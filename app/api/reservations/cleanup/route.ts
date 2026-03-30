import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

const ACTIVE_RESERVATION_STATUSES = ["pending", "confirmed", "seated"] as const

const dedupeIds = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const isMissingReservationTablesError = (error: any) => {
  const message = String(error?.message || "").toLowerCase()
  const details = String(error?.details || "").toLowerCase()
  const code = String(error?.code || "").toLowerCase()
  return (
    (message.includes("reservation_tables") || details.includes("reservation_tables")) &&
    (message.includes("does not exist") || details.includes("does not exist") || code === "42p01")
  )
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

  if (!linksAvailable) return Array.from(rowsById.values())

  const { data: linkRows, error: linksError } = await supabase
    .from("reservation_tables")
    .select("reservation_id")
    .eq("table_id", tableId)
  if (linksError) {
    if (isMissingReservationTablesError(linksError)) return Array.from(rowsById.values())
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

// Cancels past-day pending/confirmed reservations and recalculates associated table statuses
export async function POST() {
  try {
    const supabase = await createServerClient()

    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = String(today.getMonth() + 1).padStart(2, "0")
    const dd = String(today.getDate()).padStart(2, "0")
    const todayStr = `${yyyy}-${mm}-${dd}`

    const { data: oldActive, error: fetchError } = await supabase
      .from("reservations")
      .select("id, table_id")
      .lt("reservation_date", todayStr)
      .in("status", ["pending", "confirmed"])
    if (fetchError) throw fetchError

    if (!oldActive || oldActive.length === 0) {
      return NextResponse.json({ updated: 0 })
    }

    const reservationIds = oldActive.map((reservation) => reservation.id)
    const impactedTableIds = dedupeIds(oldActive.map((reservation) => String(reservation.table_id || "")))

    let linksAvailable = true
    const { data: linkRows, error: linksError } = await supabase
      .from("reservation_tables")
      .select("reservation_id, table_id")
      .in("reservation_id", reservationIds)
    if (linksError) {
      if (isMissingReservationTablesError(linksError)) {
        linksAvailable = false
      } else {
        throw linksError
      }
    } else {
      for (const link of linkRows || []) {
        impactedTableIds.push(String(link.table_id || ""))
      }
    }

    const { error: updateResErr } = await supabase
      .from("reservations")
      .update({ status: "cancelled" })
      .in("id", reservationIds)
    if (updateResErr) throw updateResErr

    await recalculateTableStatuses(supabase, impactedTableIds, linksAvailable)

    return NextResponse.json({ updated: reservationIds.length })
  } catch (error) {
    console.error("[v0] Error in reservations cleanup:", error)
    return NextResponse.json({ error: "Failed to cleanup reservations" }, { status: 500 })
  }
}
