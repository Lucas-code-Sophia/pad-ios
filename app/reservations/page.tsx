"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import type { Reservation, Table } from "@/lib/types"
import type { VisualFloorPlan } from "@/lib/floor-plan-layouts"
import { sortTablesForDisplay } from "@/lib/table-sort"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Calendar, Plus, Phone, Users, Clock, CheckCircle, XCircle, ChevronLeft, ChevronRight, Sun, Moon, Pencil, Trash2, MapPin, X, MessageCircle, Star, Heart } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"

type ServiceFilter = "all" | "midi" | "soir"

interface CalendarCounts {
  [date: string]: { midi: number; soir: number; total: number }
}

const DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
]

export default function ReservationsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddReservation, setShowAddReservation] = useState(false)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0])
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all")

  // Calendar state
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear())
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1) // 1-based
  const [calendarCounts, setCalendarCounts] = useState<CalendarCounts>({})
  const [calendarLoading, setCalendarLoading] = useState(false)

  // Customer visit counts (loyalty)
  const [customerVisits, setCustomerVisits] = useState<Record<string, number>>({})

  // WhatsApp global settings (admin/manager only)
  const [waConfirmEnabled, setWaConfirmEnabled] = useState(false)
  const [waReviewEnabled, setWaReviewEnabled] = useState(false)
  const [waSettingsLoading, setWaSettingsLoading] = useState(true)

  const [newReservation, setNewReservation] = useState({
    table_id: "",
    table_ids: [] as string[],
    customer_name: "",
    customer_phone: "",
    reservation_date: selectedDate,
    reservation_time: "19:00",
    party_size: "2",
    duration_minutes: 90,
    notes: "",
    created_by: "",
  })

  const [addError, setAddError] = useState("")

  // Table picker (visual map) state
  const [showTablePicker, setShowTablePicker] = useState(false)
  const [tablePickerTarget, setTablePickerTarget] = useState<"add" | "edit">("add")
  const [visualLayouts, setVisualLayouts] = useState<VisualFloorPlan[]>([])
  const [pickerReservations, setPickerReservations] = useState<Record<string, Reservation[]>>({})
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerSelectedTableIds, setPickerSelectedTableIds] = useState<string[]>([])

  // Edit reservation state
  const [showEditReservation, setShowEditReservation] = useState(false)
  const [editingReservation, setEditingReservation] = useState<{
    id: string
    table_id: string
    table_ids: string[]
    customer_name: string
    customer_phone: string
    reservation_date: string
    reservation_time: string
    party_size: string
    duration_minutes: number
    notes: string
  } | null>(null)
  const [editError, setEditError] = useState("")

  const sanitizeIntegerInput = (value: string) => value.replace(/\D/g, "")

  const parseIntegerInput = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  const parseTimeToMinutes = (time: string) => {
    const [hours, minutes] = String(time || "")
      .slice(0, 5)
      .split(":")
      .map((x) => Number.parseInt(x, 10))
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
    return hours * 60 + minutes
  }

  const hasTimeOverlap = (startA: number, durationA: number, startB: number, durationB: number) => {
    const endA = startA + durationA
    const endB = startB + durationB
    return !(endA <= startB || startA >= endB)
  }

  const getReservationTableIds = (reservation: Reservation) => {
    if (Array.isArray(reservation.table_ids) && reservation.table_ids.length > 0) {
      return reservation.table_ids
    }
    return reservation.table_id ? [reservation.table_id] : []
  }

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user) {
      fetchReservations()
      fetchTables()
      fetchWhatsAppSettings()
      setNewReservation((prev) => ({ ...prev, created_by: user.id }))
    }
  }, [user, selectedDate])

  useEffect(() => {
    if (user) {
      fetchCalendarCounts()
    }
  }, [user, calendarYear, calendarMonth])

  const fetchReservations = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/reservations?date=${selectedDate}`)
      if (response.ok) {
        const data = await response.json()
        setReservations(data)

        // Fetch customer visit counts
        const phones = data
          .map((r: Reservation) => r.customer_phone)
          .filter(Boolean)
        const uniquePhones = [...new Set(phones)] as string[]
        if (uniquePhones.length > 0) {
          try {
            const visitsRes = await fetch(`/api/reservations/customer-visits?phones=${encodeURIComponent(uniquePhones.join(","))}`)
            if (visitsRes.ok) {
              const visits = await visitsRes.json()
              setCustomerVisits(visits)
            }
          } catch {
            // Silently fail - visit counts are non-critical
          }
        }
      }
    } catch (error) {
      console.error("[v0] Error fetching reservations:", error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTables = async () => {
    try {
      const response = await fetch("/api/tables")
      if (response.ok) {
        const data = await response.json()
        setTables(sortTablesForDisplay(data))
      }
    } catch (error) {
      console.error("[v0] Error fetching tables:", error)
    }
  }

  const fetchCalendarCounts = async () => {
    try {
      setCalendarLoading(true)
      const response = await fetch(`/api/reservations/calendar?year=${calendarYear}&month=${calendarMonth}`)
      if (response.ok) {
        const data = await response.json()
        setCalendarCounts(data.counts || {})
      }
    } catch (error) {
      console.error("[v0] Error fetching calendar:", error)
    } finally {
      setCalendarLoading(false)
    }
  }

  const fetchWhatsAppSettings = async () => {
    try {
      setWaSettingsLoading(true)
      const response = await fetch("/api/settings/whatsapp")
      if (response.ok) {
        const data = await response.json()
        setWaConfirmEnabled(data.confirmation_enabled ?? false)
        setWaReviewEnabled(data.review_enabled ?? false)
      }
    } catch (error) {
      console.error("[v0] Error fetching WhatsApp settings:", error)
    } finally {
      setWaSettingsLoading(false)
    }
  }

  const toggleWhatsAppSetting = async (key: "confirmation_enabled" | "review_enabled", value: boolean) => {
    try {
      // Optimistic update
      if (key === "confirmation_enabled") setWaConfirmEnabled(value)
      else setWaReviewEnabled(value)

      const response = await fetch("/api/settings/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      })

      if (!response.ok) {
        // Rollback on error
        if (key === "confirmation_enabled") setWaConfirmEnabled(!value)
        else setWaReviewEnabled(!value)
        return
      }

      // Notify n8n webhook to enable/disable the workflow
      const webhookName = key === "confirmation_enabled" ? "whatsapp" : "review"
      fetch("https://n8n.srv1367878.hstgr.cloud/webhook/whatsapp-review-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: webhookName, status: value }),
      }).catch((err) => console.warn("[v0] n8n webhook notification failed:", err))

    } catch (error) {
      console.error("[v0] Error toggling WhatsApp setting:", error)
      if (key === "confirmation_enabled") setWaConfirmEnabled(!value)
      else setWaReviewEnabled(!value)
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

  const openTablePicker = async (target: "add" | "edit") => {
    setTablePickerTarget(target)
    const initialSelection =
      target === "add"
        ? [...newReservation.table_ids]
        : editingReservation
          ? [...editingReservation.table_ids]
          : []
    setPickerSelectedTableIds(initialSelection)
    // Close the dialog first so Radix doesn't block clicks
    if (target === "add") setShowAddReservation(false)
    else setShowEditReservation(false)

    setPickerLoading(true)
    setShowTablePicker(true)

    // Fetch visual layouts if not yet loaded
    if (visualLayouts.length === 0) {
      await fetchVisualLayouts()
    }

    // Fetch reservations for the target date
    const date = target === "add" ? newReservation.reservation_date : editingReservation?.reservation_date
    if (date) {
      try {
        const response = await fetch(`/api/reservations?date=${date}`)
        if (response.ok) {
          const data: Reservation[] = await response.json()
          const map: Record<string, Reservation[]> = {}
          for (const r of data) {
            if (r.status === "cancelled" || r.status === "completed") continue
            const reservationTableIds = getReservationTableIds(r)
            for (const tableId of reservationTableIds) {
              if (!map[tableId]) map[tableId] = []
              map[tableId].push(r)
            }
          }
          for (const k of Object.keys(map)) {
            map[k].sort((a, b) => (a.reservation_time < b.reservation_time ? -1 : 1))
          }
          setPickerReservations(map)
        }
      } catch (e) {
        // ignore
      }
    }
    setPickerLoading(false)
  }

  const closeTablePicker = () => {
    setShowTablePicker(false)
    setPickerSelectedTableIds([])
    // Reopen the dialog
    if (tablePickerTarget === "add") setShowAddReservation(true)
    else setShowEditReservation(true)
  }

  const handlePickerTableSelect = (tableId: string) => {
    setPickerSelectedTableIds((prev) => {
      const isSelected = prev.includes(tableId)
      return isSelected ? prev.filter((id) => id !== tableId) : [...prev, tableId]
    })
  }

  const confirmTablePickerSelection = () => {
    const orderedTableIds = [...pickerSelectedTableIds]
    if (tablePickerTarget === "add") {
      setNewReservation((prev) => ({
        ...prev,
        table_ids: orderedTableIds,
        table_id: orderedTableIds[0] || "",
      }))
    } else if (editingReservation) {
      setEditingReservation({
        ...editingReservation,
        table_ids: orderedTableIds,
        table_id: orderedTableIds[0] || "",
      })
    }
    setShowTablePicker(false)
    setPickerSelectedTableIds([])
    if (tablePickerTarget === "add") setShowAddReservation(true)
    else setShowEditReservation(true)
  }

  const getPickerTableReservationContext = (tableId: string) => {
    const reservationsForTable = (pickerReservations[tableId] || [])
      .filter((reservation) => ["pending", "confirmed", "seated"].includes(reservation.status))
      .sort((a, b) => String(a.reservation_time || "").localeCompare(String(b.reservation_time || "")))

    const targetTime = tablePickerTarget === "add" ? newReservation.reservation_time : editingReservation?.reservation_time || ""
    const targetDuration = Number(
      tablePickerTarget === "add" ? newReservation.duration_minutes : editingReservation?.duration_minutes || 90,
    )
    const safeTargetDuration = Number.isFinite(targetDuration) && targetDuration > 0 ? targetDuration : 90
    const targetStart = parseTimeToMinutes(targetTime)
    const targetReservationId = tablePickerTarget === "edit" ? editingReservation?.id : ""

    const overlappingReservations: Reservation[] = []
    const nonOverlappingReservations: Reservation[] = []

    for (const reservation of reservationsForTable) {
      if (targetReservationId && reservation.id === targetReservationId) continue

      const reservationStart = parseTimeToMinutes(reservation.reservation_time)
      const reservationDuration = Number(reservation.duration_minutes || 90)
      const safeReservationDuration =
        Number.isFinite(reservationDuration) && reservationDuration > 0 ? reservationDuration : 90

      const hasOverlap =
        targetStart != null &&
        reservationStart != null &&
        hasTimeOverlap(targetStart, safeTargetDuration, reservationStart, safeReservationDuration)

      if (hasOverlap) overlappingReservations.push(reservation)
      else nonOverlappingReservations.push(reservation)
    }

    const otherSlots = Array.from(
      new Set(
        nonOverlappingReservations
          .map((reservation) => String(reservation.reservation_time || "").slice(0, 5))
          .filter((hour) => Boolean(hour)),
      ),
    ).sort((a, b) => a.localeCompare(b))

    const compactSlots = otherSlots.slice(0, 3)
    const remaining = Math.max(otherSlots.length - compactSlots.length, 0)
    const otherSlotsLabel = otherSlots.length === 0
      ? ""
      : remaining > 0
        ? `Autres résas: ${compactSlots.join(", ")} +${remaining}`
        : `${otherSlots.length > 1 ? "Autres résas" : "Autre résa"}: ${compactSlots.join(", ")}`

    return {
      overlappingReservations,
      nonOverlappingReservations,
      hasOverlap: overlappingReservations.length > 0,
      hasOtherSlots: nonOverlappingReservations.length > 0,
      otherSlotsLabel,
    }
  }

  const getTableNumber = (tableId: string) => {
    const t = tables.find((table) => table.id === tableId)
    return t?.table_number || tableId
  }

  const getTableNumbersLabel = (tableIds: string[]) => {
    if (!tableIds || tableIds.length === 0) return ""
    return tableIds.map((tableId) => getTableNumber(tableId)).join(", ")
  }

  const getTotalSeatsForTables = (tableIds: string[]) => {
    return tableIds.reduce((sum, tableId) => {
      const table = tables.find((t) => t.id === tableId)
      return sum + (table?.seats || 0)
    }, 0)
  }

  const getPickerSelectedTableIds = () => {
    return pickerSelectedTableIds
  }

  const getPickerTargetPartySize = () => {
    const rawValue = tablePickerTarget === "add" ? newReservation.party_size : editingReservation?.party_size || ""
    return parseIntegerInput(rawValue) || 0
  }

  const getReservationTableNumbers = (reservation: Reservation) => {
    if (Array.isArray(reservation.table_numbers) && reservation.table_numbers.length > 0) {
      return reservation.table_numbers
    }
    const tableIds = getReservationTableIds(reservation)
    return tableIds.map((tableId) => getTableNumber(tableId))
  }

  const handleAddReservation = async () => {
    setAddError("")
    const parsedPartySize = parseIntegerInput(newReservation.party_size)
    const selectedTableIds = newReservation.table_ids
    const missing: string[] = []
    if (!newReservation.customer_name.trim()) missing.push("Nom du client")
    if (selectedTableIds.length === 0) missing.push("Table")
    if (!newReservation.reservation_date) missing.push("Date")
    if (!newReservation.reservation_time) missing.push("Heure")
    if (!parsedPartySize || parsedPartySize < 1) missing.push("Nombre de personnes")
    if (missing.length > 0) {
      setAddError(`Champs obligatoires manquants : ${missing.join(", ")}`)
      return
    }
    if (!parsedPartySize || parsedPartySize < 1) return
    try {
      const payload = {
        ...newReservation,
        table_ids: selectedTableIds,
        table_id: selectedTableIds[0] || "",
        party_size: parsedPartySize,
        created_by: user?.id || null,
        whatsapp_confirmation_requested: waConfirmEnabled,
        whatsapp_review_requested: waReviewEnabled,
      }
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errData = await response.json()
        setAddError(errData.error || "Erreur lors de la création")
        return
      }

      setShowAddReservation(false)
      setAddError("")
      setNewReservation({
        table_id: "",
        table_ids: [],
        customer_name: "",
        customer_phone: "",
        reservation_date: selectedDate,
        reservation_time: "19:00",
        party_size: "2",
        duration_minutes: 90,
        notes: "",
        created_by: "",
      })
      fetchReservations()
      fetchTables()
      fetchCalendarCounts()
    } catch (error) {
      console.error("[v0] Error adding reservation:", error)
      setAddError("Erreur réseau")
    }
  }

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      const response = await fetch(`/api/reservations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })

      if (response.ok) {
        fetchReservations()
        fetchTables()
        fetchCalendarCounts()
      }
    } catch (error) {
      console.error("[v0] Error updating reservation:", error)
    }
  }

  const handleDeleteReservation = async (id: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette réservation ?")) return

    try {
      const response = await fetch(`/api/reservations/${id}`, {
        method: "DELETE",
      })

      if (response.ok) {
        fetchReservations()
        fetchTables()
        fetchCalendarCounts()
      }
    } catch (error) {
      console.error("[v0] Error deleting reservation:", error)
    }
  }

  const openEditDialog = (reservation: Reservation) => {
    const tableIds = getReservationTableIds(reservation)
    setEditingReservation({
      id: reservation.id,
      table_id: tableIds[0] || reservation.table_id,
      table_ids: tableIds,
      customer_name: reservation.customer_name,
      customer_phone: reservation.customer_phone || "",
      reservation_date: reservation.reservation_date,
      reservation_time: (reservation.reservation_time || "").slice(0, 5),
      party_size: String(reservation.party_size),
      duration_minutes: reservation.duration_minutes || 90,
      notes: reservation.notes || "",
    })
    setEditError("")
    setShowEditReservation(true)
  }

  const handleEditReservation = async () => {
    if (!editingReservation) return
    setEditError("")
    const parsedPartySize = parseIntegerInput(editingReservation.party_size)
    const selectedTableIds = editingReservation.table_ids
    const missing: string[] = []
    if (!editingReservation.customer_name.trim()) missing.push("Nom du client")
    if (selectedTableIds.length === 0) missing.push("Table")
    if (!editingReservation.reservation_date) missing.push("Date")
    if (!editingReservation.reservation_time) missing.push("Heure")
    if (!parsedPartySize || parsedPartySize < 1) missing.push("Nombre de personnes")
    if (missing.length > 0) {
      setEditError(`Champs obligatoires manquants : ${missing.join(", ")}`)
      return
    }
    if (!parsedPartySize || parsedPartySize < 1) return
    try {
      const { id, ...body } = editingReservation
      const response = await fetch(`/api/reservations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          table_ids: selectedTableIds,
          table_id: selectedTableIds[0] || "",
          party_size: parsedPartySize,
        }),
      })

      if (!response.ok) {
        const errData = await response.json()
        setEditError(errData.error || "Erreur lors de la modification")
        return
      }

      setShowEditReservation(false)
      setEditingReservation(null)
      fetchReservations()
      fetchTables()
      fetchCalendarCounts()
    } catch (error) {
      console.error("[v0] Error editing reservation:", error)
      setEditError("Erreur réseau")
    }
  }

  // Calendar helpers
  const goToPrevMonth = () => {
    if (calendarMonth === 1) {
      setCalendarMonth(12)
      setCalendarYear((y) => y - 1)
    } else {
      setCalendarMonth((m) => m - 1)
    }
  }

  const goToNextMonth = () => {
    if (calendarMonth === 12) {
      setCalendarMonth(1)
      setCalendarYear((y) => y + 1)
    } else {
      setCalendarMonth((m) => m + 1)
    }
  }

  const goToToday = () => {
    const now = new Date()
    setCalendarYear(now.getFullYear())
    setCalendarMonth(now.getMonth() + 1)
    setSelectedDate(now.toISOString().split("T")[0])
  }

  const selectDay = (day: number) => {
    const dateStr = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    setSelectedDate(dateStr)
  }

  // Build calendar grid
  const buildCalendarDays = () => {
    const firstDayOfMonth = new Date(calendarYear, calendarMonth - 1, 1)
    const lastDayOfMonth = new Date(calendarYear, calendarMonth, 0)
    const totalDays = lastDayOfMonth.getDate()

    // Monday = 0 in our grid (JS: getDay() returns 0=Sun, 1=Mon...)
    let startDow = firstDayOfMonth.getDay() - 1 // Convert to Mon=0
    if (startDow < 0) startDow = 6 // Sunday → 6

    const cells: (number | null)[] = []
    // Fill blank leading cells
    for (let i = 0; i < startDow; i++) cells.push(null)
    // Fill day cells
    for (let d = 1; d <= totalDays; d++) cells.push(d)
    // Fill trailing blanks to complete the last row
    while (cells.length % 7 !== 0) cells.push(null)

    return cells
  }

  const getCountForDay = (day: number) => {
    const dateStr = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    return calendarCounts[dateStr] || { midi: 0, soir: 0, total: 0 }
  }

  const isToday = (day: number) => {
    const now = new Date()
    return day === now.getDate() && calendarMonth === now.getMonth() + 1 && calendarYear === now.getFullYear()
  }

  const isSelected = (day: number) => {
    const dateStr = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    return dateStr === selectedDate
  }

  // Filter reservations by service
  const filteredReservations = reservations.filter((r) => {
    if (serviceFilter === "all") return true
    const time = (r.reservation_time || "").slice(0, 5)
    if (serviceFilter === "midi") return time >= "10:00" && time <= "15:59"
    if (serviceFilter === "soir") return time >= "16:00" && time <= "23:59"
    return true
  })

  // WhatsApp link generator
  const generateWhatsAppLink = (reservation: Reservation) => {
    const phone = (reservation.customer_phone || "").replace(/[\s\-.()]/g, "")
    // Format: +33... or 06... → convert 06 to +336
    let formattedPhone = phone
    if (phone.startsWith("0")) {
      formattedPhone = "+33" + phone.slice(1)
    } else if (!phone.startsWith("+")) {
      formattedPhone = "+" + phone
    }

    const dateObj = new Date(reservation.reservation_date + "T00:00:00")
    const dateStr = dateObj.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    const timeStr = (reservation.reservation_time || "").slice(0, 5).replace(":", "h")

    const message = `Bonjour ${reservation.customer_name} 👋\n\n📅 Rappel de votre réservation :\n🕐 ${dateStr} à ${timeStr}\n👥 ${reservation.party_size} personne${reservation.party_size > 1 ? "s" : ""}\n\nPouvez-vous confirmer votre venue ?\n✅ Oui, je confirme\n❌ Non, j'annule`

    return `https://wa.me/${formattedPhone.replace("+", "")}?text=${encodeURIComponent(message)}`
  }

  const generateReviewWhatsAppLink = (reservation: Reservation) => {
    const phone = (reservation.customer_phone || "").replace(/[\s\-.()]/g, "")
    let formattedPhone = phone
    if (phone.startsWith("0")) {
      formattedPhone = "+33" + phone.slice(1)
    } else if (!phone.startsWith("+")) {
      formattedPhone = "+" + phone
    }

    const message = `Bonjour ${reservation.customer_name} 😊\n\nMerci pour votre visite ! Nous espérons que vous avez passé un agréable moment.\n\n⭐ Si vous avez apprécié, un petit avis nous ferait très plaisir !\n\nMerci et à bientôt ! 🙏`

    return `https://wa.me/${formattedPhone.replace("+", "")}?text=${encodeURIComponent(message)}`
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-amber-600"
      case "confirmed": return "bg-blue-600"
      case "seated": return "bg-green-600"
      case "cancelled": return "bg-red-600"
      case "completed": return "bg-slate-600"
      default: return "bg-slate-600"
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case "pending": return "En attente de confirmation"
      case "confirmed": return "Confirmée"
      case "seated": return "Installée"
      case "cancelled": return "Annulée"
      case "completed": return "Terminée"
      default: return status
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  const calendarDays = buildCalendarDays()
  const pickerSelectedIds = getPickerSelectedTableIds()
  const pickerSelectedSeats = getTotalSeatsForTables(pickerSelectedIds)
  const pickerTargetPartySize = getPickerTargetPartySize()
  const pickerCapacityMissing = pickerTargetPartySize > 0 && pickerSelectedSeats < pickerTargetPartySize
  const pickerDateValue =
    (tablePickerTarget === "add" ? newReservation.reservation_date : editingReservation?.reservation_date) || ""

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-4">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <Button
            onClick={() => router.push("/floor-plan")}
            variant="outline"
            size="sm"
            className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
          >
            <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Retour</span>
          </Button>
          <h1 className="text-xl sm:text-3xl font-bold text-white">Réservations</h1>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Service filter */}
          <div className="flex bg-slate-800 rounded-lg border border-slate-700 p-0.5">
            <button
              onClick={() => setServiceFilter("all")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                serviceFilter === "all" ? "bg-slate-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Tous
            </button>
            <button
              onClick={() => setServiceFilter("midi")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                serviceFilter === "midi" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Sun className="h-3 w-3" /> Midi
            </button>
            <button
              onClick={() => setServiceFilter("soir")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                serviceFilter === "soir" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Moon className="h-3 w-3" /> Soir
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push(`/floor-plan?reservationDate=${encodeURIComponent(selectedDate)}`)}
            className="bg-cyan-700/30 border-cyan-600 text-cyan-200 hover:bg-cyan-700/50"
          >
            <MapPin className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Plan du jour</span>
          </Button>

          <Dialog
            open={showAddReservation}
            onOpenChange={(open) => {
              setShowAddReservation(open)
              if (open) {
                setNewReservation((prev) => ({
                  ...prev,
                  reservation_date: selectedDate,
                }))
              } else {
                setAddError("")
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="bg-green-600 hover:bg-green-700">
                <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                <span className="text-xs sm:text-sm">Nouvelle</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-base sm:text-lg">Créer une réservation</DialogTitle>
                <DialogDescription className="text-slate-400 text-sm">Ajouter une nouvelle réservation</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 sm:space-y-4">
                {addError && (
                  <div className="bg-red-900/40 border border-red-700 text-red-300 text-sm px-3 py-2 rounded">
                    {addError}
                  </div>
                )}
                <div>
                  <Label className="text-sm">Nom du client <span className="text-red-400">*</span></Label>
                  <Input
                    value={newReservation.customer_name}
                    onChange={(e) => setNewReservation({ ...newReservation, customer_name: e.target.value })}
                    className="bg-slate-700 border-slate-600 text-sm"
                    placeholder="Jean Dupont"
                  />
                </div>
                <div>
                  <Label className="text-sm">Téléphone</Label>
                  <Input
                    value={newReservation.customer_phone}
                    onChange={(e) => setNewReservation({ ...newReservation, customer_phone: e.target.value })}
                    className="bg-slate-700 border-slate-600 text-sm"
                    placeholder="06 12 34 56 78"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <div>
                    <Label className="text-sm">Date <span className="text-red-400">*</span></Label>
                    <Input
                      type="date"
                      value={newReservation.reservation_date}
                      onChange={(e) => setNewReservation({ ...newReservation, reservation_date: e.target.value })}
                      className="bg-slate-700 border-slate-600 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Heure <span className="text-red-400">*</span></Label>
                    <Input
                      type="time"
                      value={newReservation.reservation_time}
                      onChange={(e) => setNewReservation({ ...newReservation, reservation_time: e.target.value })}
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
                    value={newReservation.duration_minutes}
                    onChange={(e) =>
                      setNewReservation({ ...newReservation, duration_minutes: Number.parseInt(e.target.value || "0") })
                    }
                    className="bg-slate-700 border-slate-600 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <div>
                    <Label className="text-sm">Nombre de personnes <span className="text-red-400">*</span></Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newReservation.party_size}
                      onChange={(e) =>
                        setNewReservation({ ...newReservation, party_size: sanitizeIntegerInput(e.target.value) })
                      }
                      className="bg-slate-700 border-slate-600 text-sm"
                      placeholder="2"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">Table <span className="text-red-400">*</span></Label>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => openTablePicker("add")}
                      className="w-full justify-start bg-slate-700 border-slate-600 text-sm hover:bg-slate-600 h-10"
                    >
                      <MapPin className="h-3.5 w-3.5 mr-2 shrink-0 text-blue-400" />
                      {newReservation.table_ids.length > 0
                        ? <span className="truncate">{getTableNumbersLabel(newReservation.table_ids)}</span>
                        : <span className="text-slate-400">Choisir sur le plan...</span>
                      }
                    </Button>
                    {newReservation.table_ids.length > 0 && (
                      <p className="text-xs text-slate-400 mt-1">
                        {newReservation.table_ids.length} table{newReservation.table_ids.length > 1 ? "s" : ""} ·{" "}
                        {getTotalSeatsForTables(newReservation.table_ids)} places
                      </p>
                    )}
                    {(() => {
                      const people = parseIntegerInput(newReservation.party_size) || 0
                      const seats = getTotalSeatsForTables(newReservation.table_ids)
                      if (people <= 0 || seats >= people) return null
                      return (
                        <p className="text-xs text-amber-400 mt-1">
                          Capacité insuffisante: {seats} place{seats > 1 ? "s" : ""} pour {people} personne{people > 1 ? "s" : ""}.
                        </p>
                      )
                    })()}
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Notes</Label>
                  <Textarea
                    value={newReservation.notes}
                    onChange={(e) => setNewReservation({ ...newReservation, notes: e.target.value })}
                    className="bg-slate-700 border-slate-600 text-sm"
                    placeholder="Allergies, demandes spéciales..."
                    rows={3}
                  />
                </div>
                {/* WhatsApp info */}
                {(waConfirmEnabled || waReviewEnabled) && (
                  <div className="border border-green-700/40 rounded-lg p-2.5 bg-green-900/10">
                    <div className="flex items-center gap-2 text-green-400 text-xs">
                      <MessageCircle className="h-3.5 w-3.5" />
                      <span className="font-medium">WhatsApp actif :</span>
                      {waConfirmEnabled && <span className="bg-green-900/40 px-1.5 py-0.5 rounded text-[10px]">Confirmation J-1</span>}
                      {waReviewEnabled && <span className="bg-purple-900/40 text-purple-400 px-1.5 py-0.5 rounded text-[10px]">Avis J+1</span>}
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-500"><span className="text-red-400">*</span> Champs obligatoires</p>
                <Button onClick={handleAddReservation} className="w-full bg-green-600 hover:bg-green-700 text-sm">
                  Créer la réservation
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* WhatsApp global settings — manager only */}
      {user?.role === "manager" && (
        <div className="mb-4 sm:mb-6 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </div>
          {waSettingsLoading ? (
            <span className="text-slate-500 text-xs">Chargement...</span>
          ) : (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <button
                  type="button"
                  onClick={() => toggleWhatsAppSetting("confirmation_enabled", !waConfirmEnabled)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${waConfirmEnabled ? "bg-green-600" : "bg-slate-600"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${waConfirmEnabled ? "translate-x-4" : ""}`} />
                </button>
                <span className="text-xs text-slate-300">Confirmation J-1</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <button
                  type="button"
                  onClick={() => toggleWhatsAppSetting("review_enabled", !waReviewEnabled)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${waReviewEnabled ? "bg-purple-600" : "bg-slate-600"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${waReviewEnabled ? "translate-x-4" : ""}`} />
                </button>
                <span className="text-xs text-slate-300">Avis J+1</span>
              </label>
            </>
          )}
        </div>
      )}

      {/* Calendar */}
      <Card className="bg-slate-800 border-slate-700 mb-4 sm:mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={goToPrevMonth} className="text-slate-400 hover:text-white hover:bg-slate-700">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-3">
              <h2 className="text-white font-semibold text-base sm:text-lg">
                {MONTHS_FR[calendarMonth - 1]} {calendarYear}
              </h2>
              <Button variant="outline" size="sm" onClick={goToToday} className="text-xs bg-slate-700 border-slate-600 text-slate-300 hover:text-white hover:bg-slate-600">
                Aujourd'hui
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={goToNextMonth} className="text-slate-400 hover:text-white hover:bg-slate-700">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAYS_FR.map((day) => (
              <div key={day} className="text-center text-xs font-medium text-slate-500 py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, idx) => {
              if (day === null) {
                return <div key={`blank-${idx}`} className="h-12 sm:h-16" />
              }

              const counts = getCountForDay(day)
              const today = isToday(day)
              const selected = isSelected(day)
              const hasReservations = counts.total > 0

              // Determine what count to show based on service filter
              const displayCount = serviceFilter === "midi" ? counts.midi
                : serviceFilter === "soir" ? counts.soir
                : counts.total

              return (
                <button
                  key={`day-${day}`}
                  onClick={() => selectDay(day)}
                  className={`h-12 sm:h-16 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all text-sm relative
                    ${selected
                      ? "bg-blue-600 text-white ring-2 ring-blue-400"
                      : today
                        ? "bg-slate-700 text-white ring-1 ring-emerald-500"
                        : "hover:bg-slate-700/60 text-slate-300"
                    }
                  `}
                >
                  <span className={`text-xs sm:text-sm font-medium ${today && !selected ? "text-emerald-400" : ""}`}>
                    {day}
                  </span>
                  {hasReservations && (
                    <div className="flex items-center gap-0.5">
                      {(serviceFilter === "all" || serviceFilter === "midi") && counts.midi > 0 && (
                        <span className={`text-[10px] px-1 rounded-full font-medium ${
                          selected ? "bg-amber-400/30 text-amber-200" : "bg-amber-600/30 text-amber-400"
                        }`}>
                          {counts.midi}
                        </span>
                      )}
                      {(serviceFilter === "all" || serviceFilter === "soir") && counts.soir > 0 && (
                        <span className={`text-[10px] px-1 rounded-full font-medium ${
                          selected ? "bg-indigo-400/30 text-indigo-200" : "bg-indigo-600/30 text-indigo-400"
                        }`}>
                          {counts.soir}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-slate-700">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-3 h-3 rounded-full bg-amber-600/30 border border-amber-500/40" />
              Midi
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-3 h-3 rounded-full bg-indigo-600/30 border border-indigo-500/40" />
              Soir
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-3 h-3 rounded-full bg-emerald-600/50 border border-emerald-500/40" />
              Aujourd'hui
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Date heading for list */}
      {(() => {
        const midiCouverts = reservations
          .filter((r) => r.status !== "cancelled" && (r.reservation_time || "").slice(0, 5) >= "10:00" && (r.reservation_time || "").slice(0, 5) <= "15:59")
          .reduce((sum, r) => sum + (r.party_size || 0), 0)
        const soirCouverts = reservations
          .filter((r) => r.status !== "cancelled" && (r.reservation_time || "").slice(0, 5) >= "16:00")
          .reduce((sum, r) => sum + (r.party_size || 0), 0)
        const totalCouverts = midiCouverts + soirCouverts

        return (
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h2 className="text-white font-semibold text-sm sm:text-base">
              {new Date(selectedDate + "T00:00:00").toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {serviceFilter !== "all" && (
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                  serviceFilter === "midi" ? "bg-amber-600/20 text-amber-400" : "bg-indigo-600/20 text-indigo-400"
                }`}>
                  {serviceFilter === "midi" ? "☀ Midi" : "🌙 Soir"}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-3 text-xs sm:text-sm">
              <span className="text-slate-400">
                {filteredReservations.length} résa{filteredReservations.length !== 1 ? "s" : ""}
              </span>
              <span className="text-slate-600">|</span>
              <div className="flex items-center gap-2">
                <span className="text-amber-400" title="Couverts midi">
                  ☀ {midiCouverts}
                </span>
                <span className="text-indigo-400" title="Couverts soir">
                  🌙 {soirCouverts}
                </span>
                <span className="text-slate-300 font-medium" title="Total couverts">
                  = {totalCouverts} couv.
                </span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Reservation list */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {loading ? (
          <Card className="bg-slate-800 border-slate-700 col-span-full">
            <CardContent className="p-6 text-center">
              <p className="text-slate-400 text-sm">Chargement...</p>
            </CardContent>
          </Card>
        ) : filteredReservations.length === 0 ? (
          <Card className="bg-slate-800 border-slate-700 col-span-full">
            <CardContent className="p-6 sm:p-8 text-center">
              <Calendar className="h-10 w-10 sm:h-12 sm:w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">
                Aucune réservation {serviceFilter === "midi" ? "le midi" : serviceFilter === "soir" ? "le soir" : ""} pour cette date
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredReservations.map((reservation) => (
            <Card key={reservation.id} className={`bg-slate-800 ${reservation.status === "pending" ? "border-amber-500/60 border-2" : "border-slate-700"}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-white text-base sm:text-lg truncate">
                      {reservation.customer_name}
                    </CardTitle>
                    <CardDescription className="text-slate-400 flex items-center gap-1 mt-1 text-xs sm:text-sm">
                      <Phone className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{reservation.customer_phone || "Non renseigné"}</span>
                    </CardDescription>
                    {reservation.customer_phone && (customerVisits[reservation.customer_phone] || 0) > 1 && (
                      <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-pink-900/30 border border-pink-700/40 text-pink-400 text-[10px] sm:text-xs w-fit">
                        <Heart className="h-2.5 w-2.5 fill-pink-400" />
                        Client fidèle · {customerVisits[reservation.customer_phone]} réservations
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(reservation.reservation_time || "").slice(0, 5) <= "15:59" ? (
                      <Sun className="h-3 w-3 text-amber-400" />
                    ) : (
                      <Moon className="h-3 w-3 text-indigo-400" />
                    )}
                    <div
                      className={`px-2 py-1 rounded text-xs text-white whitespace-nowrap ${getStatusColor(reservation.status)}`}
                    >
                      {getStatusText(reservation.status)}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 sm:space-y-3">
                <div className="flex items-center gap-2 text-slate-300 text-sm">
                  <Clock className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                  <span>{reservation.reservation_time}</span>
                  {reservation.duration_minutes && (
                    <span className="text-slate-500 text-xs">({reservation.duration_minutes} min)</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-slate-300 text-sm">
                  <Users className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                  <span>{reservation.party_size} personnes</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300 text-sm">
                  <Calendar className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                  <span>
                    Tables {getReservationTableNumbers(reservation).join(", ") || "N/A"}
                    {reservation.total_seats ? ` (${reservation.total_seats} places)` : ""}
                  </span>
                </div>
                {reservation.notes && (
                  <div className="text-xs sm:text-sm text-slate-400 bg-slate-700 p-2 rounded break-words">
                    {reservation.notes}
                  </div>
                )}
                {/* WhatsApp status */}
                {(reservation.whatsapp_confirmation_requested || reservation.whatsapp_review_requested) && (
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {reservation.whatsapp_confirmation_requested && (
                      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                        reservation.whatsapp_confirmation_sent
                          ? "bg-green-900/40 text-green-400 border border-green-700/50"
                          : "bg-yellow-900/30 text-yellow-400 border border-yellow-700/50"
                      }`}>
                        <MessageCircle className="h-2.5 w-2.5" />
                        Confirmation {reservation.whatsapp_confirmation_sent ? "✓ envoyé" : "⏳ en attente"}
                      </span>
                    )}
                    {reservation.whatsapp_review_requested && (
                      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                        reservation.whatsapp_review_sent
                          ? "bg-green-900/40 text-green-400 border border-green-700/50"
                          : "bg-purple-900/30 text-purple-400 border border-purple-700/50"
                      }`}>
                        <Star className="h-2.5 w-2.5" />
                        Avis {reservation.whatsapp_review_sent ? "✓ envoyé" : "⏳ en attente"}
                      </span>
                    )}
                  </div>
                )}
                {/* WhatsApp action buttons */}
                {reservation.customer_phone && reservation.status !== "cancelled" && (
                  <div className="flex gap-1.5 flex-wrap">
                    <a
                      href={generateWhatsAppLink(reservation)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-green-600/20 hover:bg-green-600/40 text-green-400 border border-green-700/50 transition-colors"
                    >
                      <MessageCircle className="h-3 w-3" />
                      Confirmer via WhatsApp
                    </a>
                    {(reservation.status === "completed") && (
                      <a
                        href={generateReviewWhatsAppLink(reservation)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-700/50 transition-colors"
                      >
                        <Star className="h-3 w-3" />
                        Demander un avis
                      </a>
                    )}
                  </div>
                )}
                {/* Action buttons */}
                <div className="flex gap-2 pt-2 flex-wrap">
                  {/* Edit button — visible for pending/confirmed/seated */}
                  {(reservation.status === "pending" || reservation.status === "confirmed" || reservation.status === "seated") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditDialog(reservation)}
                      className="bg-slate-700 hover:bg-slate-600 border-slate-600 text-slate-300 text-xs sm:text-sm"
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Modifier
                    </Button>
                  )}

                  {/* Confirm button — only for pending */}
                  {reservation.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handleUpdateStatus(reservation.id, "confirmed")}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm"
                      >
                        <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                        Confirmer
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUpdateStatus(reservation.id, "cancelled")}
                        className="bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 text-xs sm:text-sm"
                      >
                        <XCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                        Annuler
                      </Button>
                    </>
                  )}

                  {reservation.status === "confirmed" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handleUpdateStatus(reservation.id, "seated")}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-xs sm:text-sm"
                      >
                        <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                        Installer
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUpdateStatus(reservation.id, "cancelled")}
                        className="bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 text-xs sm:text-sm"
                      >
                        <XCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                        No-show
                      </Button>
                    </>
                  )}
                  {reservation.status === "seated" && (
                    <Button
                      size="sm"
                      onClick={() => handleUpdateStatus(reservation.id, "completed")}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm"
                    >
                      Terminer
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDeleteReservation(reservation.id)}
                    className="bg-red-900/20 hover:bg-red-900/40 border-red-800 text-red-400 text-xs sm:text-sm"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Supprimer
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit Reservation Dialog */}
      <Dialog open={showEditReservation} onOpenChange={setShowEditReservation}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Modifier la réservation</DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Modifier les informations de la réservation
            </DialogDescription>
          </DialogHeader>
          {editingReservation && (
            <div className="space-y-3 sm:space-y-4">
              {editError && (
                <div className="bg-red-900/40 border border-red-700 text-red-300 text-sm px-3 py-2 rounded">
                  {editError}
                </div>
              )}
              <div>
                <Label className="text-sm">Nom du client <span className="text-red-400">*</span></Label>
                <Input
                  value={editingReservation.customer_name}
                  onChange={(e) =>
                    setEditingReservation({ ...editingReservation, customer_name: e.target.value })
                  }
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div>
                <Label className="text-sm">Téléphone</Label>
                <Input
                  value={editingReservation.customer_phone}
                  onChange={(e) =>
                    setEditingReservation({ ...editingReservation, customer_phone: e.target.value })
                  }
                  className="bg-slate-700 border-slate-600 text-sm"
                  placeholder="06 12 34 56 78"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <Label className="text-sm">Date <span className="text-red-400">*</span></Label>
                  <Input
                    type="date"
                    value={editingReservation.reservation_date}
                    onChange={(e) =>
                      setEditingReservation({ ...editingReservation, reservation_date: e.target.value })
                    }
                    className="bg-slate-700 border-slate-600 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-sm">Heure <span className="text-red-400">*</span></Label>
                  <Input
                    type="time"
                    value={editingReservation.reservation_time}
                    onChange={(e) =>
                      setEditingReservation({ ...editingReservation, reservation_time: e.target.value })
                    }
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
                  value={editingReservation.duration_minutes}
                  onChange={(e) =>
                    setEditingReservation({
                      ...editingReservation,
                      duration_minutes: Number.parseInt(e.target.value || "0"),
                    })
                  }
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <Label className="text-sm">Nombre de personnes <span className="text-red-400">*</span></Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={editingReservation.party_size}
                    onChange={(e) =>
                      setEditingReservation({
                        ...editingReservation,
                        party_size: sanitizeIntegerInput(e.target.value),
                      })
                    }
                    className="bg-slate-700 border-slate-600 text-sm"
                    placeholder="2"
                  />
                </div>
                <div>
                  <Label className="text-sm">Table <span className="text-red-400">*</span></Label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openTablePicker("edit")}
                    className="w-full justify-start bg-slate-700 border-slate-600 text-sm hover:bg-slate-600 h-10"
                  >
                    <MapPin className="h-3.5 w-3.5 mr-2 shrink-0 text-blue-400" />
                    {editingReservation.table_ids.length > 0
                      ? <span className="truncate">{getTableNumbersLabel(editingReservation.table_ids)}</span>
                      : <span className="text-slate-400">Choisir sur le plan...</span>
                    }
                  </Button>
                  {editingReservation.table_ids.length > 0 && (
                    <p className="text-xs text-slate-400 mt-1">
                      {editingReservation.table_ids.length} table{editingReservation.table_ids.length > 1 ? "s" : ""} ·{" "}
                      {getTotalSeatsForTables(editingReservation.table_ids)} places
                    </p>
                  )}
                  {(() => {
                    const people = parseIntegerInput(editingReservation.party_size) || 0
                    const seats = getTotalSeatsForTables(editingReservation.table_ids)
                    if (people <= 0 || seats >= people) return null
                    return (
                      <p className="text-xs text-amber-400 mt-1">
                        Capacité insuffisante: {seats} place{seats > 1 ? "s" : ""} pour {people} personne{people > 1 ? "s" : ""}.
                      </p>
                    )
                  })()}
                </div>
              </div>
              <div>
                <Label className="text-sm">Notes</Label>
                <Textarea
                  value={editingReservation.notes}
                  onChange={(e) =>
                    setEditingReservation({ ...editingReservation, notes: e.target.value })
                  }
                  className="bg-slate-700 border-slate-600 text-sm"
                  placeholder="Allergies, demandes spéciales..."
                  rows={3}
                />
              </div>
              <p className="text-xs text-slate-500"><span className="text-red-400">*</span> Champs obligatoires</p>
              <div className="flex gap-2">
                <Button
                  onClick={handleEditReservation}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-sm"
                >
                  Enregistrer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowEditReservation(false)}
                  className="bg-slate-700 hover:bg-slate-600 border-slate-600 text-sm"
                >
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Visual Table Picker (full-screen overlay) ─── */}
      {showTablePicker && (
        <div className="fixed inset-0 z-[9999] bg-slate-900 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <MapPin className="h-5 w-5 text-blue-400" />
              <div className="min-w-0">
                <h2 className="text-white font-semibold text-sm sm:text-base">Choisir une ou plusieurs tables</h2>
                <p className="text-slate-400 text-xs">
                  Réservations du{" "}
                  {pickerDateValue
                    ? new Date(`${pickerDateValue}T00:00:00`).toLocaleDateString("fr-FR", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })
                    : "N/A"}
                  {" · "}
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: "#16a34a" }} /> Dispo</span>
                  {" · "}
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm border border-orange-300" style={{ backgroundColor: "#16a34a" }} />
                    Dispo (autres créneaux)
                  </span>
                  {" · "}
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-500" /> Conflit horaire</span>
                </p>
                <p className="text-slate-300 text-xs mt-0.5">
                  {pickerSelectedIds.length} table{pickerSelectedIds.length > 1 ? "s" : ""} · {pickerSelectedSeats} places
                </p>
                {pickerCapacityMissing && (
                  <p className="text-amber-400 text-xs mt-0.5">
                    Capacité insuffisante: {pickerSelectedSeats} place{pickerSelectedSeats > 1 ? "s" : ""} pour{" "}
                    {pickerTargetPartySize} personne{pickerTargetPartySize > 1 ? "s" : ""}.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={closeTablePicker}
                className="bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200 text-xs sm:text-sm h-9"
              >
                Annuler
              </Button>
              <Button
                onClick={confirmTablePickerSelection}
                className="bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm h-9"
              >
                Valider
              </Button>
              <button
                onClick={closeTablePicker}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Map content — fills all remaining space */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {pickerLoading ? (
              <div className="flex items-center justify-center h-full w-full">
                <div className="text-slate-400 text-sm animate-pulse">Chargement du plan...</div>
              </div>
            ) : visualLayouts.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-4 py-8">
                  <p className="text-slate-400 text-sm">Aucun plan visuel configuré.</p>
                  <p className="text-slate-500 text-xs">Sélection classique :</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-w-lg mx-auto">
                    {tables.map((table) => {
                      const tableContext = getPickerTableReservationContext(table.id)
                      const isSelected = pickerSelectedIds.includes(table.id)
                      const hasConflict = tableContext.hasOverlap
                      const hasOtherSlots = tableContext.hasOtherSlots
                      const isDisabled = hasConflict && !isSelected
                      return (
                        <button
                          key={table.id}
                          onClick={() => handlePickerTableSelect(table.id)}
                          disabled={isDisabled}
                          className={`p-3 rounded-lg border-2 text-white font-medium text-sm transition-all ${
                            isDisabled ? "opacity-60 cursor-not-allowed" : "hover:scale-105 active:scale-95"
                          } ${
                            isSelected
                              ? "bg-blue-600 ring-2 ring-blue-300 border-blue-300"
                              : hasConflict
                                ? "bg-red-600 border-red-300"
                                : hasOtherSlots
                                  ? "bg-green-600 hover:bg-green-500 border-orange-300"
                                  : "bg-green-600 hover:bg-green-500 border-white/30"
                          }`}
                        >
                          <div>{table.table_number}</div>
                          <div className="text-[10px] opacity-80">{table.seats} pl.</div>
                          {hasConflict ? (
                            <div className="text-[9px] mt-1 opacity-90">Conflit horaire</div>
                          ) : hasOtherSlots ? (
                            <div className="text-[9px] mt-1 opacity-90">{tableContext.otherSlotsLabel}</div>
                          ) : null}
                          {isSelected && (
                            <div className="text-[9px] mt-1 font-semibold">Sélectionnée</div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {visualLayouts.map((layout) => (
                  <div
                    key={layout.id}
                    className="absolute inset-0 bg-[#c8edf5]"
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
                        const tableContext = getPickerTableReservationContext(table.id)
                        const isCurrentlySelected = pickerSelectedIds.includes(table.id)
                        const hasConflict = tableContext.hasOverlap
                        const hasOtherSlots = tableContext.hasOtherSlots
                        const isDisabled = hasConflict && !isCurrentlySelected

                        return (
                          <button
                            key={item.id}
                            onClick={() => handlePickerTableSelect(table.id)}
                            disabled={isDisabled}
                            className={`absolute flex flex-col items-center justify-center text-white font-bold select-none transition-all ${
                              isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:scale-110 active:scale-95"
                            } ${
                              isCurrentlySelected ? "z-30" : "z-10"
                            }`}
                            style={{
                              left: `${item.x}%`,
                              top: `${item.y}%`,
                              width: `${item.width}%`,
                              height: `${item.height}%`,
                              backgroundColor: isCurrentlySelected
                                ? "#2563eb"
                                : hasConflict
                                  ? "#dc2626"
                                  : "#16a34a",
                              borderRadius: item.shape === "round" ? "50%" : "6px",
                              fontSize: "clamp(9px, 1.2vw, 16px)",
                              border: isCurrentlySelected
                                ? "3px solid #93c5fd"
                                : hasConflict
                                  ? "2px solid #fca5a5"
                                  : hasOtherSlots
                                    ? "2px solid #fdba74"
                                : "2px solid rgba(255,255,255,0.3)",
                              boxShadow: isCurrentlySelected
                                ? "0 0 12px rgba(37,99,235,0.55)"
                                : hasOtherSlots
                                  ? "0 0 10px rgba(251,146,60,0.3)"
                                : "0 2px 6px rgba(0,0,0,0.2)",
                              transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                            }}
                          >
                            <span className="leading-tight">{table.table_number}</span>
                            <span className="text-[7px] sm:text-[9px] opacity-80">{table.seats} pl.</span>
                            {hasConflict ? (
                              <span className="text-[7px] sm:text-[9px] opacity-90 leading-tight max-w-full truncate px-0.5">
                                Conflit horaire
                              </span>
                            ) : hasOtherSlots ? (
                              <span className="text-[7px] sm:text-[9px] opacity-90 leading-tight max-w-full truncate px-0.5">
                                {tableContext.otherSlotsLabel}
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="border-t border-slate-700 bg-slate-900 px-4 py-3 shrink-0">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
              <div className="text-xs text-slate-300">
                Sélection: {pickerSelectedIds.length} table{pickerSelectedIds.length > 1 ? "s" : ""} · {pickerSelectedSeats} places
                {pickerCapacityMissing && (
                  <span className="text-amber-400"> · capacité inférieure à {pickerTargetPartySize} personnes</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={closeTablePicker}
                  className="bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200"
                >
                  Annuler
                </Button>
                <Button onClick={confirmTablePickerSelection} className="bg-blue-600 hover:bg-blue-700">
                  Valider la sélection
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
