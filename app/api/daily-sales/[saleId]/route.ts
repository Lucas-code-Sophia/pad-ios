import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"
import { isBeforeRestaurantOpeningDate } from "@/lib/restaurant-opening"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ saleId: string }> }) {
  try {
    const { saleId } = await params
    const supabase = await createServerClient()

    const { data: sale, error: saleError } = await supabase
      .from("daily_sales")
      .select("*")
      .eq("id", saleId)
      .maybeSingle()

    if (saleError) {
      console.error("[v0] Error fetching daily sale detail:", saleError)
      return NextResponse.json({ error: "Failed to fetch transaction" }, { status: 500 })
    }

    if (!sale) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
    }

    if (sale.date && isBeforeRestaurantOpeningDate(String(sale.date))) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 })
    }

    const orderId = sale.order_id as string | null
    if (!orderId) {
      return NextResponse.json({
        sale,
        order: null,
        items: [],
        supplements: [],
        payments: [],
        paymentBreakdown: { cash: 0, card: 0, other: 0, total: 0 },
      })
    }

    const [orderResult, itemsResult, supplementsResult, paymentsResult] = await Promise.all([
      supabase.from("orders").select("id, table_id, server_id, created_at, closed_at").eq("id", orderId).maybeSingle(),
      supabase
        .from("order_items")
        .select("id, menu_item_id, quantity, price, notes, status, is_complimentary, complimentary_reason")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
      supabase
        .from("supplements")
        .select("id, name, amount, notes, is_complimentary, complimentary_reason, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
      supabase
        .from("payments")
        .select("id, amount, payment_method, tip_amount, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
    ])

    if (orderResult.error || itemsResult.error || supplementsResult.error || paymentsResult.error) {
      console.error("[v0] Error fetching transaction detail blocks:", {
        orderError: orderResult.error,
        itemsError: itemsResult.error,
        supplementsError: supplementsResult.error,
        paymentsError: paymentsResult.error,
      })
      return NextResponse.json({ error: "Failed to fetch transaction details" }, { status: 500 })
    }

    const items = itemsResult.data || []
    const menuItemIds = Array.from(new Set(items.map((item) => item.menu_item_id).filter(Boolean)))

    let menuNameById = new Map<string, string>()
    let menuTaxById = new Map<string, number>()
    if (menuItemIds.length > 0) {
      const { data: menuItemsData, error: menuError } = await supabase
        .from("menu_items")
        .select("id, name, tax_rate")
        .in("id", menuItemIds)

      if (menuError) {
        console.error("[v0] Error fetching menu names for transaction detail:", menuError)
      } else {
        menuNameById = new Map((menuItemsData || []).map((menuItem) => [menuItem.id, menuItem.name]))
        menuTaxById = new Map((menuItemsData || []).map((menuItem) => [menuItem.id, Number(menuItem.tax_rate || 0)]))
      }
    }

    const detailedItems = items.map((item) => ({
      ...item,
      menu_name: menuNameById.get(item.menu_item_id) || "Article inconnu",
      tax_rate: menuTaxById.get(item.menu_item_id) ?? 0,
      line_total: Number(item.price || 0) * Number(item.quantity || 0),
    }))

    const payments = (paymentsResult.data || []).length > 0
      ? paymentsResult.data || []
      : [
          {
            id: `fallback-${sale.id}`,
            amount: sale.total_amount,
            payment_method: sale.payment_method || "other",
            tip_amount: 0,
            created_at: sale.created_at,
          },
        ]
    const paymentBreakdown = payments.reduce(
      (acc, payment) => {
        const amount = Number(payment.amount || 0)
        if (payment.payment_method === "cash") acc.cash += amount
        else if (payment.payment_method === "card") acc.card += amount
        else acc.other += amount
        acc.total += amount
        return acc
      },
      { cash: 0, card: 0, other: 0, total: 0 },
    )

    return NextResponse.json({
      sale,
      order: orderResult.data || null,
      items: detailedItems,
      supplements: supplementsResult.data || [],
      payments,
      paymentBreakdown,
    })
  } catch (error) {
    console.error("[v0] Error in daily sale detail API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
