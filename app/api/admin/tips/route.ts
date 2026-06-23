import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  RESTAURANT_OPENING_TIMESTAMP,
  clampDateToRestaurantOpening,
  isBeforeRestaurantOpeningDate,
} from "@/lib/restaurant-opening"

interface Payment {
  tip_amount: number | null
  created_at: string
  payment_method?: "cash" | "card" | "other"
  recorded_by?: string | null
  orders: {
    table_id: string
    tables?: {
      table_number: string | null
    } | null
  } | null
  users?: {
    name: string | null
  } | null
}

interface DailyBreakdown {
  date: string
  amount: number
  tables: Set<string>
}

const WEEKLY_HISTORY_LENGTH = 8
const TIPS_QUERY_PAGE_SIZE = 1000

const getIsoWeekNumber = (date: Date) => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNumber = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

const toDateString = (date: Date) => date.toISOString().split("T")[0]

async function fetchTipPayments(
  supabase: any,
  startIso: string,
  endIso: string,
  includeDetails: boolean,
) {
  const rows: any[] = []

  for (let page = 0; ; page += 1) {
    const from = page * TIPS_QUERY_PAGE_SIZE
    const to = from + TIPS_QUERY_PAGE_SIZE - 1
    const select = includeDetails
      ? `
        tip_amount,
        created_at,
        payment_method,
        recorded_by,
        orders!inner(
          table_id,
          tables(
            table_number
          )
        ),
        users:users!payments_recorded_by_fkey(
          name
        )
      `
      : `
        tip_amount,
        created_at,
        orders!inner(
          table_id
        )
      `

    const { data, error } = await supabase
      .from("payments")
      .select(select)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .not("tip_amount", "is", null)
      .gt("tip_amount", 0)
      .order("created_at", { ascending: true })
      .range(from, to)

    if (error) {
      return { data: null, error }
    }

    const pageRows = data || []
    rows.push(...pageRows)

    if (pageRows.length < TIPS_QUERY_PAGE_SIZE) {
      return { data: rows, error: null }
    }
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const week = searchParams.get("week") || "current"

    const supabase = await createClient()

    // Calculer une semaine complète du lundi au dimanche sans décalage lié au fuseau horaire.
    const now = new Date()
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    const daysSinceMonday = (today.getUTCDay() + 6) % 7
    const weekOffset = week === "current" ? 0 : week === "last" ? 7 : week === "last2" ? 14 : null

    if (weekOffset === null) {
      return NextResponse.json({ error: "Invalid week parameter" }, { status: 400 })
    }

    const weekStart = new Date(today)
    weekStart.setUTCDate(today.getUTCDate() - daysSinceMonday - weekOffset)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6)

    const weekStartStr = toDateString(weekStart)
    const weekEndStr = toDateString(weekEnd)
    const effectiveWeekStartStr = clampDateToRestaurantOpening(weekStartStr)
    const effectiveWeekStartIso = `${effectiveWeekStartStr}T00:00:00.000Z`
    const effectiveWeekEndIso = `${weekEndStr}T23:59:59.999Z`
    const weekNumber = getIsoWeekNumber(weekStart)

    if (isBeforeRestaurantOpeningDate(weekEndStr)) {
      return NextResponse.json({
        weeklyTotal: 0,
        averagePerTable: 0,
        tablesServed: 0,
        weeklyChange: 0,
        totalTips: 0,
        totalCash: 0,
        totalCard: 0,
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        weekNumber,
        weeklyHistory: [],
        dailyBreakdown: [],
        recentEntries: [],
        settlement: null,
      })
    }

    // Récupérer les paiements avec des pourboires
    const { data: payments, error: paymentsError } = await fetchTipPayments(
      supabase,
      effectiveWeekStartIso,
      effectiveWeekEndIso,
      true,
    )

    if (paymentsError) {
      console.error("Error fetching tips:", paymentsError)
      return NextResponse.json({ error: "Failed to fetch tips" }, { status: 500 })
    }

    const paymentRows = payments || []

    // Calculer les statistiques
    const weeklyTotal = paymentRows.reduce((sum: number, payment: any) => sum + (payment.tip_amount || 0), 0)
    const uniqueTables = new Set(paymentRows.map((p: any) => p.orders?.table_id).filter(Boolean)).size
    const averagePerTable = uniqueTables > 0 ? weeklyTotal / uniqueTables : 0
    const totalCash = paymentRows.reduce(
      (sum: number, payment: Payment) => sum + (payment.payment_method === "cash" ? payment.tip_amount || 0 : 0),
      0,
    )
    const totalCard = paymentRows.reduce(
      (sum: number, payment: Payment) => sum + (payment.payment_method === "card" ? payment.tip_amount || 0 : 0),
      0,
    )

    // Construire l'historique des semaines jusqu'à la semaine sélectionnée.
    const weeklyHistory = Array.from({ length: WEEKLY_HISTORY_LENGTH }, (_, index) => {
      const start = new Date(weekStart)
      start.setUTCDate(weekStart.getUTCDate() - (WEEKLY_HISTORY_LENGTH - 1 - index) * 7)
      const end = new Date(start)
      end.setUTCDate(start.getUTCDate() + 6)

      return {
        weekStart: toDateString(start),
        weekEnd: toDateString(end),
        weekNumber: getIsoWeekNumber(start),
        amount: 0,
        change: null as number | null,
      }
    })

    const historyStartStr = clampDateToRestaurantOpening(weeklyHistory[0].weekStart)
    const { data: historyPayments, error: historyError } = await fetchTipPayments(
      supabase,
      `${historyStartStr}T00:00:00.000Z`,
      effectiveWeekEndIso,
      false,
    )

    if (historyError) {
      console.error("Error fetching weekly tips history:", historyError)
      return NextResponse.json({ error: "Failed to fetch weekly tips history" }, { status: 500 })
    }

    const historyPaymentRows = historyPayments || []
    historyPaymentRows.forEach((payment: { tip_amount: number | null; created_at: string }) => {
      const paymentDate = payment.created_at.slice(0, 10)
      const period = weeklyHistory.find(
        (entry) => paymentDate >= entry.weekStart && paymentDate <= entry.weekEnd,
      )
      if (period) {
        period.amount += payment.tip_amount || 0
      }
    })

    weeklyHistory.forEach((entry, index) => {
      if (index === 0) return
      const previousAmount = weeklyHistory[index - 1].amount
      entry.change = previousAmount > 0 ? ((entry.amount - previousAmount) / previousAmount) * 100 : null
    })

    const weeklyChange = weeklyHistory.at(-1)?.change || 0

    // Grouper par jour
    const dailyBreakdown: any[] = []
    paymentRows.forEach((payment: Payment) => {
      const date = new Date(payment.created_at).toLocaleDateString('fr-FR', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
      })

      const existingDay = dailyBreakdown.find((d: any) => d.date === date)
      const serverName = payment.users?.name || "Inconnu"
      if (existingDay) {
        existingDay.amount += payment.tip_amount || 0
        if (payment.orders?.table_id) {
          existingDay.tables.add(payment.orders.table_id)
        }
        const serverEntry = existingDay.servers.find((s: any) => s.name === serverName)
        if (serverEntry) {
          serverEntry.amount += payment.tip_amount || 0
        } else {
          existingDay.servers.push({ name: serverName, amount: payment.tip_amount || 0 })
        }
      } else {
        dailyBreakdown.push({
          date,
          amount: payment.tip_amount || 0,
          tables: new Set(payment.orders?.table_id ? [payment.orders.table_id] : []),
          servers: [{ name: serverName, amount: payment.tip_amount || 0 }]
        })
      }
    })

    // Convertir les Sets en nombres
    // Total général de tous les pourboires
    const { data: allPayments } = await supabase
      .from("payments")
      .select("tip_amount")
      .gte("created_at", RESTAURANT_OPENING_TIMESTAMP)
      .not("tip_amount", "is", null)
      .gt("tip_amount", 0)

    const totalTips = allPayments?.reduce((sum: number, p: any) => sum + (p.tip_amount || 0), 0) || 0

    // Convertir les Sets en nombres pour le JSON
    const dailyBreakdownForJson = dailyBreakdown.map((day: any) => ({
      date: day.date,
      amount: day.amount,
      tables: day.tables.size,
      servers: day.servers,
    }))

    const recentEntries = paymentRows
      .map((payment: Payment) => ({
        created_at: payment.created_at,
        amount: payment.tip_amount || 0,
        payment_method: payment.payment_method || "other",
        table_number: payment.orders?.tables?.table_number || "",
        server_name: payment.users?.name || "Inconnu",
      }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 25)

    const { data: settlement } = await supabase
      .from("tip_settlements")
      .select(`
        id,
        week_start,
        week_end,
        total_tips,
        total_cash,
        total_card,
        status,
        settled_at,
        tip_settlement_lines(
          id,
          employee_name,
          services_count,
          amount
        )
      `)
      .eq("week_start", weekStartStr)
      .maybeSingle()

    return NextResponse.json({
      weeklyTotal,
      averagePerTable,
      tablesServed: uniqueTables,
      weeklyChange,
      totalTips,
      totalCash,
      totalCard,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      weekNumber,
      weeklyHistory,
      dailyBreakdown: dailyBreakdownForJson,
      recentEntries,
      settlement,
    })

  } catch (error) {
    console.error("Error in tips API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
