"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import type { Table, Reservation } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { LogOut, User, Settings, Plus, List, Calendar, Search, History } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DEFAULT_FLOOR_PLAN_LAYOUT,
  isFloorPlanLayoutId,
  type FloorPlanLayout,
  type FloorPlanLayoutId,
  type TableLocation,
  type VisualFloorPlan,
  type UserFloorPlanAssignments,
} from "@/lib/floor-plan-layouts"
import { toast } from "@/components/ui/use-toast"
import { sortTablesForDisplay } from "@/lib/table-sort"

type TableVisualStatus = "available" | "occupied" | "occupied_to_follow" | "reserved"
type ReservationServiceFilter = "midi" | "soir"

const toIsoDate = (date: Date) => {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

export default function FloorPlanPage() {
  const { user, logout, isLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddTable, setShowAddTable] = useState(false)
  const [showTableList, setShowTableList] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [showReservationEditor, setShowReservationEditor] = useState(false)
  const [reservationLoading, setReservationLoading] = useState(false)
  const [reservationEdit, setReservationEdit] = useState<Reservation | null>(null)
  const [reservationTableLabel, setReservationTableLabel] = useState<string>("")
  const [reservationTableId, setReservationTableId] = useState<string>("")
  const [reservationsByTable, setReservationsByTable] = useState<Record<string, Reservation[]>>({})
  const [reservationsForDay, setReservationsForDay] = useState<Reservation[]>([])
  const [newTable, setNewTable] = useState({
    table_number: "",
    seats: 2,
    location: "I" as "T" | "I" | "C" | "H",
  })
  const [activeLayout, setActiveLayout] = useState<FloorPlanLayoutId>(DEFAULT_FLOOR_PLAN_LAYOUT)
  const [customLayouts, setCustomLayouts] = useState<FloorPlanLayout[]>([])
  const [visualLayouts, setVisualLayouts] = useState<VisualFloorPlan[]>([])
  const [userAssignments, setUserAssignments] = useState<UserFloorPlanAssignments>({ assignments: {}, default_layout: "" })
  const tablesRequestRef = useRef<Promise<void> | null>(null)
  const reservationsRequestRef = useRef<Promise<void> | null>(null)
  const [reservationServiceFilter, setReservationServiceFilter] = useState<ReservationServiceFilter>("midi")

  const reservationDateParam = String(searchParams.get("reservationDate") || "").trim()
  const reservationPlanMode = searchParams.get("reservationPlan") === "1"
  const activeReservationDate = isIsoDate(reservationDateParam) ? reservationDateParam : toIsoDate(new Date())
  const isReservationDateToday = activeReservationDate === toIsoDate(new Date())
  const activeReservationDateLabel = new Date(`${activeReservationDate}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  const getReservationService = (reservation: Reservation): ReservationServiceFilter => {
    const normalizedTime = String(reservation.reservation_time || "").slice(0, 5)
    return normalizedTime <= "15:59" ? "midi" : "soir"
  }

  const reservationMatchesActiveService = (reservation: Reservation) => {
    if (!reservationPlanMode) return true
    return getReservationService(reservation) === reservationServiceFilter
  }

  const reservationsByTableForDisplay = useMemo(() => {
    if (!reservationPlanMode) return reservationsByTable
    const filtered: Record<string, Reservation[]> = {}
    for (const [tableId, reservationList] of Object.entries(reservationsByTable)) {
      const scopedReservations = reservationList.filter((reservation) => reservationMatchesActiveService(reservation))
      if (scopedReservations.length > 0) {
        filtered[tableId] = scopedReservations
      }
    }
    return filtered
  }, [reservationMatchesActiveService, reservationPlanMode, reservationServiceFilter, reservationsByTable])

  const reservationsForDayForDisplay = useMemo(() => {
    if (!reservationPlanMode) return reservationsForDay
    return reservationsForDay.filter((reservation) => reservationMatchesActiveService(reservation))
  }, [reservationMatchesActiveService, reservationPlanMode, reservationServiceFilter, reservationsForDay])

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [user, isLoading, router])

  const getTodaySummary = (tableId: string) => {
    const arr = reservationsByTableForDisplay[tableId] || []
    if (arr.length === 0) return ""
    return arr.map((r) => `${r.party_size}p - ${r.reservation_time.slice(0, 5).replace(":", "h")}`).join(", ")
  }

  const handleReservationField = (key: keyof Reservation, value: any) => {
    if (!reservationEdit) return
    setReservationEdit({ ...reservationEdit, [key]: value })
  }

  const saveReservation = async () => {
    if (!reservationEdit) return
    try {
      const res = await fetch(`/api/reservations/${reservationEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: reservationEdit.customer_name,
          customer_phone: reservationEdit.customer_phone,
          reservation_date: reservationEdit.reservation_date,
          reservation_time: reservationEdit.reservation_time,
          duration_minutes: reservationEdit.duration_minutes ?? 120,
          party_size: reservationEdit.party_size,
          notes: reservationEdit.notes,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: "Erreur", description: err?.error || "Échec de la sauvegarde", variant: "destructive" as any })
        return
      }
      setShowReservationEditor(false)
    } catch (e) {
      toast({ title: "Erreur", description: "Échec de la sauvegarde", variant: "destructive" as any })
    } finally {
      fetchTables()
    }
  }

  const setReservationStatus = async (status: "seated" | "cancelled" | "completed") => {
    if (!reservationEdit) return
    try {
      const res = await fetch(`/api/reservations/${reservationEdit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: "Erreur", description: err?.error || "Échec de la mise à jour", variant: "destructive" as any })
        return
      }
      setShowReservationEditor(false)
    } catch (e) {
      toast({ title: "Erreur", description: "Échec de la mise à jour", variant: "destructive" as any })
    } finally {
      fetchTables()
      if (status === "seated") {
        const targetTableId = reservationTableId || reservationEdit.table_id
        router.push(`/order/${targetTableId}`)
      }
    }
  }

  useEffect(() => {
    if (user) {
      // Initial load: keep active-layout behavior stable, then load secondary layout metadata in background.
      const fetchInitialData = async () => {
        try {
          await Promise.all([fetchTables(), fetchReservationsForDate(), fetchLayoutSetting(), fetchUserAssignments()])
        } catch (e) {
          console.error("[v0] Error during initial load:", e)
        } finally {
          setLoading(false)
          void Promise.allSettled([fetchLayouts(), fetchVisualLayouts()])
        }
      }
      fetchInitialData()

      // Refresh periodically
      const interval = setInterval(fetchTables, 5000)
      const rInterval = setInterval(fetchReservationsForDate, 15000)
      const layoutInterval = setInterval(fetchLayoutSetting, 30000)
      const layoutsInterval = setInterval(fetchLayouts, 60000)
      const visualInterval = setInterval(fetchVisualLayouts, 60000)
      const assignInterval = setInterval(fetchUserAssignments, 60000)
      
      // Rafraîchir quand la page redevient visible (retour d'une autre page)
      const handleVisibilityChange = () => {
        if (!document.hidden) {
          fetchTables()
          fetchReservationsForDate()
          fetchLayoutSetting()
          fetchLayouts()
          fetchVisualLayouts()
          fetchUserAssignments()
        }
      }
      
      document.addEventListener('visibilitychange', handleVisibilityChange)
      
      return () => {
        clearInterval(interval)
        clearInterval(rInterval)
        clearInterval(layoutInterval)
        clearInterval(layoutsInterval)
        clearInterval(visualInterval)
        clearInterval(assignInterval)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [user, activeReservationDate])

  // Run a one-time cleanup for past-day confirmed reservations to free tables
  useEffect(() => {
    if (!user) return
    const runCleanup = async () => {
      try {
        await fetch("/api/reservations/cleanup", { method: "POST" })
        // After cleanup, refresh tables
        fetchTables()
      } catch (e) {
        // ignore errors silently in UI
      }
    }
    runCleanup()
    // run once on mount when user is present
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const fetchTables = async () => {
    if (tablesRequestRef.current) return tablesRequestRef.current

    tablesRequestRef.current = (async () => {
      try {
        const response = await fetch("/api/tables")
        if (response.ok) {
          const data = await response.json()
          setTables(data)
        }
      } catch (error) {
        console.error("[v0] Error fetching tables:", error)
      } finally {
        tablesRequestRef.current = null
      }
    })()

    return tablesRequestRef.current
  }

  const fetchReservationsForDate = async () => {
    if (reservationsRequestRef.current) return reservationsRequestRef.current

    reservationsRequestRef.current = (async () => {
      try {
        const response = await fetch(`/api/reservations?date=${activeReservationDate}`)
        if (response.ok) {
          const data: Reservation[] = await response.json()
          const map: Record<string, Reservation[]> = {}
          for (const r of data) {
            if (r.status !== "pending" && r.status !== "confirmed") continue
            const linkedTableIds =
              Array.isArray(r.table_ids) && r.table_ids.length > 0
                ? r.table_ids
                : r.table_id
                  ? [r.table_id]
                  : []
            for (const tableId of linkedTableIds) {
              if (!map[tableId]) map[tableId] = []
              map[tableId].push(r)
            }
          }
          for (const k of Object.keys(map)) {
            map[k].sort((a, b) => (a.reservation_time < b.reservation_time ? -1 : 1))
          }
          setReservationsByTable(map)
        }
      } catch (e) {
        // ignore
      } finally {
        reservationsRequestRef.current = null
      }
    })()

    return reservationsRequestRef.current
  }

  const fetchLayoutSetting = async () => {
    try {
      const response = await fetch("/api/settings/floor-plan-layout")
      if (response.ok) {
        const data = await response.json()
        const nextLayout = String(data?.active_layout || DEFAULT_FLOOR_PLAN_LAYOUT)
        setActiveLayout(nextLayout || DEFAULT_FLOOR_PLAN_LAYOUT)
      }
    } catch (e) {
      // ignore
    }
  }

  const fetchLayouts = async () => {
    try {
      const response = await fetch("/api/settings/floor-plan-layouts")
      if (response.ok) {
        const data = await response.json()
        setCustomLayouts(Array.isArray(data?.layouts) ? data.layouts : [])
      }
    } catch (e) {
      // ignore
    }
  }

  const fetchVisualLayouts = async () => {
    try {
      const response = await fetch("/api/settings/floor-plan-visual-layouts")
      if (response.ok) {
        const data = await response.json()
        setVisualLayouts(Array.isArray(data?.layouts) ? data.layouts : [])
      }
    } catch (e) {
      // ignore
    }
  }

  const fetchUserAssignments = async () => {
    try {
      const response = await fetch("/api/settings/user-floor-plan-assignments")
      if (response.ok) {
        const data = await response.json()
        setUserAssignments({
          assignments: data?.assignments || {},
          default_layout: data?.default_layout || "",
        })
      }
    } catch (e) {
      // ignore
    }
  }

  const getTableStatus = (table: Table): TableVisualStatus => {
    if (!isReservationDateToday) {
      return (reservationsByTableForDisplay[table.id] || []).length > 0 ? "reserved" : "available"
    }

    const status =
      table.status === "occupied"
        ? table.has_to_follow
          ? "occupied_to_follow"
          : "occupied"
        : (reservationsByTableForDisplay[table.id] || []).length > 0
          ? "reserved"
          : "available"
    return status
  }

  const handleTableClick = async (table: Table) => {
    const status = getTableStatus(table)
    if (!isReservationDateToday && status === "available") return

    if (status === "available" || status === "occupied" || status === "occupied_to_follow") {
      router.push(`/order/${table.id}`)
    } else if (status === "reserved") {
      // Open inline reservation editor for the reserved table
      setReservationTableLabel(table.table_number)
      setReservationTableId(table.id)
      setShowReservationEditor(true)
      setReservationLoading(true)
      try {
        const res = await fetch(`/api/reservations/by-table?tableId=${table.id}&date=${activeReservationDate}`)
        if (res.ok) {
          const data = await res.json()
          const reservations = Array.isArray(data) ? data : []
          setReservationsForDay(reservations)
          // Preselect the next upcoming confirmed reservation if any
          const scopedReservations = reservationPlanMode
            ? reservations.filter((reservation: Reservation) => reservationMatchesActiveService(reservation))
            : reservations
          const upcoming = scopedReservations
            .filter((r: Reservation) => r.status === "pending" || r.status === "confirmed")
            .sort((a: Reservation, b: Reservation) => (a.reservation_time < b.reservation_time ? -1 : 1))
          setReservationEdit(upcoming[0] ?? scopedReservations[0] ?? reservations[0] ?? null)
        } else {
          setReservationsForDay([])
          setReservationEdit(null)
          const err = await res.json().catch(() => ({}))
          toast({ title: "Erreur", description: err?.error || "Chargement des réservations échoué", variant: "destructive" as any })
        }
      } catch (e) {
        setReservationsForDay([])
        setReservationEdit(null)
        toast({ title: "Erreur", description: "Chargement des réservations échoué", variant: "destructive" as any })
      } finally {
        setReservationLoading(false)
      }
    }
  }

  const handleAccessReservedTable = () => {
    if (!isReservationDateToday) return
    const targetTableId = reservationTableId || reservationEdit?.table_id
    if (!targetTableId) return
    setShowReservationEditor(false)
    router.push(`/order/${targetTableId}`)
  }

  const handleLogout = () => {
    logout()
    router.push("/login")
  }

  const handleAddTable = async () => {
    try {
      const response = await fetch("/api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table_number: `${newTable.location}${newTable.table_number}`,
          seats: newTable.seats,
          location: newTable.location,
          position_x: 100,
          position_y: 100,
          status: "available",
        }),
      })

      if (response.ok) {
        setShowAddTable(false)
        setNewTable({ table_number: "", seats: 2, location: "I" })
        fetchTables()
      }
    } catch (error) {
      console.error("[v0] Error adding table:", error)
    }
  }

  if (isLoading || loading) {
    return (
      <>
      <div className="flex min-h-screen items-center justify-center bg-[#DAF6FC]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#081E3E]/20 border-t-[#081E3E]"></div>
          <div className="text-[#081E3E] text-lg font-medium">Chargement du plan…</div>
        </div>
      </div>

      {/* Inline Reservation Editor */}
      <Dialog open={showReservationEditor} onOpenChange={setShowReservationEditor}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Réservation – Table {reservationTableLabel}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Voir et modifier la réservation confirmée associée à cette table
            </DialogDescription>
          </DialogHeader>
          {/* List of reservations for selected date for this table */}
          {!reservationLoading && (
            <div className="mb-3">
              <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Réservations du {activeReservationDateLabel}</div>
              <div className="max-h-80 overflow-y-auto space-y-1">
              {reservationsForDayForDisplay.length === 0 ? (
                <div className="text-slate-400 text-sm text-center py-2">Aucune réservation pour cette date sur cette table.</div>
              ) : (
                reservationsForDayForDisplay.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setReservationEdit(r)}
                    className={`w-full text-left px-3 py-2 rounded border ${
                      reservationEdit?.id === r.id ? "border-blue-500 bg-slate-700" : "border-slate-600 bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center justify-between text-sm">
                      <div className="font-medium">{r.customer_name || "Sans nom"}</div>
                      <div className="text-slate-300">{r.reservation_time}</div>
                    </div>
                    <div className="text-xs text-slate-400">{r.party_size} pers • {r.status}</div>
                  </button>
                ))
              )}
              </div>
            </div>
          )}
          {reservationLoading ? (
            <div className="py-6 text-center text-slate-300">Chargement…</div>
          ) : !reservationEdit ? (
            <div className="py-6 text-center text-slate-400 text-sm">Aucune réservation confirmée trouvée pour cette table.</div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Nom</Label>
                <Input
                  value={reservationEdit.customer_name}
                  onChange={(e) => handleReservationField("customer_name", e.target.value)}
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div>
                <Label className="text-sm">Téléphone</Label>
                <Input
                  value={reservationEdit.customer_phone || ""}
                  onChange={(e) => handleReservationField("customer_phone", e.target.value)}
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-sm">Date</Label>
                  <Input
                    type="date"
                    value={reservationEdit.reservation_date}
                    onChange={(e) => handleReservationField("reservation_date", e.target.value)}
                    className="bg-slate-700 border-slate-600 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-sm">Heure</Label>
                  <Input
                    type="time"
                    value={reservationEdit.reservation_time}
                    onChange={(e) => handleReservationField("reservation_time", e.target.value)}
                    className="bg-slate-700 border-slate-600 text-sm"
                  />
                </div>
              </div>
              <div>
                <Label className="text-sm">Durée (minutes)</Label>
                <Input
                  type="number"
                  min="15"
                  step="5"
                  value={reservationEdit.duration_minutes ?? 120}
                  onChange={(e) => handleReservationField("duration_minutes" as any, Number.parseInt(e.target.value || "0"))}
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div>
                <Label className="text-sm">Personnes</Label>
                <Input
                  type="number"
                  min="1"
                  value={reservationEdit.party_size}
                  onChange={(e) => handleReservationField("party_size", Number.parseInt(e.target.value))}
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div>
                <Label className="text-sm">Notes</Label>
                <Input
                  value={reservationEdit.notes || ""}
                  onChange={(e) => handleReservationField("notes", e.target.value)}
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={saveReservation} className="flex-1 bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm">
                  Enregistrer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setReservationStatus("seated")}
                  className="flex-1 bg-green-900/30 hover:bg-green-900/50 border-green-700 text-green-400 text-xs sm:text-sm"
                >
                  Installer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setReservationStatus("cancelled")}
                  className="flex-1 bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 text-xs sm:text-sm"
                >
                  No-show
                </Button>
              </div>
              {isReservationDateToday && (
                <Button
                  onClick={handleAccessReservedTable}
                  className="w-full bg-orange-600 hover:bg-orange-700 text-xs sm:text-sm"
                >
                  Accéder à la table malgré la/les réservations
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      </>
    )
  }

  const sortTablesByNumber = (tables: Table[]) => {
    return sortTablesForDisplay(tables)
  }

  const filterTables = (tables: Table[]) => {
    if (!searchQuery) return tables
    return tables.filter((table) => table.table_number.toLowerCase().includes(searchQuery.toLowerCase()))
  }

  const getStatusColor = (status: TableVisualStatus) => {
    switch (status) {
      case "available":
        return "bg-green-600 hover:bg-green-700 border-green-500"
      case "occupied_to_follow":
        return "bg-pink-500 hover:bg-pink-600 border-pink-400"
      case "occupied":
        return "bg-red-600 hover:bg-red-700 border-red-500"
      case "reserved":
        return "bg-yellow-600 hover:bg-yellow-700 border-yellow-500"
      default:
        return "bg-slate-600 hover:bg-slate-700 border-slate-500"
    }
  }

  const getStatusText = (status: TableVisualStatus) => {
    switch (status) {
      case "available":
        return "Libre"
      case "occupied_to_follow":
        return "Occupée (à suivre)"
      case "occupied":
        return "Occupée"
      case "reserved":
        return "Réservée"
      default:
        return status
    }
  }

  const terraceTablesTop = sortTablesByNumber(
    tables.filter((t) => t.location === "T" && Number.parseInt(t.table_number.substring(1)) <= 24),
  )
  const terraceTablesMiddle = sortTablesByNumber(
    tables.filter((t) => t.location === "T" && Number.parseInt(t.table_number.substring(1)) > 24),
  )
  const canapeeTables = sortTablesByNumber(tables.filter((t) => t.location === "C"))
  const interiorTables = sortTablesByNumber(tables.filter((t) => t.location === "I"))
  const tableHoteTables = sortTablesByNumber(tables.filter((t) => t.location === "H"))
  
  // Tables du serveur connecté
  const myTables = sortTablesByNumber(
    tables.filter((t) => t.opened_by === user?.id && t.status === "occupied")
  )

  const tableVisualStatuses = tables.map((table) => ({ table, status: getTableStatus(table) }))
  const freeTablesCount = tableVisualStatuses.filter((entry) => entry.status === "available").length
  const occupiedTablesCount = tableVisualStatuses.filter(
    (entry) => entry.status === "occupied" || entry.status === "occupied_to_follow",
  ).length
  const reservedTablesCount = tableVisualStatuses.filter((entry) => entry.status === "reserved").length
  const servedCoversCount = tables.reduce((sum, table) => sum + (table.status === "occupied" ? table.seats : 0), 0)
  const reservationCountForDate = new Set(
    Object.values(reservationsByTableForDisplay)
      .flat()
      .map((reservation) => reservation.id),
  ).size

  // Fonction pour afficher le nom du serveur qui a ouvert la table
  const getServerName = (table: Table) => {
    if (table.opened_by_name) {
      return table.opened_by_name
    }
    return ""
  }

  // Composant pour afficher une table avec le nom du serveur
  const TableButton = ({ table, aspectRatio = true }: { table: Table; aspectRatio?: boolean }) => (
    <button
      key={table.id}
      onClick={() => handleTableClick(table)}
      className={`${aspectRatio ? 'aspect-square' : 'h-20 sm:h-24'} rounded-lg border-2 transition-all ${getStatusColor(getTableStatus(table))} text-white font-semibold shadow-lg flex items-center justify-center text-sm sm:text-xl relative`}
    >
      <div className="flex flex-col items-center leading-tight text-center">
        <div>{table.table_number}</div>
        {getTodaySummary(table.id) && (
          <div className="text-[10px] sm:text-xs opacity-90 mt-0.5 text-white/90 px-1">{getTodaySummary(table.id)}</div>
        )}
      </div>
      {table.status === "occupied" && getServerName(table) && (
        <div className="absolute top-1 right-1 text-[8px] sm:text-[10px] bg-black/50 px-1 py-0.5 rounded text-white/90">
          {getServerName(table)}
        </div>
      )}
      {table.status === "occupied" && table.current_covers != null && table.current_covers > 0 && (
        <div className="absolute bottom-1 right-1 text-[8px] sm:text-[10px] bg-cyan-600/80 px-1 py-0.5 rounded text-white font-medium">
          👥{table.current_covers}
        </div>
      )}
    </button>
  )

  const GRID_COLS: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
    5: "grid-cols-5",
    6: "grid-cols-6",
    7: "grid-cols-7",
    8: "grid-cols-8",
  }

  const GRID_COLS_SM: Record<number, string> = {
    1: "sm:grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-4",
    5: "sm:grid-cols-5",
    6: "sm:grid-cols-6",
    7: "sm:grid-cols-7",
    8: "sm:grid-cols-8",
  }

  const getGridClass = (mobileCols: number, desktopCols: number) =>
    `grid ${GRID_COLS[mobileCols] || "grid-cols-4"} ${GRID_COLS_SM[desktopCols] || "sm:grid-cols-8"} gap-2 sm:gap-3`

  const renderMyTablesSection = () => {
    if (myTables.length === 0 || user?.role === "manager") return null
    return (
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Mes tables</h2>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3">
          {myTables.map((table) => (
            <TableButton key={table.id} table={table} />
          ))}
        </div>
      </div>
    )
  }

  const renderBaseLayout = () => (
    <>
      {renderMyTablesSection()}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Terrasse</h2>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3">
          {terraceTablesTop.slice(0, 24).map((table) => (
            <TableButton key={table.id} table={table} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Canapé</h2>
          <div className="grid grid-cols-4 sm:grid-cols-4 gap-2 sm:gap-3">
            {canapeeTables.map((table) => (
              <TableButton key={table.id} table={table} />
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3 sm:invisible">Terrasse (suite)</h2>
          <div className="grid grid-cols-4 sm:grid-cols-4 gap-2 sm:gap-3">
            {terraceTablesMiddle.map((table) => (
              <TableButton key={table.id} table={table} />
            ))}
          </div>
        </div>
      </div>
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Intérieur</h2>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3">
          {interiorTables.map((table) => (
            <TableButton key={table.id} table={table} />
          ))}
        </div>
      </div>
      {tableHoteTables.length > 0 && (
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Table d&apos;Hôte</h2>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3">
            {tableHoteTables.map((table) => (
              <TableButton key={table.id} table={table} />
            ))}
          </div>
        </div>
      )}
    </>
  )

  const renderZonesLayout = () => {
    const terraceTablesAll = sortTablesByNumber(tables.filter((t) => t.location === "T"))
    return (
      <>
        {renderMyTablesSection()}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2">
            <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Terrasse</h2>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3">
              {terraceTablesAll.map((table) => (
                <TableButton key={table.id} table={table} />
              ))}
            </div>
          </div>
          <div className="space-y-4 sm:space-y-6">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Intérieur</h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
                {interiorTables.map((table) => (
                  <TableButton key={table.id} table={table} />
                ))}
              </div>
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Canapé</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                {canapeeTables.map((table) => (
                  <TableButton key={table.id} table={table} aspectRatio={false} />
                ))}
              </div>
            </div>
            {tableHoteTables.length > 0 && (
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Table d&apos;Hôte</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  {tableHoteTables.map((table) => (
                    <TableButton key={table.id} table={table} aspectRatio={false} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  const renderCompactLayout = () => (
    <>
      {renderMyTablesSection()}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Terrasse</h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-3">
            {sortTablesByNumber(tables.filter((t) => t.location === "T")).map((table) => (
              <TableButton key={table.id} table={table} />
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Intérieur</h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-3">
            {interiorTables.map((table) => (
              <TableButton key={table.id} table={table} />
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Canapé</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {canapeeTables.map((table) => (
              <TableButton key={table.id} table={table} aspectRatio={false} />
            ))}
          </div>
        </div>
        {tableHoteTables.length > 0 && (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">Table d&apos;Hôte</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {tableHoteTables.map((table) => (
                <TableButton key={table.id} table={table} aspectRatio={false} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )

  const renderCustomLayout = (layout: FloorPlanLayout) => (
    <>
      {renderMyTablesSection()}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {layout.zones.map((zone) => {
          const zoneTables = sortTablesByNumber(
            tables.filter((t) => zone.locations.includes(t.location as TableLocation)),
          )
          if (zoneTables.length === 0) return null
          const isCanapeLike = zone.locations.includes("C") || zone.locations.includes("H")
          const mobileCols = zone.layout?.columns?.mobile ?? (isCanapeLike ? 2 : 4)
          const desktopCols = zone.layout?.columns?.desktop ?? (isCanapeLike ? 4 : 8)
          const gridClass = getGridClass(mobileCols, desktopCols)
          const aspectRatio = zone.layout?.aspect === "rect" ? false : !isCanapeLike
          return (
            <div key={zone.id}>
              <h2 className="text-lg sm:text-xl font-bold text-[#081E3E] mb-2 sm:mb-3">{zone.title}</h2>
              <div className={gridClass}>
                {zoneTables.map((table) => (
                  <TableButton key={table.id} table={table} aspectRatio={aspectRatio} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )

  // ─── Visual layout rendering ───

  const renderVisualLayout = (layout: VisualFloorPlan) => {
    const getStatusColorVisual = (status: TableVisualStatus) => {
      switch (status) {
        case "available": return "#16a34a"
        case "occupied_to_follow": return "#ec4899"
        case "occupied": return "#dc2626"
        case "reserved": return "#ca8a04"
        default: return "#475569"
      }
    }

    return (
      <>
        {renderMyTablesSection()}
        <div
          className="relative w-full rounded-lg overflow-hidden bg-[#c8edf5]"
          style={{
            aspectRatio: "16 / 10",
          }}
        >
          {layout.items.map((item) => {
            if (item.type === "decoration") {
              return (
                <div
                  key={item.id}
                  className="absolute flex items-center justify-center text-white font-bold select-none pointer-events-none"
                  style={{
                    left: `${item.x}%`,
                    top: `${item.y}%`,
                    width: `${item.width}%`,
                    height: `${item.height}%`,
                    backgroundColor: item.color || "#64748b",
                    borderRadius: item.shape === "round" ? "50%" : "4px",
                    fontSize: "clamp(8px, 1.2vw, 14px)",
                    opacity: 0.8,
                    border: "1px solid rgba(255,255,255,0.2)",
                    transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                  }}
                >
                  <span className="truncate px-1">{item.label}</span>
                </div>
              )
            }

            // Table item
            const table = tables.find((t) => t.id === item.tableId)
            if (!table) return null
            const status = getTableStatus(table)
            const bgColor = getStatusColorVisual(status)

            return (
              <button
                key={item.id}
                onClick={() => handleTableClick(table)}
                className="absolute flex flex-col items-center justify-center text-white font-bold select-none cursor-pointer transition-transform hover:scale-105 active:scale-95"
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  width: `${item.width}%`,
                  height: `${item.height}%`,
                  backgroundColor: bgColor,
                  borderRadius: item.shape === "round" ? "50%" : "6px",
                  fontSize: "clamp(9px, 1.2vw, 16px)",
                  border: "2px solid rgba(255,255,255,0.3)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                  transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                }}
              >
                <span className="leading-tight">{table.table_number}</span>
                {getTodaySummary(table.id) && (
                  <span className="text-[8px] sm:text-[10px] opacity-90 leading-tight">{getTodaySummary(table.id)}</span>
                )}
                {table.status === "occupied" && getServerName(table) && (
                  <span className="absolute top-0.5 right-0.5 text-[7px] sm:text-[9px] bg-black/50 px-0.5 rounded text-white/90">
                    {getServerName(table)}
                  </span>
                )}
                {table.status === "occupied" && table.current_covers != null && table.current_covers > 0 && (
                  <span className="absolute bottom-0.5 right-0.5 text-[7px] sm:text-[9px] bg-cyan-600/80 px-0.5 rounded text-white font-medium">
                    👥{table.current_covers}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </>
    )
  }

  // ─── Resolve which layout to use for current user ───

  const resolveUserLayout = (): { type: "visual"; layout: VisualFloorPlan } | { type: "grid" } => {
    if (reservationPlanMode) {
      const forcedLayout =
        visualLayouts.find((layout) => layout.label.trim().toLowerCase() === "restaurant - vue réelle") ||
        visualLayouts.find((layout) => layout.label.trim().toLowerCase().includes("vue réelle"))
      if (forcedLayout) return { type: "visual", layout: forcedLayout }
    }

    if (!user) return { type: "grid" }

    // Check user-specific assignment first
    const userAssignment = userAssignments.assignments[user.id]
    const layoutRef = userAssignment || userAssignments.default_layout

    if (layoutRef && layoutRef.startsWith("visual:")) {
      const visualId = layoutRef.replace("visual:", "")
      const found = visualLayouts.find((l) => l.id === visualId)
      if (found) return { type: "visual", layout: found }
    }

    // Fallback to grid
    return { type: "grid" }
  }

  const renderLayout = () => {
    // Check if user has a visual layout assigned
    const resolved = resolveUserLayout()
    if (resolved.type === "visual") {
      return renderVisualLayout(resolved.layout)
    }

    // Grid-based layout fallback
    if (!isFloorPlanLayoutId(activeLayout)) {
      const customLayout = customLayouts.find((layout) => layout.id === activeLayout)
      if (customLayout) return renderCustomLayout(customLayout)
    }

    switch (activeLayout) {
      case "zones":
        return renderZonesLayout()
      case "compact":
        return renderCompactLayout()
      case "base_list":
      default:
        return renderBaseLayout()
    }
  }

  return (
    <div className="min-h-screen bg-[#DAF6FC] p-2 sm:p-4">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[#081E3E]">
            <User className="h-5 w-5 sm:h-6 sm:w-6" />
            <div>
              <p className="font-semibold text-sm sm:text-base">{user?.name}</p>
              <p className="text-xs sm:text-sm text-slate-600">{user?.role === "manager" ? "Manager" : "Serveur"}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-2 sm:pb-0">
          {user?.role === "manager" && (
            <Button
              onClick={() => router.push("/admin")}
              variant="outline"
              size="sm"
              className="bg-blue-600 text-white border-blue-500 hover:bg-blue-700 whitespace-nowrap text-xs sm:text-sm"
            >
              <Settings className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">Admin</span>
            </Button>
          )}
          <Button
            onClick={() => router.push("/reservations")}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700 whitespace-nowrap text-xs sm:text-sm"
          >
            <Calendar className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
            <span className="hidden sm:inline">Réservations</span>
          </Button>
          {!isReservationDateToday && (
            <Button
              onClick={() => router.push("/floor-plan")}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 whitespace-nowrap text-xs sm:text-sm"
            >
              <Calendar className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">Vue Aujourd&apos;hui</span>
            </Button>
          )}
          {user?.role === "manager" && (
            <Button
              onClick={() => router.push("/history")}
              size="sm"
              className="bg-orange-600 hover:bg-orange-700 whitespace-nowrap text-xs sm:text-sm"
            >
              <History className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">Historique</span>
            </Button>
          )}
          <Dialog
            open={showTableList}
            onOpenChange={(open) => {
              setShowTableList(open)
              if (!open) setSearchQuery("")
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 whitespace-nowrap text-xs sm:text-sm">
                <List className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">Liste</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-2xl max-h-[85vh] sm:max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Liste des tables et commandes</DialogTitle>
                <DialogDescription className="text-slate-400">Vue d'ensemble de toutes les tables</DialogDescription>
              </DialogHeader>
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher une table (ex: T1, I5, C2)..."
                    className="bg-slate-700 border-slate-600 pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                {filterTables(sortTablesByNumber([...tables])).length === 0 ? (
                  <div className="text-center py-8 text-slate-400">Aucune table trouvée pour "{searchQuery}"</div>
                ) : (
                  filterTables(sortTablesByNumber([...tables])).map((table) => (
                    <Card
                      key={table.id}
                      className={`p-4 cursor-pointer ${getStatusColor(getTableStatus(table))} border-2`}
                      onClick={() => {
                        setShowTableList(false)
                        setSearchQuery("")
                        handleTableClick(table)
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold text-lg sm:text-xl">{table.table_number}</div>
                          <div className="text-sm sm:text-base opacity-90">{table.seats} places</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm sm:text-base font-semibold">
                            {(() => {
                              const s = getTableStatus(table)
                              return getStatusText(s)
                            })()}
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={showAddTable} onOpenChange={setShowAddTable}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-green-600 hover:bg-green-700 whitespace-nowrap text-xs sm:text-sm">
                <Plus className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">Ajouter</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Ajouter une nouvelle table</DialogTitle>
                <DialogDescription className="text-slate-400">
                  Créer une nouvelle table dans le plan de salle
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Localisation</Label>
                  <Select
                    value={newTable.location}
                    onValueChange={(value: "T" | "I" | "C" | "H") => setNewTable({ ...newTable, location: value })}
                  >
                    <SelectTrigger className="bg-slate-700 border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-700 border-slate-600">
                      <SelectItem value="T">Terrasse (T)</SelectItem>
                      <SelectItem value="I">Intérieur (I)</SelectItem>
                      <SelectItem value="C">Canapé (C)</SelectItem>
                      <SelectItem value="H">Table d&apos;Hôte (H)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Numéro de table</Label>
                  <Input
                    type="number"
                    value={newTable.table_number}
                    onChange={(e) => setNewTable({ ...newTable, table_number: e.target.value })}
                    className="bg-slate-700 border-slate-600"
                    placeholder="Ex: 1, 2, 3..."
                  />
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    Sera affiché comme: {newTable.location}
                    {newTable.table_number}
                  </p>
                </div>
                <div>
                  <Label>Nombre de places</Label>
                  <Input
                    type="number"
                    value={newTable.seats}
                    onChange={(e) => setNewTable({ ...newTable, seats: Number.parseInt(e.target.value) })}
                    className="bg-slate-700 border-slate-600"
                    min="1"
                    max="20"
                  />
                </div>
                <Button onClick={handleAddTable} className="w-full bg-green-600 hover:bg-green-700">
                  Créer la table
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button
            onClick={handleLogout}
            variant="outline"
            size="sm"
            className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700 whitespace-nowrap text-xs sm:text-sm"
          >
            <LogOut className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
            <span className="hidden sm:inline">Déconnexion</span>
          </Button>
        </div>
      </div>

      {/* Title */}
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-3xl font-bold text-[#081E3E] mb-1 sm:mb-2">Plan de salle</h1>
        <p className="text-xs sm:text-base text-slate-600">
          {isReservationDateToday
            ? "Sélectionnez une table pour prendre une commande"
            : `Vue réservations du ${activeReservationDateLabel}`}
        </p>
        {reservationPlanMode && (
          <div className="mt-2 inline-flex items-center rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
            <button
              onClick={() => setReservationServiceFilter("midi")}
              className={`rounded-md px-3 py-1 text-xs sm:text-sm font-medium transition-colors ${
                reservationServiceFilter === "midi"
                  ? "bg-blue-600 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Midi
            </button>
            <button
              onClick={() => setReservationServiceFilter("soir")}
              className={`rounded-md px-3 py-1 text-xs sm:text-sm font-medium transition-colors ${
                reservationServiceFilter === "soir"
                  ? "bg-blue-600 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              Soir
            </button>
          </div>
        )}
        {!isReservationDateToday && (
          <p className="text-[11px] sm:text-sm text-slate-500 mt-1">
            Mode consultation: horaires et réservations par table pour la date sélectionnée.
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="mb-4 sm:mb-6 flex gap-3 sm:gap-4">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="h-3 w-3 sm:h-4 sm:w-4 rounded bg-green-600"></div>
          <span className="text-xs sm:text-sm text-slate-700">Libre</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="h-3 w-3 sm:h-4 sm:w-4 rounded bg-red-600"></div>
          <span className="text-xs sm:text-sm text-slate-700">Occupée</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="h-3 w-3 sm:h-4 sm:w-4 rounded bg-pink-500"></div>
          <span className="text-xs sm:text-sm text-slate-700">Reste à suivre</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="h-3 w-3 sm:h-4 sm:w-4 rounded bg-yellow-600"></div>
          <span className="text-xs sm:text-sm text-slate-700">Réservée</span>
        </div>
      </div>

      {/* Floor Plan */}
      <div className="space-y-4 sm:space-y-6">{renderLayout()}</div>

      {/* Stats */}
      <div className="mt-4 sm:mt-6 grid grid-cols-3 gap-2 sm:gap-4">
        <Card className="bg-slate-800 border-slate-700 p-3 sm:p-4">
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-green-500">
              {freeTablesCount}
            </div>
            <div className="text-xs sm:text-sm text-slate-400 mt-1">Tables libres</div>
          </div>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-3 sm:p-4">
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-red-500">
              {isReservationDateToday ? occupiedTablesCount : reservedTablesCount}
            </div>
            <div className="text-xs sm:text-sm text-slate-400 mt-1">
              {isReservationDateToday ? "Tables occupées" : "Tables réservées"}
            </div>
          </div>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-3 sm:p-4">
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-blue-500">
              {isReservationDateToday ? servedCoversCount : reservationCountForDate}
            </div>
            <div className="text-xs sm:text-sm text-slate-400 mt-1">
              {isReservationDateToday ? "Couverts servis" : "Réservations"}
            </div>
          </div>
        </Card>
      </div>

      {/* Inline Reservation Editor */}
      <Dialog open={showReservationEditor} onOpenChange={setShowReservationEditor}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Réservation – Table {reservationTableLabel}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Voir et modifier la réservation confirmée associée à cette table
            </DialogDescription>
          </DialogHeader>
          {reservationLoading ? (
            <div className="py-6 text-center text-slate-300">Chargement…</div>
          ) : !reservationEdit ? (
            <div className="py-6 text-center text-slate-400 text-sm">Aucune réservation confirmée trouvée pour cette table.</div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Nom</Label>
                <Input
                  value={reservationEdit?.customer_name || ""}
                  onChange={(e) => handleReservationField("customer_name", e.target.value)}
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div>
                <Label className="text-sm">Téléphone</Label>
                <Input
                  value={reservationEdit?.customer_phone || ""}
                  onChange={(e) => handleReservationField("customer_phone", e.target.value)}
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-sm">Date</Label>
                  <Input
                    type="date"
                    value={reservationEdit?.reservation_date || ""}
                    onChange={(e) => handleReservationField("reservation_date", e.target.value)}
                    className="bg-slate-700 border-slate-600 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-sm">Heure</Label>
                  <Input
                    type="time"
                    value={reservationEdit?.reservation_time || ""}
                    onChange={(e) => handleReservationField("reservation_time", e.target.value)}
                    className="bg-slate-700 border-slate-600 text-sm"
                  />
                </div>
              </div>
              <div>
                <Label className="textsm">Personnes</Label>
                <Input
                  type="number"
                  min="1"
                  value={reservationEdit?.party_size ?? 1}
                  onChange={(e) => handleReservationField("party_size", Number.parseInt(e.target.value))}
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div>
                <Label className="text-sm">Notes</Label>
                <Input
                  value={reservationEdit?.notes || ""}
                  onChange={(e) => handleReservationField("notes", e.target.value)}
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={saveReservation} className="flex-1 bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm">
                  Enregistrer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setReservationStatus("seated")}
                  className="flex-1 bg-green-900/30 hover:bg-green-900/50 border-green-700 text-green-400 text-xs sm:text-sm"
                >
                  Installer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setReservationStatus("cancelled")}
                  className="flex-1 bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 text-xs sm:text-sm"
                >
                  No-show
                </Button>
              </div>
              {isReservationDateToday && (
                <Button
                  onClick={handleAccessReservedTable}
                  className="w-full bg-orange-600 hover:bg-orange-700 text-xs sm:text-sm"
                >
                  Accéder à la table malgré la/les réservations
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}
