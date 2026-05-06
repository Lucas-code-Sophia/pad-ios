import { NextResponse } from "next/server"
import { createClient, createServerClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: tables, error } = await supabase.from("tables").select("*").eq("archived", false).order("table_number", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching tables:", error)
      return NextResponse.json({ error: error.message || "Failed to fetch tables" }, { status: 500 })
    }

    // Enrichir les tables occupées avec le nombre de couverts de la commande ouverte
    const occupiedTableIds = (tables || []).filter((t: any) => t.status === "occupied").map((t: any) => t.id)
    let coversMap = new Map<string, number>()
    let hasToFollowMap = new Map<string, boolean>()
    if (occupiedTableIds.length > 0) {
      const { data: openOrders } = await supabase
        .from("orders")
        .select("id, table_id, covers")
        .in("table_id", occupiedTableIds)
        .eq("status", "open")

      for (const o of openOrders || []) {
        if (o.covers != null && o.covers > 0) {
          coversMap.set(o.table_id, o.covers)
        }
      }

      const openOrderIds = (openOrders || []).map((o: any) => o.id).filter(Boolean)
      if (openOrderIds.length > 0) {
        const { data: toFollowItems } = await supabase
          .from("order_items")
          .select("order_id")
          .in("order_id", openOrderIds)
          .in("status", ["to_follow_1", "to_follow_2"])

        const orderToTableMap = new Map<string, string>()
        for (const o of openOrders || []) {
          orderToTableMap.set(o.id, o.table_id)
        }

        for (const item of toFollowItems || []) {
          const tableId = orderToTableMap.get(item.order_id)
          if (tableId) hasToFollowMap.set(tableId, true)
        }
      }
    }

    const enrichedTables = (tables || []).map((t: any) => ({
      ...t,
      current_covers: coversMap.get(t.id) ?? null,
      has_to_follow: hasToFollowMap.get(t.id) ?? false,
    }))

    return NextResponse.json(enrichedTables)
  } catch (error) {
    console.error("[v0] Error in tables API:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()

    const { data: table, error } = await supabase
      .from("tables")
      .insert({
        table_number: body.table_number,
        seats: body.seats,
        location: body.location,
        position_x: body.position_x || 100,
        position_y: body.position_y || 100,
        status: body.status || "available",
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Error creating table:", error)
      return NextResponse.json({ error: error.message || "Failed to create table" }, { status: 500 })
    }

    return NextResponse.json(table)
  } catch (error) {
    console.error("[v0] Error in tables POST API:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createServerClient()
    const body = await request.json().catch(() => ({}))
    const scope = String(body?.scope || "all")

    if (scope !== "all") {
      return NextResponse.json({ error: "Invalid delete scope" }, { status: 400 })
    }

    const { data: existingTables, error: listError } = await supabase.from("tables").select("id")
    if (listError) {
      console.error("[v0] Error listing tables before bulk delete:", listError)
      return NextResponse.json({ error: listError.message || "Failed to list tables" }, { status: 500 })
    }

    const tableIds = (existingTables || []).map((row: any) => String(row.id || "")).filter(Boolean)
    if (tableIds.length === 0) {
      return NextResponse.json({ success: true, deletedCount: 0 })
    }

    const { error: deleteError } = await supabase.from("tables").delete().in("id", tableIds)
    if (deleteError) {
      console.error("[v0] Error bulk deleting tables:", deleteError)
      return NextResponse.json({ error: deleteError.message || "Failed to delete tables" }, { status: 500 })
    }

    return NextResponse.json({ success: true, deletedCount: tableIds.length })
  } catch (error) {
    console.error("[v0] Error in tables DELETE API:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    )
  }
}
