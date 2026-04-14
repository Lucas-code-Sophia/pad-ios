import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isBeforeRestaurantOpeningDate } from "@/lib/restaurant-opening"

type PaymentBucketMethod = "cash" | "card" | "other"
type OrderPaymentMethod = PaymentBucketMethod | "mixed"
type PaymentBucket = {
  cash: number
  card: number
  other: number
  cash_count: number
  card_count: number
  other_count: number
}

type OrderRow = {
  id: string
  table_id: string | null
  server_id: string | null
  created_at: string | null
  closed_at: string | null
  covers: number | null
}

type DailySaleRow = {
  order_id: string | null
  table_id: string | null
  table_number: string | number | null
  server_id: string | null
  server_name: string | null
  total_amount: string | number | null
  complimentary_amount: string | number | null
  complimentary_count: string | number | null
  payment_method: string | null
  created_at: string | null
}

const normalizePaymentMethod = (value: unknown): PaymentBucketMethod => {
  if (value === "cash") return "cash"
  if (value === "card") return "card"
  return "other"
}

const toNumber = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const date = searchParams.get("date")

    if (!date) {
      return NextResponse.json({ error: "Date is required" }, { status: 400 })
    }

    if (isBeforeRestaurantOpeningDate(date)) {
      return NextResponse.json({
        date,
        hasData: false,
        services: { midi: null, soir: null },
        servers: [],
        insights: [],
      })
    }

    const supabase = await createClient()

    // Daily sales is the accounting source for this screen.
    const { data: dailySalesData } = await supabase.from("daily_sales").select("*").eq("date", date)
    const dailySales = (dailySalesData || []) as DailySaleRow[]

    if (dailySales.length === 0) {
      return NextResponse.json({
        date,
        hasData: false,
        services: { midi: null, soir: null },
        servers: [],
        insights: [],
      })
    }

    const orderIds = Array.from(
      new Set(
        dailySales
          .map((sale) => (sale.order_id ? String(sale.order_id) : ""))
          .filter((id) => id.length > 0),
      ),
    )

    const { data: ordersData } = orderIds.length
      ? await supabase
          .from("orders")
          .select("id, table_id, server_id, created_at, closed_at, covers")
          .in("id", orderIds)
      : { data: [] as OrderRow[] }
    const orders = (ordersData || []) as OrderRow[]
    const orderById = new Map<string, OrderRow>((orders || []).map((order) => [order.id, order]))

    // ── Fetch users for server names ──
    const serverIds = Array.from(
      new Set(
        [
          ...dailySales.map((sale) => (sale.server_id ? String(sale.server_id) : "")),
          ...orders.map((order) => (order.server_id ? String(order.server_id) : "")),
        ].filter((id) => id.length > 0),
      ),
    )
    let serverNameMap = new Map<string, string>()
    if (serverIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, name").in("id", serverIds)
      serverNameMap = new Map((users || []).map((u: any) => [u.id, u.name]))
    }

    // ── Fetch tables for table numbers ──
    const tableIds = Array.from(
      new Set(
        [
          ...dailySales.map((sale) => (sale.table_id ? String(sale.table_id) : "")),
          ...orders.map((order) => (order.table_id ? String(order.table_id) : "")),
        ].filter((id) => id.length > 0),
      ),
    )
    let tableNumberMap = new Map<string, string>()
    if (tableIds.length > 0) {
      const { data: tables } = await supabase.from("tables").select("id, table_number").in("id", tableIds)
      tableNumberMap = new Map((tables || []).map((t: any) => [t.id, String(t.table_number)]))
    }

    // ── Fetch payments to resolve reliable payment mode per order ──
    const { data: paymentsData } = orderIds.length
      ? await supabase
          .from("payments")
          .select("order_id, payment_method, amount")
          .in("order_id", orderIds)
      : { data: [] as any[] }

    const paymentBucketsByOrder = new Map<string, PaymentBucket>()
    for (const payment of paymentsData || []) {
      const orderId = String(payment.order_id || "")
      if (!orderId) continue
      const amount = toNumber(payment.amount)
      if (amount <= 0) continue
      const bucket = paymentBucketsByOrder.get(orderId) || {
        cash: 0,
        card: 0,
        other: 0,
        cash_count: 0,
        card_count: 0,
        other_count: 0,
      }
      const method = normalizePaymentMethod(String(payment.payment_method || "").toLowerCase())
      if (method === "cash") {
        bucket.cash += amount
        bucket.cash_count += 1
      } else if (method === "card") {
        bucket.card += amount
        bucket.card_count += 1
      } else {
        bucket.other += amount
        bucket.other_count += 1
      }
      paymentBucketsByOrder.set(orderId, bucket)
    }

    const paymentMethodByOrder = new Map<string, OrderPaymentMethod>()
    for (const [orderId, bucket] of paymentBucketsByOrder.entries()) {
      const usedMethods = [
        bucket.cash > 0.009 ? "cash" : null,
        bucket.card > 0.009 ? "card" : null,
        bucket.other > 0.009 ? "other" : null,
      ].filter((method): method is PaymentBucketMethod => method !== null)
      if (usedMethods.length === 1) paymentMethodByOrder.set(orderId, usedMethods[0])
      else if (usedMethods.length > 1) paymentMethodByOrder.set(orderId, "mixed")
    }

    const { data: allOrderItems } = orderIds.length
      ? await supabase
          .from("order_items")
          .select("order_id, menu_item_id, quantity, price, is_complimentary, notes")
          .in("order_id", orderIds)
      : { data: [] as any[] }

    const orderItemsByOrder = new Map<string, any[]>()
    for (const item of allOrderItems || []) {
      const id = String(item.order_id || "")
      if (!id) continue
      const list = orderItemsByOrder.get(id) || []
      list.push(item)
      orderItemsByOrder.set(id, list)
    }

    const { data: menuItemsData } = await supabase.from("menu_items").select("id, name")
    const menuItemMap = new Map((menuItemsData || []).map((m: any) => [m.id, m]))

    // ── Build per-server stats ──
    const serverStatsMap: Record<
      string,
      {
        server_id: string
        server_name: string
        tables_served: number
        total_sales: number
        total_covers: number
        total_duration: number
        duration_count: number
        orders: Array<{
          table_number: string
          amount: number
          covers: number | null
          duration_min: number | null
          service: "midi" | "soir"
          time: string
          payment_method: string
        }>
        complimentary_amount: number
        complimentary_count: number
      }
    > = {}

    // ── Build per-service stats ──
    let midiSales = 0,
      midiOrders = 0,
      midiCovers = 0,
      midiDurations: number[] = []
    let soirSales = 0,
      soirOrders = 0,
      soirCovers = 0,
      soirDurations: number[] = []
    let midiCashAmount = 0,
      midiCashOrders = 0
    let midiCardAmount = 0,
      midiCardOrders = 0
    let midiOtherAmount = 0,
      midiOtherOrders = 0
    let soirCashAmount = 0,
      soirCashOrders = 0
    let soirCardAmount = 0,
      soirCardOrders = 0
    let soirOtherAmount = 0,
      soirOtherOrders = 0
    let totalCashAmount = 0,
      totalCashOrders = 0
    let totalCardAmount = 0,
      totalCardOrders = 0
    let totalOtherAmount = 0,
      totalOtherOrders = 0

    // ── Top dishes tracking ──
    const dishCountMap: Record<string, { name: string; quantity: number; revenue: number }> = {}

    for (const sale of dailySales) {
      const orderId = String(sale.order_id || "")
      if (!orderId) continue
      const order = orderById.get(orderId)

      const serverId = String(order?.server_id || sale.server_id || "unknown")
      const serverName = serverNameMap.get(serverId) || String(sale.server_name || "Inconnu")
      const tableId = String(order?.table_id || sale.table_id || "")
      const tableNumber = tableNumberMap.get(tableId) || String(sale.table_number || "?")
      const amount = toNumber(sale.total_amount)
      const paymentBucket = paymentBucketsByOrder.get(orderId)
      const salePaymentMethod = String(sale.payment_method || "").toLowerCase()
      const paymentMethod: OrderPaymentMethod =
        paymentMethodByOrder.get(orderId) ||
        (salePaymentMethod === "mixed" ? "mixed" : normalizePaymentMethod(salePaymentMethod))
      const compAmount = toNumber(sale.complimentary_amount)
      const compCount = Math.round(toNumber(sale.complimentary_count))

      const createdAt = order?.created_at || sale.created_at
      const covers = order?.covers && order.covers > 0 ? order.covers : 0

      // Duration
      let durationMin: number | null = null
      if (order?.created_at && order.closed_at) {
        const d = (new Date(order.closed_at).getTime() - new Date(order.created_at).getTime()) / 60000
        if (d > 0 && d < 360) durationMin = Math.round(d)
      }

      // Service (midi < 16h, soir >= 16h)
      const hour = createdAt ? new Date(createdAt).getHours() : 12
      const service: "midi" | "soir" = hour < 16 ? "midi" : "soir"

      if (service === "midi") {
        midiSales += amount
        midiOrders++
        midiCovers += covers
        if (durationMin != null) midiDurations.push(durationMin)
        if (paymentBucket) {
          midiCashAmount += paymentBucket.cash
          midiCardAmount += paymentBucket.card
          midiOtherAmount += paymentBucket.other
          midiCashOrders += paymentBucket.cash_count
          midiCardOrders += paymentBucket.card_count
          midiOtherOrders += paymentBucket.other_count
        } else if (paymentMethod === "cash") {
          midiCashAmount += amount
          midiCashOrders++
        } else if (paymentMethod === "card") {
          midiCardAmount += amount
          midiCardOrders++
        } else {
          midiOtherAmount += amount
          midiOtherOrders++
        }
      } else {
        soirSales += amount
        soirOrders++
        soirCovers += covers
        if (durationMin != null) soirDurations.push(durationMin)
        if (paymentBucket) {
          soirCashAmount += paymentBucket.cash
          soirCardAmount += paymentBucket.card
          soirOtherAmount += paymentBucket.other
          soirCashOrders += paymentBucket.cash_count
          soirCardOrders += paymentBucket.card_count
          soirOtherOrders += paymentBucket.other_count
        } else if (paymentMethod === "cash") {
          soirCashAmount += amount
          soirCashOrders++
        } else if (paymentMethod === "card") {
          soirCardAmount += amount
          soirCardOrders++
        } else {
          soirOtherAmount += amount
          soirOtherOrders++
        }
      }

      if (paymentBucket) {
        totalCashAmount += paymentBucket.cash
        totalCardAmount += paymentBucket.card
        totalOtherAmount += paymentBucket.other
        totalCashOrders += paymentBucket.cash_count
        totalCardOrders += paymentBucket.card_count
        totalOtherOrders += paymentBucket.other_count
      } else if (paymentMethod === "cash") {
        totalCashAmount += amount
        totalCashOrders++
      } else if (paymentMethod === "card") {
        totalCardAmount += amount
        totalCardOrders++
      } else {
        totalOtherAmount += amount
        totalOtherOrders++
      }

      if (!serverStatsMap[serverId]) {
        serverStatsMap[serverId] = {
          server_id: serverId,
          server_name: serverName,
          tables_served: 0,
          total_sales: 0,
          total_covers: 0,
          total_duration: 0,
          duration_count: 0,
          orders: [],
          complimentary_amount: 0,
          complimentary_count: 0,
        }
      }

      const ss = serverStatsMap[serverId]
      ss.tables_served++
      ss.total_sales += amount
      ss.complimentary_amount += compAmount
      ss.complimentary_count += compCount
      ss.total_covers += covers
      if (durationMin != null) {
        ss.total_duration += durationMin
        ss.duration_count++
      }
      ss.orders.push({
        table_number: tableNumber,
        amount,
        covers: covers || null,
        duration_min: durationMin,
        service,
        time: createdAt
          ? new Date(createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
          : "--:--",
        payment_method: paymentMethod,
      })

      // Dish tracking (sold items only, excludes complimentary).
      const orderItems = orderItemsByOrder.get(orderId) || []
      for (const item of orderItems) {
        if (item.is_complimentary) continue
        const mi = menuItemMap.get(item.menu_item_id)
        if (!mi) continue
        const quantity = toNumber(item.quantity)
        if (quantity <= 0) continue
        const lineTotal = quantity * toNumber(item.price)
        const key = String(item.menu_item_id)
        if (!dishCountMap[key]) {
          dishCountMap[key] = { name: mi.name, quantity: 0, revenue: 0 }
        }
        dishCountMap[key].quantity += quantity
        dishCountMap[key].revenue += lineTotal
      }
    }

    const servers = Object.values(serverStatsMap)
      .map((s) => ({
        ...s,
        average_ticket: s.tables_served > 0 ? s.total_sales / s.tables_served : 0,
        avg_duration: s.duration_count > 0 ? Math.round(s.total_duration / s.duration_count) : null,
        revenue_per_cover: s.total_covers > 0 ? s.total_sales / s.total_covers : null,
        complimentary_percentage: s.total_sales > 0 ? (s.complimentary_amount / s.total_sales) * 100 : 0,
        orders: s.orders.sort((a, b) => a.time.localeCompare(b.time)),
      }))
      .sort((a, b) => b.total_sales - a.total_sales)

    const midiAvgDuration =
      midiDurations.length > 0
        ? Math.round(midiDurations.reduce((a, b) => a + b, 0) / midiDurations.length)
        : null
    const soirAvgDuration =
      soirDurations.length > 0
        ? Math.round(soirDurations.reduce((a, b) => a + b, 0) / soirDurations.length)
        : null

    const services = {
      midi:
        midiOrders > 0
          ? {
              sales: midiSales,
              orders: midiOrders,
              covers: midiCovers,
              avg_ticket: midiSales / midiOrders,
              avg_duration: midiAvgDuration,
              revenue_per_cover: midiCovers > 0 ? midiSales / midiCovers : null,
              payment_breakdown: {
                cash: { amount: midiCashAmount, orders: midiCashOrders },
                card: { amount: midiCardAmount, orders: midiCardOrders },
                other: { amount: midiOtherAmount, orders: midiOtherOrders },
              },
            }
          : null,
      soir:
        soirOrders > 0
          ? {
              sales: soirSales,
              orders: soirOrders,
              covers: soirCovers,
              avg_ticket: soirSales / soirOrders,
              avg_duration: soirAvgDuration,
              revenue_per_cover: soirCovers > 0 ? soirSales / soirCovers : null,
              payment_breakdown: {
                cash: { amount: soirCashAmount, orders: soirCashOrders },
                card: { amount: soirCardAmount, orders: soirCardOrders },
                other: { amount: soirOtherAmount, orders: soirOtherOrders },
              },
            }
          : null,
    }

    const topDishes = Object.values(dishCountMap)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10)

    const totalSales = midiSales + soirSales
    const totalOrders = midiOrders + soirOrders
    const totalCovers = midiCovers + soirCovers
    const allDurations = [...midiDurations, ...soirDurations]
    const avgDuration =
      allDurations.length > 0 ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length) : null

    const insights: Array<{ icon: string; label: string; value: string; color: string }> = []

    insights.push({ icon: "💰", label: "CA total TTC du jour", value: `${totalSales.toFixed(2)} €`, color: "blue" })
    insights.push({ icon: "🧾", label: "Nombre de tables", value: `${totalOrders}`, color: "purple" })
    if (totalCovers > 0) {
      insights.push({ icon: "👥", label: "Couverts total", value: `${totalCovers}`, color: "cyan" })
      insights.push({
        icon: "🍽️",
        label: "CA par couvert",
        value: `${(totalSales / totalCovers).toFixed(2)} €`,
        color: "emerald",
      })
    }
    insights.push({
      icon: "📊",
      label: "Ticket moyen",
      value: `${totalOrders > 0 ? (totalSales / totalOrders).toFixed(2) : "0"} €`,
      color: "orange",
    })
    if (avgDuration) {
      insights.push({ icon: "⏱️", label: "Durée moy. table", value: `${avgDuration} min`, color: "indigo" })
    }

    if (servers.length > 0) {
      const best = servers[0]
      insights.push({
        icon: "🏆",
        label: "Meilleur serveur",
        value: `${best.server_name} (${best.total_sales.toFixed(0)}€)`,
        color: "amber",
      })
    }

    const hourlyCount: Record<number, number> = {}
    for (const sale of dailySales) {
      const orderId = String(sale.order_id || "")
      const order = orderById.get(orderId)
      const ts = order?.created_at || sale.created_at
      if (!ts) continue
      const h = new Date(ts).getHours()
      hourlyCount[h] = (hourlyCount[h] || 0) + 1
    }
    const busiestHour = Object.entries(hourlyCount).sort((a, b) => Number(b[1]) - Number(a[1]))[0]
    if (busiestHour) {
      insights.push({
        icon: "🔥",
        label: "Heure de pointe",
        value: `${busiestHour[0]}h (${busiestHour[1]} tables)`,
        color: "red",
      })
    }

    if (services.midi && services.soir) {
      const minSales = Math.min(midiSales, soirSales)
      if (minSales > 0) {
        const stronger = midiSales > soirSales ? "midi" : "soir"
        const ratio = Math.round((Math.max(midiSales, soirSales) / minSales - 1) * 100)
        insights.push({
          icon: stronger === "midi" ? "☀️" : "🌙",
          label: "Service dominant",
          value: `${stronger === "midi" ? "Midi" : "Soir"} (+${ratio}%)`,
          color: stronger === "midi" ? "amber" : "indigo",
        })
      }
    }

    return NextResponse.json({
      date,
      hasData: true,
      services,
      servers,
      topDishes,
      insights,
      totals: {
        sales: totalSales,
        orders: totalOrders,
        covers: totalCovers,
        avg_ticket: totalOrders > 0 ? totalSales / totalOrders : 0,
        avg_duration: avgDuration,
        payment_breakdown: {
          cash: { amount: totalCashAmount, orders: totalCashOrders },
          card: { amount: totalCardAmount, orders: totalCardOrders },
          other: { amount: totalOtherAmount, orders: totalOtherOrders },
        },
      },
    })
  } catch (error) {
    console.error("[v0] Error fetching service summary:", error)
    return NextResponse.json({ error: "Failed to fetch service summary" }, { status: 500 })
  }
}
