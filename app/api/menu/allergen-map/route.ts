import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Returns a map: { [menu_item_id]: Allergen[] }
export async function GET() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("menu_item_allergens")
      .select(`
        menu_item_id,
        allergens (
          id, name, emoji, sort_order
        )
      `)

    if (error) {
      console.error("[v0] Error fetching allergen map:", error)
      return NextResponse.json({ error: "Failed to fetch allergen map" }, { status: 500 })
    }

    // Build map: menu_item_id -> allergens[]
    const map: Record<string, Array<{ id: string; name: string; emoji: string; sort_order: number }>> = {}
    for (const row of data || []) {
      const itemId = row.menu_item_id
      if (!map[itemId]) map[itemId] = []
      if (row.allergens) {
        map[itemId].push(row.allergens as any)
      }
    }

    // Sort allergens by sort_order within each item
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.sort_order - b.sort_order)
    }

    return NextResponse.json(map)
  } catch (error) {
    console.error("[v0] Error in allergen map API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}


