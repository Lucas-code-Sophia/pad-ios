import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function PATCH(request: Request) {
  try {
    const { itemId, notes } = await request.json()

    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json({ error: "itemId requis" }, { status: 400 })
    }

    if (typeof notes !== "string") {
      return NextResponse.json({ error: "notes invalide" }, { status: 400 })
    }

    const supabase = await createClient()
    const cleanedNotes = notes.trim()

    const { data, error } = await supabase
      .from("order_items")
      .update({ notes: cleanedNotes || null })
      .eq("id", itemId)
      .select("id, notes")
      .single()

    if (error) {
      console.error("[v0] Error updating order item notes:", error)
      return NextResponse.json({ error: "Impossible de mettre à jour la note" }, { status: 500 })
    }

    return NextResponse.json({ success: true, item: data })
  } catch (error) {
    console.error("[v0] Error in order item notes PATCH API:", error)
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}
