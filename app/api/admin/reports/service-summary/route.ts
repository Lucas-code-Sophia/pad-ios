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

const normalizePaymentMethod = (value: unknown): PaymentBucketMethod => {
  if (value === "cash") return "cash"
  if (value === "card") return "card"
  return "other"
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

    // ── Fetch all closed orders for this date ──
    const dayStart = `${date}T00:00:00`
    const dayEnd = `${date}T23:59:59`

    const { data: orders } = await supabase
      .from("orders")
      .select("id, table_id, server_id, status, created_at, closed_at, covers")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .eq("status", "closed")

    if (!orders || orders.length === 0) {
      return NextResponse.json({
        date,
        hasData: false,
        services: { midi: null, soir: null },
        servers: [],
        insights: [],
      })
    }

    // ── Fetch users for server names ──
    const serverIds = Array.from(new Set(orders.map((o) => o.server_id).filter(Boolean)))
    let serverNameMap = new Map<string, string>()
    if (serverIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, name").in("id", serverIds)
      serverNameMap = new Map((users || []).map((u: any) => [u.id, u.name]))
    }

    // ── Fetch tables for table numbers ──
    const tableIds = Array.from(new Set(orders.map((o) => o.table_id).filter(Boolean)))
    let tableNumberMap = new Map<string, string>()
    if (tableIds.length > 0) {
      const { data: tables } = await supabase.from("tables").select("id, table_number").in("id", tableIds)
      tableNumberMap = new Map((tables || []).map((t: any) => [t.id, t.table_number]))
    }

    // ── Fetch daily_sales for amounts ──
    const { data: dailySales } = await supabase
      .from("daily_sales")
      .select("*")
      .eq("date", date)

    const saleByOrder = new Map(
      (dailySales || []).map((s: any) => [s.order_id, s]),
    )

    // ── Fetch order_items for all orders ──
    const orderIds = orders.map((o) => o.id)

    // ── Fetch payments to resolve reliable payment mode per order ──
    const { data: paymentsData } = await supabase
      .from("payments")
      .select("order_id, payment_method, amount")
      .in("order_id", orderIds)

    const paymentBucketsByOrder = new Map<string, PaymentBucket>()
    for (const payment of paymentsData || []) {
      const orderId = String(payment.order_id || "")
      if (!orderId) continue
      const amount = Number(payment.amount || 0)
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
      ].filter(Boolean) as string[]
      if (usedMethods.length === 1) paymentMethodByOrder.set(orderId, usedMethods[0])
      else if (usedMethods.length > 1) paymentMethodByOrder.set(orderId, "mixed")
    }

    const { data: allOrderItems } = await supabase
      .from("order_items")
      .select("order_id, menu_item_id, quantity, price, is_complimentary, notes")
      .in("order_id", orderIds)

    const { data: menuItemsData } = await supabase.from("menu_items").select("id, name, category_id")
    const menuItemMap = new Map((menuItemsData || []).map((m: any) => [m.id, m]))

    const { data: categoriesData } = await supabase.from("menu_categories").select("id, name")
    const categoryMap = new Map((categoriesData || []).map((c: any) => [c.id, c.name]))

    // ── Build per-server stats ──
    const serverStatsMap: Record<string, {
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
    }> = {}

    // ── Build per-service stats ──
    let midiSales = 0, midiOrders = 0, midiCovers = 0, midiDurations: number[] = []
    let soirSales = 0, soirOrders = 0, soirCovers = 0, soirDurations: number[] = []
    let midiCashAmount = 0, midiCashOrders = 0
    let midiCardAmount = 0, midiCardOrders = 0
    let midiOtherAmount = 0, midiOtherOrders = 0
    let soirCashAmount = 0, soirCashOrders = 0
    let soirCardAmount = 0, soirCardOrders = 0
    let soirOtherAmount = 0, soirOtherOrders = 0
    let totalCashAmount = 0, totalCashOrders = 0
    let totalCardAmount = 0, totalCardOrders = 0
    let totalOtherAmount = 0, totalOtherOrders = 0

    // ── Top dishes tracking ──
    const dishCountMap: Record<string, { name: string; quantity: number; revenue: number }> = {}

    for (const order of orders) {
      const serverName = serverNameMap.get(order.server_id) || "Inconnu"
      const tableNumber = tableNumberMap.get(order.table_id) || "?"
      const sale = saleByOrder.get(order.id)
      const amount = sale ? Number.parseFloat(sale.total_amount) : 0
      const paymentBucket = paymentBucketsByOrder.get(order.id)
      const salePaymentMethod = String(sale?.payment_method || "").toLowerCase()
      const paymentMethod: OrderPaymentMethod =
        paymentMethodByOrder.get(order.id) ||
        (salePaymentMethod === "mixed" ? "mixed" : normalizePaymentMethod(salePaymentMethod))
      const compAmount = sale ? Number.parseFloat(sale.complimentary_amount || 0) : 0
      const compCount = sale ? parseInt(sale.complimentary_count || 0) : 0

      // Duration
      let durationMin: number | null = null
      if (order.created_at && order.closed_at) {
        const d = (new Date(order.closed_at).getTime() - new Date(order.created_at).getTime()) / 60000
        if (d > 0 && d < 360) durationMin = Math.round(d)
      }

      // Service (midi < 16h, soir >= 16h)
      const hour = new Date(order.created_at).getHours()
      const service: "midi" | "soir" = hour < 16 ? "midi" : "soir"

      if (service === "midi") {
        midiSales += amount
        midiOrders++
        if (order.covers) midiCovers += order.covers
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
        if (order.covers) soirCovers += order.covers
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

      // Server stats
      if (!serverStatsMap[order.server_id]) {
        serverStatsMap[order.server_id] = {
          server_id: order.server_id,
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

      const ss = serverStatsMap[order.server_id]
      ss.tables_served++
      ss.total_sales += amount
      ss.complimentary_amount += compAmount
      ss.complimentary_count += compCount
      if (order.covers) ss.total_covers += order.covers
      if (durationMin != null) {
        ss.total_duration += durationMin
        ss.duration_count++
      }
      ss.orders.push({
        table_number: tableNumber,
        amount,
        covers: order.covers,
        duration_min: durationMin,
        service,
        time: new Date(order.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        payment_method: paymentMethod,
      })

      // Dish tracking
      const orderItems = (allOrderItems || []).filter((i) => i.order_id === order.id)
      for (const item of orderItems) {
        const mi = menuItemMap.get(item.menu_item_id)
        if (mi) {
          const key = item.menu_item_id
          if (!dishCountMap[key]) {
            dishCountMap[key] = { name: mi.name, quantity: 0, revenue: 0 }
          }
          dishCountMap[key].quantity += item.quantity
          dishCountMap[key].revenue += item.quantity * Number.parseFloat(item.price)
        }
      }
    }

    // ── Format server results ──
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

    // ── Service breakdown ──
    const midiAvgDuration = midiDurations.length > 0 ? Math.round(midiDurations.reduce((a, b) => a + b, 0) / midiDurations.length) : null
    const soirAvgDuration = soirDurations.length > 0 ? Math.round(soirDurations.reduce((a, b) => a + b, 0) / soirDurations.length) : null

    const services = {
      midi: midiOrders > 0 ? {
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
      } : null,
      soir: soirOrders > 0 ? {
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
      } : null,
    }

    // ── Top dishes of the day ──
    const topDishes = Object.values(dishCountMap)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10)

    // ── Build insights ──
    const totalSales = midiSales + soirSales
    const totalOrders = midiOrders + soirOrders
    const totalCovers = midiCovers + soirCovers
    const allDurations = [...midiDurations, ...soirDurations]
    const avgDuration = allDurations.length > 0 ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length) : null

    const insights: Array<{ icon: string; label: string; value: string; color: string }> = []

    insights.push({ icon: "💰", label: "CA total TTC du jour", value: `${totalSales.toFixed(2)} €`, color: "blue" })
    insights.push({ icon: "🧾", label: "Nombre de tables", value: `${totalOrders}`, color: "purple" })
    if (totalCovers > 0) {
      insights.push({ icon: "👥", label: "Couverts total", value: `${totalCovers}`, color: "cyan" })
      insights.push({ icon: "🍽️", label: "CA par couvert", value: `${(totalSales / totalCovers).toFixed(2)} €`, color: "emerald" })
    }
    insights.push({ icon: "📊", label: "Ticket moyen", value: `${totalOrders > 0 ? (totalSales / totalOrders).toFixed(2) : "0"} €`, color: "orange" })
    if (avgDuration) {
      insights.push({ icon: "⏱️", label: "Durée moy. table", value: `${avgDuration} min`, color: "indigo" })
    }

    // Best server
    if (servers.length > 0) {
      const best = servers[0]
      insights.push({ icon: "🏆", label: "Meilleur serveur", value: `${best.server_name} (${best.total_sales.toFixed(0)}€)`, color: "amber" })
    }

    // Busiest hour
    const hourlyCount: Record<number, number> = {}
    for (const order of orders) {
      const h = new Date(order.created_at).getHours()
      hourlyCount[h] = (hourlyCount[h] || 0) + 1
    }
    const busiestHour = Object.entries(hourlyCount).sort((a, b) => b[1] - a[1])[0]
    if (busiestHour) {
      insights.push({ icon: "🔥", label: "Heure de pointe", value: `${busiestHour[0]}h (${busiestHour[1]} tables)`, color: "red" })
    }

    // Midi vs Soir comparison
    if (services.midi && services.soir) {
      const stronger = midiSales > soirSales ? "midi" : "soir"
      const ratio = Math.round((Math.max(midiSales, soirSales) / Math.min(midiSales, soirSales) - 1) * 100)
      insights.push({ icon: stronger === "midi" ? "☀️" : "🌙", label: "Service dominant", value: `${stronger === "midi" ? "Midi" : "Soir"} (+${ratio}%)`, color: stronger === "midi" ? "amber" : "indigo" })
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
