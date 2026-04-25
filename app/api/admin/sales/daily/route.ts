import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { RESTAURANT_OPENING_DATE, isBeforeRestaurantOpeningDate } from "@/lib/restaurant-opening"
import { getBusinessDateIso, shiftIsoDate } from "@/lib/business-date"

export async function GET() {
  try {
    const supabase = await createClient()

    const today = getBusinessDateIso()

    if (isBeforeRestaurantOpeningDate(today)) {
      return NextResponse.json({
        date: today,
        total_sales: 0,
        total_sales_ht: 0,
        total_tax: 0,
        order_count: 0,
        average_ticket: 0,
      })
    }

    const windowStartIso = `${shiftIsoDate(today, -1)}T00:00:00.000Z`
    const windowEndIso = `${shiftIsoDate(today, 1)}T23:59:59.999Z`

    const { data: salesWindow, error: dailyError } = await supabase
      .from("daily_sales")
      .select("*")
      .gte("created_at", windowStartIso)
      .lte("created_at", windowEndIso)
      .gte("date", RESTAURANT_OPENING_DATE)
    if (dailyError) throw dailyError

    const dailySales = (salesWindow || []).filter((sale: any) => {
      const saleBusinessDate = sale?.created_at ? getBusinessDateIso(sale.created_at) : String(sale?.date || "")
      return saleBusinessDate === today
    })

    const totalSales = dailySales?.reduce((sum, record) => sum + Number.parseFloat(record.total_amount), 0) || 0
    const orderCount = dailySales?.length || 0

    const orderIds = (dailySales || []).map((sale: any) => sale.order_id).filter(Boolean)
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

    const totalSalesHT = totalSales - totalTax
    const averageTicket = orderCount > 0 ? totalSales / orderCount : 0

    return NextResponse.json({
      date: today,
      total_sales: totalSales,
      total_sales_ht: totalSalesHT,
      total_tax: totalTax,
      order_count: orderCount,
      average_ticket: averageTicket,
    })
  } catch (error) {
    console.error("[v0] Error fetching daily sales:", error)
    return NextResponse.json({ error: "Failed to fetch sales" }, { status: 500 })
  }
}
