import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  try {
    const { itemIds } = await request.json()
    const supabase = await createClient()

    // Update items to fired status
    const { error } = await supabase
      .from("order_items")
      .update({ status: "fired", fired_at: new Date().toISOString() })
      .in("id", itemIds)

    if (error) {
      console.error("[v0] Error firing items:", error)
      return NextResponse.json({ error: "Failed to fire items" }, { status: 500 })
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
