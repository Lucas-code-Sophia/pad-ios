import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map((x) => Number.parseInt(x, 10))
  return h * 60 + m
}

const formatDate = (d: Date) => d.toISOString().split("T")[0]
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

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const fromTableId = searchParams.get("fromTableId")

    const { data: tables, error: tablesError } = await supabase
      .from("tables")
      .select("id, table_number, seats, status")
      .eq("archived", false)
      .eq("status", "available")
      .order("table_number", { ascending: true })

    if (tablesError) {
      console.error("[v0] Error fetching tables:", tablesError)
      return NextResponse.json({ error: "Failed to fetch tables" }, { status: 500 })
    }

    const availableTables = (tables || []).filter((t) => t.id !== fromTableId)
    if (availableTables.length === 0) {
      return NextResponse.json([])
    }

    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const windowMinutes = 90
    const endMinutes = nowMinutes + windowMinutes
    const today = formatDate(now)
    const tomorrow = formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))

    const tableIds = availableTables.map((t) => t.id)

    const { data: reservations, error: resError } = await supabase
      .from("reservations")
      .select("id, table_id, reservation_date, reservation_time, status")
      .in("status", ["pending", "confirmed"])
      .in("reservation_date", endMinutes > 1440 ? [today, tomorrow] : [today])

    if (resError) {
      console.error("[v0] Error fetching reservations:", resError)
      return NextResponse.json({ error: "Failed to fetch reservations" }, { status: 500 })
    }

    const reservationIds = (reservations || []).map((reservation: any) => String(reservation.id || "")).filter(Boolean)
    let linksMap = new Map<string, string[]>()
    if (reservationIds.length > 0) {
      const { data: linksData, error: linksError } = await supabase
        .from("reservation_tables")
        .select("reservation_id, table_id")
        .in("reservation_id", reservationIds)

      if (linksError && !isMissingReservationTablesError(linksError)) {
        console.error("[v0] Error fetching reservation links:", linksError)
        return NextResponse.json({ error: "Failed to fetch reservation links" }, { status: 500 })
      }

      if (!linksError) {
        for (const link of linksData || []) {
          const reservationId = String(link.reservation_id || "")
          const linkTableId = String(link.table_id || "")
          if (!reservationId || !linkTableId) continue
          if (!linksMap.has(reservationId)) linksMap.set(reservationId, [])
          linksMap.get(reservationId)!.push(linkTableId)
        }
      }
    }

    const blocked = new Set<string>()
    for (const r of reservations || []) {
      const minutes = toMinutes(r.reservation_time)
      const reservationTableIds = dedupeIds([
        String(r.table_id || ""),
        ...(linksMap.get(String(r.id || "")) || []),
      ]).filter((tableId) => tableIds.includes(tableId))

      if (reservationTableIds.length === 0) continue

      const blockTableIds = () => {
        for (const reservationTableId of reservationTableIds) {
          blocked.add(reservationTableId)
        }
      }

      if (r.reservation_date === today) {
        if (endMinutes <= 1440) {
          if (minutes >= nowMinutes && minutes <= endMinutes) blockTableIds()
        } else {
          if (minutes >= nowMinutes) blockTableIds()
        }
      } else if (r.reservation_date === tomorrow && endMinutes > 1440) {
        const nextDayEnd = endMinutes - 1440
        if (minutes <= nextDayEnd) blockTableIds()
      }
    }

    const filtered = availableTables.filter((t) => !blocked.has(t.id))
    return NextResponse.json(filtered)
  } catch (error) {
    console.error("[v0] Error in available transfer tables API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
