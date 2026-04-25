import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const toMinutes = (time: string) => {
  const [hours, minutes] = String(time || "")
    .split(":")
    .map((value) => Number.parseInt(value, 10))
  return hours * 60 + minutes
}

const formatDate = (date: Date) => date.toISOString().split("T")[0]
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
  const linksMap = new Map<string, string[]>()

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

  return reservations.some((reservation: any) => {
    const reservationTableIds = dedupeIds([
      String(reservation.table_id || ""),
      ...(linksMap.get(String(reservation.id || "")) || []),
    ])

    if (!reservationTableIds.includes(tableId)) return false

    const minutes = toMinutes(reservation.reservation_time)
    if (reservation.reservation_date === today) {
      if (endMinutes <= 1440) {
        return minutes >= nowMinutes && minutes <= endMinutes
      }
      return minutes >= nowMinutes
    }

    if (reservation.reservation_date === tomorrow && endMinutes > 1440) {
      return minutes <= endMinutes - 1440
    }

    return false
  })
}

export async function POST(request: Request) {
  try {
    const { targetTableId, sourceTableIds, serverId } = await request.json()

    if (!targetTableId || typeof targetTableId !== "string") {
      return NextResponse.json({ error: "Missing targetTableId" }, { status: 400 })
    }

    if (!Array.isArray(sourceTableIds)) {
      return NextResponse.json({ error: "sourceTableIds must be an array" }, { status: 400 })
    }

    const normalizedSourceIds = dedupeIds(
      sourceTableIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
    )

    if (normalizedSourceIds.length < 1) {
      return NextResponse.json({ error: "At least one source table is required" }, { status: 400 })
    }

    if (normalizedSourceIds.includes(targetTableId)) {
      return NextResponse.json({ error: "Target table cannot be one of the source tables" }, { status: 400 })
    }

    if (!serverId || typeof serverId !== "string") {
      return NextResponse.json({ error: "Missing serverId" }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: targetTable, error: targetTableError } = await supabase
      .from("tables")
      .select("id, table_number, status")
      .eq("id", targetTableId)
      .eq("archived", false)
      .maybeSingle()

    if (targetTableError) {
      console.error("[v0] Error loading target table for merge:", targetTableError)
      return NextResponse.json({ error: "Failed to load target table" }, { status: 500 })
    }

    if (!targetTable) {
      return NextResponse.json({ error: "Target table not found" }, { status: 404 })
    }

    const { data: sourceTables, error: sourceTablesError } = await supabase
      .from("tables")
      .select("id, table_number")
      .in("id", normalizedSourceIds)
      .eq("archived", false)

    if (sourceTablesError) {
      console.error("[v0] Error loading source tables for merge:", sourceTablesError)
      return NextResponse.json({ error: "Failed to load source tables" }, { status: 500 })
    }

    if (!sourceTables || sourceTables.length !== normalizedSourceIds.length) {
      return NextResponse.json({ error: "One or more source tables are invalid" }, { status: 404 })
    }

    const sourceTableNumberById = new Map<string, string>(
      sourceTables.map((table: any) => [String(table.id || ""), String(table.table_number || "")]),
    )

    const { data: sourceOpenOrders, error: sourceOpenOrdersError } = await supabase
      .from("orders")
      .select("id, table_id, covers, created_at")
      .in("table_id", normalizedSourceIds)
      .eq("status", "open")
      .order("created_at", { ascending: false })

    if (sourceOpenOrdersError) {
      console.error("[v0] Error loading source open orders for merge:", sourceOpenOrdersError)
      return NextResponse.json({ error: "Failed to load source open orders" }, { status: 500 })
    }

    const latestSourceOrderByTable = new Map<string, { id: string; covers: number }>()
    for (const order of sourceOpenOrders || []) {
      const tableId = String(order.table_id || "")
      const orderId = String(order.id || "")
      if (!tableId || !orderId) continue
      if (latestSourceOrderByTable.has(tableId)) continue

      latestSourceOrderByTable.set(tableId, {
        id: orderId,
        covers: Math.max(0, Number(order.covers) || 0),
      })
    }

    const missingSourceIds = normalizedSourceIds.filter((id) => !latestSourceOrderByTable.has(id))
    if (missingSourceIds.length > 0) {
      const missingLabels = missingSourceIds
        .map((id) => sourceTableNumberById.get(id))
        .filter(Boolean)
        .map((tableNumber) => `Table ${tableNumber}`)
      return NextResponse.json(
        {
          error:
            missingLabels.length > 0
              ? `${missingLabels.join(", ")} n'a pas de commande ouverte`
              : "Every source table must have an open order",
        },
        { status: 400 },
      )
    }

    const sourceOrderIds = Array.from(latestSourceOrderByTable.values()).map((order) => order.id)

    const { data: sourcePayments, error: sourcePaymentsError } = await supabase
      .from("payments")
      .select("order_id")
      .in("order_id", sourceOrderIds)

    if (sourcePaymentsError) {
      console.error("[v0] Error checking source payments for merge:", sourcePaymentsError)
      return NextResponse.json({ error: "Failed to validate source payments" }, { status: 500 })
    }

    if ((sourcePayments || []).length > 0) {
      const paidOrderIds = new Set<string>(
        (sourcePayments || []).map((payment: any) => String(payment.order_id || "")).filter(Boolean),
      )
      const blockedTables = normalizedSourceIds
        .filter((tableId) => {
          const order = latestSourceOrderByTable.get(tableId)
          return order ? paidOrderIds.has(order.id) : false
        })
        .map((tableId) => sourceTableNumberById.get(tableId))
        .filter(Boolean)
        .map((tableNumber) => `Table ${tableNumber}`)

      return NextResponse.json(
        {
          error:
            blockedTables.length > 0
              ? `Fusion impossible: paiement déjà enregistré sur ${blockedTables.join(", ")}`
              : "Fusion impossible: one or more source tables already have payments",
        },
        { status: 409 },
      )
    }

    const { data: targetOpenOrder, error: targetOpenOrderError } = await supabase
      .from("orders")
      .select("id, covers")
      .eq("table_id", targetTableId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (targetOpenOrderError) {
      console.error("[v0] Error loading target open order for merge:", targetOpenOrderError)
      return NextResponse.json({ error: "Failed to load target order" }, { status: 500 })
    }

    let targetOrderId = targetOpenOrder?.id ? String(targetOpenOrder.id) : ""
    const targetCovers = Math.max(0, Number(targetOpenOrder?.covers) || 0)

    if (!targetOrderId) {
      if (targetTable.status !== "available") {
        return NextResponse.json(
          { error: "Target table must be available or already have an open order" },
          { status: 409 },
        )
      }

      const hasUpcomingReservation = await hasReservationInNext90(supabase, targetTableId)
      if (hasUpcomingReservation) {
        return NextResponse.json({ error: "Target table has a reservation soon" }, { status: 409 })
      }

      const { data: createdOrder, error: createTargetOrderError } = await supabase
        .from("orders")
        .insert({
          table_id: targetTableId,
          server_id: serverId,
          status: "open",
        })
        .select("id")
        .single()

      if (createTargetOrderError || !createdOrder?.id) {
        console.error("[v0] Error creating target order for merge:", createTargetOrderError)
        return NextResponse.json({ error: "Failed to create target order" }, { status: 500 })
      }

      targetOrderId = String(createdOrder.id)
    }

    const sourceCovers = Array.from(latestSourceOrderByTable.values()).reduce(
      (sum, order) => sum + Math.max(0, Number(order.covers) || 0),
      0,
    )
    const mergedCoversValue = targetCovers + sourceCovers
    const mergedCovers = mergedCoversValue > 0 ? mergedCoversValue : null
    const nowIso = new Date().toISOString()

    const { error: moveItemsError } = await supabase
      .from("order_items")
      .update({ order_id: targetOrderId })
      .in("order_id", sourceOrderIds)

    if (moveItemsError) {
      console.error("[v0] Error moving order items during merge:", moveItemsError)
      return NextResponse.json({ error: "Failed to move order items" }, { status: 500 })
    }

    const { error: moveSupplementsError } = await supabase
      .from("supplements")
      .update({ order_id: targetOrderId })
      .in("order_id", sourceOrderIds)

    if (moveSupplementsError) {
      console.error("[v0] Error moving supplements during merge:", moveSupplementsError)
      return NextResponse.json({ error: "Failed to move supplements" }, { status: 500 })
    }

    const { error: closeSourceOrdersError } = await supabase
      .from("orders")
      .update({ status: "closed", closed_at: nowIso })
      .in("id", sourceOrderIds)

    if (closeSourceOrdersError) {
      console.error("[v0] Error closing source orders during merge:", closeSourceOrdersError)
      return NextResponse.json({ error: "Failed to close source orders" }, { status: 500 })
    }

    const { error: updateTargetCoversError } = await supabase
      .from("orders")
      .update({ covers: mergedCovers })
      .eq("id", targetOrderId)

    if (updateTargetCoversError) {
      console.error("[v0] Error updating target covers during merge:", updateTargetCoversError)
      return NextResponse.json({ error: "Failed to update target covers" }, { status: 500 })
    }

    const { error: releaseSourceTablesError } = await supabase
      .from("tables")
      .update({ status: "available", opened_by: null, opened_by_name: null })
      .in("id", normalizedSourceIds)

    if (releaseSourceTablesError) {
      console.error("[v0] Error releasing source tables during merge:", releaseSourceTablesError)
      return NextResponse.json({ error: "Failed to update source table status" }, { status: 500 })
    }

    const { data: server } = await supabase.from("users").select("name").eq("id", serverId).maybeSingle()

    const { error: occupyTargetTableError } = await supabase
      .from("tables")
      .update({
        status: "occupied",
        opened_by: serverId || null,
        opened_by_name: server?.name || null,
      })
      .eq("id", targetTableId)

    if (occupyTargetTableError) {
      console.error("[v0] Error updating target table status during merge:", occupyTargetTableError)
      return NextResponse.json({ error: "Failed to update target table status" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      targetTableId,
      targetOrderId,
      mergedSourceTableIds: normalizedSourceIds,
      mergedCovers,
    })
  } catch (error) {
    console.error("[v0] Error in orders merge API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
