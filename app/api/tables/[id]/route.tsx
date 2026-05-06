import { type NextRequest, NextResponse } from "next/server"
import { createClient, createServerClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data: table, error } = await supabase.from("tables").select("*").eq("id", id).maybeSingle()

    if (error) {
      console.error("[v0] Error fetching table:", error)
      return NextResponse.json({ error: "Failed to fetch table" }, { status: 500 })
    }

    if (!table) {
      return NextResponse.json({ error: "Table not found" }, { status: 404 })
    }

    return NextResponse.json(table)
  } catch (error) {
    console.error("[v0] Error in table API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createServerClient()

    const { data, error } = await supabase
      .from("tables")
      .delete()
      .eq("id", id)
      .select()
      .maybeSingle()

    if (error) {
      console.error("[v0] Error deleting table:", error)
      return NextResponse.json({ error: error.message || "Failed to delete table" }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: "Table not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in table DELETE API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
