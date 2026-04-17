import { NextResponse } from "next/server"
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

export async function GET() {
  try {
    const supabase = await createClient()

    // Vérifier et remettre en stock les articles expirés
    await supabase.rpc('auto_restock_items')

    const { data, error } = await supabase
      .from("menu_items")
      .select(`
        *,
        menu_categories!menu_items_category_id_fkey (
          name
        )
      `)
      .order("name", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching menu items:", error)
      return NextResponse.json({ error: "Failed to fetch menu items" }, { status: 500 })
    }

    const menuItemIds = (data || []).map((item: any) => item.id)
    let inventoryMap = new Map<string, { quantity: number; last_updated: string | null }>()

    if (menuItemIds.length > 0) {
      const { data: inventoryData, error: inventoryError } = await supabase
        .from("inventory")
        .select("menu_item_id, quantity, last_updated")
        .in("menu_item_id", menuItemIds)

      if (inventoryError) {
        console.warn("[v0] inventory table unavailable or unreadable:", inventoryError.message)
      } else {
        inventoryMap = new Map(
          (inventoryData || []).map((row: any) => [
            row.menu_item_id,
            {
              quantity: Number(row.quantity) || 0,
              last_updated: row.last_updated || null,
            },
          ]),
        )
      }
    }

    // Transformer les données pour aplatir la structure
    const transformedData = data.map(item => ({
      ...item,
      category: item.menu_categories?.name || null,
      stock_quantity: inventoryMap.get(item.id)?.quantity ?? null,
      stock_last_updated: inventoryMap.get(item.id)?.last_updated ?? null,
    }))

    return NextResponse.json(transformedData, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    })
  } catch (error) {
    console.error("[v0] Error in menu items API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { name, details, price, tax_rate, category, routing, out_of_stock, button_color, status, is_piatto_del_giorno, stock_quantity } = await request.json()
    const supabase = await createClient()
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

    const normalizedDetails =
      typeof details === "string" && details.trim().length > 0 ? details.trim() : null

    const newItem: any = { 
      name, 
      details: normalizedDetails,
      price: Number.parseFloat(price), 
      tax_rate: Number.parseFloat(tax_rate), 
      routing,
      type: routing === "bar" ? "drink" : "food",
      status: status === undefined ? true : Boolean(status),
    }

    if (button_color !== undefined) {
      newItem.button_color = normalizeMenuButtonColor(button_color)
    }
    
    if (categoryId) {
      newItem.category_id = categoryId
    }

    if (out_of_stock !== undefined) {
      newItem.out_of_stock = out_of_stock
      newItem.out_of_stock_date = out_of_stock ? new Date().toISOString().split("T")[0] : null
    }

    if (parsedStockQuantity === 0) {
      newItem.out_of_stock = true
      newItem.out_of_stock_date = new Date().toISOString().split("T")[0]
    }

    if (is_piatto_del_giorno !== undefined) {
      newItem.is_piatto_del_giorno = Boolean(is_piatto_del_giorno)
    }

    const { data, error } = await supabase.from("menu_items").insert(newItem).select().single()

    if (error) {
      console.error("[v0] Error creating menu item:", error)
      return NextResponse.json({ error: "Failed to create item" }, { status: 500 })
    }

    if (parsedStockQuantity !== undefined) {
      if (parsedStockQuantity === null) {
        await supabase.from("inventory").delete().eq("menu_item_id", data.id)
      } else {
        const { error: inventoryError } = await supabase.from("inventory").upsert(
          {
            menu_item_id: data.id,
            quantity: parsedStockQuantity,
            last_updated: new Date().toISOString(),
          },
          { onConflict: "menu_item_id" },
        )

        if (inventoryError) {
          console.error("[v0] Error saving inventory quantity:", inventoryError)
          return NextResponse.json({ error: "Failed to save inventory quantity" }, { status: 500 })
        }
      }
    }

    return NextResponse.json({
      ...data,
      stock_quantity: parsedStockQuantity ?? null,
    })
  } catch (error) {
    console.error("[v0] Error in menu create API:", error)
    const message = error instanceof Error ? error.message : "Internal server error"
    if (message === "Invalid stock quantity") {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
