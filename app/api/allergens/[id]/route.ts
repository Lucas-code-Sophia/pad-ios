import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { name, emoji } = await request.json()
    const supabase = await createClient()
    const { id } = await params

    const updateData: Record<string, string> = {}
    if (name !== undefined) updateData.name = name
    if (emoji !== undefined) updateData.emoji = emoji

    const { error } = await supabase.from("allergens").update(updateData).eq("id", id)

    if (error) {
      console.error("[v0] Error updating allergen:", error)
      return NextResponse.json({ error: "Failed to update allergen" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in allergen update API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { id } = await params

    // Delete all menu_item_allergens links first
    await supabase.from("menu_item_allergens").delete().eq("allergen_id", id)

    const { error } = await supabase.from("allergens").delete().eq("id", id)

    if (error) {
      console.error("[v0] Error deleting allergen:", error)
      return NextResponse.json({ error: "Failed to delete allergen" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in allergen delete API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}


