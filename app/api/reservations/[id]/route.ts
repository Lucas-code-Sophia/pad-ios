import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

const DEFAULT_RESERVATION_DURATION_MINUTES = 90
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

const listActiveReservationStatusesForTable = async (supabase: any, tableId: string, linksAvailable: boolean) => {
  const { data: legacyRows, error: legacyError } = await supabase
    .from("reservations")
    .select("id, status")
    .eq("table_id", tableId)
    .in("status", [...ACTIVE_RESERVATION_STATUSES])
  if (legacyError) throw legacyError

  const rowsById = new Map<string, string>()
  for (const row of legacyRows || []) {
    rowsById.set(String(row.id), String(row.status))
  }

  if (!linksAvailable) {
    return Array.from(rowsById.values())
  }

  const { data: linkRows, error: linksError } = await supabase
    .from("reservation_tables")
    .select("reservation_id")
    .eq("table_id", tableId)
  if (linksError) {
    if (isMissingReservationTablesError(linksError)) {
      return Array.from(rowsById.values())
    }
    throw linksError
  }

  const linkedReservationIds = dedupeIds((linkRows || []).map((row: any) => String(row.reservation_id || "")))
  if (linkedReservationIds.length > 0) {
    const { data: linkedRows, error: linkedError } = await supabase
      .from("reservations")
      .select("id, status")
      .in("id", linkedReservationIds)
      .in("status", [...ACTIVE_RESERVATION_STATUSES])
    if (linkedError) throw linkedError

    for (const row of linkedRows || []) {
      rowsById.set(String(row.id), String(row.status))
    }
  }

  return Array.from(rowsById.values())
}

const recalculateTableStatuses = async (supabase: any, tableIds: string[], linksAvailable: boolean) => {
  for (const tableId of dedupeIds(tableIds)) {
    if (!tableId) continue
    const statuses = await listActiveReservationStatusesForTable(supabase, tableId, linksAvailable)
    const hasSeated = statuses.some((status) => status === "seated")
    const hasActive = statuses.length > 0

    if (hasSeated) {
      await supabase.from("tables").update({ status: "occupied" }).eq("id", tableId)
    } else if (hasActive) {
      await supabase.from("tables").update({ status: "reserved" }).eq("id", tableId)
    } else {
      await supabase.from("tables").update({ status: "available", opened_by: null, opened_by_name: null }).eq("id", tableId)
    }
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const supabase = await createServerClient()

    const { data: currentReservation, error: currentError } = await supabase
      .from("reservations")
      .select("id, table_id, reservation_date, reservation_time, duration_minutes")
      .eq("id", id)
      .single()
    if (currentError || !currentReservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 })
    }

    const currentLinksResult = await fetchReservationLinks(supabase, [id])
    const currentTableIds = getEffectiveReservationTableIds(currentReservation, currentLinksResult.map)

    const selectedTableIds = normalizeTableIds(body?.table_ids, body?.table_id)
    const targetTableIds = selectedTableIds.length > 0 ? selectedTableIds : currentTableIds
    if (targetTableIds.length === 0) {
      return NextResponse.json({ error: "Au moins une table est requise" }, { status: 400 })
    }

    const targetDate = body?.reservation_date ?? currentReservation.reservation_date
    const targetTime = body?.reservation_time ?? currentReservation.reservation_time
    const targetDuration = body?.duration_minutes !== undefined
      ? normalizeDurationMinutes(body.duration_minutes)
      : normalizeDurationMinutes(currentReservation.duration_minutes)

    const shouldValidateOverlap =
      body?.table_ids !== undefined ||
      body?.table_id !== undefined ||
      body?.reservation_date !== undefined ||
      body?.reservation_time !== undefined ||
      body?.duration_minutes !== undefined

    if (shouldValidateOverlap && targetDate && targetTime) {
      const { data: existing, error: existingError } = await supabase
        .from("reservations")
        .select("id, table_id, reservation_time, duration_minutes")
        .eq("reservation_date", targetDate)
        .in("status", [...ACTIVE_RESERVATION_STATUSES])
        .neq("id", id)
      if (existingError) throw existingError

      const existingRows = existing || []
      const existingIds = existingRows.map((reservation: any) => String(reservation.id || "")).filter(Boolean)
      const linksResult = await fetchReservationLinks(supabase, existingIds)

      const newStart = toMinutes(targetTime as string)
      const hasConflict = existingRows.some((reservation: any) => {
        const start = toMinutes(reservation.reservation_time as string)
        const duration = normalizeDurationMinutes(reservation.duration_minutes)
        if (!intervalsOverlap(newStart, targetDuration, start, duration)) return false

        const reservationTableIds = getEffectiveReservationTableIds(reservation, linksResult.map)
        return reservationTableIds.some((tableId) => targetTableIds.includes(tableId))
      })

      if (hasConflict) {
        return NextResponse.json(
          { error: "Réservation en conflit: créneau déjà occupé pour au moins une table sélectionnée." },
          { status: 400 },
        )
      }
    }

    const sanitizedBody: Record<string, any> = { ...body }
    delete sanitizedBody.table_ids
    if (body?.duration_minutes !== undefined) {
      sanitizedBody.duration_minutes = normalizeDurationMinutes(body.duration_minutes)
    }
    if (body?.table_ids !== undefined || body?.table_id !== undefined) {
      sanitizedBody.table_id = targetTableIds[0]
    }

    const { data: updatedReservation, error: updateError } = await supabase
      .from("reservations")
      .update(sanitizedBody)
      .eq("id", id)
      .select()
      .single()
    if (updateError) throw updateError

    const linksAvailable = currentLinksResult.available
    if (body?.table_ids !== undefined || body?.table_id !== undefined) {
      if (!linksAvailable && targetTableIds.length > 1) {
        return NextResponse.json(
          { error: "La base n'est pas migrée pour les réservations multi-tables (table reservation_tables manquante)." },
          { status: 500 },
        )
      }

      if (linksAvailable) {
        const { error: deleteLinksError } = await supabase.from("reservation_tables").delete().eq("reservation_id", id)
        if (deleteLinksError) throw deleteLinksError

        const linkRows = targetTableIds.map((tableId) => ({
          reservation_id: id,
          table_id: tableId,
        }))
        const { error: insertLinksError } = await supabase.from("reservation_tables").insert(linkRows)
        if (insertLinksError) throw insertLinksError
      }
    }

    const impactedTableIds = dedupeIds([...currentTableIds, ...targetTableIds])
    await recalculateTableStatuses(supabase, impactedTableIds, linksAvailable)

    return NextResponse.json({
      ...updatedReservation,
      table_ids: targetTableIds,
    })
  } catch (error) {
    console.error("[v0] Error updating reservation:", error)
    return NextResponse.json({ error: "Failed to update reservation" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createServerClient()

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, table_id")
      .eq("id", id)
      .single()
    if (reservationError || !reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 })
    }

    const linksResult = await fetchReservationLinks(supabase, [id])
    const impactedTableIds = getEffectiveReservationTableIds(reservation, linksResult.map)

    const { error } = await supabase.from("reservations").delete().eq("id", id)
    if (error) throw error

    await recalculateTableStatuses(supabase, impactedTableIds, linksResult.available)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error deleting reservation:", error)
    return NextResponse.json({ error: "Failed to delete reservation" }, { status: 500 })
  }
}
