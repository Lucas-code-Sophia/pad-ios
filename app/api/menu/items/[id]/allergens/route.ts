import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// GET allergens for a specific menu item
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { id } = await params

    const { data, error } = await supabase
      .from("menu_item_allergens")
      .select(`
        allergen_id,
        allergens (
          id, name, emoji, sort_order
        )
      `)
      .eq("menu_item_id", id)

    if (error) {
      console.error("[v0] Error fetching item allergens:", error)
      return NextResponse.json({ error: "Failed to fetch item allergens" }, { status: 500 })
    }

    const allergens = data?.map((d: any) => d.allergens).filter(Boolean) || []
    return NextResponse.json(allergens)
  } catch (error) {
    console.error("[v0] Error in item allergens API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// PUT — replace all allergens for a menu item
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { allergen_ids } = await request.json() as { allergen_ids: string[] }
    const supabase = await createClient()
    const { id } = await params

    // Delete existing
    await supabase.from("menu_item_allergens").delete().eq("menu_item_id", id)

    // Insert new
    if (allergen_ids && allergen_ids.length > 0) {
      const rows = allergen_ids.map((allergen_id) => ({
        menu_item_id: id,
        allergen_id,
      }))

      const { error } = await supabase.from("menu_item_allergens").insert(rows)

      if (error) {
        console.error("[v0] Error assigning allergens:", error)
        return NextResponse.json({ error: "Failed to assign allergens" }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in item allergens PUT API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}


