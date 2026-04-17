import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  try {
    const { itemIds } = await request.json()
    const supabase = await createClient()

    const { data: existingRows, error: existingRowsError } = await supabase
      .from("order_items")
      .select("id, status, menu_item_id, quantity")
      .in("id", itemIds)

    if (existingRowsError) {
      console.error("[v0] Error reading items before firing:", existingRowsError)
      return NextResponse.json({ error: "Failed to load items" }, { status: 500 })
    }

    const rowsToDeduct = (existingRows || []).filter((row: any) => row.status !== "fired")

    // Update items to fired status
    const { error } = await supabase
      .from("order_items")
      .update({ status: "fired", fired_at: new Date().toISOString() })
      .in("id", itemIds)

    if (error) {
      console.error("[v0] Error firing items:", error)
      return NextResponse.json({ error: "Failed to fire items" }, { status: 500 })
    }

    if (rowsToDeduct.length > 0) {
      const stockDeductions = new Map<string, number>()
      rowsToDeduct.forEach((row: any) => {
        const menuItemId = row.menu_item_id
        const quantity = Math.max(0, Number(row.quantity) || 0)
        if (!menuItemId || quantity <= 0) return
        stockDeductions.set(menuItemId, (stockDeductions.get(menuItemId) || 0) + quantity)
      })

      if (stockDeductions.size > 0) {
        const nowIso = new Date().toISOString()
        const today = nowIso.split("T")[0]
        const menuItemIds = Array.from(stockDeductions.keys())

        const { data: inventoryRows, error: inventoryError } = await supabase
          .from("inventory")
          .select("menu_item_id, quantity")
          .in("menu_item_id", menuItemIds)

        if (!inventoryError && inventoryRows) {
          for (const row of inventoryRows) {
            const deduction = stockDeductions.get(row.menu_item_id) || 0
            if (deduction <= 0) continue

            const currentQuantity = Math.max(0, Number(row.quantity) || 0)
            const nextQuantity = Math.max(0, currentQuantity - deduction)

            await supabase
              .from("inventory")
              .update({ quantity: nextQuantity, last_updated: nowIso })
              .eq("menu_item_id", row.menu_item_id)

            if (nextQuantity === 0) {
              await supabase
                .from("menu_items")
                .update({ out_of_stock: true, out_of_stock_date: today })
                .eq("id", row.menu_item_id)
            }
          }
        } else if (inventoryError) {
          console.warn("[v0] Skipping stock auto-decrement in /api/orders/fire:", inventoryError.message)
        }
      }
    }

    // Get the items details to create tickets
    const { data: items } = await supabase.from("order_items").select("*, orders(table_id)").in("id", itemIds)

    if (items && items.length > 0) {
      const orderId = items[0].order_id
      const tableId = (items[0].orders as any).table_id

      // Get table number
      const { data: table } = await supabase.from("tables").select("table_number").eq("id", tableId).single()

      // Get menu items details
      const { data: menuItems } = await supabase
        .from("menu_items")
        .select("*")
        .in(
          "id",
          items.map((i) => i.menu_item_id),
        )

      // Group by type
      const kitchenItems: any[] = []
      const barItems: any[] = []

      items.forEach((item) => {
        const menuItem = menuItems?.find((m) => m.id === item.menu_item_id)
        if (menuItem) {
          const ticketItem = {
            name: menuItem.name,
            quantity: item.quantity,
            notes: item.notes,
          }
          const isBarItem = menuItem.routing === "bar" || menuItem.type === "drink"
          if (isBarItem) {
            barItems.push(ticketItem)
          } else {
            kitchenItems.push(ticketItem)
          }
        }
      })

      // Create tickets
      const tickets = []
      if (kitchenItems.length > 0) {
        tickets.push({
          order_id: orderId,
          table_number: table?.table_number,
          type: "kitchen",
          items: kitchenItems,
          status: "pending",
        })
      }
      if (barItems.length > 0) {
        tickets.push({
          order_id: orderId,
          table_number: table?.table_number,
          type: "bar",
          items: barItems,
          status: "pending",
        })
      }

      if (tickets.length > 0) {
        await supabase.from("kitchen_tickets").insert(tickets)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error in fire API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
