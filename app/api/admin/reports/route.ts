import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  RESTAURANT_OPENING_DATE,
  clampDateToRestaurantOpening,
  isBeforeRestaurantOpeningDate,
} from "@/lib/restaurant-opening"
import { getBusinessDateIso, getBusinessHour, shiftIsoDate } from "@/lib/business-date"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const period = searchParams.get("period") || "7days"
    const customStartDate = searchParams.get("startDate")
    const customEndDate = searchParams.get("endDate")
    const todayDateParam = searchParams.get("todayDate")
    const isIsoDate = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
    const resolvedTodayDate = isIsoDate(todayDateParam) ? String(todayDateParam) : getBusinessDateIso()

    const supabase = await createClient()
    const PAGE_SIZE = 1000
    const ORDER_ID_CHUNK_SIZE = 200
    const MENU_ID_CHUNK_SIZE = 500

    const fetchRowsByOrderIds = async (table: "order_items" | "supplements", select: string, orderIds: string[]) => {
      const rows: any[] = []
      if (orderIds.length === 0) return rows

      for (let i = 0; i < orderIds.length; i += ORDER_ID_CHUNK_SIZE) {
        const orderIdChunk = orderIds.slice(i, i + ORDER_ID_CHUNK_SIZE)
        let offset = 0

        while (true) {
          const { data, error } = await supabase
            .from(table)
            .select(select)
            .in("order_id", orderIdChunk)
            .order("id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1)

          if (error) throw error
          if (!data || data.length === 0) break

          rows.push(...data)
          if (data.length < PAGE_SIZE) break
          offset += PAGE_SIZE
        }
      }

      return rows
    }

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()

    if (period === "custom" && customStartDate && customEndDate) {
      startDate.setTime(new Date(customStartDate).getTime())
      endDate.setTime(new Date(customEndDate).getTime())
    } else if (period === "today") {
      // Aujourd'hui : même jour pour début et fin
      // Pas besoin de modifier les dates, on utilise today
    } else {
      switch (period) {
        case "7days":
          startDate.setDate(endDate.getDate() - 6)
          break
        case "30days":
          startDate.setDate(endDate.getDate() - 29)
          break
        case "3months":
          startDate.setMonth(endDate.getMonth() - 3)
          break
      }
    }

    const startDateStr = period === "today" ? resolvedTodayDate : startDate.toISOString().split("T")[0]
    const endDateStr = period === "today" ? resolvedTodayDate : endDate.toISOString().split("T")[0]
    const effectiveStartDateStr = clampDateToRestaurantOpening(startDateStr)

    if (isBeforeRestaurantOpeningDate(endDateStr)) {
      return NextResponse.json({
        salesData: [],
        hourlySales: [],
        topDishes: [],
        serverStats: [],
        stats: {
          totalSales: 0,
          totalSalesHT: 0,
          totalOrders: 0,
          averageTicket: 0,
          dailyAverage: 0,
          activeDays: 0,
          totalPeriodDays: 0,
          totalTax: 0,
          taxRate10Share: 0,
          taxRate20Share: 0,
          totalComplimentaryAmount: 0,
          totalComplimentaryCount: 0,
          totalCovers: 0,
          averageCoversPerOrder: 0,
          revenuePerCover: 0,
          dailyAverageCovers: 0,
          avgDurationMin: 0,
          minDuration: 0,
          maxDuration: 0,
          tablesWithDuration: 0,
          complimentaryPercentage: 0,
          paymentMix: {
            volume: { cash: 0, card: 0, other: 0 },
            value: { cash: 0, card: 0, other: 0 },
          },
        },
      })
    }

    // Fetch daily sales data (paginated to avoid default row limits)
    const dailySales: any[] = []
    let salesOffset = 0
    const todayWindowStartIso = `${shiftIsoDate(resolvedTodayDate, -1)}T00:00:00.000Z`
    const todayWindowEndIso = `${shiftIsoDate(resolvedTodayDate, 1)}T23:59:59.999Z`
    while (true) {
      const salesPageQuery =
        period === "today"
          ? supabase
              .from("daily_sales")
              .select("*")
              .gte("created_at", todayWindowStartIso)
              .lte("created_at", todayWindowEndIso)
              .order("created_at", { ascending: true })
              .range(salesOffset, salesOffset + PAGE_SIZE - 1)
          : supabase
              .from("daily_sales")
              .select("*")
              .gte("date", effectiveStartDateStr)
              .lte("date", endDateStr)
              .order("date", { ascending: true })
              .order("created_at", { ascending: true })
              .range(salesOffset, salesOffset + PAGE_SIZE - 1)

      const { data: salesPage, error: salesPageError } = await salesPageQuery

      if (salesPageError) throw salesPageError
      if (!salesPage || salesPage.length === 0) break

      dailySales.push(...salesPage)
      if (salesPage.length < PAGE_SIZE) break
      salesOffset += PAGE_SIZE
    }

    if (period === "today") {
      const filteredSales = dailySales.filter((sale: any) => {
        const saleBusinessDate = sale?.created_at ? getBusinessDateIso(sale.created_at) : String(sale?.date || "")
        return saleBusinessDate === resolvedTodayDate
      })
      dailySales.length = 0
      dailySales.push(...filteredSales)
    }

    // Group by date for chart
    const salesByDate = (dailySales || []).reduce((acc: any, sale: any) => {
      const date = sale.date
      if (!acc[date]) {
        acc[date] = { date, total: 0, orders: 0, complimentary: 0, complimentaryCount: 0 }
      }
      acc[date].total += Number.parseFloat(sale.total_amount)
      acc[date].orders += 1
      acc[date].complimentary += Number.parseFloat(sale.complimentary_amount || 0)
      acc[date].complimentaryCount += parseInt(sale.complimentary_count || 0)
      return acc
    }, {})

    const salesData = Object.values(salesByDate)

    // Calculate stats
    const totalSales = (dailySales || []).reduce(
      (sum: number, sale: any) => sum + Number.parseFloat(sale.total_amount),
      0,
    )
    const totalOrders = (dailySales || []).length
    const averageTicket = totalOrders > 0 ? totalSales / totalOrders : 0
    const cashOrders = (dailySales || []).filter((sale: any) => sale.payment_method === "cash").length
    const cardOrders = (dailySales || []).filter((sale: any) => sale.payment_method === "card").length
    const otherOrders = (dailySales || []).filter(
      (sale: any) => sale.payment_method && !["cash", "card"].includes(sale.payment_method),
    ).length

    const cashAmount = (dailySales || [])
      .filter((sale: any) => sale.payment_method === "cash")
      .reduce((sum: number, sale: any) => sum + Number.parseFloat(sale.total_amount), 0)
    const cardAmount = (dailySales || [])
      .filter((sale: any) => sale.payment_method === "card")
      .reduce((sum: number, sale: any) => sum + Number.parseFloat(sale.total_amount), 0)
    const otherAmount = (dailySales || [])
      .filter((sale: any) => sale.payment_method && !["cash", "card"].includes(sale.payment_method))
      .reduce((sum: number, sale: any) => sum + Number.parseFloat(sale.total_amount), 0)

    // Calculate complimentary stats
    const totalComplimentaryAmount = (dailySales || []).reduce(
      (sum: number, sale: any) => sum + Number.parseFloat(sale.complimentary_amount || 0),
      0,
    )
    const totalComplimentaryCount = (dailySales || []).reduce(
      (sum: number, sale: any) => sum + parseInt(sale.complimentary_count || 0),
      0,
    )

    // Calculate TVA and top dishes from all sold order lines in range.
    const orderIds = (dailySales || []).map((sale: any) => sale.order_id).filter(Boolean)
    const uniqueOrderIds = Array.from(new Set(orderIds))
    const orderIdToServer = new Map(
      (dailySales || []).map((sale: any) => [sale.order_id, sale.server_name || "Inconnu"]),
    )
    const orderIdToDate = new Map(
      (dailySales || []).map((sale: any) => [sale.order_id, String(sale.date || "")]),
    )

    const allOrderItems = await fetchRowsByOrderIds(
      "order_items",
      "order_id, menu_item_id, quantity, price, is_complimentary",
      uniqueOrderIds,
    )
    const allSupplements = await fetchRowsByOrderIds(
      "supplements",
      "order_id, amount, tax_rate, is_complimentary",
      uniqueOrderIds,
    )

    const uniqueMenuItemIds = Array.from(new Set(allOrderItems.map((item: any) => item.menu_item_id).filter(Boolean)))
    const menuMetaById = new Map<string, { name: string; tax_rate: number }>()
    for (let i = 0; i < uniqueMenuItemIds.length; i += MENU_ID_CHUNK_SIZE) {
      const menuIdChunk = uniqueMenuItemIds.slice(i, i + MENU_ID_CHUNK_SIZE)
      const { data: menuChunk, error: menuChunkError } = await supabase
        .from("menu_items")
        .select("id, name, tax_rate")
        .in("id", menuIdChunk)
      if (menuChunkError) throw menuChunkError
      for (const item of menuChunk || []) {
        menuMetaById.set(item.id, { name: item.name, tax_rate: Number(item.tax_rate) || 0 })
      }
    }

    let totalTax = 0
    let rate10Sales = 0
    let rate20Sales = 0
    const taxByServer: Record<string, number> = {}
    const dishStats: Record<
      string,
      {
        menu_item_id: string
        name: string
        quantity: number
        revenue: number
        byDate: Record<string, number>
      }
    > = {}

    for (const item of allOrderItems || []) {
      if (!item?.menu_item_id || item.is_complimentary) continue
      const quantity = Number(item.quantity || 0)
      if (quantity <= 0) continue

      const meta = menuMetaById.get(item.menu_item_id)
      if (!meta) continue

      const lineTotal = Number(item.price || 0) * quantity
      const rate = meta.tax_rate
      const lineTax = rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0
      totalTax += lineTax

      const serverName = orderIdToServer.get(item.order_id) || "Inconnu"
      taxByServer[serverName] = (taxByServer[serverName] || 0) + lineTax
      if (rate === 10) rate10Sales += lineTotal
      if (rate === 20) rate20Sales += lineTotal

      if (!dishStats[item.menu_item_id]) {
        dishStats[item.menu_item_id] = {
          menu_item_id: item.menu_item_id,
          name: meta.name,
          quantity: 0,
          revenue: 0,
          byDate: {},
        }
      }
      dishStats[item.menu_item_id].quantity += quantity
      dishStats[item.menu_item_id].revenue += lineTotal

      const saleDate = orderIdToDate.get(item.order_id)
      if (saleDate) {
        dishStats[item.menu_item_id].byDate[saleDate] = (dishStats[item.menu_item_id].byDate[saleDate] || 0) + quantity
      }
    }

    for (const sup of allSupplements || []) {
      if (sup?.is_complimentary) continue
      const rate = Number(sup?.tax_rate ?? 10)
      const lineTotal = Number(sup?.amount) || 0
      const lineTax = rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0

      totalTax += lineTax
      const serverName = orderIdToServer.get(sup?.order_id) || "Inconnu"
      taxByServer[serverName] = (taxByServer[serverName] || 0) + lineTax
      if (rate === 10) rate10Sales += lineTotal
      if (rate === 20) rate20Sales += lineTotal
    }

    const totalSalesHT = totalSales - totalTax
    const taxRate10Share = totalSales > 0 ? (rate10Sales / totalSales) * 100 : 0
    const taxRate20Share = totalSales > 0 ? (rate20Sales / totalSales) * 100 : 0

    const topDishes = Object.values(dishStats)
      .sort((a: any, b: any) => b.quantity - a.quantity)
      .slice(0, 100)
      .map((dish) => {
        const dailySales = Object.entries(dish.byDate)
          .map(([date, quantity]) => ({ date, quantity }))
          .sort((a, b) => a.date.localeCompare(b.date))
        const bestDay =
          dailySales.length > 0
            ? dailySales.reduce((best, current) => (current.quantity > best.quantity ? current : best))
            : null

        return {
          menu_item_id: dish.menu_item_id,
          name: dish.name,
          quantity: dish.quantity,
          revenue: dish.revenue,
          dailySales,
          bestDay,
        }
      })

    // Fetch server stats
    const serverStatsMap = (dailySales || []).reduce((acc: any, sale: any) => {
      const serverName = sale.server_name || "Inconnu"
      if (!acc[serverName]) {
        acc[serverName] = {
          server_name: serverName,
          total_sales: 0,
          order_count: 0,
          complimentary_amount: 0,
          complimentary_count: 0,
        }
      }
      acc[serverName].total_sales += Number.parseFloat(sale.total_amount)
      acc[serverName].order_count += 1
      acc[serverName].complimentary_amount += Number.parseFloat(sale.complimentary_amount || 0)
      acc[serverName].complimentary_count += parseInt(sale.complimentary_count || 0)
      return acc
    }, {})

    // ── Hourly sales breakdown (based on table open time, not payment time) ──
    const hourlyMap: Record<number, { hour: number; total: number; orders: number }> = {}
    for (let h = 0; h < 24; h++) {
      hourlyMap[h] = { hour: h, total: 0, orders: 0 }
    }

    // Fetch order open/close/cover data in chunks to avoid row limits.
    const ordersForStats: Array<{ id: string; covers: number | null; created_at: string | null; closed_at: string | null }> = []
    if (uniqueOrderIds.length > 0) {
      for (let i = 0; i < uniqueOrderIds.length; i += ORDER_ID_CHUNK_SIZE) {
        const orderIdChunk = uniqueOrderIds.slice(i, i + ORDER_ID_CHUNK_SIZE)
        const { data: ordersChunk, error: ordersChunkError } = await supabase
          .from("orders")
          .select("id, covers, created_at, closed_at")
          .in("id", orderIdChunk)

        if (ordersChunkError) throw ordersChunkError
        ordersForStats.push(...(ordersChunk || []))
      }
    }

    const orderOpenTimeMap = new Map<string, string>()
    for (const order of ordersForStats) {
      if (order?.id && order.created_at) {
        orderOpenTimeMap.set(order.id, order.created_at)
      }
    }

    for (const sale of dailySales || []) {
      // Use order open time if available, fallback to sale created_at
      const openTime = sale.order_id ? orderOpenTimeMap.get(sale.order_id) : null
      const timestamp = openTime || sale.created_at
      if (!timestamp) continue
      const hour = getBusinessHour(timestamp)
      if (hour == null) continue
      hourlyMap[hour].total += Number.parseFloat(sale.total_amount)
      hourlyMap[hour].orders += 1
    }

    // Active days should follow sales dates from daily_sales to avoid timezone drift.
    const activeDaySet = new Set(
      (dailySales || []).map((sale: any) => String(sale.date || "")).filter((value: string) => value.length > 0),
    )
    const activeDays = activeDaySet.size
    const numDays = Math.max(activeDays, 1)
    const hourlySales = Object.values(hourlyMap)
      .filter((h) => h.total > 0 || (h.hour >= 10 && h.hour <= 23)) // Only show relevant hours
      .map((h) => ({
        hour: `${h.hour}h`,
        total: Math.round(h.total * 100) / 100,
        orders: h.orders,
        average: Math.round((h.total / numDays) * 100) / 100,
      }))

    // ── Days open / closed calculation ──
    // Calculate total calendar days in the period
    const periodStartMs = new Date(effectiveStartDateStr).getTime()
    const periodEndMs = new Date(endDateStr).getTime()
    const totalPeriodDays = Math.max(1, Math.round((periodEndMs - periodStartMs) / (1000 * 60 * 60 * 24)) + 1)
    const dailyAverage = activeDays > 0 ? totalSales / activeDays : 0

    // ── Covers (couverts) & Duration stats ──
    let totalCovers = 0
    let ordersWithCovers = 0
    const durations: number[] = []
    const serverDurationMap: Record<string, { totalDuration: number; count: number }> = {}
    const serverCoversMap: Record<string, number> = {}
    const orderToServer = new Map(
      (dailySales || []).map((sale: any) => [sale.order_id, sale.server_name || "Inconnu"]),
    )

    for (const order of ordersForStats) {
      if (order.covers != null && order.covers > 0) {
        totalCovers += order.covers
        ordersWithCovers++
        const serverName = orderToServer.get(order.id) || "Inconnu"
        serverCoversMap[serverName] = (serverCoversMap[serverName] || 0) + order.covers
      }

      // Duration calculation (only if closed_at exists and duration is reasonable: < 6h)
      if (order.created_at && order.closed_at) {
        const durationMin = (new Date(order.closed_at).getTime() - new Date(order.created_at).getTime()) / 60000
        if (durationMin > 0 && durationMin < 360) {
          durations.push(durationMin)
          const serverName = orderToServer.get(order.id) || "Inconnu"
          if (!serverDurationMap[serverName]) {
            serverDurationMap[serverName] = { totalDuration: 0, count: 0 }
          }
          serverDurationMap[serverName].totalDuration += durationMin
          serverDurationMap[serverName].count += 1
        }
      }
    }
    const averageCoversPerOrder = ordersWithCovers > 0 ? totalCovers / ordersWithCovers : 0
    const revenuePerCover = totalCovers > 0 ? totalSales / totalCovers : 0
    const dailyAverageCovers = activeDays > 0 ? totalCovers / activeDays : 0
    const avgDurationMin = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0

    // ── Build final server stats (after duration data is available) ──
    const serverStats = Object.values(serverStatsMap).map((server: any) => {
      const durationData = serverDurationMap[server.server_name]
      const serverCovers = serverCoversMap[server.server_name] || 0
      return {
        ...server,
        total_sales_ht: server.total_sales - (taxByServer[server.server_name] || 0),
        average_ticket: server.order_count > 0 ? server.total_sales / server.order_count : 0,
        complimentary_percentage: server.total_sales > 0 ? (server.complimentary_amount / server.total_sales) * 100 : 0,
        avg_duration: durationData ? Math.round(durationData.totalDuration / durationData.count) : null,
        total_covers: serverCovers,
        revenue_per_cover: serverCovers > 0 ? server.total_sales / serverCovers : null,
      }
    })

    return NextResponse.json({
      salesData,
      hourlySales,
      topDishes,
      serverStats,
      stats: {
        totalSales,
        totalSalesHT,
        totalOrders,
        averageTicket,
        dailyAverage,
        activeDays,
        totalPeriodDays,
        totalTax,
        taxRate10Share,
        taxRate20Share,
        totalComplimentaryAmount,
        totalComplimentaryCount,
        totalCovers,
        averageCoversPerOrder,
        revenuePerCover,
        dailyAverageCovers,
        avgDurationMin: Math.round(avgDurationMin),
        minDuration: Math.round(minDuration),
        maxDuration: Math.round(maxDuration),
        tablesWithDuration: durations.length,
        complimentaryPercentage: totalSales > 0 ? (totalComplimentaryAmount / totalSales) * 100 : 0,
        paymentMix: {
          volume: {
            cash: totalOrders > 0 ? (cashOrders / totalOrders) * 100 : 0,
            card: totalOrders > 0 ? (cardOrders / totalOrders) * 100 : 0,
            other: totalOrders > 0 ? (otherOrders / totalOrders) * 100 : 0,
          },
          value: {
            cash: totalSales > 0 ? (cashAmount / totalSales) * 100 : 0,
            card: totalSales > 0 ? (cardAmount / totalSales) * 100 : 0,
            other: totalSales > 0 ? (otherAmount / totalSales) * 100 : 0,
          },
        },
      },
    })
  } catch (error) {
    console.error("[v0] Error fetching reports:", error)
    return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 })
  }
}
