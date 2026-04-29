import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isWineInventoryTableMissingError, parseNonNegativeNumber } from "../helpers"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const userId = typeof body?.userId === "string" ? body.userId : null
    const items = Array.isArray(body?.items) ? body.items : null

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "Aucune ligne de recomptage fournie" }, { status: 400 })
    }

    const payload = items.map((item: any, index: number) => {
      const wineInventoryItemId = typeof item?.wineInventoryItemId === "string" ? item.wineInventoryItemId : ""
      const currentBottles = parseNonNegativeNumber(item?.currentBottles)

      if (!wineInventoryItemId || currentBottles === null) {
        throw new Error(`Ligne de recomptage invalide à l'index ${index}`)
      }

      return {
        wineInventoryItemId,
        currentBottles: Number(currentBottles.toFixed(3)),
      }
    })

    const supabase = await createClient()

    const { data, error } = await supabase.rpc("apply_wine_inventory_recount", {
      _items: payload,
      _updated_by: userId,
    })

    if (error) throw error

    const firstRow = Array.isArray(data) ? data[0] : null

    return NextResponse.json({
      updatedCount: Number(firstRow?.updated_count || payload.length),
      trackingStartedAt: firstRow?.tracking_started_at || null,
    })
  } catch (error: any) {
    console.error("[v0] Error applying wine inventory recount:", error)

    if (String(error?.message || "").toLowerCase().includes("ligne de recomptage invalide")) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (isWineInventoryTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Inventaire vin n'est pas encore activé en base. Lancez la migration scripts/019_add_wine_inventory_module.sql.",
        },
        { status: 400 },
      )
    }

    const functionMissing =
      String(error?.code || "") === "42883" ||
      String(error?.message || "").toLowerCase().includes("apply_wine_inventory_recount")

    if (functionMissing) {
      return NextResponse.json(
        {
          error:
            "La fonction SQL de recomptage est absente. Lancez la migration scripts/019_add_wine_inventory_module.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to apply wine inventory recount" }, { status: 500 })
  }
}
