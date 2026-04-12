import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const roundCurrency = (value: number) => Math.round((Number(value) || 0) * 100) / 100

const toSupportedTaxRate = (value: unknown): 10 | 20 | null => {
  const rate = Number(value)
  if (rate === 10 || rate === 20) return rate
  return null
}

type EmployeeDiscountBreakdown = {
  taxRate: 10 | 20
  amount: number
}

type EmployeeDiscountConfig = {
  scope: "full" | "items"
  amount: number
  breakdown: EmployeeDiscountBreakdown[]
}

export async function POST(request: NextRequest) {
  try {
    const { orderId, amount, paymentMethod, tableId, splitMode, itemQuantities, discount, tipAmount, recordedBy } =
      await request.json()
    const supabase = await createServerClient()

    if (!recordedBy) {
      return NextResponse.json({ error: "Missing recordedBy" }, { status: 400 })
    }

    const paymentAmount = roundCurrency(toNumber(amount))
    if (paymentAmount <= 0) {
      return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 })
    }
    const safeTipAmount = roundCurrency(Math.max(0, toNumber(tipAmount)))

    let employeeDiscount: EmployeeDiscountConfig | null = null

    if (discount && typeof discount === "object" && discount.type === "employee_50") {
      const { data: requester, error: requesterError } = await supabase
        .from("users")
        .select("role")
        .eq("id", recordedBy)
        .maybeSingle()

      if (requesterError || !requester || requester.role !== "manager") {
        return NextResponse.json({ error: "Employee discount is manager-only" }, { status: 403 })
      }

      const discountAmount = roundCurrency(Math.max(0, toNumber(discount.amount)))
      if (discountAmount <= 0) {
        return NextResponse.json({ error: "Invalid employee discount amount" }, { status: 400 })
      }

      // -50% salarié => le montant encaissé doit correspondre au montant de remise.
      if (Math.abs(discountAmount - paymentAmount) > 0.1) {
        return NextResponse.json({ error: "Employee discount mismatch with payment amount" }, { status: 400 })
      }

      const scope: "full" | "items" = discount.scope === "items" ? "items" : "full"
      const breakdownInput = Array.isArray(discount.breakdown) ? discount.breakdown : []

      let normalizedBreakdown = breakdownInput
        .map((entry: any) => {
          const taxRate = toSupportedTaxRate(entry?.taxRate)
          const entryAmount = roundCurrency(Math.max(0, toNumber(entry?.amount)))
          if (!taxRate || entryAmount <= 0) return null
          return { taxRate, amount: entryAmount }
        })
        .filter(Boolean) as EmployeeDiscountBreakdown[]

      if (normalizedBreakdown.length === 0) {
        normalizedBreakdown = [{ taxRate: 10, amount: discountAmount }]
      } else {
        const breakdownTotal = normalizedBreakdown.reduce((sum, row) => sum + row.amount, 0)
        if (breakdownTotal <= 0) {
          normalizedBreakdown = [{ taxRate: 10, amount: discountAmount }]
        } else {
          const scaledRows = normalizedBreakdown.map((row) => ({
            taxRate: row.taxRate,
            amount: roundCurrency((row.amount / breakdownTotal) * discountAmount),
          }))
          const scaledTotal = scaledRows.reduce((sum, row) => sum + row.amount, 0)
          const delta = roundCurrency(discountAmount - scaledTotal)
          if (scaledRows.length > 0 && Math.abs(delta) > 0) {
            scaledRows[scaledRows.length - 1].amount = roundCurrency(scaledRows[scaledRows.length - 1].amount + delta)
          }
          normalizedBreakdown = scaledRows.filter((row) => row.amount > 0)
          if (normalizedBreakdown.length === 0) {
            normalizedBreakdown = [{ taxRate: 10, amount: discountAmount }]
          }
        }
      }

      employeeDiscount = { scope, amount: discountAmount, breakdown: normalizedBreakdown }
    }

    const { data: paymentData, error: paymentError } = await supabase
      .from("payments")
      .insert({
        order_id: orderId,
        amount: paymentAmount,
        payment_method: paymentMethod,
        tip_amount: safeTipAmount,
        recorded_by: recordedBy,
        metadata: { splitMode, itemQuantities, discount: employeeDiscount },
      })
      .select()
      .single()

    if (paymentError) {
      console.error("[v0] Error recording payment:", paymentError)
      return NextResponse.json({ error: "Failed to record payment" }, { status: 500 })
    }

    if (employeeDiscount) {
      const discountSupplements = employeeDiscount.breakdown.map((row) => ({
        order_id: orderId,
        name: "Remise salarié -50 %",
        amount: -roundCurrency(row.amount),
        tax_rate: row.taxRate,
        notes:
          employeeDiscount.scope === "items"
            ? "Remise -50% sur les articles sélectionnés"
            : "Remise -50% sur l'addition",
        is_complimentary: false,
      }))

      const { error: discountError } = await supabase.from("supplements").insert(discountSupplements)
      if (discountError) {
        console.error("[v0] Error applying employee discount:", discountError)
        await supabase.from("payments").delete().eq("id", paymentData.id)
        return NextResponse.json({ error: "Failed to apply employee discount" }, { status: 500 })
      }
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
    const { data: payments } = await supabase
      .from("payments")
      .select("amount, payment_method")
      .eq("order_id", orderId)

    // Get order total and complimentary items
    const { data: orderItems } = await supabase.from("order_items").select("price, quantity, is_complimentary").eq("order_id", orderId)
    const { data: supplements } = await supabase
      .from("supplements")
      .select("amount, is_complimentary")
      .eq("order_id", orderId)

    // Calculer les totaux
    const itemsTotal = orderItems?.reduce((sum, item) => sum + (item.is_complimentary ? 0 : toNumber(item.price) * toNumber(item.quantity)), 0) || 0
    const supplementsTotal = supplements?.reduce((sum, sup) => sum + (sup.is_complimentary ? 0 : toNumber(sup.amount)), 0) || 0
    const orderTotal = itemsTotal + supplementsTotal

    // Calculer les articles offerts
    const complimentaryItemsTotal = orderItems?.reduce((sum, item) => sum + (item.is_complimentary ? toNumber(item.price) * toNumber(item.quantity) : 0), 0) || 0
    const complimentarySupplementsTotal = supplements?.reduce((sum, sup) => sum + (sup.is_complimentary ? toNumber(sup.amount) : 0), 0) || 0
    const complimentaryItemsCount = orderItems?.filter(item => item.is_complimentary).reduce((sum, item) => sum + toNumber(item.quantity), 0) || 0
    const complimentarySupplementsCount = supplements?.filter(sup => sup.is_complimentary).length || 0
    
    const totalComplimentaryAmount = complimentaryItemsTotal + complimentarySupplementsTotal
    const totalComplimentaryCount = complimentaryItemsCount + complimentarySupplementsCount

    const paidTotal = payments?.reduce((sum, payment) => sum + Number.parseFloat(payment.amount.toString()), 0) || 0
    const remainingAmount = orderTotal - paidTotal

    const isFullyPaid = remainingAmount <= 0.01 // Allow for small rounding errors

    // Classify the final payment mode for the sale record.
    // If multiple methods were used, keep an explicit "mixed" flag.
    const normalizedPaymentMethods = Array.from(
      new Set(
        (payments || [])
          .filter((payment) => Number(payment.amount || 0) > 0.009)
          .map((payment) => {
            const method = String(payment.payment_method || "").toLowerCase()
            if (method === "cash" || method === "card") return method
            return "other"
          }),
      ),
    )
    const salePaymentMethod =
      normalizedPaymentMethods.length === 1
        ? normalizedPaymentMethods[0]
        : normalizedPaymentMethods.length > 1
          ? "mixed"
          : paymentMethod

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
        payment_method: salePaymentMethod,
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
