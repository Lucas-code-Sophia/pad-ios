import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("allergens")
      .select("*")
      .order("sort_order", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching allergens:", error)
      return NextResponse.json({ error: "Failed to fetch allergens" }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in allergens API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { name, emoji } = await request.json()
    const supabase = await createClient()

    // Get max sort_order
    const { data: maxOrder } = await supabase
      .from("allergens")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .single()

    const nextOrder = (maxOrder?.sort_order || 0) + 1

    const { data, error } = await supabase
      .from("allergens")
      .insert({ name, emoji: emoji || "⚠️", sort_order: nextOrder })
      .select()
      .single()

    if (error) {
      console.error("[v0] Error creating allergen:", error)
      return NextResponse.json({ error: "Failed to create allergen" }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error in allergens create API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}


