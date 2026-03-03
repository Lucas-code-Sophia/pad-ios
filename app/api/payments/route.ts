import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  try {
    const { orderId, amount, paymentMethod, tableId, splitMode, itemQuantities, discount, tipAmount, recordedBy } =
      await request.json()
    const supabase = await createServerClient()

    if (!recordedBy) {
      return NextResponse.json({ error: "Missing recordedBy" }, { status: 400 })
    }

    const { data: paymentData, error: paymentError } = await supabase
      .from("payments")
      .insert({
        order_id: orderId,
        amount,
        payment_method: paymentMethod,
        tip_amount: Math.max(0, Number(tipAmount) || 0),
        recorded_by: recordedBy,
        metadata: { splitMode, itemQuantities, discount },
      })
      .select()
      .single()

    if (paymentError) {
      console.error("[v0] Error recording payment:", paymentError)
      return NextResponse.json({ error: "Failed to record payment" }, { status: 500 })
    }

    if (splitMode === "items" && itemQuantities) {
      const paymentItems = []
      const selectedEntries = Object.entries(itemQuantities)
        .map(([orderItemId, quantity]) => [orderItemId, Number(quantity)] as const)
        .filter(([, quantityNum]) => quantityNum > 0)

      if (selectedEntries.length > 0) {
        const itemIds = selectedEntries.map(([orderItemId]) => orderItemId)
        const { data: orderItemsForPayment } = await supabase
          .from("order_items")
          .select("id, price")
          .in("id", itemIds)

        const priceByItemId = new Map((orderItemsForPayment || []).map((item) => [item.id, item.price]))

        for (const [orderItemId, quantityNum] of selectedEntries) {
          const itemPrice = priceByItemId.get(orderItemId)
          if (itemPrice == null) continue
          paymentItems.push({
            payment_id: paymentData.id,
            order_item_id: orderItemId,
            quantity: quantityNum,
            amount: itemPrice * quantityNum,
          })
        }
      }

      if (paymentItems.length > 0) {
        await supabase.from("payment_items").insert(paymentItems)
      }
    }

    // Get total payments for this order
    const { data: payments } = await supabase.from("payments").select("amount").eq("order_id", orderId)

    // Get order total and complimentary items
    const { data: orderItems } = await supabase.from("order_items").select("price, quantity, is_complimentary").eq("order_id", orderId)
    const { data: supplements } = await supabase
      .from("supplements")
      .select("amount, is_complimentary")
      .eq("order_id", orderId)

    // Calculer les totaux
    const itemsTotal = orderItems?.reduce((sum, item) => sum + (item.is_complimentary ? 0 : item.price * item.quantity), 0) || 0
    const supplementsTotal = supplements?.reduce((sum, sup) => sum + (sup.is_complimentary ? 0 : sup.amount), 0) || 0
    const orderTotal = itemsTotal + supplementsTotal

    // Calculer les articles offerts
    const complimentaryItemsTotal = orderItems?.reduce((sum, item) => sum + (item.is_complimentary ? item.price * item.quantity : 0), 0) || 0
    const complimentarySupplementsTotal = supplements?.reduce((sum, sup) => sum + (sup.is_complimentary ? sup.amount : 0), 0) || 0
    const complimentaryItemsCount = orderItems?.filter(item => item.is_complimentary).reduce((sum, item) => sum + item.quantity, 0) || 0
    const complimentarySupplementsCount = supplements?.filter(sup => sup.is_complimentary).length || 0
    
    const totalComplimentaryAmount = complimentaryItemsTotal + complimentarySupplementsTotal
    const totalComplimentaryCount = complimentaryItemsCount + complimentarySupplementsCount

    const paidTotal = payments?.reduce((sum, payment) => sum + Number.parseFloat(payment.amount.toString()), 0) || 0
    const remainingAmount = orderTotal - paidTotal

    const isFullyPaid = remainingAmount <= 0.01 // Allow for small rounding errors

    if (isFullyPaid) {
      await supabase.from("orders").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", orderId)
      
      // Récupérer les infos de la table AVANT de la libérer
      const { data: tableData } = await supabase.from("tables").select("table_number, opened_by, opened_by_name").eq("id", tableId).single()
      
      await supabase.from("tables").update({ status: "available", opened_by: null, opened_by_name: null }).eq("id", tableId)

      const { data: orderData } = await supabase.from("orders").select("server_id, table_id, created_at").eq("id", orderId).single()

      // Utiliser le nom de la personne qui a ouvert la table si disponible, sinon le serveur de la commande
      const { data: serverData } = await supabase.from("users").select("name").eq("id", tableData?.opened_by || orderData?.server_id).single()

      // Use the order creation date for sales records
      const saleDate = orderData?.created_at ? new Date(orderData.created_at).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]

      await supabase.from("daily_sales").insert({
        date: saleDate,
        table_id: tableId,
        table_number: tableData?.table_number || "",
        order_id: orderId,
        server_id: tableData?.opened_by || orderData?.server_id,
        server_name: tableData?.opened_by_name || serverData?.name || "",
        total_amount: orderTotal,
        complimentary_amount: totalComplimentaryAmount,
        complimentary_count: totalComplimentaryCount,
        payment_method: paymentMethod,
      })
    }

    return NextResponse.json({
      success: true,
      isFullyPaid,
      paidTotal,
      remainingAmount: Math.max(0, remainingAmount),
      orderTotal,
    })
  } catch (error) {
    console.error("[v0] Error in payments API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get("orderId")

    if (!orderId) {
      return NextResponse.json({ error: "Order ID required" }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data: payments, error } = await supabase
      .from("payments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching payments:", error)
      return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 })
    }

    if (!payments || payments.length === 0) {
      return NextResponse.json([])
    }

    const paymentIds = payments.map((payment) => payment.id)
    const { data: allItems, error: itemsError } = await supabase
      .from("payment_items")
      .select("*")
      .in("payment_id", paymentIds)

    if (itemsError) {
      console.error("[v0] Error fetching payment items:", itemsError)
      return NextResponse.json({ error: "Failed to fetch payment items" }, { status: 500 })
    }

    const itemsByPaymentId = new Map<string, any[]>()
    for (const item of allItems || []) {
      const existing = itemsByPaymentId.get(item.payment_id) || []
      existing.push(item)
      itemsByPaymentId.set(item.payment_id, existing)
    }

    const paymentsWithItems = payments.map((payment) => ({
      ...payment,
      items: itemsByPaymentId.get(payment.id) || [],
    }))

    return NextResponse.json(paymentsWithItems)
  } catch (error) {
    console.error("[v0] Error in payments GET API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
