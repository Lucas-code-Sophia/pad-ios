import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { WINE_GLASS_FACTOR, isWineInventoryTableMissingError, parseNonNegativeNumber } from "../../helpers"

const dedupeStringIds = (values: unknown): string[] => {
  if (!Array.isArray(values)) return []
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0)
  return Array.from(new Set(normalized))
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const userId = typeof body?.userId === "string" ? body.userId : null

    const hasStockUpdate = body?.currentBottles !== undefined
    const parsedStock = hasStockUpdate ? parseNonNegativeNumber(body?.currentBottles) : null

    if (hasStockUpdate && parsedStock === null) {
      return NextResponse.json({ error: "Stock invalide" }, { status: 400 })
    }

    if (body?.isActive !== undefined && typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive doit être un booléen" }, { status: 400 })
    }

    const desiredGlassIds =
      body?.glassMenuItemIds === undefined ? undefined : dedupeStringIds(body.glassMenuItemIds)

    if (body?.glassMenuItemIds !== undefined && !Array.isArray(body.glassMenuItemIds)) {
      return NextResponse.json({ error: "glassMenuItemIds doit être un tableau" }, { status: 400 })
    }

    const supabase = await createClient()
    const now = new Date().toISOString()

    const { data: existingItem, error: existingItemError } = await supabase
      .from("wine_inventory_items")
      .select("id")
      .eq("id", id)
      .maybeSingle()

    if (existingItemError) throw existingItemError
    if (!existingItem) {
      return NextResponse.json({ error: "Référence vin introuvable" }, { status: 404 })
    }

    const updateData: Record<string, any> = {
      updated_at: now,
      updated_by: userId,
    }

    if (hasStockUpdate && parsedStock !== null) {
      updateData.current_bottles = Number(parsedStock.toFixed(3))
    }

    if (typeof body?.isActive === "boolean") {
      updateData.is_active = body.isActive
    }

    if (hasStockUpdate || typeof body?.isActive === "boolean") {
      const { error: updateError } = await supabase.from("wine_inventory_items").update(updateData).eq("id", id)
      if (updateError) throw updateError
    }

    if (desiredGlassIds !== undefined) {
      const { data: currentLinks, error: currentLinksError } = await supabase
        .from("wine_inventory_glass_links")
        .select("id, glass_menu_item_id")
        .eq("wine_inventory_item_id", id)

      if (currentLinksError) throw currentLinksError

      const desiredGlassIdSet = new Set(desiredGlassIds)

      const linksToDelete = (currentLinks || []).filter((link: any) => !desiredGlassIdSet.has(link.glass_menu_item_id))
      if (linksToDelete.length > 0) {
        const linkIds = linksToDelete.map((link: any) => link.id)
        const { error: deleteLinksError } = await supabase.from("wine_inventory_glass_links").delete().in("id", linkIds)
        if (deleteLinksError) throw deleteLinksError
      }

      const linksToUpsert = desiredGlassIds.map((glassMenuItemId) => ({
        wine_inventory_item_id: id,
        glass_menu_item_id: glassMenuItemId,
        factor: WINE_GLASS_FACTOR,
        is_active: true,
        updated_at: now,
        updated_by: userId,
        created_by: userId,
      }))

      if (linksToUpsert.length > 0) {
        const { error: upsertLinksError } = await supabase
          .from("wine_inventory_glass_links")
          .upsert(linksToUpsert, { onConflict: "glass_menu_item_id" })

        if (upsertLinksError) throw upsertLinksError
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[v0] Error updating wine inventory item:", error)

    if (isWineInventoryTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Inventaire vin n'est pas encore activé en base. Lancez la migration scripts/019_add_wine_inventory_module.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to update wine inventory item" }, { status: 500 })
  }
}
