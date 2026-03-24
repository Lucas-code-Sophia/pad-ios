"use client"

import { useEffect, useState } from "react"
import type { KitchenTicket } from "@/lib/types"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Check, Clock, Printer } from "lucide-react"
import { printTicketWithConfiguredMode } from "@/lib/print-client"
import type { EposTicket } from "@/lib/epos"

export default function KitchenPage() {
  const [tickets, setTickets] = useState<KitchenTicket[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTickets()
    // Refresh every 5 seconds
    const interval = setInterval(fetchTickets, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchTickets = async () => {
    try {
      const response = await fetch("/api/kitchen/tickets?type=kitchen")
      if (response.ok) {
        const data = await response.json()
        setTickets(data)
      }
    } catch (error) {
      console.error("[v0] Error fetching tickets:", error)
    } finally {
      setLoading(false)
    }
  }

  const completeTicket = async (ticketId: string) => {
    try {
      await fetch(`/api/kitchen/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      })
      await fetchTickets()
    } catch (error) {
      console.error("[v0] Error completing ticket:", error)
    }
  }

  const printTicket = (ticket: KitchenTicket) => {
    const sendPrint = async () => {
      const directItems = ticket.items.filter((item) => item.phase !== "to_follow_1" && item.phase !== "to_follow_2")
      const follow1Items = ticket.items.filter((item) => item.phase === "to_follow_1")
      const follow2Items = ticket.items.filter((item) => item.phase === "to_follow_2")
      const line = "-------------------------------"
      const directTextScale = 1.5
      const followTextScale = 1

      const lines: EposTicket["lines"] = []

      lines.push({ content: `Table ${ticket.table_number}`, bold: true, fontScale: directTextScale })
      if (ticket.server_name) {
        lines.push({ content: `Serveur: ${ticket.server_name}`, bold: true, fontScale: directTextScale })
      }
      lines.push({ content: `Heure: ${new Date(ticket.created_at).toLocaleTimeString("fr-FR")}` })
      lines.push({ content: line, align: "center" })

      const pushItems = (items: typeof ticket.items, strong: boolean, fontScale: number) => {
        items.forEach((item) => {
          lines.push({ content: `${item.quantity}x ${item.name}`, bold: strong, fontScale })
          if (item.notes) {
            lines.push({ content: `  - ${item.notes}` })
          }
        })
      }

      if (directItems.length > 0) {
        lines.push({ content: "DIRECT", bold: true })
        pushItems(directItems, true, directTextScale)
      }

      if (directItems.length > 0 && (follow1Items.length > 0 || follow2Items.length > 0)) {
        lines.push({ content: line, align: "center" })
      }

      if (follow1Items.length > 0) {
        lines.push({ content: "A SUIVRE 1" })
        pushItems(follow1Items, false, followTextScale)
      }

      if (follow1Items.length > 0 && follow2Items.length > 0) {
        lines.push({ content: line, align: "center" })
      }

      if (follow2Items.length > 0) {
        lines.push({ content: "A SUIVRE 2" })
        pushItems(follow2Items, false, followTextScale)
      }

      const result = await printTicketWithConfiguredMode({
        kind: "kitchen",
        ticket: {
          title: "CUISINE",
          lines,
          cut: true,
          beep: true,
        },
      })

      if (!result.ok) {
        alert(result.message || "Échec de l'impression")
      }
    }

    sendPrint().catch(() => alert("Échec de l'impression"))
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  const pendingTickets = tickets.filter((t) => t.status === "pending")
  const completedTickets = tickets.filter((t) => t.status === "completed")

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-4xl font-bold text-white mb-2">Cuisine</h1>
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <Badge className="bg-red-600 text-white text-sm sm:text-lg px-3 py-1.5 sm:px-4 sm:py-2">
            {pendingTickets.length} en attente
          </Badge>
          <Badge className="bg-green-600 text-white text-sm sm:text-lg px-3 py-1.5 sm:px-4 sm:py-2">
            {completedTickets.length} terminés
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {/* Pending Tickets */}
        {pendingTickets.map((ticket) => (
          <Card key={ticket.id} className="bg-red-900/30 border-red-700 p-4 sm:p-6">
            <div className="flex items-start justify-between mb-3 sm:mb-4">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white">Table {ticket.table_number}</h2>
                <div className="flex items-center gap-2">
                  <p className="text-xs sm:text-sm text-slate-400">
                    {new Date(ticket.created_at).toLocaleTimeString("fr-FR")}
                  </p>
                  {ticket.covers != null && ticket.covers > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-600/20 text-cyan-300 border border-cyan-500/30">
                      👥 {ticket.covers}
                    </span>
                  )}
                </div>
              </div>
              <Badge className="bg-red-600 text-white text-xs sm:text-sm">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                En cours
              </Badge>
            </div>

            <div className="space-y-2 sm:space-y-3 mb-3 sm:mb-4">
              {(() => {
                const directItems = ticket.items.filter((item) => item.phase !== "to_follow_1" && item.phase !== "to_follow_2")
                const follow1Items = ticket.items.filter((item) => item.phase === "to_follow_1")
                const follow2Items = ticket.items.filter((item) => item.phase === "to_follow_2")
                const renderItem = (item: KitchenTicket["items"][number], strong: boolean) => (
                  <div key={`${item.name}-${item.quantity}-${item.notes || ""}`} className="bg-slate-900/50 p-2 sm:p-3 rounded">
                    <div className="flex items-start justify-between">
                      <span className={`${strong ? "font-semibold text-white" : "text-slate-300"} text-sm sm:text-base`}>
                        {item.quantity}x {item.name}
                      </span>
                    </div>
                    {item.notes && <p className="text-xs sm:text-sm text-yellow-400 mt-1 italic">Note: {item.notes}</p>}
                  </div>
                )

                return (
                  <>
                    {directItems.length > 0 && (
                      <>
                        <div className="text-xs font-bold text-white tracking-wide">DIRECT</div>
                        {directItems.map((item) => renderItem(item, true))}
                      </>
                    )}
                    {directItems.length > 0 && (follow1Items.length > 0 || follow2Items.length > 0) && (
                      <div className="my-2">
                        <div className="border-t border-slate-700" />
                        <div className="border-t border-slate-700 mt-1" />
                      </div>
                    )}
                    {follow1Items.length > 0 && (
                      <>
                        <div className="text-[11px] text-slate-300 tracking-wide">À SUIVRE 1</div>
                        {follow1Items.map((item) => renderItem(item, false))}
                      </>
                    )}
                    {follow1Items.length > 0 && follow2Items.length > 0 && (
                      <div className="my-2">
                        <div className="border-t border-slate-700" />
                        <div className="border-t border-slate-700 mt-1" />
                      </div>
                    )}
                    {follow2Items.length > 0 && (
                      <>
                        <div className="text-[11px] text-slate-300 tracking-wide">À SUIVRE 2</div>
                        {follow2Items.map((item) => renderItem(item, false))}
                      </>
                    )}
                  </>
                )
              })()}
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => completeTicket(ticket.id)}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm sm:text-base"
                size="sm"
              >
                <Check className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                Terminé
              </Button>
              <Button
                onClick={() => printTicket(ticket)}
                variant="outline"
                size="sm"
                className="bg-slate-800 border-slate-700 text-white"
              >
                <Printer className="h-3 w-3 sm:h-4 sm:w-4" />
              </Button>
            </div>
          </Card>
        ))}

        {/* Completed Tickets (last 6) */}
        {completedTickets.slice(0, 6).map((ticket) => (
          <Card key={ticket.id} className="bg-slate-800 border-slate-700 p-4 sm:p-6 opacity-60">
            <div className="flex items-start justify-between mb-3 sm:mb-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-white">Table {ticket.table_number}</h2>
                <p className="text-xs sm:text-sm text-slate-400">
                  {new Date(ticket.created_at).toLocaleTimeString("fr-FR")}
                </p>
              </div>
              <Badge className="bg-green-600 text-white text-xs sm:text-sm">
                <Check className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                Terminé
              </Badge>
            </div>

            <div className="space-y-1.5 sm:space-y-2">
              {ticket.items.map((item, index) => (
                <div key={index} className="text-slate-400 text-xs sm:text-sm">
                  {item.quantity}x {item.name}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {pendingTickets.length === 0 && completedTickets.length === 0 && (
        <div className="text-center text-slate-500 mt-12 sm:mt-20">
          <p className="text-lg sm:text-xl">Aucun ticket pour le moment</p>
        </div>
      )}
    </div>
  )
}
