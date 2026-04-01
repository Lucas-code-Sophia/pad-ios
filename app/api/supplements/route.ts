import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get("orderId")

    if (!orderId) {
      return NextResponse.json({ error: "Order ID required" }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data: supplements, error } = await supabase
      .from("supplements")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching supplements:", error)
      return NextResponse.json({ error: "Failed to fetch supplements" }, { status: 500 })
    }

    return NextResponse.json(supplements || [])
  } catch (error) {
    console.error("[v0] Error in supplements GET API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const supplementId = searchParams.get("id")
    const orderId = searchParams.get("orderId")

    if (!supplementId) {
      return NextResponse.json({ error: "Supplement ID required" }, { status: 400 })
    }

    const supabase = await createServerClient()
    let query = supabase.from("supplements").delete().eq("id", supplementId)

    if (orderId) {
      query = query.eq("order_id", orderId)
    }

    const { error } = await query

    if (error) {
      console.error("[v0] Error deleting supplement:", error)
      return NextResponse.json({ error: "Failed to delete supplement" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in supplements DELETE API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
