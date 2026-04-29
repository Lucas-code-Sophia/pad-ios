import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { bootstrapWineInventory, isWineInventoryTableMissingError } from "../helpers"

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const userId = typeof body?.userId === "string" ? body.userId : null

    const supabase = await createClient()
    const result = await bootstrapWineInventory(supabase, userId)

    return NextResponse.json(result)
  } catch (error: any) {
    console.error("[v0] Error bootstrapping wine inventory:", error)

    if (isWineInventoryTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Inventaire vin n'est pas encore activé en base. Lancez la migration scripts/019_add_wine_inventory_module.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to bootstrap wine inventory" }, { status: 500 })
  }
}
