import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isWineInventoryTableMissingError } from "../helpers"

const parseThreshold = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Number(parsed.toFixed(3))
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const redThreshold = parseThreshold(body?.redThreshold)
    const yellowThreshold = parseThreshold(body?.yellowThreshold)
    const userId = typeof body?.userId === "string" ? body.userId : null

    if (redThreshold === null || yellowThreshold === null) {
      return NextResponse.json({ error: "Seuils invalides" }, { status: 400 })
    }

    if (yellowThreshold < redThreshold) {
      return NextResponse.json(
        { error: "Le seuil jaune doit être supérieur ou égal au seuil rouge" },
        { status: 400 },
      )
    }

    const supabase = await createClient()
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from("wine_inventory_settings")
      .upsert(
        {
          id: 1,
          red_threshold: redThreshold,
          yellow_threshold: yellowThreshold,
          updated_at: now,
          updated_by: userId,
        },
        { onConflict: "id" },
      )
      .select("red_threshold, yellow_threshold, tracking_started_at")
      .single()

    if (error) throw error

    return NextResponse.json({
      settings: {
        redThreshold: Number(data.red_threshold ?? redThreshold),
        yellowThreshold: Number(data.yellow_threshold ?? yellowThreshold),
        trackingStartedAt: data.tracking_started_at || null,
      },
    })
  } catch (error: any) {
    console.error("[v0] Error updating wine inventory settings:", error)

    if (isWineInventoryTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Inventaire vin n'est pas encore activé en base. Lancez la migration scripts/019_add_wine_inventory_module.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to update wine inventory settings" }, { status: 500 })
  }
}
