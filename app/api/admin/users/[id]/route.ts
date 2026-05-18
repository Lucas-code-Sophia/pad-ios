import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { name, pin, disabled, can_access_bill, is_tva_analyst } = await request.json()
    const supabase = await createClient()

    // Validation du PIN si fourni (6 chiffres)
    if (pin && (pin.length !== 6 || !/^\d{6}$/.test(pin))) {
      return NextResponse.json({ error: "Le code PIN doit contenir exactement 6 chiffres" }, { status: 400 })
    }

    const updateData: any = {}
    if (name) updateData.name = name
    if (pin) updateData.pin = pin
    if (typeof disabled === "boolean") updateData.disabled = disabled
    if (typeof can_access_bill === "boolean") updateData.can_access_bill = can_access_bill
    if (typeof is_tva_analyst === "boolean") updateData.is_tva_analyst = is_tva_analyst

    const { error } = await supabase.from("users").update(updateData).eq("id", id)

    if (error) {
      console.error("[v0] Error updating user:", error)
      if (error.message?.includes("can_access_bill")) {
        return NextResponse.json(
          { error: "La colonne can_access_bill est manquante. Appliquez la migration SQL d'abord." },
          { status: 400 },
        )
      }
      if (error.message?.includes("is_tva_analyst")) {
        return NextResponse.json(
          { error: "La colonne is_tva_analyst est manquante. Appliquez la migration SQL d'abord." },
          { status: 400 },
        )
      }
      return NextResponse.json({ error: "Failed to update user" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in user update API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { error } = await supabase.from("users").delete().eq("id", id)

    if (error) {
      console.error("[v0] Error deleting user:", error)
      return NextResponse.json({ error: "Failed to delete user" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in user delete API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
