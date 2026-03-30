import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

const isMissingReservationTablesError = (error: any) => {
  const message = String(error?.message || "").toLowerCase()
  const details = String(error?.details || "").toLowerCase()
  const code = String(error?.code || "").toLowerCase()
  return (
    (message.includes("reservation_tables") || details.includes("reservation_tables")) &&
    (message.includes("does not exist") || details.includes("does not exist") || code === "42p01")
  )
}

const dedupeById = (reservations: any[]) => {
  const map = new Map<string, any>()
  for (const reservation of reservations) {
    const id = String(reservation?.id || "")
    if (!id) continue
    map.set(id, reservation)
  }
  return Array.from(map.values())
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tableId = String(searchParams.get("tableId") || "").trim()
    const date = searchParams.get("date")
    if (!tableId) return NextResponse.json({ error: "Missing tableId" }, { status: 400 })

    const supabase = await createServerClient()

    let linkedReservationIds: string[] = []
    let linksAvailable = true

    const { data: linkRows, error: linksError } = await supabase
      .from("reservation_tables")
      .select("reservation_id")
      .eq("table_id", tableId)

    if (linksError) {
      if (isMissingReservationTablesError(linksError)) {
        linksAvailable = false
      } else {
        throw linksError
      }
    } else {
      linkedReservationIds = (linkRows || [])
        .map((row: any) => String(row.reservation_id || ""))
        .filter(Boolean)
    }

    const legacyQuery = supabase.from("reservations").select("*").eq("table_id", tableId)
    const linkedQuery = linksAvailable && linkedReservationIds.length > 0
      ? supabase.from("reservations").select("*").in("id", linkedReservationIds)
      : null

    if (date) {
      const [{ data: legacyRows, error: legacyError }, linkedResult] = await Promise.all([
        legacyQuery.eq("reservation_date", date).order("reservation_time", { ascending: true }),
        linkedQuery
          ? linkedQuery.eq("reservation_date", date).order("reservation_time", { ascending: true })
          : Promise.resolve({ data: [], error: null as any }),
      ])

      if (legacyError) throw legacyError
      if (linkedResult.error) throw linkedResult.error

      const merged = dedupeById([...(legacyRows || []), ...(linkedResult.data || [])]).sort((a, b) =>
        String(a.reservation_time || "").localeCompare(String(b.reservation_time || "")),
      )
      return NextResponse.json(merged)
    }

    const [{ data: legacyRows, error: legacyError }, linkedResult] = await Promise.all([
      legacyQuery
        .in("status", ["pending", "confirmed"])
        .order("reservation_date", { ascending: false })
        .order("reservation_time", { ascending: false })
        .limit(5),
      linkedQuery
        ? linkedQuery
            .in("status", ["pending", "confirmed"])
            .order("reservation_date", { ascending: false })
            .order("reservation_time", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null as any }),
    ])

    if (legacyError) throw legacyError
    if (linkedResult.error) throw linkedResult.error

    const merged = dedupeById([...(legacyRows || []), ...(linkedResult.data || [])]).sort((a, b) => {
      const dateCmp = String(b.reservation_date || "").localeCompare(String(a.reservation_date || ""))
      if (dateCmp !== 0) return dateCmp
      return String(b.reservation_time || "").localeCompare(String(a.reservation_time || ""))
    })

    return NextResponse.json(merged[0] || null)
  } catch (error) {
    console.error("[v0] Error fetching reservation by table:", error)
    return NextResponse.json({ error: "Failed to fetch reservation by table" }, { status: 500 })
  }
}
