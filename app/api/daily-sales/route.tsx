import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"
import { RESTAURANT_OPENING_DATE, isBeforeRestaurantOpeningDate } from "@/lib/restaurant-opening"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date") || new Date().toISOString().split("T")[0]

    if (isBeforeRestaurantOpeningDate(date)) {
      return NextResponse.json({
        date,
        sales: [],
        statistics: {
          totalRevenue: 0,
          orderCount: 0,
          averageTicket: 0,
          totalTax: 0,
        },
        serverStats: [],
      })
    }

    const supabase = await createServerClient()

    // Get all sales for the specified date
    const { data: sales, error } = await supabase
      .from("daily_sales")
      .select("*")
      .eq("date", date)
      .gte("date", RESTAURANT_OPENING_DATE)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[v0] Error fetching daily sales:", error)
      return NextResponse.json({ error: "Failed to fetch daily sales" }, { status: 500 })
    }

    const totalRevenue = sales?.reduce((sum, sale) => sum + Number.parseFloat(sale.total_amount.toString()), 0) || 0
    const orderCount = sales?.length || 0
    const averageTicket = orderCount > 0 ? totalRevenue / orderCount : 0

    // Calculate TVA precisely from item tax rates
    const orderIds = (sales || []).map((sale: any) => sale.order_id).filter(Boolean)
    let totalTax = 0

    if (orderIds.length > 0) {
      const { data: orderItems } = await supabase
        .from("order_items")
        .select("order_id, menu_item_id, quantity, price, is_complimentary")
        .in("order_id", orderIds)

      const menuItemIds = Array.from(new Set((orderItems || []).map((item: any) => item.menu_item_id).filter(Boolean)))

      const { data: menuItems } = await supabase
        .from("menu_items")
        .select("id, tax_rate")
        .in("id", menuItemIds)

      const menuItemTaxMap = new Map((menuItems || []).map((item: any) => [item.id, Number(item.tax_rate) || 0]))

      for (const item of orderItems || []) {
        if (item.is_complimentary) continue
        const rate = menuItemTaxMap.get(item.menu_item_id) || 0
        const lineTotal = Number(item.price) * Number(item.quantity || 0)
        const lineTax = rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0
        totalTax += lineTax
      }

      const { data: supplements } = await supabase
        .from("supplements")
        .select("order_id, amount, tax_rate, is_complimentary")
        .in("order_id", orderIds)

      for (const sup of supplements || []) {
        if (sup.is_complimentary) continue
        const rate = Number(sup.tax_rate ?? 10)
        const lineTotal = Number(sup.amount) || 0
        const lineTax = rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0
        totalTax += lineTax
      }
    }

    // Group by server
    const serverStats = sales?.reduce((acc: any, sale) => {
      const serverId = sale.server_id
      if (!acc[serverId]) {
        acc[serverId] = {
          server_id: serverId,
          server_name: sale.server_name,
          total_revenue: 0,
          order_count: 0,
          tables: [],
        }
      }
      acc[serverId].total_revenue += Number.parseFloat(sale.total_amount.toString())
      acc[serverId].order_count += 1
      acc[serverId].tables.push({
        table_number: sale.table_number,
        amount: sale.total_amount,
        payment_method: sale.payment_method,
        created_at: sale.created_at,
      })
      return acc
    }, {})

    return NextResponse.json({
      date,
      sales: sales || [],
      statistics: {
        totalRevenue,
        orderCount,
        averageTicket,
        totalTax,
      },
      serverStats: Object.values(serverStats || {}),
    })
  } catch (error) {
    console.error("[v0] Error in daily sales API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
