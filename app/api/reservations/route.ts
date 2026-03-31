import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

const DEFAULT_RESERVATION_DURATION_MINUTES = 120
const ACTIVE_RESERVATION_STATUSES = ["pending", "confirmed", "seated"] as const

const normalizeDurationMinutes = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESERVATION_DURATION_MINUTES
}

const toMinutes = (t: string) => {
  const [h, m] = String(t)
    .slice(0, 5)
    .split(":")
    .map((x: string) => Number.parseInt(x, 10))
  return h * 60 + m
}

const intervalsOverlap = (startA: number, durationA: number, startB: number, durationB: number) => {
  const endA = startA + durationA
  const endB = startB + durationB
  return !(endA <= startB || startA >= endB)
}

const dedupeIds = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const normalizeTableIds = (tableIdsInput: unknown, tableIdInput: unknown) => {
  const fromArray = Array.isArray(tableIdsInput) ? tableIdsInput.map((v) => String(v || "").trim()) : []
  const fromLegacy = String(tableIdInput || "").trim()
  return dedupeIds(fromLegacy ? [fromLegacy, ...fromArray] : fromArray)
}

const isMissingReservationTablesError = (error: any) => {
  const message = String(error?.message || "").toLowerCase()
  const details = String(error?.details || "").toLowerCase()
  const code = String(error?.code || "").toLowerCase()
  return (
    (message.includes("reservation_tables") || details.includes("reservation_tables")) &&
    (message.includes("does not exist") || details.includes("does not exist") || code === "42p01")
  )
}

const fetchReservationLinks = async (supabase: any, reservationIds: string[]) => {
  if (reservationIds.length === 0) return { map: new Map<string, string[]>(), available: true }

  const { data, error } = await supabase
    .from("reservation_tables")
    .select("reservation_id, table_id")
    .in("reservation_id", reservationIds)

  if (error) {
    if (isMissingReservationTablesError(error)) {
      return { map: new Map<string, string[]>(), available: false }
    }
    throw error
  }

  const map = new Map<string, string[]>()
  for (const row of data || []) {
    const reservationId = String(row.reservation_id || "")
    const tableId = String(row.table_id || "")
    if (!reservationId || !tableId) continue
    if (!map.has(reservationId)) map.set(reservationId, [])
    map.get(reservationId)!.push(tableId)
  }

  return { map, available: true }
}

const getEffectiveReservationTableIds = (reservation: any, linksMap: Map<string, string[]>) => {
  const linked = linksMap.get(String(reservation.id || "")) || []
  const legacy = String(reservation.table_id || "").trim()
  return dedupeIds(legacy ? [legacy, ...linked] : linked)
}

const buildTableMeta = async (supabase: any, tableIds: string[]) => {
  const uniqueIds = dedupeIds(tableIds)
  if (uniqueIds.length === 0) return new Map<string, { table_number: string; seats: number }>()

  const { data, error } = await supabase.from("tables").select("id, table_number, seats").in("id", uniqueIds)
  if (error) throw error

  const map = new Map<string, { table_number: string; seats: number }>()
  for (const row of data || []) {
    map.set(row.id, {
      table_number: String(row.table_number || ""),
      seats: Number(row.seats || 0),
    })
  }
  return map
}

const sortTableIdsByNumber = (tableIds: string[], tableMap: Map<string, { table_number: string; seats: number }>) => {
  return [...tableIds].sort((a, b) => {
    const aNumber = tableMap.get(a)?.table_number || a
    const bNumber = tableMap.get(b)?.table_number || b
    return aNumber.localeCompare(bNumber, undefined, { numeric: true, sensitivity: "base" })
  })
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")

    let query = supabase.from("reservations").select("*").order("reservation_time", { ascending: true })
    if (date) {
      query = query.eq("reservation_date", date)
    }

    const { data: reservations, error } = await query
    if (error) throw error

    const safeReservations = reservations || []
    const reservationIds = safeReservations.map((r: any) => String(r.id || "")).filter(Boolean)
    const linksResult = await fetchReservationLinks(supabase, reservationIds)

    const allTableIds = safeReservations.flatMap((reservation: any) =>
      getEffectiveReservationTableIds(reservation, linksResult.map),
    )
    const tableMeta = await buildTableMeta(supabase, allTableIds)

    const enriched = safeReservations.map((reservation: any) => {
      const tableIds = sortTableIdsByNumber(getEffectiveReservationTableIds(reservation, linksResult.map), tableMeta)
      const tableNumbers = tableIds.map((tableId) => tableMeta.get(tableId)?.table_number || "").filter(Boolean)
      const totalSeats = tableIds.reduce((sum, tableId) => sum + (tableMeta.get(tableId)?.seats || 0), 0)

      return {
        ...reservation,
        table_ids: tableIds,
        table_numbers: tableNumbers,
        total_seats: totalSeats,
      }
    })

    return NextResponse.json(enriched)
  } catch (error) {
    console.error("[v0] Error fetching reservations:", error)
    return NextResponse.json({ error: "Failed to fetch reservations" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = await createServerClient()

    const selectedTableIds = normalizeTableIds(body?.table_ids, body?.table_id)
    if (selectedTableIds.length === 0) {
      return NextResponse.json({ error: "Au moins une table est requise" }, { status: 400 })
    }
    if (!body?.reservation_date || !body?.reservation_time) {
      return NextResponse.json({ error: "Date et heure de réservation requises" }, { status: 400 })
    }

    const newDuration = normalizeDurationMinutes(body.duration_minutes)
    const newStart = toMinutes(body.reservation_time as string)

    const { data: existing, error: fetchErr } = await supabase
      .from("reservations")
      .select("id, table_id, reservation_time, status, duration_minutes")
      .eq("reservation_date", body.reservation_date)
      .in("status", [...ACTIVE_RESERVATION_STATUSES])
    if (fetchErr) throw fetchErr

    const existingRows = existing || []
    const existingIds = existingRows.map((r: any) => String(r.id || "")).filter(Boolean)
    const linksResult = await fetchReservationLinks(supabase, existingIds)

    const hasConflict = existingRows.some((reservation: any) => {
      const start = toMinutes(reservation.reservation_time as string)
      const duration = normalizeDurationMinutes(reservation.duration_minutes)
      if (!intervalsOverlap(newStart, newDuration, start, duration)) return false

      const reservationTableIds = getEffectiveReservationTableIds(reservation, linksResult.map)
      return reservationTableIds.some((tableId) => selectedTableIds.includes(tableId))
    })

    if (hasConflict) {
      return NextResponse.json(
        { error: "Réservation en conflit: créneau déjà occupé pour au moins une table sélectionnée." },
        { status: 400 },
      )
    }

    const insertPayload: Record<string, any> = { ...body }
    delete insertPayload.table_ids
    insertPayload.table_id = selectedTableIds[0]
    insertPayload.duration_minutes = newDuration
    if (!insertPayload.created_by) insertPayload.created_by = null

    const { data: created, error: createError } = await supabase
      .from("reservations")
      .insert(insertPayload)
      .select()
      .single()
    if (createError) throw createError

    if (linksResult.available) {
      const linkRows = selectedTableIds.map((tableId) => ({
        reservation_id: created.id,
        table_id: tableId,
      }))
      const { error: linksInsertError } = await supabase.from("reservation_tables").insert(linkRows)
      if (linksInsertError) {
        await supabase.from("reservations").delete().eq("id", created.id)
        throw linksInsertError
      }
    } else if (selectedTableIds.length > 1) {
      await supabase.from("reservations").delete().eq("id", created.id)
      return NextResponse.json(
        { error: "La base n'est pas migrée pour les réservations multi-tables (table reservation_tables manquante)." },
        { status: 500 },
      )
    }

    await supabase.from("tables").update({ status: "reserved" }).in("id", selectedTableIds)

    const tableMeta = await buildTableMeta(supabase, selectedTableIds)
    const orderedTableIds = sortTableIdsByNumber(selectedTableIds, tableMeta)

    return NextResponse.json({
      ...created,
      table_ids: orderedTableIds,
      table_numbers: orderedTableIds.map((tableId) => tableMeta.get(tableId)?.table_number || "").filter(Boolean),
      total_seats: orderedTableIds.reduce((sum, tableId) => sum + (tableMeta.get(tableId)?.seats || 0), 0),
    })
  } catch (error) {
    console.error("[v0] Error creating reservation:", error)
    return NextResponse.json({ error: "Failed to create reservation" }, { status: 500 })
  }
}
