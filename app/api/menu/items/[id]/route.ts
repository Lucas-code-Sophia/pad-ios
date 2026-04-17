import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { normalizeMenuButtonColor } from "@/lib/menu-colors"

const parseOptionalStockQuantity = (raw: unknown): number | null | undefined => {
  if (raw === undefined) return undefined
  if (raw === null || raw === "") return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error("Invalid stock quantity")
  }

  return Math.max(0, Math.floor(parsed))
}

const isInventoryTableMissingError = (error: any) => {
  const code = String(error?.code || "")
  const message = String(error?.message || "").toLowerCase()
  return code === "42P01" || message.includes("relation") && message.includes("inventory")
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { name, details, price, tax_rate, category, routing, out_of_stock, button_color, status, is_piatto_del_giorno, stock_quantity } = await request.json()
    const supabase = await createClient()
    const { id } = await params // ← CORRECTION Next.js 15
    const parsedStockQuantity = parseOptionalStockQuantity(stock_quantity)

    let categoryId = null
    if (category) {
      // Récupérer l'ID de la catégorie à partir du nom
      const { data: catData } = await supabase
        .from("menu_categories")
        .select("id")
        .eq("name", category)
        .single()
      
      categoryId = catData?.id
    }

    const updateData: any = { name, price, tax_rate, routing }
    if (details !== undefined) {
      updateData.details = typeof details === "string" && details.trim().length > 0 ? details.trim() : null
    }
    if (categoryId) {
      updateData.category_id = categoryId
    }

    if (out_of_stock !== undefined) {
      updateData.out_of_stock = out_of_stock
      updateData.out_of_stock_date = out_of_stock ? new Date().toISOString().split("T")[0] : null
    }

    if (parsedStockQuantity === 0) {
      updateData.out_of_stock = true
      updateData.out_of_stock_date = new Date().toISOString().split("T")[0]
    }

    if (parsedStockQuantity && parsedStockQuantity > 0 && out_of_stock === undefined) {
      updateData.out_of_stock = false
      updateData.out_of_stock_date = null
    }

    if (button_color !== undefined) {
      updateData.button_color = normalizeMenuButtonColor(button_color)
    }

    if (status !== undefined) {
      updateData.status = Boolean(status)
    }

    if (is_piatto_del_giorno !== undefined) {
      updateData.is_piatto_del_giorno = Boolean(is_piatto_del_giorno)
    }

    const { error } = await supabase.from("menu_items").update(updateData).eq("id", id) // ← UTILISE id

    if (error) {
      console.error("[v0] Error updating menu item:", error)
      return NextResponse.json({ error: "Failed to update item" }, { status: 500 })
    }

    let stockTrackingUnavailable = false
    let savedStockQuantity: number | null = parsedStockQuantity ?? null

    if (parsedStockQuantity !== undefined) {
      if (parsedStockQuantity === null) {
        const { error: inventoryDeleteError } = await supabase.from("inventory").delete().eq("menu_item_id", id)
        if (inventoryDeleteError) {
          if (isInventoryTableMissingError(inventoryDeleteError)) {
            stockTrackingUnavailable = true
            savedStockQuantity = null
            console.warn("[v0] Inventory table missing; stock quantity not persisted")
          } else {
            console.error("[v0] Error clearing inventory quantity:", inventoryDeleteError)
            return NextResponse.json({ error: "Failed to clear inventory quantity" }, { status: 500 })
          }
        }
      } else {
        const { error: inventoryError } = await supabase.from("inventory").upsert(
          {
            menu_item_id: id,
            quantity: parsedStockQuantity,
            last_updated: new Date().toISOString(),
          },
          { onConflict: "menu_item_id" },
        )

        if (inventoryError) {
          if (isInventoryTableMissingError(inventoryError)) {
            stockTrackingUnavailable = true
            savedStockQuantity = null
            console.warn("[v0] Inventory table missing; stock quantity not persisted")
          } else {
            console.error("[v0] Error saving inventory quantity:", inventoryError)
            return NextResponse.json({ error: "Failed to save inventory quantity" }, { status: 500 })
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      stock_quantity: savedStockQuantity,
      stock_tracking_unavailable: stockTrackingUnavailable,
    })
  } catch (error) {
    console.error("[v0] Error in menu update API:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    if (message === "Invalid stock quantity") {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { id } = await params // ← CORRECTION Next.js 15
    const { error } = await supabase.from("menu_items").delete().eq("id", id) // ← UTILISE id

    if (error) {
      console.error("[v0] Error deleting menu item:", error)
      return NextResponse.json({ error: "Failed to delete item" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in menu delete API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
