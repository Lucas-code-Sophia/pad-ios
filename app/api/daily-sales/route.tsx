import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"
import { RESTAURANT_OPENING_DATE, isBeforeRestaurantOpeningDate } from "@/lib/restaurant-opening"
import { getBusinessDateIso } from "@/lib/business-date"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date") || getBusinessDateIso()
    const normalizeText = (value: unknown) =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()

    if (isBeforeRestaurantOpeningDate(date)) {
      return NextResponse.json({
        date,
        sales: [],
        statistics: {
          totalRevenue: 0,
          orderCount: 0,
          averageTicket: 0,
          totalTax: 0,
          seasonalDiscountAmount: 0,
          seasonalDiscountCount: 0,
          employeeDiscountAmount: 0,
          employeeDiscountCount: 0,
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

    let seasonalDiscountAmount = 0
    let seasonalDiscountCount = 0
    let employeeDiscountAmount = 0
    let employeeDiscountCount = 0

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
        .select("order_id, amount, tax_rate, is_complimentary, name, notes")
        .in("order_id", orderIds)

      for (const sup of supplements || []) {
        if (sup.is_complimentary) continue
        const rate = Number(sup.tax_rate ?? 10)
        const lineTotal = Number(sup.amount) || 0
        const lineTax = rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0
        totalTax += lineTax

        const normalizedName = normalizeText((sup as any).name)
        const normalizedNotes = normalizeText((sup as any).notes)
        const isSeasonalDiscount =
          normalizedName.includes("remise saisonnier -10") || normalizedNotes.includes("remise -10% saisonnier")
        const isEmployeeDiscount = normalizedName.includes("remise salarie -50") || normalizedNotes.includes("remise -50%")
        if (isSeasonalDiscount && lineTotal < 0) {
          seasonalDiscountAmount += Math.abs(lineTotal)
          seasonalDiscountCount += 1
        }
        if (isEmployeeDiscount && lineTotal < 0) {
          employeeDiscountAmount += Math.abs(lineTotal)
          employeeDiscountCount += 1
        }
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
        seasonalDiscountAmount,
        seasonalDiscountCount,
        employeeDiscountAmount,
        employeeDiscountCount,
      },
      serverStats: Object.values(serverStats || {}),
    })
  } catch (error) {
    console.error("[v0] Error in daily sales API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
