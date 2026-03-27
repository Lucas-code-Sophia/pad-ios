import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  RESTAURANT_OPENING_DATE,
  clampDateToRestaurantOpening,
  isBeforeRestaurantOpeningDate,
} from "@/lib/restaurant-opening"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const period = searchParams.get("period") || "7days"
    const customStartDate = searchParams.get("startDate")
    const customEndDate = searchParams.get("endDate")

    const supabase = await createClient()

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
          startDate.setDate(endDate.getDate() - 7)
          break
        case "30days":
          startDate.setDate(endDate.getDate() - 30)
          break
        case "3months":
          startDate.setMonth(endDate.getMonth() - 3)
          break
      }
    }

    const startDateStr = period === "today" ? new Date().toISOString().split("T")[0] : startDate.toISOString().split("T")[0]
    const endDateStr = period === "today" ? new Date().toISOString().split("T")[0] : endDate.toISOString().split("T")[0]
    const effectiveStartDateStr = clampDateToRestaurantOpening(startDateStr)
    const effectiveStartTimestamp = `${effectiveStartDateStr}T00:00:00.000Z`
    const effectiveEndTimestamp = `${endDateStr}T23:59:59.999Z`

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

    // Fetch daily sales data
    const { data: dailySales } = await supabase
      .from("daily_sales")
      .select("*")
      .gte("date", effectiveStartDateStr)
      .lte("date", endDateStr)
      .order("date", { ascending: true })

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

    // Calculate TVA precisely from item tax rates
    const orderIds = (dailySales || []).map((sale: any) => sale.order_id).filter(Boolean)
    const orderIdToServer = new Map(
      (dailySales || []).map((sale: any) => [sale.order_id, sale.server_name || "Inconnu"]),
    )

    let totalTax = 0
    let rate10Sales = 0
    let rate20Sales = 0
    const taxByServer: Record<string, number> = {}

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
        const serverName = orderIdToServer.get(item.order_id) || "Inconnu"
        taxByServer[serverName] = (taxByServer[serverName] || 0) + lineTax
        if (rate === 10) rate10Sales += lineTotal
        if (rate === 20) rate20Sales += lineTotal
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
        const serverName = orderIdToServer.get(sup.order_id) || "Inconnu"
        taxByServer[serverName] = (taxByServer[serverName] || 0) + lineTax
        if (rate === 10) rate10Sales += lineTotal
        if (rate === 20) rate20Sales += lineTotal
      }
    }

    const totalSalesHT = totalSales - totalTax
    const taxRate10Share = totalSales > 0 ? (rate10Sales / totalSales) * 100 : 0
    const taxRate20Share = totalSales > 0 ? (rate20Sales / totalSales) * 100 : 0

    // Fetch top dishes
    const { data: orderItems } = await supabase
      .from("order_items")
      .select(`
        menu_item_id,
        quantity,
        price,
        created_at
      `)
      .gte("created_at", effectiveStartTimestamp)
      .lte("created_at", effectiveEndTimestamp)

    const { data: menuItems } = await supabase.from("menu_items").select("*")

    const dishStats = (orderItems || []).reduce((acc: any, item: any) => {
      const menuItem = menuItems?.find((m: any) => m.id === item.menu_item_id)
      if (menuItem) {
        if (!acc[item.menu_item_id]) {
          acc[item.menu_item_id] = {
            name: menuItem.name,
            quantity: 0,
            revenue: 0,
          }
        }
        acc[item.menu_item_id].quantity += item.quantity
        acc[item.menu_item_id].revenue += item.quantity * Number.parseFloat(item.price)
      }
      return acc
    }, {})

    const topDishes = Object.values(dishStats)
      .sort((a: any, b: any) => b.quantity - a.quantity)
      .slice(0, 10)

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
    const daysInPeriod = new Set<string>()

    // Fetch order open times for all sales
    const saleOrderIds = (dailySales || []).map((s: any) => s.order_id).filter(Boolean)
    const orderOpenTimeMap = new Map<string, string>()
    if (saleOrderIds.length > 0) {
      const { data: orderTimes } = await supabase
        .from("orders")
        .select("id, created_at")
        .in("id", saleOrderIds)
      for (const o of orderTimes || []) {
        if (o.created_at) orderOpenTimeMap.set(o.id, o.created_at)
      }
    }

    for (const sale of dailySales || []) {
      // Use order open time if available, fallback to sale created_at
      const openTime = sale.order_id ? orderOpenTimeMap.get(sale.order_id) : null
      const timestamp = openTime || sale.created_at
      if (!timestamp) continue
      const d = new Date(timestamp)
      const hour = d.getHours()
      hourlyMap[hour].total += Number.parseFloat(sale.total_amount)
      hourlyMap[hour].orders += 1
      daysInPeriod.add(d.toISOString().split("T")[0])
    }
    const numDays = Math.max(daysInPeriod.size, 1)
    const hourlySales = Object.values(hourlyMap)
      .filter((h) => h.total > 0 || (h.hour >= 10 && h.hour <= 23)) // Only show relevant hours
      .map((h) => ({
        hour: `${h.hour}h`,
        total: Math.round(h.total * 100) / 100,
        orders: h.orders,
        average: Math.round((h.total / numDays) * 100) / 100,
      }))

    // ── Days open / closed calculation ──
    const activeDays = daysInPeriod.size
    // Calculate total calendar days in the period
    const periodStartMs = new Date(effectiveStartDateStr).getTime()
    const periodEndMs = new Date(endDateStr).getTime()
    const totalPeriodDays = Math.max(1, Math.round((periodEndMs - periodStartMs) / (1000 * 60 * 60 * 24)) + 1)
    const dailyAverage = activeDays > 0 ? totalSales / activeDays : 0

    // ── Covers (couverts) & Duration stats ──
    const orderIdsForCovers = (dailySales || []).map((s: any) => s.order_id).filter(Boolean)
    let totalCovers = 0
    let ordersWithCovers = 0
    const durations: number[] = []
    const serverDurationMap: Record<string, { totalDuration: number; count: number; totalCovers: number }> = {}

    if (orderIdsForCovers.length > 0) {
      const { data: ordersData } = await supabase
        .from("orders")
        .select("id, covers, created_at, closed_at, server_id")
        .in("id", orderIdsForCovers)

      // Map order_id → server_name from dailySales
      const orderToServer = new Map(
        (dailySales || []).map((s: any) => [s.order_id, s.server_name || "Inconnu"]),
      )

      for (const o of ordersData || []) {
        if (o.covers != null && o.covers > 0) {
          totalCovers += o.covers
          ordersWithCovers++
        }
        // Duration calculation (only if closed_at exists and duration is reasonable: < 6h)
        if (o.created_at && o.closed_at) {
          const durationMin = (new Date(o.closed_at).getTime() - new Date(o.created_at).getTime()) / 60000
          if (durationMin > 0 && durationMin < 360) {
            durations.push(durationMin)
            const sName = orderToServer.get(o.id) || "Inconnu"
            if (!serverDurationMap[sName]) {
              serverDurationMap[sName] = { totalDuration: 0, count: 0, totalCovers: 0 }
            }
            serverDurationMap[sName].totalDuration += durationMin
            serverDurationMap[sName].count += 1
            if (o.covers != null && o.covers > 0) {
              serverDurationMap[sName].totalCovers += o.covers
            }
          }
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
      return {
        ...server,
        total_sales_ht: server.total_sales - (taxByServer[server.server_name] || 0),
        average_ticket: server.order_count > 0 ? server.total_sales / server.order_count : 0,
        complimentary_percentage: server.total_sales > 0 ? (server.complimentary_amount / server.total_sales) * 100 : 0,
        avg_duration: durationData ? Math.round(durationData.totalDuration / durationData.count) : null,
        total_covers: durationData?.totalCovers || 0,
        revenue_per_cover: durationData && durationData.totalCovers > 0 ? server.total_sales / durationData.totalCovers : null,
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
