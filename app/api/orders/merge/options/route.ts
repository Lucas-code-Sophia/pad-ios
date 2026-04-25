import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

type MergeOptionRow = {
  id: string
  table_number: string
  status: "available" | "occupied" | "reserved"
  seats: number
  openOrderId: string | null
  covers: number | null
  hasPayments: boolean
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const currentTableId = searchParams.get("currentTableId")

    const { data: tables, error: tablesError } = await supabase
      .from("tables")
      .select("id, table_number, status, seats")
      .eq("archived", false)
      .order("table_number", { ascending: true })

    if (tablesError) {
      console.error("[v0] Error loading merge table options:", tablesError)
      return NextResponse.json({ error: "Failed to load tables" }, { status: 500 })
    }

    const tableRows = tables || []
    if (tableRows.length === 0) {
      return NextResponse.json([])
    }

    const tableIds = tableRows.map((table: any) => String(table.id || "")).filter(Boolean)

    const { data: openOrders, error: openOrdersError } = await supabase
      .from("orders")
      .select("id, table_id, covers, created_at")
      .in("table_id", tableIds)
      .eq("status", "open")
      .order("created_at", { ascending: false })

    if (openOrdersError) {
      console.error("[v0] Error loading open orders for merge options:", openOrdersError)
      return NextResponse.json({ error: "Failed to load open orders" }, { status: 500 })
    }

    const latestOpenOrderByTable = new Map<string, { id: string; covers: number | null }>()
    for (const order of openOrders || []) {
      const tableId = String(order.table_id || "")
      const orderId = String(order.id || "")
      if (!tableId || !orderId) continue
      if (latestOpenOrderByTable.has(tableId)) continue

      latestOpenOrderByTable.set(tableId, {
        id: orderId,
        covers: order.covers != null ? Number(order.covers) || 0 : null,
      })
    }

    const openOrderIds = Array.from(latestOpenOrderByTable.values())
      .map((row) => row.id)
      .filter(Boolean)

    const paidOrderIds = new Set<string>()
    if (openOrderIds.length > 0) {
      const { data: payments, error: paymentsError } = await supabase
        .from("payments")
        .select("order_id")
        .in("order_id", openOrderIds)

      if (paymentsError) {
        console.error("[v0] Error loading payments for merge options:", paymentsError)
        return NextResponse.json({ error: "Failed to load payment status" }, { status: 500 })
      }

      for (const payment of payments || []) {
        const orderId = String(payment.order_id || "")
        if (orderId) paidOrderIds.add(orderId)
      }
    }

    const options: MergeOptionRow[] = tableRows.map((table: any) => {
      const tableId = String(table.id || "")
      const openOrder = latestOpenOrderByTable.get(tableId)

      return {
        id: tableId,
        table_number: String(table.table_number || ""),
        status: table.status,
        seats: Number(table.seats) || 0,
        openOrderId: openOrder?.id || null,
        covers: openOrder?.covers ?? null,
        hasPayments: openOrder ? paidOrderIds.has(openOrder.id) : false,
      }
    })

    if (currentTableId) {
      options.sort((a, b) => {
        if (a.id === currentTableId) return -1
        if (b.id === currentTableId) return 1
        return 0
      })
    }

    return NextResponse.json(options)
  } catch (error) {
    console.error("[v0] Error in merge options API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
