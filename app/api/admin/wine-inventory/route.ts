import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  bootstrapWineInventory,
  buildGaugeStatus,
  isMenuItemActive,
  isWineGlassCandidate,
  isWineInventoryTableMissingError,
} from "./helpers"

const getCategoryName = (row: any) => {
  const category = row?.menu_categories
  if (!category) return null
  if (Array.isArray(category)) return typeof category[0]?.name === "string" ? category[0].name : null
  return typeof category?.name === "string" ? category.name : null
}

export async function GET() {
  try {
    const supabase = await createClient()

    let { data: settingsRow, error: settingsError } = await supabase
      .from("wine_inventory_settings")
      .select("red_threshold, yellow_threshold, tracking_started_at")
      .eq("id", 1)
      .maybeSingle()

    if (settingsError) throw settingsError

    if (!settingsRow) {
      const { error: bootstrapSettingsError } = await supabase
        .from("wine_inventory_settings")
        .upsert({ id: 1 }, { onConflict: "id" })
      if (bootstrapSettingsError) throw bootstrapSettingsError

      const settingsRefetch = await supabase
        .from("wine_inventory_settings")
        .select("red_threshold, yellow_threshold, tracking_started_at")
        .eq("id", 1)
        .maybeSingle()

      if (settingsRefetch.error) throw settingsRefetch.error
      settingsRow = settingsRefetch.data
    }

    let { data: inventoryRows, error: inventoryError } = await supabase
      .from("wine_inventory_items")
      .select("id, bottle_menu_item_id, current_bottles, is_active, created_at, updated_at")
      .order("created_at", { ascending: true })

    if (inventoryError) throw inventoryError

    if (!inventoryRows || inventoryRows.length === 0) {
      await bootstrapWineInventory(supabase, null)
      const inventoryRefetch = await supabase
        .from("wine_inventory_items")
        .select("id, bottle_menu_item_id, current_bottles, is_active, created_at, updated_at")
        .order("created_at", { ascending: true })

      if (inventoryRefetch.error) throw inventoryRefetch.error
      inventoryRows = inventoryRefetch.data || []
    }

    const bottleMenuIds = Array.from(new Set((inventoryRows || []).map((row: any) => row.bottle_menu_item_id)))

    let bottleItemsById = new Map<string, { name: string; category: string | null; isActiveInMenu: boolean }>()
    if (bottleMenuIds.length > 0) {
      const { data: bottleItems, error: bottleItemsError } = await supabase
        .from("menu_items")
        .select(
          `
          id,
          name,
          status,
          menu_categories!menu_items_category_id_fkey (
            name
          )
        `,
        )
        .in("id", bottleMenuIds)

      if (bottleItemsError) throw bottleItemsError

      bottleItemsById = new Map(
        (bottleItems || []).map((item: any) => [
          item.id,
          {
            name: item.name,
            category: getCategoryName(item),
            isActiveInMenu: isMenuItemActive(item?.status),
          },
        ]),
      )
    }

    const inventoryItemIds = (inventoryRows || []).map((row: any) => row.id)
    let linkRows: any[] = []

    if (inventoryItemIds.length > 0) {
      const { data: links, error: linksError } = await supabase
        .from("wine_inventory_glass_links")
        .select("id, wine_inventory_item_id, glass_menu_item_id, factor, is_active")
        .in("wine_inventory_item_id", inventoryItemIds)
        .eq("is_active", true)

      if (linksError) throw linksError
      linkRows = links || []
    }

    const glassMenuIds = Array.from(new Set(linkRows.map((row: any) => row.glass_menu_item_id)))

    let glassItemsById = new Map<string, { name: string; category: string | null }>()
    if (glassMenuIds.length > 0) {
      const { data: glassItems, error: glassItemsError } = await supabase
        .from("menu_items")
        .select(
          `
          id,
          name,
          menu_categories!menu_items_category_id_fkey (
            name
          )
        `,
        )
        .in("id", glassMenuIds)

      if (glassItemsError) throw glassItemsError

      glassItemsById = new Map(
        (glassItems || []).map((item: any) => [
          item.id,
          {
            name: item.name,
            category: getCategoryName(item),
          },
        ]),
      )
    }

    const { data: drinkRows, error: drinkRowsError } = await supabase
      .from("menu_items")
      .select(
        `
        id,
        name,
        status,
        menu_categories!menu_items_category_id_fkey (
          name
        )
      `,
      )
      .eq("type", "drink")
      .order("name", { ascending: true })

    if (drinkRowsError) throw drinkRowsError

    const availableGlassItems = (drinkRows || [])
      .filter((item: any) => isMenuItemActive(item?.status) && isWineGlassCandidate(getCategoryName(item), item?.name))
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        category: getCategoryName(item),
      }))

    const redThreshold = Number(settingsRow?.red_threshold ?? 3)
    const yellowThreshold = Number(settingsRow?.yellow_threshold ?? 5)

    const linksByInventoryItemId = new Map<string, any[]>()
    for (const linkRow of linkRows) {
      const existing = linksByInventoryItemId.get(linkRow.wine_inventory_item_id) || []
      const glass = glassItemsById.get(linkRow.glass_menu_item_id)
      existing.push({
        id: linkRow.id,
        wineInventoryItemId: linkRow.wine_inventory_item_id,
        glassMenuItemId: linkRow.glass_menu_item_id,
        glassName: glass?.name || "Article introuvable",
        glassCategory: glass?.category || null,
        factor: Number(linkRow.factor ?? 0.2),
        isActive: Boolean(linkRow.is_active),
      })
      linksByInventoryItemId.set(linkRow.wine_inventory_item_id, existing)
    }

    const items = (inventoryRows || []).map((row: any) => {
      const bottle = bottleItemsById.get(row.bottle_menu_item_id)
      const currentBottles = Number(row.current_bottles ?? 0)
      const isActive = Boolean(row.is_active)
      return {
        id: row.id,
        bottleMenuItemId: row.bottle_menu_item_id,
        bottleName: bottle?.name || "Vin introuvable",
        bottleCategory: bottle?.category || null,
        menuItemActive: Boolean(bottle?.isActiveInMenu),
        currentBottles,
        isActive,
        gauge: buildGaugeStatus(currentBottles, redThreshold, yellowThreshold, isActive),
        links: linksByInventoryItemId.get(row.id) || [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    }).filter((item) => item.menuItemActive)

    const criticalCount = items.filter((item) => item.isActive && item.currentBottles < redThreshold).length

    return NextResponse.json({
      settings: {
        redThreshold,
        yellowThreshold,
        trackingStartedAt: settingsRow?.tracking_started_at || null,
      },
      criticalCount,
      items,
      availableGlassItems,
    })
  } catch (error: any) {
    console.error("[v0] Error fetching wine inventory:", error)

    if (isWineInventoryTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Inventaire vin n'est pas encore activé en base. Lancez la migration scripts/019_add_wine_inventory_module.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to fetch wine inventory" }, { status: 500 })
  }
}
