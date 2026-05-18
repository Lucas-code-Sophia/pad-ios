import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const PAGE_SIZE = 1000
const ORDER_ID_CHUNK_SIZE = 200
const MENU_ID_CHUNK_SIZE = 500

type Breakdown = {
  ttc_0: number
  ht_0: number
  tva_0: number
  ttc_10: number
  ht_10: number
  tva_10: number
  ttc_20: number
  ht_20: number
  tva_20: number
  ttc_other: number
  ht_other: number
  tva_other: number
}

const createEmptyBreakdown = (): Breakdown => ({
  ttc_0: 0,
  ht_0: 0,
  tva_0: 0,
  ttc_10: 0,
  ht_10: 0,
  tva_10: 0,
  ttc_20: 0,
  ht_20: 0,
  tva_20: 0,
  ttc_other: 0,
  ht_other: 0,
  tva_other: 0,
})

const round2 = (value: number) => Math.round(value * 100) / 100
const isIsoDate = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))

const normalizeRate = (value: number) => {
  if (Math.abs(value - 0) < 0.0001) return 0
  if (Math.abs(value - 10) < 0.0001) return 10
  if (Math.abs(value - 20) < 0.0001) return 20
  return -1
}

const addLineToBreakdown = (target: Breakdown, rateRaw: number, lineTtc: number) => {
  const rate = normalizeRate(rateRaw)
  const lineHt = rateRaw > 0 ? lineTtc / (1 + rateRaw / 100) : lineTtc
  const lineTva = lineTtc - lineHt

  if (rate === 0) {
    target.ttc_0 += lineTtc
    target.ht_0 += lineHt
    target.tva_0 += lineTva
    return
  }

  if (rate === 10) {
    target.ttc_10 += lineTtc
    target.ht_10 += lineHt
    target.tva_10 += lineTva
    return
  }

  if (rate === 20) {
    target.ttc_20 += lineTtc
    target.ht_20 += lineHt
    target.tva_20 += lineTva
    return
  }

  target.ttc_other += lineTtc
  target.ht_other += lineHt
  target.tva_other += lineTva
}

const fetchRowsByOrderIds = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "order_items" | "supplements",
  select: string,
  orderIds: string[],
) => {
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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      return NextResponse.json({ error: "Paramètres startDate et endDate invalides (YYYY-MM-DD)." }, { status: 400 })
    }

    if (String(startDate) > String(endDate)) {
      return NextResponse.json({ error: "startDate doit être inférieur ou égal à endDate." }, { status: 400 })
    }

    const supabase = await createClient()

    const dailySales: any[] = []
    let salesOffset = 0

    while (true) {
      const { data: salesPage, error: salesError } = await supabase
        .from("daily_sales")
        .select("date, order_id, total_amount")
        .gte("date", String(startDate))
        .lte("date", String(endDate))
        .order("date", { ascending: true })
        .order("created_at", { ascending: true })
        .range(salesOffset, salesOffset + PAGE_SIZE - 1)

      if (salesError) throw salesError
      if (!salesPage || salesPage.length === 0) break

      dailySales.push(...salesPage)
      if (salesPage.length < PAGE_SIZE) break
      salesOffset += PAGE_SIZE
    }

    const orderIds = Array.from(new Set(dailySales.map((sale) => sale.order_id).filter(Boolean)))
    const orderIdToDate = new Map<string, string>(
      dailySales.map((sale) => [String(sale.order_id), String(sale.date)]),
    )

    const allOrderItems = await fetchRowsByOrderIds(
      supabase,
      "order_items",
      "order_id, menu_item_id, quantity, price, is_complimentary",
      orderIds,
    )
    const allSupplements = await fetchRowsByOrderIds(
      supabase,
      "supplements",
      "order_id, amount, tax_rate, is_complimentary",
      orderIds,
    )

    const uniqueMenuItemIds = Array.from(new Set(allOrderItems.map((item: any) => item.menu_item_id).filter(Boolean)))
    const menuTaxRateById = new Map<string, number>()

    for (let i = 0; i < uniqueMenuItemIds.length; i += MENU_ID_CHUNK_SIZE) {
      const menuIdChunk = uniqueMenuItemIds.slice(i, i + MENU_ID_CHUNK_SIZE)
      const { data: menuChunk, error: menuChunkError } = await supabase
        .from("menu_items")
        .select("id, tax_rate")
        .in("id", menuIdChunk)

      if (menuChunkError) throw menuChunkError
      for (const item of menuChunk || []) {
        menuTaxRateById.set(String(item.id), Number(item.tax_rate) || 0)
      }
    }

    const byDate = new Map<string, Breakdown & { date: string; ca_ttc: number; orders: number }>()
    const totals = createEmptyBreakdown()
    let totalCaTtc = 0

    for (const sale of dailySales) {
      const date = String(sale.date)
      const current = byDate.get(date) || {
        date,
        ca_ttc: 0,
        orders: 0,
        ...createEmptyBreakdown(),
      }
      current.ca_ttc += Number(sale.total_amount) || 0
      current.orders += 1
      byDate.set(date, current)
      totalCaTtc += Number(sale.total_amount) || 0
    }

    for (const item of allOrderItems) {
      if (!item?.menu_item_id || item?.is_complimentary) continue
      const quantity = Number(item.quantity || 0)
      if (quantity <= 0) continue

      const lineTtc = (Number(item.price) || 0) * quantity
      const rate = menuTaxRateById.get(String(item.menu_item_id))
      if (rate == null) continue

      addLineToBreakdown(totals, rate, lineTtc)
      const date = orderIdToDate.get(String(item.order_id))
      if (date && byDate.has(date)) {
        addLineToBreakdown(byDate.get(date)!, rate, lineTtc)
      }
    }

    for (const supplement of allSupplements) {
      if (supplement?.is_complimentary) continue
      const lineTtc = Number(supplement?.amount || 0)
      if (lineTtc <= 0) continue

      const rate = Number(supplement?.tax_rate ?? 10)
      addLineToBreakdown(totals, rate, lineTtc)
      const date = orderIdToDate.get(String(supplement?.order_id))
      if (date && byDate.has(date)) {
        addLineToBreakdown(byDate.get(date)!, rate, lineTtc)
      }
    }

    const toPayload = (item: Breakdown & { ca_ttc?: number; orders?: number }) => {
      const caHt = item.ht_0 + item.ht_10 + item.ht_20 + item.ht_other
      const totalTva = item.tva_0 + item.tva_10 + item.tva_20 + item.tva_other
      return {
        ca_ttc: round2(item.ca_ttc || 0),
        ca_ht: round2(caHt),
        total_tva: round2(totalTva),
        ttc_0: round2(item.ttc_0),
        ht_0: round2(item.ht_0),
        tva_0: round2(item.tva_0),
        ttc_10: round2(item.ttc_10),
        ht_10: round2(item.ht_10),
        tva_10: round2(item.tva_10),
        ttc_20: round2(item.ttc_20),
        ht_20: round2(item.ht_20),
        tva_20: round2(item.tva_20),
        ttc_other: round2(item.ttc_other),
        ht_other: round2(item.ht_other),
        tva_other: round2(item.tva_other),
        orders: Number(item.orders || 0),
      }
    }

    const appByDate = Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => ({
        date: item.date,
        ...toPayload(item),
      }))

    return NextResponse.json({
      period: {
        startDate: String(startDate),
        endDate: String(endDate),
      },
      appTotals: {
        ...toPayload({ ...totals, ca_ttc: totalCaTtc, orders: dailySales.length }),
      },
      appByDate,
    })
  } catch (error) {
    console.error("[v0] Error fetching TVA analyst summary:", error)
    return NextResponse.json({ error: "Failed to fetch TVA analyst summary" }, { status: 500 })
  }
}
