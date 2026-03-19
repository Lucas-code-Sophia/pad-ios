import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  try {
    const { tableId, serverId, items, supplements, orderId, covers } = await request.json()
    const supabase = await createClient()

    let currentOrderId = orderId

    // If no existing order, create one and update table status
    if (!currentOrderId) {
      const orderInsert: any = {
        table_id: tableId,
        server_id: serverId,
        status: "open",
      }
      if (covers != null) orderInsert.covers = covers

      const { data: newOrder, error: orderError } = await supabase
        .from("orders")
        .insert(orderInsert)
        .select()
        .single()

      if (orderError) {
        console.error("[v0] Error creating order:", orderError)
        return NextResponse.json({ error: "Failed to create order" }, { status: 500 })
      }

      currentOrderId = newOrder.id

      // Update table status to occupied and record who opened it
      const { data: server } = await supabase.from("users").select("name").eq("id", serverId).single()
      await supabase.from("tables").update({ 
        status: "occupied",
        opened_by: serverId,
        opened_by_name: server?.name || null
      }).eq("id", tableId)
    }
    else {
      // Ensure table is marked occupied if items are added to an existing order
      const { data: tableData } = await supabase.from("tables").select("status").eq("id", tableId).single()
      if (tableData?.status !== "occupied") {
        const { data: server } = await supabase.from("users").select("name").eq("id", serverId).single()
        await supabase.from("tables").update({
          status: "occupied",
          opened_by: serverId,
          opened_by_name: server?.name || null
        }).eq("id", tableId)
      }
    }

    const normalizeName = (name: string) => name.trim().toLowerCase().replace(/’/g, "'")
    const menuItemIds = Array.from(new Set(items.map((item: any) => item.menuItemId).filter(Boolean)))
    const { data: menuItems } = await supabase
      .from("menu_items")
      .select("id, name")
      .in("id", menuItemIds)
    const menuItemNameMap = new Map((menuItems || []).map((item: any) => [item.id, normalizeName(item.name)]))
    const shouldZeroPrice = (item: any) => {
      const menuName = menuItemNameMap.get(item.menuItemId) || ""
      const notes = String(item.notes || "").toLowerCase()
      return menuName === "sirop à l'eau" && notes.includes("inclus menu enfant")
    }

    // Gérer les articles existants et nouveaux séparément
    const existingItems = items.filter((item: any) => !item.cartItemId.startsWith('temp-'))
    const newItems = items.filter((item: any) => item.cartItemId.startsWith('temp-'))

    // Mettre à jour les articles existants
    const updatePromises = existingItems.map(async (item: any) => {
      const updatePayload: Record<string, any> = {
        menu_item_id: item.menuItemId,
        quantity: item.quantity,
        price: shouldZeroPrice(item) ? 0 : item.price,
        status: item.status,
        notes: item.notes,
        fired_at: item.status === "fired" ? new Date().toISOString() : null,
        is_complimentary: item.isComplimentary || false,
        complimentary_reason: item.complimentaryReason,
      }

      if (item.status !== "fired") {
        updatePayload.printed_fired_at = null
      }

      const { data, error } = await supabase
        .from("order_items")
        .update(updatePayload)
        .eq("order_id", currentOrderId)
        .eq("id", item.cartItemId)

      if (error) {
        console.error("[v0] Error updating item:", error)
        throw error
      }

      return data
    })

    // Insérer les nouveaux articles
    const insertPromises = newItems.map(async (item: any) => {
      const { data, error } = await supabase
        .from("order_items")
        .insert({
          order_id: currentOrderId,
          menu_item_id: item.menuItemId,
          cart_item_id: item.cartItemId,
          quantity: item.quantity,
          price: shouldZeroPrice(item) ? 0 : item.price,
          status: item.status,
          notes: item.notes,
          fired_at: item.status === "fired" ? new Date().toISOString() : null,
          is_complimentary: item.isComplimentary || false,
          complimentary_reason: item.complimentaryReason,
        })
        .select()
        .single()

      if (error) {
        console.error("[v0] Error inserting new item:", error)
        throw error
      }

      return data
    })

    await Promise.all([...updatePromises, ...insertPromises])

    if (supplements && supplements.length > 0) {
      const supplementRecords = supplements.map((sup: any) => ({
        order_id: currentOrderId,
        name: sup.name,
        amount: sup.amount,
        notes: sup.notes,
        is_complimentary: sup.isComplimentary || false,
        complimentary_reason: sup.complimentaryReason,
      }))

      const { error: supplementsError } = await supabase.from("supplements").insert(supplementRecords)

      if (supplementsError) {
        console.error("[v0] Error inserting supplements:", supplementsError)
        return NextResponse.json({ error: "Failed to insert supplements" }, { status: 500 })
      }
    }

    // Create kitchen tickets for fired items (+ plan "à suivre" si non déjà imprimés)
    const firedItems = items.filter((item: any) => item.status === "fired")
    if (firedItems.length > 0) {
      const includeFollowPlan = true

      // Get table number
      const { data: table } = await supabase.from("tables").select("table_number").eq("id", tableId).single()

      const firedExistingIds = firedItems
        .map((item: any) => item.cartItemId)
        .filter((id: any) => typeof id === "string" && !id.startsWith("temp-"))

      const firedExistingPrintData = firedExistingIds.length
        ? (await supabase.from("order_items").select("id, printed_fired_at").in("id", firedExistingIds)).data || []
        : []

      const printableFiredIds = new Set(
        firedExistingPrintData.filter((row: any) => !row.printed_fired_at).map((row: any) => row.id),
      )

      const firedItemsToPrint = firedItems.filter((item: any) => {
        const id = item.cartItemId
        if (typeof id !== "string") return true
        if (id.startsWith("temp-")) return true
        return printableFiredIds.has(id)
      })

      const followItemsToPrint = includeFollowPlan
        ? (await supabase
            .from("order_items")
            .select("id, menu_item_id, quantity, notes, status")
            .eq("order_id", currentOrderId)
            .in("status", ["to_follow_1", "to_follow_2"])
            .is("printed_plan_at", null)).data || []
        : []

      if (firedItemsToPrint.length === 0 && followItemsToPrint.length === 0) {
        return NextResponse.json({ success: true, orderId: currentOrderId })
      }

      const menuItemIds = Array.from(
        new Set([
          ...firedItemsToPrint.map((i: any) => i.menuItemId),
          ...followItemsToPrint.map((i: any) => i.menu_item_id),
        ]),
      )

      // Get menu items details
      const { data: menuItems } = await supabase.from("menu_items").select("*").in("id", menuItemIds)

      // Group by type (kitchen/bar)
      const kitchenItems: any[] = []
      const barItems: any[] = []

      const pushTicketItem = (params: {
        menuItemId: string
        quantity: number
        notes?: string
        phase: "direct" | "to_follow_1" | "to_follow_2"
      }) => {
        const menuItem = menuItems?.find((m) => m.id === params.menuItemId)
        if (menuItem) {
          const ticketItem = {
            name: menuItem.name,
            quantity: params.quantity,
            notes: params.notes,
            phase: params.phase,
          }
          const isBarItem = menuItem.routing === "bar" || menuItem.type === "drink"
          if (isBarItem) {
            barItems.push(ticketItem)
          } else {
            kitchenItems.push(ticketItem)
          }
        }
      }

      firedItemsToPrint.forEach((item: any) => {
        pushTicketItem({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          notes: item.notes,
          phase: "direct",
        })
      })

      followItemsToPrint.forEach((item: any) => {
        const phase = item.status === "to_follow_1" ? "to_follow_1" : "to_follow_2"
        pushTicketItem({
          menuItemId: item.menu_item_id,
          quantity: item.quantity,
          notes: item.notes,
          phase,
        })
      })

      // Create tickets
      const tickets = []
      if (kitchenItems.length > 0) {
        tickets.push({
          order_id: currentOrderId,
          table_number: table?.table_number,
          type: "kitchen",
          items: kitchenItems,
          status: "pending",
        })
      }
      if (barItems.length > 0) {
        tickets.push({
          order_id: currentOrderId,
          table_number: table?.table_number,
          type: "bar",
          items: barItems,
          status: "pending",
        })
      }

      if (tickets.length > 0) {
        const { error: ticketsError } = await supabase.from("kitchen_tickets").insert(tickets)
        if (ticketsError) {
          console.error("[v0] Error inserting kitchen tickets:", ticketsError)
          return NextResponse.json({ error: "Failed to create tickets" }, { status: 500 })
        }

        const now = new Date().toISOString()

        if (followItemsToPrint.length > 0) {
          const followIds = followItemsToPrint.map((i: any) => i.id)
          await supabase.from("order_items").update({ printed_plan_at: now }).in("id", followIds)
        }

        const firedExistingPrintedIds = firedItemsToPrint
          .map((item: any) => item.cartItemId)
          .filter((id: any) => typeof id === "string" && !id.startsWith("temp-"))

        const firedTempPrintedIds = firedItemsToPrint
          .map((item: any) => item.cartItemId)
          .filter((id: any) => typeof id === "string" && id.startsWith("temp-"))

        if (firedExistingPrintedIds.length > 0) {
          await supabase.from("order_items").update({ printed_fired_at: now }).in("id", firedExistingPrintedIds)
        }

        if (firedTempPrintedIds.length > 0) {
          await supabase
            .from("order_items")
            .update({ printed_fired_at: now })
            .eq("order_id", currentOrderId)
            .in("cart_item_id", firedTempPrintedIds)
        }
      }
    }

    return NextResponse.json({ success: true, orderId: currentOrderId })
  } catch (error) {
    console.error("[v0] Error in orders API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
