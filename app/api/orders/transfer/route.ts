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

const hasReservationInNext90 = async (supabase: any, tableId: string) => {
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const endMinutes = nowMinutes + 90
  const today = formatDate(now)
  const tomorrow = formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))

  const dates = endMinutes > 1440 ? [today, tomorrow] : [today]
  const { data, error } = await supabase
    .from("reservations")
    .select("id, table_id, reservation_date, reservation_time, status")
    .in("status", ["pending", "confirmed"])
    .in("reservation_date", dates)

  if (error) {
    throw error
  }

  const reservations = data || []
  const reservationIds = reservations.map((reservation: any) => String(reservation.id || "")).filter(Boolean)
  let linksMap = new Map<string, string[]>()
  if (reservationIds.length > 0) {
    const { data: linksData, error: linksError } = await supabase
      .from("reservation_tables")
      .select("reservation_id, table_id")
      .in("reservation_id", reservationIds)

    if (linksError && !isMissingReservationTablesError(linksError)) {
      throw linksError
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

  return reservations.some((r: any) => {
    const reservationTableIds = dedupeIds([String(r.table_id || ""), ...(linksMap.get(String(r.id || "")) || [])])
    if (!reservationTableIds.includes(tableId)) return false

    const minutes = toMinutes(r.reservation_time)
    if (r.reservation_date === today) {
      if (endMinutes <= 1440) {
        return minutes >= nowMinutes && minutes <= endMinutes
      }
      return minutes >= nowMinutes
    }
    if (r.reservation_date === tomorrow && endMinutes > 1440) {
      return minutes <= endMinutes - 1440
    }
    return false
  })
}

export async function POST(request: Request) {
  try {
    const { orderId, fromTableId, toTableId, serverId } = await request.json()
    if (!orderId || !fromTableId || !toTableId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, table_id, status")
      .eq("id", orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    if (order.status !== "open") {
      return NextResponse.json({ error: "Order is not open" }, { status: 400 })
    }

    if (order.table_id !== fromTableId) {
      return NextResponse.json({ error: "Order does not belong to this table" }, { status: 400 })
    }

    const { data: targetTable, error: targetError } = await supabase
      .from("tables")
      .select("id, status")
      .eq("id", toTableId)
      .single()

    if (targetError || !targetTable) {
      return NextResponse.json({ error: "Target table not found" }, { status: 404 })
    }

    if (targetTable.status !== "available") {
      return NextResponse.json({ error: "Target table is not available" }, { status: 400 })
    }

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("table_id", toTableId)
      .eq("status", "open")
      .limit(1)
      .maybeSingle()

    if (existingOrder) {
      return NextResponse.json({ error: "Target table already has an open order" }, { status: 400 })
    }

    const hasUpcoming = await hasReservationInNext90(supabase, toTableId)
    if (hasUpcoming) {
      return NextResponse.json({ error: "Target table has a reservation soon" }, { status: 400 })
    }

    const { data: server } = await supabase.from("users").select("name").eq("id", serverId).single()

    const { error: updateOrderError } = await supabase
      .from("orders")
      .update({ table_id: toTableId })
      .eq("id", orderId)

    if (updateOrderError) {
      console.error("[v0] Error updating order table:", updateOrderError)
      return NextResponse.json({ error: "Failed to transfer order" }, { status: 500 })
    }

    await supabase.from("tables").update({ status: "available", opened_by: null, opened_by_name: null }).eq("id", fromTableId)
    await supabase
      .from("tables")
      .update({ status: "occupied", opened_by: serverId || null, opened_by_name: server?.name || null })
      .eq("id", toTableId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in order transfer API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
