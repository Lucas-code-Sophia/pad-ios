import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// GET /api/reservations/customer-visits?phones=0612345678,0698765432
// Returns { "0612345678": 5, "0698765432": 2 }
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const phonesParam = searchParams.get("phones")

    if (!phonesParam) {
      return NextResponse.json({})
    }

    const phones = phonesParam
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)

    if (phones.length === 0) {
      return NextResponse.json({})
    }

    const supabase = await createClient()

    // Count reservations per phone (excluding cancelled) from both reservations and reservation_history
    const result: Record<string, number> = {}

    // Count from active reservations table
    const { data: activeData, error: activeError } = await supabase
      .from("reservations")
      .select("customer_phone")
      .in("customer_phone", phones)
      .neq("status", "cancelled")

    if (activeError) {
      console.error("[v0] Error fetching active visits:", activeError)
    }

    // Count from reservation_history table
    const { data: historyData, error: historyError } = await supabase
      .from("reservation_history")
      .select("customer_phone")
      .in("customer_phone", phones)
      .neq("status", "cancelled")

    if (historyError) {
      console.error("[v0] Error fetching history visits:", historyError)
    }

    // Merge counts
    for (const row of activeData || []) {
      if (row.customer_phone) {
        result[row.customer_phone] = (result[row.customer_phone] || 0) + 1
      }
    }
    for (const row of historyData || []) {
      if (row.customer_phone) {
        result[row.customer_phone] = (result[row.customer_phone] || 0) + 1
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("[v0] Error in customer visits API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}


