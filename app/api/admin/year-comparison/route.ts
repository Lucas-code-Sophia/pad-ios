import { type NextRequest, NextResponse } from "next/server"
import { BUSINESS_TIME_ZONE, getBusinessDateIso } from "@/lib/business-date"
import { createClient } from "@/lib/supabase/server"
import {
  FULL_STAFF_THRESHOLD,
  LAST_YEAR_COMPARISON_DAYS,
  LAST_YEAR_COMPARISON_YEAR,
  LAST_YEAR_SOURCE_LABEL,
  REINFORCED_STAFF_THRESHOLD,
  STAFF_LOAD_LABELS,
  getStaffLoadLevel,
  type LastYearComparisonDay,
  type ServicePeriod,
  type StaffLoadLevel,
} from "@/lib/year-comparison-data"

type ServiceTotals = Record<ServicePeriod, { totalTtc: number; covers: number }>

interface DailySaleRow {
  date: string | null
  total_amount: string | number | null
  order_id: string | null
  created_at: string | null
}

interface OrderRow {
  id: string
  covers: number | null
  created_at: string | null
}

interface CurrentDayMutable {
  date: string
  totalTtc: number
  rowCount: number
  orderIds: Set<string>
  coverOrderIds: Set<string>
  covers: number
  services: ServiceTotals
  serviceCoverOrderIds: Record<ServicePeriod, Set<string>>
}

interface CurrentDayPayload {
  date: string
  totalTtc: number
  covers: number
  orderCount: number
  averageTicket: number
  services: ServiceTotals
}

const PAGE_SIZE = 1000
const ORDER_CHUNK_SIZE = 200
const SERVICE_PERIODS = ["midi", "afternoon", "soir"] as const
const SERVICE_LABELS: Record<ServicePeriod, string> = {
  midi: "Midi",
  afternoon: "Après-midi",
  soir: "Soir",
}

const businessMinuteFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const round2 = (value: number) => Math.round(value * 100) / 100
const toNumber = (value: unknown) => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

const createEmptyServices = (): ServiceTotals => ({
  midi: { totalTtc: 0, covers: 0 },
  afternoon: { totalTtc: 0, covers: 0 },
  soir: { totalTtc: 0, covers: 0 },
})

const createServiceCoverSets = (): Record<ServicePeriod, Set<string>> => ({
  midi: new Set<string>(),
  afternoon: new Set<string>(),
  soir: new Set<string>(),
})

const isIsoDate = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))

const getBusinessMinutes = (value: string | null | undefined) => {
  if (!value) return null
  const sourceDate = new Date(value)
  if (Number.isNaN(sourceDate.getTime())) return null

  const parts = businessMinuteFormatter.formatToParts(sourceDate)
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0") % 24
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0")

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

const getServicePeriod = (value: string | null | undefined): ServicePeriod => {
  const minutes = getBusinessMinutes(value)
  if (minutes == null) return "soir"
  if (minutes >= 11 * 60 + 30 && minutes < 15 * 60 + 30) return "midi"
  if (minutes >= 15 * 60 + 30 && minutes < 19 * 60) return "afternoon"
  return "soir"
}

const getComparableDate = (currentYear: number, lastYearDate: string) => `${currentYear}-${lastYearDate.slice(5)}`

const getWeekKey = (date: string) => {
  const target = new Date(`${date}T00:00:00.000Z`)
  const daysSinceMonday = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - daysSinceMonday)
  return target.toISOString().split("T")[0]
}

const sum = <T,>(items: T[], getter: (item: T) => number) =>
  round2(items.reduce((total, item) => total + getter(item), 0))

const fetchCurrentSales = async (supabase: Awaited<ReturnType<typeof createClient>>, startDate: string, endDate: string) => {
  const rows: DailySaleRow[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("daily_sales")
      .select("date,total_amount,order_id,created_at")
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    rows.push(...(data as DailySaleRow[]))
    if (data.length < PAGE_SIZE) break
  }

  return rows
}

const fetchOrdersByIds = async (supabase: Awaited<ReturnType<typeof createClient>>, orderIds: string[]) => {
  const orders = new Map<string, OrderRow>()

  for (let index = 0; index < orderIds.length; index += ORDER_CHUNK_SIZE) {
    const chunk = orderIds.slice(index, index + ORDER_CHUNK_SIZE)
    const { data, error } = await supabase.from("orders").select("id,covers,created_at").in("id", chunk)

    if (error) throw error
    for (const order of (data || []) as OrderRow[]) {
      orders.set(order.id, order)
    }
  }

  return orders
}

const toCurrentDayPayloads = (salesRows: DailySaleRow[], ordersById: Map<string, OrderRow>): CurrentDayPayload[] => {
  const byDate = new Map<string, CurrentDayMutable>()

  for (const sale of salesRows) {
    const date = String(sale.date || "")
    if (!isIsoDate(date)) continue

    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        totalTtc: 0,
        rowCount: 0,
        orderIds: new Set<string>(),
        coverOrderIds: new Set<string>(),
        covers: 0,
        services: createEmptyServices(),
        serviceCoverOrderIds: createServiceCoverSets(),
      })
    }

    const day = byDate.get(date)!
    const amount = toNumber(sale.total_amount)
    const order = sale.order_id ? ordersById.get(sale.order_id) : null
    const service = getServicePeriod(order?.created_at || sale.created_at)

    day.totalTtc = round2(day.totalTtc + amount)
    day.rowCount += 1
    day.services[service].totalTtc = round2(day.services[service].totalTtc + amount)

    if (!sale.order_id) continue

    day.orderIds.add(sale.order_id)
    if (order && !day.coverOrderIds.has(sale.order_id)) {
      day.covers += toNumber(order.covers)
      day.coverOrderIds.add(sale.order_id)
    }

    if (order && !day.serviceCoverOrderIds[service].has(sale.order_id)) {
      day.services[service].covers += toNumber(order.covers)
      day.serviceCoverOrderIds[service].add(sale.order_id)
    }
  }

  return Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const orderCount = day.orderIds.size || day.rowCount
      return {
        date: day.date,
        totalTtc: round2(day.totalTtc),
        covers: day.covers,
        orderCount,
        averageTicket: orderCount > 0 ? round2(day.totalTtc / orderCount) : 0,
        services: day.services,
      }
    })
}

const buildWeeklyBaseline = (currentYear: number) => {
  const weekMap = new Map<string, LastYearComparisonDay[]>()

  for (const day of LAST_YEAR_COMPARISON_DAYS) {
    const weekKey = getWeekKey(day.date)
    const weekDays = weekMap.get(weekKey) || []
    weekDays.push(day)
    weekMap.set(weekKey, weekDays)
  }

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, days]) => {
      const activeDays = days.filter((day) => day.totalTtc > 0)
      const totalTtc = sum(days, (day) => day.totalTtc)
      const averageTtc = activeDays.length > 0 ? round2(totalTtc / activeDays.length) : 0
      const firstDay = days[0]
      const lastDay = days[days.length - 1]

      return {
        startDate: firstDay.date,
        endDate: lastDay.date,
        comparableStartDate: getComparableDate(currentYear, firstDay.date),
        comparableEndDate: getComparableDate(currentYear, lastDay.date),
        totalTtc,
        averageTtc,
        activeDays: activeDays.length,
        covers: sum(days, (day) => day.covers),
        loadLevel: getStaffLoadLevel(averageTtc),
      }
    })
}

export async function GET(request: NextRequest) {
  try {
    const todayDateParam = request.nextUrl.searchParams.get("todayDate")
    const resolvedTodayDate = isIsoDate(todayDateParam) ? String(todayDateParam) : getBusinessDateIso()
    const currentYear = Number(resolvedTodayDate.slice(0, 4)) || 2026
    const startDate = `${currentYear}-07-01`
    const seasonEndDate = `${currentYear}-08-31`
    const endDate = resolvedTodayDate < startDate ? startDate : resolvedTodayDate > seasonEndDate ? seasonEndDate : resolvedTodayDate

    const supabase = await createClient()
    const salesRows = await fetchCurrentSales(supabase, startDate, endDate)
    const orderIds = Array.from(new Set(salesRows.map((sale) => sale.order_id).filter(Boolean))) as string[]
    const ordersById = await fetchOrdersByIds(supabase, orderIds)
    const currentDays = toCurrentDayPayloads(salesRows, ordersById)
    const currentByMonthDay = new Map(currentDays.map((day) => [day.date.slice(5), day]))

    const dailyComparison = LAST_YEAR_COMPARISON_DAYS.map((lastYear) => {
      const currentDate = getComparableDate(currentYear, lastYear.date)
      const current = currentByMonthDay.get(lastYear.monthDay) || null
      const deltaTtc = current ? round2(current.totalTtc - lastYear.totalTtc) : null
      const deltaPercent = current && lastYear.totalTtc > 0 ? round2((deltaTtc! / lastYear.totalTtc) * 100) : null
      const loadLevel = getStaffLoadLevel(lastYear.totalTtc)

      return {
        date: currentDate,
        monthDay: lastYear.monthDay,
        weekday2025: lastYear.weekday,
        isElapsed: currentDate <= endDate,
        loadLevel,
        loadLabel: STAFF_LOAD_LABELS[loadLevel],
        lastYear,
        current,
        deltaTtc,
        deltaPercent,
      }
    })

    const elapsedLastYearDays = LAST_YEAR_COMPARISON_DAYS.filter(
      (day) => getComparableDate(currentYear, day.date) <= endDate,
    )
    const currentTotal = sum(currentDays, (day) => day.totalTtc)
    const currentCovers = sum(currentDays, (day) => day.covers)
    const currentOrders = sum(currentDays, (day) => day.orderCount)
    const lastYearElapsedTotal = sum(elapsedLastYearDays, (day) => day.totalTtc)
    const lastYearElapsedCovers = sum(elapsedLastYearDays, (day) => day.covers)
    const lastYearFullTotal = sum(LAST_YEAR_COMPARISON_DAYS, (day) => day.totalTtc)
    const lastYearFullCovers = sum(LAST_YEAR_COMPARISON_DAYS, (day) => day.covers)
    const paceRatio = lastYearElapsedTotal > 0 ? currentTotal / lastYearElapsedTotal : null
    const projectedSeasonTotal = paceRatio == null ? null : round2(lastYearFullTotal * paceRatio)
    const weeklyBaseline = buildWeeklyBaseline(currentYear)
    const reinforcedWeek = weeklyBaseline.find((week) => week.averageTtc >= REINFORCED_STAFF_THRESHOLD) || null
    const fullWeeks = weeklyBaseline.filter((week) => week.averageTtc >= FULL_STAFF_THRESHOLD)
    const fullStaffStartWeek = fullWeeks[0] || null
    const fullStaffEndWeek = fullWeeks[fullWeeks.length - 1] || null
    const fullStaffDays = LAST_YEAR_COMPARISON_DAYS.filter((day) => getStaffLoadLevel(day.totalTtc) === "full")
    const fullStaffTotal = sum(fullStaffDays, (day) => day.totalTtc)
    const serviceMix = SERVICE_PERIODS.map((period) => {
      const totalTtc = sum(fullStaffDays, (day) => day.services[period].totalTtc)
      return {
        period,
        label: SERVICE_LABELS[period],
        totalTtc,
        covers: sum(fullStaffDays, (day) => day.services[period].covers),
        share: fullStaffTotal > 0 ? round2((totalTtc / fullStaffTotal) * 100) : 0,
      }
    })

    const busiestDays = [...LAST_YEAR_COMPARISON_DAYS]
      .filter((day) => day.totalTtc > 0)
      .sort((a, b) => b.totalTtc - a.totalTtc)
      .slice(0, 8)
      .map((day) => {
        const loadLevel: StaffLoadLevel = getStaffLoadLevel(day.totalTtc)
        return {
          date: day.date,
          comparableDate: getComparableDate(currentYear, day.date),
          weekday: day.weekday,
          totalTtc: day.totalTtc,
          covers: day.covers,
          services: day.services,
          loadLevel,
          loadLabel: STAFF_LOAD_LABELS[loadLevel],
        }
      })

    return NextResponse.json({
      meta: {
        sourceLabel: LAST_YEAR_SOURCE_LABEL,
        currentYear,
        lastYear: LAST_YEAR_COMPARISON_YEAR,
        startDate,
        endDate,
        seasonEndDate,
        reinforcedThreshold: REINFORCED_STAFF_THRESHOLD,
        fullStaffThreshold: FULL_STAFF_THRESHOLD,
      },
      summary: {
        currentTotal,
        currentCovers,
        currentOrders,
        currentActiveDays: currentDays.filter((day) => day.totalTtc > 0).length,
        lastYearElapsedTotal,
        lastYearElapsedCovers,
        lastYearElapsedActiveDays: elapsedLastYearDays.filter((day) => day.totalTtc > 0).length,
        lastYearFullTotal,
        lastYearFullCovers,
        deltaTtc: round2(currentTotal - lastYearElapsedTotal),
        deltaPercent: lastYearElapsedTotal > 0 ? round2(((currentTotal - lastYearElapsedTotal) / lastYearElapsedTotal) * 100) : null,
        paceRatio: paceRatio == null ? null : round2(paceRatio * 100),
        projectedSeasonTotal,
      },
      recommendations: {
        reinforcedFrom: reinforcedWeek,
        fullStaffFrom: fullStaffStartWeek,
        fullStaffUntil: fullStaffEndWeek,
        serviceMix,
      },
      weeklyBaseline,
      busiestDays,
      dailyComparison,
    })
  } catch (error) {
    console.error("[v0] Error fetching year comparison:", error)
    return NextResponse.json({ error: "Failed to fetch year comparison" }, { status: 500 })
  }
}
