"use client"

import { useEffect, useState, useRef, type TouchEvent } from "react"
import { useRouter, useParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import type { Table, MenuCategory, MenuItem, Order, OrderItem } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, Plus, Minus, Send, Clock, DollarSign, Gift, AlertCircle, ShieldAlert, CheckCircle2, AlertTriangle, XCircle, Info, Search, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useOfflineManager } from "@/lib/offline-manager"
import { OfflineIndicator } from "@/components/offline-indicator"
import { getMenuButtonColorClasses } from "@/lib/menu-colors"
import { getConfiguredPrintSettings, getPrintModeForKind, printTicketWithConfiguredMode, type PrintMode } from "@/lib/print-client"
import { isNativeCapacitorRuntime } from "@/lib/capacitor-printer"
import type { EposTicket } from "@/lib/epos"
import { getItemDisplayInfo } from "@/lib/item-display"

// Fonction pour générer un ID unique
const generateUniqueId = (productName: string) => {
  const name = productName.toLowerCase().replace(/\s+/g, '-')
  const time = new Date().toTimeString().slice(0, 5).replace(':', '')
  const random = Math.random().toString(36).substr(2, 4)
  return `${name}-${time}-${random}`
}

interface CartItem {
  id: string // ID du panier (React)
  cartItemId: string // ID unique pour la BDD
  menuItemId: string
  menuItem: MenuItem | null // Peut être null si non trouvé
  quantity: number
  status: "pending" | "to_follow_1" | "to_follow_2" | "fired" | "completed"
  price?: number
  notes?: string
  isComplimentary?: boolean
  complimentaryReason?: string
}

interface SupplementItem {
  id: string
  name: string
  amount: number
  notes?: string
  isComplimentary?: boolean
  complimentaryReason?: string
}

interface CustomMenuItemFormState {
  name: string
  price: string
}

type CustomMenuItemKind = "dish" | "drink" | "alcohol"

const CUSTOM_MENU_ITEM_PRESETS: Record<
  CustomMenuItemKind,
  {
    label: string
    defaultName: string
    taxRate: 10 | 20
    routing: "kitchen" | "bar"
    categoryKeywords: string[]
  }
> = {
  dish: {
    label: "Divers plat",
    defaultName: "Divers plat",
    taxRate: 10,
    routing: "kitchen",
    categoryKeywords: ["plat"],
  },
  drink: {
    label: "Divers boisson",
    defaultName: "Divers boisson",
    taxRate: 10,
    routing: "bar",
    categoryKeywords: ["soft", "boisson"],
  },
  alcohol: {
    label: "Divers alcool",
    defaultName: "Divers alcool",
    taxRate: 20,
    routing: "bar",
    categoryKeywords: ["alcool"],
  },
}

const getDefaultSupplementForm = () => ({
  name: "",
  amount: "",
  notes: "",
  isComplimentary: false,
  complimentaryReason: "",
})

const getDefaultCustomMenuItemForm = (): CustomMenuItemFormState => ({
  name: "",
  price: "",
})

type DispatchPhase = "pending" | "to_follow_1" | "to_follow_2"
type SendFeedbackVariant = "success" | "warning" | "error" | "info"

interface SendFeedback {
  title: string
  lines: string[]
  variant: SendFeedbackVariant
}

type DispatchStation = "kitchen" | "bar"

type SpiritSelectionType = "gin_tonic" | "whisky" | "rhum" | "tequila" | "vodka"

type SpiritOption = {
  name: string
  price: number
}

type SpiritDialogConfig = {
  type: SpiritSelectionType
  title: string
  notePrefix: "Gin" | "Whisky" | "Rhum" | "Tequila" | "Vodka"
  options: SpiritOption[]
}

type DispatchPrintSummary = {
  printedStations: DispatchStation[]
  failedStations: Array<{ station: DispatchStation; message: string }>
}

const STANDARD_ALCOOL_BASE_ITEMS: Array<{ type: SpiritSelectionType; name: string; basePrice: number }> = [
  { type: "whisky", name: "Whisky", basePrice: 10 },
  { type: "rhum", name: "Rhum", basePrice: 10 },
  { type: "tequila", name: "Tequila", basePrice: 10 },
  { type: "vodka", name: "Vodka", basePrice: 10 },
]

export default function OrderPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const tableId = params.tableId as string
  const { isOnline, savePendingOrder, syncPendingOrders } = useOfflineManager()

  const [table, setTable] = useState<Table | null>(null)
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [supplements, setSupplements] = useState<SupplementItem[]>([])
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null)
  const [existingItems, setExistingItems] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notesDialog, setNotesDialog] = useState<{ open: boolean; itemId: string | null }>({
    open: false,
    itemId: null,
  })
  const [tempNotes, setTempNotes] = useState("")
  const [menuEnfantDialogOpen, setMenuEnfantDialogOpen] = useState(false)
  const [menuEnfantItem, setMenuEnfantItem] = useState<MenuItem | null>(null)
  const [menuEnfantChoice, setMenuEnfantChoice] = useState("")
  const [siropChoice, setSiropChoice] = useState("")
  const [cuissonDialogOpen, setCuissonDialogOpen] = useState(false)
  const [cuissonItem, setCuissonItem] = useState<MenuItem | null>(null)
  const [jusFruitDialogOpen, setJusFruitDialogOpen] = useState(false)
  const [jusFruitItem, setJusFruitItem] = useState<MenuItem | null>(null)
  const [rhumArrangeDialogOpen, setRhumArrangeDialogOpen] = useState(false)
  const [rhumArrangeItem, setRhumArrangeItem] = useState<MenuItem | null>(null)
  const [rhumArrangeOptions, setRhumArrangeOptions] = useState<string[]>([])
  const [kirDialogOpen, setKirDialogOpen] = useState(false)
  const [kirItem, setKirItem] = useState<MenuItem | null>(null)
  const [kirOptions, setKirOptions] = useState<string[]>([])
  const [spiritDialogOpen, setSpiritDialogOpen] = useState(false)
  const [spiritDialogItem, setSpiritDialogItem] = useState<MenuItem | null>(null)
  const [spiritDialogConfig, setSpiritDialogConfig] = useState<SpiritDialogConfig | null>(null)
  const [supplementDialog, setSupplementDialog] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [transferTables, setTransferTables] = useState<Table[]>([])
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [supplementForm, setSupplementForm] = useState(getDefaultSupplementForm())
  const [customMenuItemDialogOpen, setCustomMenuItemDialogOpen] = useState(false)
  const [customMenuItemKind, setCustomMenuItemKind] = useState<CustomMenuItemKind | null>(null)
  const [customMenuItemForm, setCustomMenuItemForm] = useState<CustomMenuItemFormState>(getDefaultCustomMenuItemForm())
  const [customMenuItemSaving, setCustomMenuItemSaving] = useState(false)
  const [complimentaryDialog, setComplimentaryDialog] = useState<{
    open: boolean
    itemId: string | null
    type: "cart" | "supplement"
  }>({
    open: false,
    itemId: null,
    type: "cart",
  })
  const [complimentaryReason, setComplimentaryReason] = useState("")
  const [elapsedTime, setElapsedTime] = useState("")
  const [coversDialogOpen, setCoversDialogOpen] = useState(false)
  const [coversCount, setCoversCount] = useState<number | null>(null)
  const [coversUpdating, setCoversUpdating] = useState(false)
  const [vinBouteilleDialogOpen, setVinBouteilleDialogOpen] = useState(false)
  const [vinBouteilleItem, setVinBouteilleItem] = useState<MenuItem | null>(null)
  const [hasOrderedWineBottle, setHasOrderedWineBottle] = useState(false)
  const [showAllergens, setShowAllergens] = useState(false)
  const [menuSearchQuery, setMenuSearchQuery] = useState("")
  const [allergenMap, setAllergenMap] = useState<Record<string, Array<{ id: string; name: string; emoji: string }>>>({})
  const [sendFeedback, setSendFeedback] = useState<SendFeedback | null>(null)
  const sendFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [swipedExistingItemId, setSwipedExistingItemId] = useState<string | null>(null)
  const existingItemTouchRef = useRef<{ itemId: string; startX: number } | null>(null)

  // Timer : temps écoulé depuis l'ouverture de la commande
  useEffect(() => {
    if (!currentOrder?.created_at) {
      setElapsedTime("")
      return
    }

    const computeElapsed = () => {
      const start = new Date(currentOrder.created_at).getTime()
      const now = Date.now()
      const diffMs = Math.max(0, now - start)
      const totalMinutes = Math.floor(diffMs / 60000)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60

      if (hours > 0) {
        setElapsedTime(`${hours}h${minutes.toString().padStart(2, "0")}`)
      } else {
        setElapsedTime(`${minutes}min`)
      }
    }

    computeElapsed()
    const interval = setInterval(computeElapsed, 30000) // Refresh toutes les 30s
    return () => clearInterval(interval)
  }, [currentOrder?.created_at])

  const normalizeName = (name: string) => name.trim().toLowerCase().replace(/'/g, "'")
  const normalizeForSearch = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
  const menuEnfantOptions = ["Pâtes poulet", "Frites poulet"]
  const siropOptions = ["Menthe", "Citron", "Pêche", "Grenadine"]
  const cuissonOptions = ["Bleu", "Saignant", "À point", "Bien cuit"]
  const jusFruitOptions = ["Orange", "Tomate", "Tomates", "Clémentine", "Fraise - Kiwi", "Ananas", "Pommes", "Abricots"]
  const defaultRhumArrangeOptions = ["Ananas", "Vanille", "Mangue", "Passion", "Coco", "Gingembre"]
  const defaultKirOptions = ["Pêche", "Cassis"]
  const spiritSelectionConfigs: Record<SpiritSelectionType, SpiritDialogConfig> = {
    gin_tonic: {
      type: "gin_tonic",
      title: "🍸 Choix du gin",
      notePrefix: "Gin",
      options: [
        { name: "Gibson", price: 11 },
        { name: "Malfy Lemon", price: 18 },
        { name: "Malfy", price: 18 },
        { name: "L'Acrobate", price: 15 },
        { name: "Mare", price: 18 },
        { name: "Monkey 47", price: 19 },
        { name: "Hendrick's", price: 14 },
        { name: "Bombay Sapphire", price: 12 },
        { name: "Plymouth", price: 15 },
        { name: "Méditerranéen gin", price: 17 },
      ],
    },
    whisky: {
      type: "whisky",
      title: "🥃 Choix du whisky (4cl)",
      notePrefix: "Whisky",
      options: [
        { name: "Ballantines", price: 10 },
        { name: "Jack Daniel", price: 14 },
        { name: "Bushmills", price: 13 },
        { name: "Nikka", price: 18 },
        { name: "Chivas Régal 18 ans", price: 20 },
        { name: "Aberlour 10 ans", price: 16 },
      ],
    },
    rhum: {
      type: "rhum",
      title: "🥃 Choix du rhum (4cl)",
      notePrefix: "Rhum",
      options: [
        { name: "Havana 3 ans", price: 10 },
        { name: "Havana 7", price: 14 },
        { name: "La Hechicera", price: 18 },
        { name: "Diplomatico", price: 16 },
        { name: "Bumbu", price: 15 },
        { name: "Bumbu XO", price: 18 },
        { name: "Botran 15 ans", price: 17 },
        { name: "Plantation XO", price: 17 },
        { name: "3 Rivières", price: 14 },
      ],
    },
    tequila: {
      type: "tequila",
      title: "🌵 Choix de la tequila (4cl)",
      notePrefix: "Tequila",
      options: [
        { name: "Diego y Maria", price: 10 },
        { name: "Don Julio Blanco", price: 17 },
        { name: "Don Julio Reposado", price: 18 },
        { name: "Olmeca", price: 15 },
        { name: "Altos Reposado", price: 15 },
        { name: "Erena", price: 16 },
        { name: "Azul", price: 45 },
      ],
    },
    vodka: {
      type: "vodka",
      title: "🍸 Choix de la vodka (4cl)",
      notePrefix: "Vodka",
      options: [
        { name: "Smirnof", price: 10 },
        { name: "Vodka Pyla", price: 14 },
        { name: "Vodka Cap Ferret", price: 14 },
        { name: "Belve / Grey Goose", price: 18 },
      ],
    },
  }
  const requiresCuissonSelection = (name: string) => {
    const normalizedName = normalizeForSearch(name)
    return normalizedName.includes("burger") || normalizedName.includes("bavette a la plancha")
  }
  const isJusArtisanalBioItem = (name: string) => normalizeForSearch(name) === "jus artisanal bio"
  const isRhumArrangeItem = (name: string) => normalizeForSearch(name).startsWith("rhum arrange")
  const isKirItem = (name: string) => /^kir\b/.test(normalizeForSearch(name))
  const isGinTonicItem = (name: string) => normalizeForSearch(name).includes("gin tonic")
  const matchesSpiritBaseName = (name: string, type: SpiritSelectionType) => {
    const normalizedName = normalizeForSearch(name)
    if (type === "whisky") return /^whisk(?:y|ies)\b/.test(normalizedName) || normalizedName.includes("whisky")
    if (type === "rhum") {
      if (normalizedName.includes("arrange")) return false
      return /^rhums?\b/.test(normalizedName) || normalizedName.includes("rhum")
    }
    if (type === "tequila") return /^tequilas?\b/.test(normalizedName) || normalizedName.includes("tequila")
    if (type === "vodka") return /^vodkas?\b/.test(normalizedName) || normalizedName.includes("vodka")
    return false
  }
  const getSpiritSelectionConfig = (item: MenuItem): SpiritDialogConfig | null => {
    if (isGinTonicItem(item.name)) {
      return spiritSelectionConfigs.gin_tonic
    }

    const normalizedName = normalizeForSearch(item.name)
    if (matchesSpiritBaseName(normalizedName, "whisky")) return spiritSelectionConfigs.whisky
    if (matchesSpiritBaseName(normalizedName, "rhum")) return spiritSelectionConfigs.rhum
    if (matchesSpiritBaseName(normalizedName, "tequila")) return spiritSelectionConfigs.tequila
    if (matchesSpiritBaseName(normalizedName, "vodka")) return spiritSelectionConfigs.vodka
    return null
  }
  const parseChoiceOptions = (value?: string | null) =>
    String(value || "")
      .split(/[,;\n]+/)
      .map((option) => option.trim())
      .filter((option) => option.length > 0)
  const isVinBouteilleItem = (item: MenuItem) => item.category === "Vins Bouteille"
  const verresOptions = [2, 3, 4, 5, 6, 7, 8]
  const getCartItemPrice = (item: CartItem) => item.price ?? item.menuItem?.price ?? 0
  const getCartItemMenuItemId = (item: CartItem) => item.menuItem?.id || item.menuItemId

  const showSendFeedback = (feedback: SendFeedback) => {
    if (sendFeedbackTimeoutRef.current) {
      clearTimeout(sendFeedbackTimeoutRef.current)
    }
    setSendFeedback(feedback)
    sendFeedbackTimeoutRef.current = setTimeout(() => {
      setSendFeedback(null)
      sendFeedbackTimeoutRef.current = null
    }, 4500)
  }

  const getPhaseLabel = (phase: DispatchPhase) => {
    if (phase === "pending") return "Commande immédiate"
    if (phase === "to_follow_1") return "À suivre 1"
    return "À suivre 2"
  }

  const summarizeDispatchByStation = (items: CartItem[]) => {
    let kitchen = 0
    let bar = 0

    for (const item of items) {
      const qty = Math.max(0, item.quantity || 0)
      const isBar = item.menuItem?.routing === "bar" || item.menuItem?.type === "drink"
      if (isBar) {
        bar += qty
      } else {
        kitchen += qty
      }
    }

    return { kitchen, bar }
  }

  const getRemainingFollowSummary = (items: CartItem[]) => {
    let follow1 = 0
    let follow2 = 0

    for (const item of items) {
      const qty = Math.max(0, item.quantity || 0)
      if (item.status === "to_follow_1") follow1 += qty
      if (item.status === "to_follow_2") follow2 += qty
    }

    if (follow1 > 0 && follow2 > 0) {
      return `Restent ${follow1} plat${follow1 > 1 ? "s" : ""} en à suivre 1 et ${follow2} plat${follow2 > 1 ? "s" : ""} en à suivre 2`
    }
    if (follow1 > 0) {
      return `Restent ${follow1} plat${follow1 > 1 ? "s" : ""} en à suivre 1`
    }
    if (follow2 > 0) {
      return `Restent ${follow2} plat${follow2 > 1 ? "s" : ""} en à suivre 2`
    }
    return ""
  }

  const buildDispatchFeedback = (params: {
    phase: DispatchPhase
    sentItems: CartItem[]
    remainingItems?: CartItem[]
    supplementsSent?: number
  }): SendFeedback => {
    const { phase, sentItems, remainingItems = [], supplementsSent = 0 } = params
    const { kitchen, bar } = summarizeDispatchByStation(sentItems)
    const lines: string[] = [`Étape envoyée: ${getPhaseLabel(phase)}`]

    if (kitchen > 0) {
      lines.push(`${kitchen} plat${kitchen > 1 ? "s" : ""} envoyé${kitchen > 1 ? "s" : ""} en cuisine`)
    }

    if (bar > 0) {
      lines.push(`${bar} boisson${bar > 1 ? "s" : ""} envoyée${bar > 1 ? "s" : ""} au bar`)
    }

    if (supplementsSent > 0) {
      lines.push(`${supplementsSent} supplément${supplementsSent > 1 ? "s" : ""} enregistré${supplementsSent > 1 ? "s" : ""}`)
    }

    const remainingText = getRemainingFollowSummary(remainingItems)
    if (remainingText) {
      lines.push(remainingText)
    }

    return {
      title: "Envoi effectué",
      lines,
      variant: "success",
    }
  }

  const buildStationTicket = (
    station: DispatchStation,
    sentItems: CartItem[],
    remainingItems: CartItem[] = [],
  ): EposTicket | null => {
    const isItemForStation = (item: CartItem) => {
      const isBar = item.menuItem?.routing === "bar" || item.menuItem?.type === "drink"
      return station === "bar" ? isBar : !isBar
    }

    const sentStationItems = sentItems.filter(isItemForStation)
    const remainingStationItems = remainingItems.filter(isItemForStation)

    if (sentStationItems.length === 0 && remainingStationItems.length === 0) return null

    const directItems = sentStationItems.filter((item) => item.status !== "to_follow_1" && item.status !== "to_follow_2")
    const follow1CurrentItems = sentStationItems.filter((item) => item.status === "to_follow_1")
    const follow2CurrentItems = sentStationItems.filter((item) => item.status === "to_follow_2")
    const follow1FutureItems = remainingStationItems.filter((item) => item.status === "to_follow_1")
    const follow2FutureItems = remainingStationItems.filter((item) => item.status === "to_follow_2")
    const line = "-------------------------------"
    const directTextScale = 1.5
    const followFutureTextScale = 1
    const lines: EposTicket["lines"] = []

    lines.push({ content: `Table ${table?.table_number || tableId}`, bold: true, fontScale: directTextScale })
    if (user?.name) {
      lines.push({ content: `Serveur: ${user.name}`, bold: true, fontScale: directTextScale })
    }
    lines.push({ content: `Heure: ${new Date().toLocaleTimeString("fr-FR")}` })
    lines.push({ content: line, align: "center" })

    const pushItems = (items: CartItem[], strong: boolean, fontScale: number) => {
      items.forEach((item) => {
        const baseItemName = item.menuItem?.name || item.menuItemId || "Article"
        const { displayName, displayNote } = getItemDisplayInfo(baseItemName, item.notes)
        lines.push({ content: `${item.quantity}x ${displayName}`, bold: strong, fontScale })
        if (displayNote) {
          displayNote
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .forEach((line) => lines.push({ content: `  - ${line}` }))
        }
      })
    }

    const pushFollowSection = (label: string, currentItems: CartItem[], futureItems: CartItem[]) => {
      if (currentItems.length > 0) {
        lines.push({ content: label })
        // Les "à suivre" effectivement envoyés doivent sortir à la même taille que le direct.
        pushItems(currentItems, false, directTextScale)
      }

      if (futureItems.length > 0) {
        if (currentItems.length > 0) {
          lines.push({ content: line, align: "center" })
        }
        lines.push({ content: `${label} (A VENIR)` })
        pushItems(futureItems, false, followFutureTextScale)
      }
    }

    if (directItems.length > 0) {
      lines.push({ content: "DIRECT", bold: true })
      pushItems(directItems, true, directTextScale)
    }

    const hasFollow1Section = follow1CurrentItems.length > 0 || follow1FutureItems.length > 0
    const hasFollow2Section = follow2CurrentItems.length > 0 || follow2FutureItems.length > 0

    if (directItems.length > 0 && (hasFollow1Section || hasFollow2Section)) {
      lines.push({ content: line, align: "center" })
    }

    pushFollowSection("A SUIVRE 1", follow1CurrentItems, follow1FutureItems)

    if (hasFollow1Section && hasFollow2Section) {
      lines.push({ content: line, align: "center" })
    }

    pushFollowSection("A SUIVRE 2", follow2CurrentItems, follow2FutureItems)

    return {
      title: station === "bar" ? "BAR" : "CUISINE",
      lines,
      cut: true,
      beep: true,
    }
  }

  const stationLabel = (station: DispatchStation) => (station === "bar" ? "Bar" : "Cuisine")

  const printDispatchedTickets = async (
    sentItems: CartItem[],
    remainingItems: CartItem[] = [],
    options?: { modeOverride?: PrintMode },
  ): Promise<DispatchPrintSummary> => {
    const summary: DispatchPrintSummary = { printedStations: [], failedStations: [] }

    for (const station of ["kitchen", "bar"] as DispatchStation[]) {
      const ticket = buildStationTicket(station, sentItems, remainingItems)
      if (!ticket) continue

      const result = await printTicketWithConfiguredMode({
        kind: station,
        ticket,
        modeOverride: options?.modeOverride,
      })
      if (result.ok) {
        summary.printedStations.push(station)
      } else {
        summary.failedStations.push({
          station,
          message: result.message || `Échec impression ${station}`,
        })
      }
    }

    return summary
  }

  useEffect(() => {
    return () => {
      if (sendFeedbackTimeoutRef.current) {
        clearTimeout(sendFeedbackTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!swipedExistingItemId) return
    const stillExists = existingItems.some((item) => item.id === swipedExistingItemId)
    if (!stillExists) {
      setSwipedExistingItemId(null)
    }
  }, [existingItems, swipedExistingItemId])

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user && tableId) {
      const loadInitialData = async () => {
        try {
          setLoading(true)
          const initialItems = await fetchBaseData()
          await fetchOrderData(initialItems)
        } finally {
          setLoading(false)
        }
      }
      loadInitialData()
    }
  }, [user, tableId])

  // Realtime : écouter les changements sur order_items pour mise à jour instantanée
  useEffect(() => {
    if (!currentOrder?.id) return

    const supabase = createClient()
    
    const channel = supabase
      .channel(`order_${currentOrder.id}`)
      .on('postgres_changes', {
        event: '*', // INSERT, UPDATE, DELETE
        schema: 'public',
        table: 'order_items',
        filter: `order_id=eq.${currentOrder.id}` // Seulement pour cette commande
      }, (payload) => {
        // Mapper le payload vers notre format CartItem
        const mapPayloadToCartItem = (item: any): CartItem => {
          const menuItem = menuItems.find((m: MenuItem) => m.id === item.menu_item_id)
          return {
            id: `cart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            cartItemId: item.id as string,
            menuItemId: item.menu_item_id as string,
            menuItem: menuItem || null,
            quantity: item.quantity as number,
            status: item.status as CartItem['status'],
            price: item.price as number | undefined,
            notes: item.notes as string | undefined,
            isComplimentary: item.is_complimentary as boolean,
            complimentaryReason: item.complimentary_reason as string | undefined,
          }
        }

        if (payload.eventType === 'INSERT') {
          // Ajouter le nouvel item au panier
          const newItem = mapPayloadToCartItem(payload.new)
          if (newItem.status !== 'fired' && newItem.status !== 'completed') {
            setCart(prev => [...prev, newItem])
          }
        } else if (payload.eventType === 'UPDATE') {
          // Mettre à jour l'item existant
          setCart(prev => prev.map(item => {
            if (item.cartItemId === payload.new.id) {
              const updatedItem = mapPayloadToCartItem(payload.new)
              // Garder dans le panier seulement si pas fired/completed
              return (updatedItem.status !== 'fired' && updatedItem.status !== 'completed')
                ? updatedItem
                : item
            }
            return item
          }))
        } else if (payload.eventType === 'DELETE') {
          // Supprimer l'item du panier
          setCart(prev => prev.filter(item => item.cartItemId !== payload.old.id))
        }
      })
      .subscribe()

    // Cleanup : se désabonner au démontage
    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentOrder?.id, menuItems])

  const fetchCategories = async () => {
    const categoriesRes = await fetch("/api/menu/categories")
    if (categoriesRes.ok) {
      const categoriesData = await categoriesRes.json()
      setCategories(categoriesData)
      if (categoriesData.length > 0) {
        setSelectedCategory((prev) => {
          const stillExists = categoriesData.some((c: MenuCategory) => c.id === prev)
          return prev && stillExists ? prev : categoriesData[0].id
        })
      }
      return categoriesData
    }
    return []
  }

  const fetchMenuItems = async () => {
    const itemsRes = await fetch("/api/menu/items", { cache: "no-store" })
    if (itemsRes.ok) {
      const itemsData = await itemsRes.json()
      setMenuItems(itemsData)
      return itemsData
    }
    return []
  }

  const ensureAlcoolBaseButtons = async (categoriesData: MenuCategory[], itemsData: MenuItem[]) => {
    const alcoolsCategory = categoriesData.find((category) =>
      normalizeForSearch(category.name || "").includes("alcool"),
    )
    if (!alcoolsCategory) return itemsData

    const itemsInAlcools = itemsData.filter((item) => item.category_id === alcoolsCategory.id)
    const hasVisibleBase = (type: SpiritSelectionType) =>
      itemsInAlcools.some((item) => item.status !== false && matchesSpiritBaseName(item.name || "", type))

    const missingItems = STANDARD_ALCOOL_BASE_ITEMS.filter((item) => !hasVisibleBase(item.type))
    if (missingItems.length === 0) return itemsData

    await Promise.all(
      missingItems.map(async (item) => {
        try {
          await fetch("/api/menu/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: item.name,
              price: item.basePrice,
              tax_rate: 20,
              category: alcoolsCategory.name,
              routing: "bar",
              status: true,
            }),
          })
        } catch (error) {
          console.error("[v0] Error ensuring alcool base item:", item.name, error)
        }
      }),
    )

    const refreshedItems = await fetchMenuItems()
    return refreshedItems.length > 0 ? refreshedItems : itemsData
  }

  const fetchAllergenMap = async () => {
    try {
      const res = await fetch("/api/menu/allergen-map")
      if (res.ok) {
        const data = await res.json()
        setAllergenMap(data)
      }
    } catch (error) {
      console.error("[v0] Error fetching allergen map:", error)
    }
  }

  const fetchBaseData = async () => {
    try {
      const [categoriesData, itemsData] = await Promise.all([fetchCategories(), fetchMenuItems(), fetchAllergenMap()])
      const finalItems = await ensureAlcoolBaseButtons(categoriesData, itemsData)
      return finalItems
    } catch (error) {
      console.error("[v0] Error fetching base data:", error)
      return []
    }
  }

  const fetchOrderData = async (menuItemsOverride?: MenuItem[]) => {
    try {
      const currentItemsPromise = menuItemsOverride
        ? Promise.resolve(menuItemsOverride)
        : menuItems.length > 0
          ? Promise.resolve(menuItems)
          : fetchMenuItems()

      const [tableRes, orderRes, initialItems] = await Promise.all([
        fetch(`/api/tables/${tableId}`),
        fetch(`/api/orders/table/${tableId}`, { cache: "no-store" }),
        currentItemsPromise,
      ])

      if (tableRes.ok) {
        const tableData = await tableRes.json()
        setTable(tableData)
      }
      if (orderRes.ok) {
        const orderData = await orderRes.json()
        if (orderData) {
          let currentItems = initialItems
          const hasMissingMenuItems = orderData.items.some(
            (item: OrderItem) => !currentItems.some((menuItem: MenuItem) => menuItem.id === item.menu_item_id),
          )
          if (hasMissingMenuItems) {
            // Un article peut avoir été créé juste avant l'ajout (cas "Divers"):
            // on rafraîchit la carte pour éviter "Article inconnu" sans refresh manuel.
            const refreshedItems = await fetchMenuItems()
            if (refreshedItems.length > 0) {
              currentItems = refreshedItems
            }
          }

          setCurrentOrder(orderData.order)

          // Organiser les articles selon leur statut
          const pendingItems = orderData.items.filter((item: OrderItem) => item.status === "pending")
          const toFollow1Items = orderData.items.filter((item: OrderItem) => item.status === "to_follow_1")
          const toFollow2Items = orderData.items.filter((item: OrderItem) => item.status === "to_follow_2")
          const firedItems = orderData.items.filter((item: OrderItem) => item.status === "fired" || item.status === "completed")

          // Mettre TOUS les articles non envoyés dans le panier (pending + to_follow)
          const cartItems = [...pendingItems, ...toFollow1Items, ...toFollow2Items].map((item: OrderItem) => {
            const menuItem = currentItems.find((m: MenuItem) => m.id === item.menu_item_id)
            if (!menuItem) {
              console.warn("[v0] MenuItem not found for item:", item.menu_item_id)
            }
            return {
              id: `cart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              cartItemId: item.id, // Utiliser l'ID de la BDD comme référence unique
              menuItemId: item.menu_item_id,
              menuItem: menuItem || null,
              quantity: item.quantity,
              status: item.status as "pending" | "to_follow_1" | "to_follow_2",
              price: item.price,
              notes: item.notes,
              isComplimentary: item.is_complimentary,
              complimentaryReason: item.complimentary_reason,
            }
          })

          setCart(cartItems)
          setExistingItems(firedItems)

          // Récupérer le nombre de couverts existant
          if (orderData.order.covers != null) {
            setCoversCount(orderData.order.covers)
          }

          // Vérifier si une bouteille de vin a déjà été commandée
          const allOrderItems = [...cartItems.map(c => c.menuItem), ...firedItems.map((fi: OrderItem) => currentItems.find((m: MenuItem) => m.id === fi.menu_item_id))]
          const hasWine = allOrderItems.some((mi) => mi && mi.category === "Vins Bouteille")
          if (hasWine) setHasOrderedWineBottle(true)

          console.log("[v0] Order loaded:", {
            pending: pendingItems.length,
            toFollow1: toFollow1Items.length,
            toFollow2: toFollow2Items.length,
            fired: firedItems.length,
            cartItems: cartItems.length,
            totalInCart: pendingItems.length + toFollow1Items.length + toFollow2Items.length,
          })
        } else {
          // Pas de commande existante → ouvrir le dialog couverts
          setCoversDialogOpen(true)
        }
      }
    } catch (error) {
      console.error("[v0] Error fetching order data:", error)
    }
  }

  const openTransferDialog = async () => {
    setTransferDialogOpen(true)
    setTransferLoading(true)
    setTransferError(null)
    try {
      const res = await fetch(`/api/tables/available-transfer?fromTableId=${tableId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || "Chargement impossible")
      }
      const data = await res.json()
      setTransferTables(data)
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "Erreur de chargement")
    } finally {
      setTransferLoading(false)
    }
  }

  const transferOrderToTable = async (targetTableId: string) => {
    if (!currentOrder?.id) return
    try {
      const response = await fetch("/api/orders/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: currentOrder.id,
          fromTableId: tableId,
          toTableId: targetTableId,
          serverId: user?.id || "",
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err?.error || "Transfert impossible")
      }

      setTransferDialogOpen(false)
      router.push(`/order/${targetTableId}`)
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "Erreur de transfert")
    }
  }

  const addToCart = async (menuItem: MenuItem, sourceCartItem?: CartItem) => {
    // BDD source de vérité:
    // - si un item "pending" identique existe déjà, on incrémente sa quantité
    // - sinon, on insère un nouvel item en BDD
    try {
      if (sourceCartItem) {
        const response = await fetch("/api/orders/fire-follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: currentOrder?.id,
            items: [
              {
                cartItemId: sourceCartItem.cartItemId,
                menuItemId: getCartItemMenuItemId(sourceCartItem),
                quantity: sourceCartItem.quantity + 1,
                price: getCartItemPrice(sourceCartItem),
                status: sourceCartItem.status,
                notes: sourceCartItem.notes,
                isComplimentary: sourceCartItem.isComplimentary || false,
                complimentaryReason: sourceCartItem.complimentaryReason,
              },
            ],
            serverId: user?.id || "",
          }),
        })

        if (response.ok) {
          await fetchOrderData()
        }
        return
      }

      const existingPending = cart.find(
        (i) => i.status === "pending" && getCartItemMenuItemId(i) === menuItem.id && (!i.notes || i.notes.trim() === ""),
      )

      if (existingPending) {
        const response = await fetch("/api/orders/fire-follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: currentOrder?.id,
            items: [
              {
                cartItemId: existingPending.cartItemId,
                menuItemId: menuItem.id,
                quantity: existingPending.quantity + 1,
                price: getCartItemPrice(existingPending),
                status: existingPending.status,
                notes: existingPending.notes,
                isComplimentary: existingPending.isComplimentary || false,
                complimentaryReason: existingPending.complimentaryReason,
              },
            ],
            serverId: user?.id || "",
          }),
        })

        if (response.ok) {
          await fetchOrderData()
        }
        return
      }

      const orderData: any = {
        tableId,
        serverId: user?.id || "",
        items: [
          {
            menuItemId: menuItem.id,
            quantity: 1,
            price: menuItem.price,
            status: "pending",
            notes: "",
            isComplimentary: false,
            complimentaryReason: "",
          },
        ],
        supplements: [],
        orderId: currentOrder?.id,
      }
      // Envoyer le nombre de couverts à la création de la commande
      if (!currentOrder?.id && coversCount != null) {
        orderData.covers = coversCount
      }

      const response = await fetch("/api/orders/to-follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderData),
      })

      if (response.ok) {
        await fetchOrderData()
      }
    } catch (error) {
      console.error("[v0] Error adding item to cart:", error)
    }
  }

  const addItemsToOrder = async (
    items: Array<{ menuItem: MenuItem; notes?: string; priceOverride?: number }>,
  ) => {
    if (items.length === 0) return

    try {
      const orderData: any = {
        tableId,
        serverId: user?.id || "",
        items: items.map((item) => ({
          menuItemId: item.menuItem.id,
          quantity: 1,
          price: item.priceOverride ?? item.menuItem.price,
          status: "pending",
          notes: item.notes || "",
          isComplimentary: false,
          complimentaryReason: "",
        })),
        supplements: [],
        orderId: currentOrder?.id,
      }
      // Envoyer le nombre de couverts à la création de la commande
      if (!currentOrder?.id && coversCount != null) {
        orderData.covers = coversCount
      }

      const response = await fetch("/api/orders/to-follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderData),
      })

      if (response.ok) {
        await fetchOrderData()
      }
    } catch (error) {
      console.error("[v0] Error adding items to order:", error)
    }
  }

  const openMenuEnfantDialog = (item: MenuItem) => {
    setMenuEnfantItem(item)
    setMenuEnfantChoice("")
    setSiropChoice("")
    setMenuEnfantDialogOpen(true)
  }

  const handleMenuEnfantConfirm = async () => {
    if (!menuEnfantItem || !menuEnfantChoice) return

    const itemsToAdd: Array<{ menuItem: MenuItem; notes?: string; priceOverride?: number }> = [
      {
        menuItem: menuEnfantItem,
        notes: menuEnfantChoice,
      },
    ]

    if (siropChoice) {
      const siropItem = menuItems.find((item) => normalizeName(item.name) === "sirop à l'eau")
      if (siropItem) {
        itemsToAdd.push({
          menuItem: siropItem,
          notes: `Goût: ${siropChoice} (inclus menu enfant)`,
          priceOverride: 0,
        })
      } else {
        alert("Article 'Sirop à l'eau' introuvable dans la carte.")
      }
    }

    await addItemsToOrder(itemsToAdd)
    setMenuEnfantDialogOpen(false)
  }

  const openCuissonDialog = (item: MenuItem) => {
    setCuissonItem(item)
    setCuissonDialogOpen(true)
  }

  const handleCuissonSelect = async (cuisson: string) => {
    if (!cuissonItem) return
    await addItemsToOrder([{ menuItem: cuissonItem, notes: `Cuisson: ${cuisson}` }])
    setCuissonDialogOpen(false)
    setCuissonItem(null)
  }

  const openJusFruitDialog = (item: MenuItem) => {
    setJusFruitItem(item)
    setJusFruitDialogOpen(true)
  }

  const handleJusFruitSelect = async (fruit: string) => {
    if (!jusFruitItem) return
    await addItemsToOrder([{ menuItem: jusFruitItem, notes: `Fruit: ${fruit}` }])
    setJusFruitDialogOpen(false)
    setJusFruitItem(null)
  }

  const openRhumArrangeDialog = (item: MenuItem) => {
    const configuredOptions = parseChoiceOptions(item.details)
    setRhumArrangeOptions(configuredOptions.length > 0 ? configuredOptions : defaultRhumArrangeOptions)
    setRhumArrangeItem(item)
    setRhumArrangeDialogOpen(true)
  }

  const handleRhumArrangeSelect = async (flavor: string) => {
    if (!rhumArrangeItem) return
    await addItemsToOrder([{ menuItem: rhumArrangeItem, notes: `Goût: ${flavor}` }])
    setRhumArrangeDialogOpen(false)
    setRhumArrangeItem(null)
    setRhumArrangeOptions([])
  }

  const openKirDialog = (item: MenuItem) => {
    const configuredOptions = parseChoiceOptions(item.details)
    setKirOptions(configuredOptions.length > 0 ? configuredOptions : defaultKirOptions)
    setKirItem(item)
    setKirDialogOpen(true)
  }

  const handleKirSelect = async (flavor: string) => {
    if (!kirItem) return
    await addItemsToOrder([{ menuItem: kirItem, notes: `Goût: ${flavor}` }])
    setKirDialogOpen(false)
    setKirItem(null)
    setKirOptions([])
  }

  const openSpiritDialog = (item: MenuItem, config: SpiritDialogConfig) => {
    setSpiritDialogItem(item)
    setSpiritDialogConfig(config)
    setSpiritDialogOpen(true)
  }

  const closeSpiritDialog = () => {
    setSpiritDialogOpen(false)
    setSpiritDialogItem(null)
    setSpiritDialogConfig(null)
  }

  const handleSpiritSelect = async (choice: SpiritOption) => {
    if (!spiritDialogItem || !spiritDialogConfig) return
    await addItemsToOrder([
      {
        menuItem: spiritDialogItem,
        notes: `${spiritDialogConfig.notePrefix}: ${choice.name}`,
        priceOverride: choice.price,
      },
    ])
    closeSpiritDialog()
  }

  const ensureSpiritBaseItemAndOpenDialog = async (type: Exclude<SpiritSelectionType, "gin_tonic">) => {
    const config = spiritSelectionConfigs[type]
    if (!config) return

    const alcoolsCategory = categories.find((category) =>
      normalizeForSearch(category.name || "").includes("alcool"),
    )
    if (!alcoolsCategory) {
      alert("Catégorie Alcools introuvable.")
      return
    }

    const existingItem = menuItems.find(
      (item) =>
        item.category_id === alcoolsCategory.id &&
        item.status !== false &&
        matchesSpiritBaseName(item.name || "", type),
    )
    if (existingItem) {
      openSpiritDialog(existingItem, config)
      return
    }

    const baseItem = STANDARD_ALCOOL_BASE_ITEMS.find((item) => item.type === type)
    if (!baseItem) return

    try {
      const response = await fetch("/api/menu/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: baseItem.name,
          price: baseItem.basePrice,
          tax_rate: 20,
          category: alcoolsCategory.name,
          routing: "bar",
          status: true,
        }),
      })
      if (!response.ok) {
        throw new Error("creation_failed")
      }
      const createdItem: MenuItem = await response.json()
      setMenuItems((prev) => [...prev, createdItem])
      openSpiritDialog(createdItem, config)
    } catch (error) {
      console.error("[v0] Error creating spirit base item:", type, error)
      alert("Impossible de créer l'article dans Alcools.")
    }
  }

  // ── Couverts ──────────────────────────────────────────────────────────
  const getActiveCoversCount = () => {
    if (coversCount != null && coversCount > 0) return coversCount
    if (currentOrder?.covers != null && currentOrder.covers > 0) return currentOrder.covers
    if (table?.current_covers != null && table.current_covers > 0) return table.current_covers
    if (table?.seats != null && table.seats > 0) return table.seats
    return 1
  }

  const hasSavedCovers =
    (coversCount != null && coversCount > 0) ||
    (currentOrder?.covers != null && currentOrder.covers > 0) ||
    (table?.current_covers != null && table.current_covers > 0)

  const handleCoversConfirm = async (count: number, options?: { closeDialog?: boolean }) => {
    const previousCoversCount = coversCount
    const previousOrderCovers = currentOrder?.covers ?? null

    setCoversCount(count)
    setCurrentOrder((prev) => (prev ? { ...prev, covers: count } : prev))
    if (options?.closeDialog !== false) setCoversDialogOpen(false)

    // Si pas encore de commande, les couverts seront envoyés à la première création de commande
    if (!currentOrder?.id) return

    try {
      setCoversUpdating(true)
      const response = await fetch(`/api/orders/table/${tableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ covers: count }),
      })
      if (!response.ok) throw new Error("Failed to update covers")
    } catch (error) {
      console.error("[v0] Error updating covers:", error)
      // Revenir à l'état précédent si la sauvegarde échoue
      setCoversCount(previousCoversCount)
      setCurrentOrder((prev) => (prev ? { ...prev, covers: previousOrderCovers } : prev))
    } finally {
      setCoversUpdating(false)
    }
  }

  const handleCoversQuickAdjust = async (delta: number) => {
    if (coversUpdating) return
    const current = getActiveCoversCount()
    const next = Math.max(1, Math.min(30, current + delta))
    if (next === current) return
    await handleCoversConfirm(next, { closeDialog: false })
  }

  // ── Vin Bouteille ─────────────────────────────────────────────────────
  const openVinBouteilleDialog = (item: MenuItem) => {
    setVinBouteilleItem(item)
    setVinBouteilleDialogOpen(true)
  }

  const handleVinBouteilleSelect = async (verres: number) => {
    if (!vinBouteilleItem) return
    await addItemsToOrder([{ menuItem: vinBouteilleItem, notes: `${verres} verres à apporter` }])
    setHasOrderedWineBottle(true)
    setVinBouteilleDialogOpen(false)
    setVinBouteilleItem(null)
  }

  const handleMenuItemClick = (item: MenuItem) => {
    if (normalizeName(item.name) === "menu enfant") {
      openMenuEnfantDialog(item)
      return
    }
    if (requiresCuissonSelection(item.name)) {
      openCuissonDialog(item)
      return
    }
    if (isJusArtisanalBioItem(item.name)) {
      openJusFruitDialog(item)
      return
    }
    if (isRhumArrangeItem(item.name)) {
      openRhumArrangeDialog(item)
      return
    }
    if (isKirItem(item.name)) {
      openKirDialog(item)
      return
    }
    const spiritConfig = getSpiritSelectionConfig(item)
    if (spiritConfig) {
      openSpiritDialog(item, spiritConfig)
      return
    }
    if (isVinBouteilleItem(item) && !hasOrderedWineBottle) {
      openVinBouteilleDialog(item)
      return
    }
    addToCart(item)
  }

  const handleExistingItemTouchStart = (itemId: string, event: TouchEvent<HTMLDivElement>) => {
    existingItemTouchRef.current = {
      itemId,
      startX: event.changedTouches[0]?.clientX ?? 0,
    }
  }

  const handleExistingItemTouchEnd = (itemId: string, event: TouchEvent<HTMLDivElement>) => {
    const touchState = existingItemTouchRef.current
    if (!touchState || touchState.itemId !== itemId) return

    const endX = event.changedTouches[0]?.clientX ?? touchState.startX
    const deltaX = endX - touchState.startX

    if (deltaX <= -45) {
      setSwipedExistingItemId(itemId)
    } else if (deltaX >= 30 && swipedExistingItemId === itemId) {
      setSwipedExistingItemId(null)
    }

    existingItemTouchRef.current = null
  }

  const removeExistingItem = async (item: OrderItem) => {
    if (!currentOrder?.id) return

    const itemName = menuItems.find((menuItem) => menuItem.id === item.menu_item_id)?.name || "cet article"
    const shouldDelete = confirm(`Supprimer ${item.quantity}x ${itemName} de la commande ?`)
    if (!shouldDelete) return

    try {
      const response = await fetch("/api/orders/fire-follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: currentOrder.id,
          items: [
            {
              cartItemId: item.id,
              menuItemId: item.menu_item_id,
              quantity: 0,
              price: item.price,
              status: item.status,
              notes: item.notes,
              isComplimentary: item.is_complimentary || false,
              complimentaryReason: item.complimentary_reason,
            },
          ],
          serverId: user?.id || "",
        }),
      })

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}))
        throw new Error(errorPayload?.error || "Suppression impossible")
      }

      setSwipedExistingItemId(null)
      await fetchOrderData()
    } catch (error) {
      console.error("[v0] Error deleting existing item:", error)
      alert("Impossible de supprimer cet article.")
    }
  }

  const removeFromCart = async (cartItemId: string) => {
    // Trouver l'article dans le panier
    const item = cart.find((item) => item.cartItemId === cartItemId)
    if (!item) return
    
    try {
      if (item.quantity > 1) {
        // Mettre à jour la quantité en utilisant l'API existante
        const response = await fetch("/api/orders/fire-follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: currentOrder?.id,
            items: [{
              cartItemId: cartItemId,
              menuItemId: getCartItemMenuItemId(item),
              quantity: item.quantity - 1,
              price: getCartItemPrice(item),
              status: item.status, // Garder le même statut
              notes: item.notes,
              isComplimentary: item.isComplimentary || false,
              complimentaryReason: item.complimentaryReason,
            }],
            serverId: user?.id || "",
          }),
        })
        
        if (response.ok) {
          await fetchOrderData()
        }
      } else {
        // Supprimer l'article
        const response = await fetch("/api/orders/fire-follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: currentOrder?.id,
            items: [{
              cartItemId: cartItemId,
              menuItemId: getCartItemMenuItemId(item),
              quantity: 0, // Quantité 0 = suppression
              price: getCartItemPrice(item),
              status: item.status,
              notes: item.notes,
              isComplimentary: item.isComplimentary || false,
              complimentaryReason: item.complimentaryReason,
            }],
            serverId: user?.id || "",
          }),
        })
        
        if (response.ok) {
          await fetchOrderData()
        }
      }
    } catch (error) {
      console.error("[v0] Error removing item from cart:", error)
    }
  }

  const toggleToFollow = async (cartItemId: string) => {
    // Trouver l'article actuel
    const item = cart.find((item) => item.cartItemId === cartItemId)
    if (!item) return
    
    // Calculer le nouveau statut
    let newStatus: "pending" | "to_follow_1" | "to_follow_2"
    if (item.status === "pending") {
      newStatus = "to_follow_1"
    } else if (item.status === "to_follow_1") {
      newStatus = "to_follow_2"
    } else {
      newStatus = "pending"
    }
    
    try {
      // Mettre à jour le statut en base
      const response = await fetch("/api/orders/fire-follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: currentOrder?.id,
          items: [{
            cartItemId: cartItemId,
            menuItemId: getCartItemMenuItemId(item),
            quantity: item.quantity,
            price: getCartItemPrice(item),
            status: newStatus, // Nouveau statut
            notes: item.notes,
            isComplimentary: item.isComplimentary || false,
            complimentaryReason: item.complimentaryReason,
          }],
          serverId: user?.id || "",
        }),
      })
      
      if (response.ok) {
        // Plus besoin de fetchData() - Realtime gère la mise à jour
      }
    } catch (error) {
      console.error("[v0] Error toggling to-follow status:", error)
    }
  }

  const openNotesDialog = (cartItemId: string) => {
    const item = cart.find((i) => i.cartItemId === cartItemId)
    setTempNotes(item?.notes || "")
    setNotesDialog({ open: true, itemId: cartItemId })
  }

  const saveNotes = async () => {
    if (notesDialog.itemId) {
      // Trouver l'article actuel
      const item = cart.find((item) => item.cartItemId === notesDialog.itemId)
      if (!item) return
      
      try {
        // Mettre à jour les notes en base
        const response = await fetch("/api/orders/fire-follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: currentOrder?.id,
            items: [{
            cartItemId: notesDialog.itemId,
            menuItemId: getCartItemMenuItemId(item),
            quantity: item.quantity,
            price: getCartItemPrice(item),
            status: item.status,
            notes: tempNotes, // Nouvelles notes
            isComplimentary: item.isComplimentary || false,
            complimentaryReason: item.complimentaryReason,
            }],
            serverId: user?.id || "",
          }),
        })
        
        if (response.ok) {
          // Plus besoin de fetchData() - Realtime gère la mise à jour
        }
      } catch (error) {
        console.error("[v0] Error saving notes:", error)
      }
    }
    setNotesDialog({ open: false, itemId: null })
    setTempNotes("")
  }

  const openSupplementDialog = () => {
    setSupplementForm(getDefaultSupplementForm())
    setSupplementDialog(true)
  }

  const openCustomMenuItemDialog = (kind: CustomMenuItemKind) => {
    const preset = CUSTOM_MENU_ITEM_PRESETS[kind]
    setCustomMenuItemKind(kind)
    setCustomMenuItemForm({
      name: preset.defaultName,
      price: "0.00",
    })
    setCustomMenuItemDialogOpen(true)
  }

  const closeCustomMenuItemDialog = () => {
    setCustomMenuItemDialogOpen(false)
    setCustomMenuItemKind(null)
    setCustomMenuItemForm(getDefaultCustomMenuItemForm())
    setCustomMenuItemSaving(false)
  }

  const addCustomMenuItem = async () => {
    if (!customMenuItemKind) return
    const preset = CUSTOM_MENU_ITEM_PRESETS[customMenuItemKind]
    const category = categories.find((c) => c.id === selectedCategory)
    const name = customMenuItemForm.name.trim()
    const parsedPrice = Number.parseFloat(customMenuItemForm.price)

    if (!category) {
      alert("Catégorie introuvable.")
      return
    }
    if (!name) {
      alert("Veuillez saisir un intitulé.")
      return
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      alert("Veuillez saisir un montant valide.")
      return
    }

    try {
      setCustomMenuItemSaving(true)
      const response = await fetch("/api/menu/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          price: parsedPrice,
          tax_rate: preset.taxRate,
          category: category.name,
          routing: preset.routing,
          status: false, // Masqué de la carte standard, utilisé uniquement pour cette commande
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err?.error || "Création de l'article impossible")
      }

      const createdItem: MenuItem = await response.json()
      setMenuItems((prev) => (prev.some((item) => item.id === createdItem.id) ? prev : [...prev, createdItem]))
      await addItemsToOrder([{ menuItem: createdItem, priceOverride: parsedPrice }])
      closeCustomMenuItemDialog()
    } catch (error) {
      console.error("[v0] Error creating custom menu item:", error)
      alert("Impossible d'ajouter cet article divers.")
    } finally {
      setCustomMenuItemSaving(false)
    }
  }

  const addSupplement = () => {
    if (
      !supplementForm.name ||
      (!supplementForm.isComplimentary && (!supplementForm.amount || Number.parseFloat(supplementForm.amount) <= 0))
    ) {
      alert("Veuillez remplir le nom et le montant (ou cocher Offert)")
      return
    }

    const newSupplement: SupplementItem = {
      id: `supplement-${Date.now()}`,
      name: supplementForm.name,
      amount: supplementForm.isComplimentary ? 0 : Number.parseFloat(supplementForm.amount),
      notes: supplementForm.notes,
      isComplimentary: supplementForm.isComplimentary,
      complimentaryReason: supplementForm.complimentaryReason,
    }

    setSupplements((prev) => [...prev, newSupplement])
    setSupplementForm(getDefaultSupplementForm())
    setSupplementDialog(false)
  }

  const removeSupplement = (id: string) => {
    setSupplements((prev) => prev.filter((s) => s.id !== id))
  }

  const toggleComplimentary = (itemId: string, type: "cart" | "supplement") => {
    setComplimentaryDialog({ open: true, itemId, type })
  }

  const saveComplimentary = async () => {
    if (complimentaryDialog.type === "cart" && complimentaryDialog.itemId) {
      // Trouver l'article actuel
      const item = cart.find((item) => item.cartItemId === complimentaryDialog.itemId)
      if (!item) return
      
      try {
        // Mettre à jour le statut offert en base
        const response = await fetch("/api/orders/fire-follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: currentOrder?.id,
            items: [{
              cartItemId: complimentaryDialog.itemId,
              menuItemId: getCartItemMenuItemId(item),
              quantity: item.quantity,
              price: getCartItemPrice(item),
              status: item.status,
              notes: item.notes,
              isComplimentary: !item.isComplimentary, // Inverser le statut
              complimentaryReason: !item.isComplimentary ? complimentaryReason : "",
            }],
            serverId: user?.id || "",
          }),
        })
        
        if (response.ok) {
          // Plus besoin de fetchData() - Realtime gère la mise à jour
        }
      } catch (error) {
        console.error("[v0] Error saving complimentary status:", error)
      }
    } else if (complimentaryDialog.type === "supplement" && complimentaryDialog.itemId) {
      // Les suppléments ne sont pas persistés en BDD avant l'envoi: on reste en local
      setSupplements((prev) =>
        prev.map((sup) =>
          sup.id === complimentaryDialog.itemId
            ? {
                ...sup,
                isComplimentary: !sup.isComplimentary,
                complimentaryReason: !sup.isComplimentary ? complimentaryReason : "",
              }
            : sup,
        ),
      )
    }
    setComplimentaryDialog({ open: false, itemId: null, type: "cart" })
    setComplimentaryReason("")
  }

  const sendOrder = async () => {
    if (cart.length === 0 && supplements.length === 0) return

    // Séparer ce qui doit être envoyé immédiatement vs ce qui reste en "à suivre"
    let itemsToSend = cart.filter((item) => item.status === "pending")
    let sendPhase: DispatchPhase | null = itemsToSend.length > 0 ? "pending" : null

    // Si aucun article "pending", essayer d'envoyer les "à suivre" étape par étape
    if (itemsToSend.length === 0) {
      const toFollow1Items = cart.filter((item) => item.status === "to_follow_1")
      if (toFollow1Items.length > 0) {
        itemsToSend = toFollow1Items
        sendPhase = "to_follow_1"
        console.log("[v0] No pending items, sending to_follow_1 items instead")
      } else {
        const toFollow2Items = cart.filter((item) => item.status === "to_follow_2")
        if (toFollow2Items.length > 0) {
          itemsToSend = toFollow2Items
          sendPhase = "to_follow_2"
          console.log("[v0] No pending/to_follow_1 items, sending to_follow_2 items instead")
        }
      }
    }

    const itemsToKeep = cart.filter(
      (item) => !itemsToSend.some((sendItem) => sendItem.cartItemId === item.cartItemId),
    )
    
    // N'envoyer les suppléments que s'il y a des plats à envoyer
    const supplementsToSend = itemsToSend.length > 0 ? supplements : []

    console.log("🔍 DEBUG sendOrder:")
    console.log("- Cart total:", cart.length)
    console.log("- Items to send (pending):", cart.filter((item) => item.status === "pending").length)
    console.log("- Items to send (final):", itemsToSend.length)
    console.log("- Items to keep (à suivre):", itemsToKeep.length)
    console.log("- Supplements to send:", supplementsToSend.length)

    if (itemsToSend.length === 0 && supplementsToSend.length === 0) {
      showSendFeedback({
        title: "Rien à envoyer",
        lines: ["Aucun plat en attente pour cette étape."],
        variant: "warning",
      })
      return
    }

    // Préparer TOUS les articles du panier pour que l'API sache lesquels garder
    const allItemsForAPI = cart.map((item) => {
      // Les articles à envoyer deviennent "fired"
      if (itemsToSend.some(sendItem => sendItem.cartItemId === item.cartItemId)) {
        return {
          cartItemId: item.cartItemId,
          menuItemId: getCartItemMenuItemId(item),
          quantity: item.quantity,
          price: getCartItemPrice(item),
          status: "fired", // Les items envoyés deviennent "fired"
          notes: item.notes,
          isComplimentary: item.isComplimentary || false,
          complimentaryReason: item.complimentaryReason,
        }
      }
      // Les articles "à suivre" gardent leur statut
      return {
        cartItemId: item.cartItemId,
        menuItemId: getCartItemMenuItemId(item),
        quantity: item.quantity,
        price: getCartItemPrice(item),
        status: item.status, // Garder le statut "à suivre"
        notes: item.notes,
        isComplimentary: item.isComplimentary || false,
        complimentaryReason: item.complimentaryReason,
      }
    })

    const orderData = {
      tableId,
      serverId: user?.id || "",
      items: allItemsForAPI, // TOUS les articles du panier
      supplements: supplementsToSend.map((sup) => ({
        name: sup.name,
        amount: sup.amount,
        notes: sup.notes,
        isComplimentary: sup.isComplimentary || false,
        complimentaryReason: sup.complimentaryReason,
      })),
      orderId: currentOrder?.id,
    }

    const printSettings = await getConfiguredPrintSettings()
    const dispatchStations = (["kitchen", "bar"] as DispatchStation[]).filter((station) =>
      Boolean(buildStationTicket(station, itemsToSend, itemsToKeep)),
    )
    const escPosStations = dispatchStations.filter(
      (station) => getPrintModeForKind(station, printSettings) === "escpos_tcp",
    )
    const hasEscPosStations = escPosStations.length > 0

    if (hasEscPosStations && !isNativeCapacitorRuntime()) {
      showSendFeedback({
        title: "Mode ESC/POS indisponible",
        lines: [
          "Au moins une station est configuree en ESC/POS TCP (9100).",
          "Ce mode fonctionne uniquement dans l'app native iOS/Android.",
          "Commande non envoyee: impression requise avant envoi.",
        ],
        variant: "error",
      })
      return
    }

    if (!isOnline) {
      if (hasEscPosStations) {
        showSendFeedback({
          title: "Impression requise",
          lines: [
            "Au moins une station ESC/POS est active: impossible d'envoyer hors ligne.",
            "Commande conservee en attente sur la table.",
          ],
          variant: "warning",
        })
        return
      }

      savePendingOrder(orderData)
      setCart(itemsToKeep) // Garder seulement les "à suivre"
      if (supplementsToSend.length > 0) {
        setSupplements([])
      }
      showSendFeedback({
        title: "Mode hors ligne",
        lines: ["Commande enregistrée. Elle sera envoyée dès que la connexion sera rétablie."],
        variant: "info",
      })
      return
    }

    try {
      let printSummary: DispatchPrintSummary = { printedStations: [], failedStations: [] }

      if (hasEscPosStations) {
        printSummary = await printDispatchedTickets(itemsToSend, itemsToKeep)
        const blockingFailures = printSummary.failedStations.filter(({ station }) => escPosStations.includes(station))
        if (blockingFailures.length > 0) {
          showSendFeedback({
            title: "Impression requise",
            lines: [
              "Commande non envoyee: au moins une impression ESC/POS a echoue.",
              ...blockingFailures.map(
                ({ station, message }) => `Impression ${stationLabel(station)} echouee: ${message}`,
              ),
            ],
            variant: "error",
          })
          return
        }
      }

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderData),
      })

      if (response.ok) {
        if (!hasEscPosStations) {
          printSummary = await printDispatchedTickets(itemsToSend, itemsToKeep)
        }

        // On se resynchronise depuis la BDD (source de vérité)
        await fetchOrderData()

        // Vider les suppléments seulement s'ils ont été envoyés
        if (supplementsToSend.length > 0) {
          setSupplements([])
        }

        if (sendPhase) {
          const feedback = buildDispatchFeedback({
            phase: sendPhase,
            sentItems: itemsToSend,
            remainingItems: itemsToKeep,
            supplementsSent: supplementsToSend.length,
          })

          if (printSummary.printedStations.length > 0) {
            const label = printSummary.printedStations
              .map((station) => stationLabel(station))
              .join(", ")
            feedback.lines.push(`Ticket imprimé: ${label}`)
          }

          if (printSummary.failedStations.length > 0) {
            feedback.variant = "warning"
            printSummary.failedStations.forEach(({ station, message }) => {
              const label = stationLabel(station)
              feedback.lines.push(`Impression ${label} échouée: ${message}`)
            })
          }

          showSendFeedback(feedback)
        }

        router.push("/floor-plan")
      } else {
        throw new Error("Failed to create order")
      }
    } catch (error) {
      console.error("[v0] Error sending order:", error)
      if (hasEscPosStations) {
        const message = error instanceof Error ? error.message : "Erreur reseau"
        showSendFeedback({
          title: "Commande non envoyee",
          lines: [
            "Impression ESC/POS requise et envoi impossible pour le moment.",
            message,
            "La commande reste en suspens sur la table.",
          ],
          variant: "error",
        })
        return
      }

      savePendingOrder(orderData)
      
      // Vider le panier même en erreur - la BDD est la source de vérité
      setCart([])
      console.log("[v0] Order saved offline and cart cleared")
      showSendFeedback({
        title: "Erreur réseau",
        lines: ["Commande enregistrée. Elle sera envoyée automatiquement dès le retour réseau."],
        variant: "warning",
      })
    }
  }

  const fireToFollowItems = async () => {
    try {
      let toFollowItems: CartItem[] = []
      let sendPhase: DispatchPhase | null = null
      
      // D'abord essayer d'envoyer les plats normaux (pending)
      toFollowItems = cart.filter((item) => item.status === "pending")
      if (toFollowItems.length > 0) {
        sendPhase = "pending"
      } else {
        // Si pas de plats normaux, envoyer les "À suivre 1"
        toFollowItems = cart.filter((item) => item.status === "to_follow_1")
        if (toFollowItems.length > 0) {
          sendPhase = "to_follow_1"
        } else {
          // Si pas de "À suivre 1", envoyer les "À suivre 2"
          toFollowItems = cart.filter((item) => item.status === "to_follow_2")
          if (toFollowItems.length > 0) {
            sendPhase = "to_follow_2"
          }
        }
      }
      
      if (toFollowItems.length === 0) {
        showSendFeedback({
          title: "Rien à envoyer",
          lines: ["Aucun plat en attente pour cette étape."],
          variant: "warning",
        })
        return
      }

      const remainingItems = cart.filter(
        (item) => !toFollowItems.some((firedItem) => firedItem.cartItemId === item.cartItemId),
      )

      // Utiliser /api/orders (c'est lui qui passe en "fired" + crée les tickets)
      // On envoie tous les items du panier, en marquant uniquement le batch choisi en "fired".
      const allItemsForAPI = cart.map((item) => {
        const shouldFire = toFollowItems.some((f) => f.cartItemId === item.cartItemId)
        return {
          cartItemId: item.cartItemId,
          menuItemId: getCartItemMenuItemId(item),
          quantity: item.quantity,
          price: getCartItemPrice(item),
          status: shouldFire ? "fired" : item.status,
          notes: item.notes,
          isComplimentary: item.isComplimentary || false,
          complimentaryReason: item.complimentaryReason,
        }
      })

      const orderData = {
        tableId,
        serverId: user?.id || "",
        items: allItemsForAPI,
        supplements: [],
        orderId: currentOrder?.id,
      }

      const printSettings = await getConfiguredPrintSettings()
      const dispatchStations = (["kitchen", "bar"] as DispatchStation[]).filter((station) =>
        Boolean(buildStationTicket(station, toFollowItems, remainingItems)),
      )
      const escPosStations = dispatchStations.filter(
        (station) => getPrintModeForKind(station, printSettings) === "escpos_tcp",
      )
      const hasEscPosStations = escPosStations.length > 0

      if (hasEscPosStations && !isNativeCapacitorRuntime()) {
        showSendFeedback({
          title: "Mode ESC/POS indisponible",
          lines: [
            "Au moins une station est configuree en ESC/POS TCP (9100).",
            "Ce mode fonctionne uniquement dans l'app native iOS/Android.",
            "Envoi de la suite bloque.",
          ],
          variant: "error",
        })
        return
      }

      if (!isOnline && hasEscPosStations) {
        showSendFeedback({
          title: "Impression requise",
          lines: [
            "Au moins une station ESC/POS est active: impossible d'envoyer la suite hors ligne.",
            "Les articles restent en attente sur la table.",
          ],
          variant: "warning",
        })
        return
      }

      let printSummary: DispatchPrintSummary = { printedStations: [], failedStations: [] }
      if (hasEscPosStations) {
        printSummary = await printDispatchedTickets(toFollowItems, remainingItems)
        const blockingFailures = printSummary.failedStations.filter(({ station }) => escPosStations.includes(station))
        if (blockingFailures.length > 0) {
          showSendFeedback({
            title: "Impression requise",
            lines: [
              "Envoi de la suite annule: au moins une impression ESC/POS a echoue.",
              ...blockingFailures.map(
                ({ station, message }) => `Impression ${stationLabel(station)} echouee: ${message}`,
              ),
            ],
            variant: "error",
          })
          return
        }
      }

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderData),
      })

      if (response.ok) {
        if (!hasEscPosStations) {
          printSummary = await printDispatchedTickets(toFollowItems, remainingItems)
        }

        await fetchOrderData()
        if (sendPhase) {
          const feedback = buildDispatchFeedback({
            phase: sendPhase,
            sentItems: toFollowItems,
            remainingItems,
          })

          if (printSummary.printedStations.length > 0) {
            const label = printSummary.printedStations
              .map((station) => stationLabel(station))
              .join(", ")
            feedback.lines.push(`Ticket imprimé: ${label}`)
          }

          if (printSummary.failedStations.length > 0) {
            feedback.variant = "warning"
            printSummary.failedStations.forEach(({ station, message }) => {
              const label = stationLabel(station)
              feedback.lines.push(`Impression ${label} échouée: ${message}`)
            })
          }

          showSendFeedback(feedback)
        }

        router.push("/floor-plan")
      } else {
        throw new Error("Failed to fire follow items")
      }
    } catch (error) {
      console.error("[v0] Error firing to follow items:", error)
      const message = error instanceof Error ? error.message : "Erreur reseau"
      showSendFeedback({
        title: "Échec de l'envoi",
        lines: ["Erreur lors de l'envoi des plats.", message],
        variant: "error",
      })
    }
  }

  
  if (isLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  const handleBackClick = async () => {
    // Plus besoin de sauvegarder : tous les articles sont déjà en base
    router.push("/floor-plan")
  }

  const normalizedSearchQuery = normalizeForSearch(menuSearchQuery)
  const hasSearchQuery = normalizedSearchQuery.length > 0
  const selectedCategoryData = categories.find((category) => category.id === selectedCategory) || null
  const selectedCategoryNameNormalized = normalizeForSearch(selectedCategoryData?.name || "")
  const visibleCustomMenuPresets = (Object.entries(CUSTOM_MENU_ITEM_PRESETS) as Array<
    [CustomMenuItemKind, (typeof CUSTOM_MENU_ITEM_PRESETS)[CustomMenuItemKind]]
  >).filter(([, preset]) => {
    const categoryMatches = preset.categoryKeywords.some((keyword) => selectedCategoryNameNormalized.includes(keyword))
    if (!categoryMatches) return false
    if (!hasSearchQuery) return true
    const presetLabel = normalizeForSearch(`${preset.label} ${preset.defaultName}`)
    return presetLabel.includes(normalizedSearchQuery)
  })
  const activeCustomMenuPreset = customMenuItemKind ? CUSTOM_MENU_ITEM_PRESETS[customMenuItemKind] : null
  const filteredItems = menuItems.filter((item) => {
    if (item.status === false) return false
    if (!hasSearchQuery && item.category_id !== selectedCategory) return false
    if (!hasSearchQuery) return true
    return normalizeForSearch(`${item.name} ${item.details || ""}`).includes(normalizedSearchQuery)
  })
  const wineColorOrder: Record<string, number> = {
    white: 0,
    red: 1,
    rose: 2,
  }
  const isWineByGlassCategory =
    selectedCategoryNameNormalized.includes("vin") && selectedCategoryNameNormalized.includes("verre")
  const isWineBottleCategory =
    selectedCategoryNameNormalized.includes("vin") && selectedCategoryNameNormalized.includes("bouteille")
  const shouldKeepWineOrdering = isWineByGlassCategory || isWineBottleCategory
  const displayedItems = shouldKeepWineOrdering
    ? [...filteredItems].sort((a, b) => {
        const rankA = wineColorOrder[(a.button_color || "").toLowerCase()] ?? 99
        const rankB = wineColorOrder[(b.button_color || "").toLowerCase()] ?? 99
        if (rankA !== rankB) return rankA - rankB
        return a.name.localeCompare(b.name, "fr", { sensitivity: "base" })
      })
    : [...filteredItems].sort((a, b) => {
        if (a.price !== b.price) return a.price - b.price
        return a.name.localeCompare(b.name, "fr", { sensitivity: "base" })
      })
  const isAlcoolsCategorySelected = selectedCategoryNameNormalized.includes("alcool")
  const missingSpiritBaseItems = isAlcoolsCategorySelected && !hasSearchQuery
    ? STANDARD_ALCOOL_BASE_ITEMS.filter(
        (baseItem) =>
          !displayedItems.some((menuItem) => matchesSpiritBaseName(menuItem.name || "", baseItem.type)),
      )
    : []
  const cartTotal =
    cart.reduce((sum, item) => sum + (item.isComplimentary ? 0 : getCartItemPrice(item) * item.quantity), 0) +
    supplements.reduce((sum, sup) => sum + (sup.isComplimentary ? 0 : sup.amount), 0) +
    existingItems.reduce((sum, item) => sum + (item.is_complimentary ? 0 : item.price * item.quantity), 0)
  const toFollowCount = cart.filter((item) => item.status === "to_follow_1" || item.status === "to_follow_2").length

  const canAccessBill = user?.role === "manager" || Boolean(user?.can_access_bill)

  // Vérifier s'il reste des plats non envoyés avant d'aller à l'addition
  const handleBillClick = () => {
    if (!canAccessBill) {
      alert("Vous n'avez pas l'autorisation d'accéder à l'addition.")
      return
    }

    const unprocessedItems = cart.filter(item => 
      item.status === "pending" || item.status === "to_follow_1" || item.status === "to_follow_2"
    )
    
    if (unprocessedItems.length > 0) {
      if (confirm(`⚠️ Attention !\n\nIl reste ${unprocessedItems.length} plat${unprocessedItems.length > 1 ? 's' : ''} non envoyé${unprocessedItems.length > 1 ? 's' : ''}.\n\nVoulez-vous continuer quand même vers l'addition ?`)) {
        router.push(`/bill/${tableId}`)
      }
    } else {
      router.push(`/bill/${tableId}`)
    }
  }

  const handleSetTableAvailable = async () => {
    try {
      const res = await fetch("/api/orders/close-empty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err?.error || "Impossible de libérer la table")
        return
      }
      router.push("/floor-plan")
    } catch (error) {
      alert("Erreur lors de la libération de la table")
    }
  }

  const getSendFeedbackTheme = (variant: SendFeedbackVariant) => {
    switch (variant) {
      case "success":
        return {
          container: "bg-emerald-900/95 border-emerald-500/60 text-emerald-50",
          icon: CheckCircle2,
          iconClass: "text-emerald-300",
        }
      case "warning":
        return {
          container: "bg-amber-900/95 border-amber-500/60 text-amber-50",
          icon: AlertTriangle,
          iconClass: "text-amber-300",
        }
      case "error":
        return {
          container: "bg-red-900/95 border-red-500/60 text-red-50",
          icon: XCircle,
          iconClass: "text-red-300",
        }
      default:
        return {
          container: "bg-blue-900/95 border-blue-500/60 text-blue-50",
          icon: Info,
          iconClass: "text-blue-300",
        }
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 p-2 sm:p-4">
      <OfflineIndicator />
      {sendFeedback && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[120] w-[calc(100%-1rem)] sm:w-[28rem] animate-in fade-in-0 slide-in-from-top-2 duration-300">
          {(() => {
            const theme = getSendFeedbackTheme(sendFeedback.variant)
            const Icon = theme.icon
            return (
              <div className={`rounded-xl border shadow-2xl backdrop-blur px-4 py-3 ${theme.container}`}>
                <div className="flex items-start gap-3">
                  <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${theme.iconClass}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm sm:text-base font-semibold">{sendFeedback.title}</p>
                    {sendFeedback.lines.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {sendFeedback.lines.map((line, index) => (
                          <p key={`${line}-${index}`} className="text-xs sm:text-sm opacity-95">
                            {line}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSendFeedback(null)}
                    className="text-white/80 hover:text-white text-sm leading-none px-1"
                    aria-label="Fermer"
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Header */}
      <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
        <Button
          onClick={handleBackClick}
          variant="outline"
          size="sm"
          className="bg-slate-800 text-white border-slate-700"
        >
          <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          <span className="text-xs sm:text-sm">Retour</span>
        </Button>
        <div className="text-center flex-1">
          <h1 className="text-lg sm:text-2xl font-bold text-white">Table {table?.table_number}</h1>
          <div className="flex items-center justify-center gap-2">
            <div className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800/80 px-1 py-1">
              <button
                type="button"
                onClick={() => { void handleCoversQuickAdjust(-1) }}
                disabled={coversUpdating || getActiveCoversCount() <= 1}
                className="h-7 w-7 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Retirer un couvert"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCoversDialogOpen(true)}
                className="px-2 text-xs sm:text-sm text-slate-300 hover:text-white transition-colors underline-offset-2 hover:underline whitespace-nowrap"
                aria-label="Modifier le nombre de couverts"
              >
                {hasSavedCovers ? `${getActiveCoversCount()} couverts` : `${table?.seats} places`}
              </button>
              <button
                type="button"
                onClick={() => { void handleCoversQuickAdjust(1) }}
                disabled={coversUpdating || getActiveCoversCount() >= 30}
                className="h-7 w-7 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Ajouter un couvert"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {elapsedTime && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-300 border border-blue-500/30">
                <Clock className="h-3 w-3" />
                {elapsedTime}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentOrder?.id && (
            <Button
              onClick={openTransferDialog}
              variant="outline"
              size="sm"
              disabled={cart.length === 0 && existingItems.length === 0 && supplements.length === 0}
              className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700 disabled:opacity-60"
            >
              <span className="text-xs sm:text-sm">Changer la table</span>
            </Button>
          )}
          {!loading &&
            currentOrder?.id &&
            table?.status === "occupied" &&
            cart.length === 0 &&
            existingItems.length === 0 &&
            supplements.length === 0 && (
              <Button
                onClick={handleSetTableAvailable}
                variant="outline"
                size="sm"
                className="bg-amber-600 text-white border-amber-700 hover:bg-amber-700"
              >
                <span className="text-xs sm:text-sm">Remettre la table disponible</span>
              </Button>
            )}
          {canAccessBill && (
            <Button
              onClick={handleBillClick}
              variant="outline"
              size="sm"
              className="bg-blue-600 text-white border-blue-700 hover:bg-blue-700"
              disabled={!currentOrder || existingItems.length === 0}
            >
              <span className="text-xs sm:text-sm">Addition</span>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        {/* Menu Section */}
        <div className="lg:col-span-8">
          {/* Categories + Allergen toggle */}
          <div className="mb-3 sm:mb-4 flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-2">
            <Button
              onClick={() => setShowAllergens(!showAllergens)}
              size="sm"
              variant={showAllergens ? "default" : "outline"}
              className={
                showAllergens
                  ? "bg-amber-600 text-white hover:bg-amber-700 whitespace-nowrap text-xs sm:text-sm flex-shrink-0"
                  : "bg-slate-800 text-amber-400 border-amber-600/50 hover:bg-amber-900/30 whitespace-nowrap text-xs sm:text-sm flex-shrink-0"
              }
            >
              <ShieldAlert className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              Allergènes
            </Button>
            <div className="relative min-w-[180px] sm:min-w-[260px] flex-shrink-0">
              <Search className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                type="search"
                value={menuSearchQuery}
                onChange={(e) => setMenuSearchQuery(e.target.value)}
                placeholder="Rechercher un élément..."
                className="h-8 sm:h-9 pl-8 sm:pl-9 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-xs sm:text-sm"
              />
            </div>
            <div className="w-px bg-slate-700 flex-shrink-0" />
          </div>
          <div className="mb-3 sm:mb-4 flex gap-1.5 sm:gap-2 overflow-x-auto pb-2">
            {categories.map((category) => (
              <Button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                size="sm"
                variant={selectedCategory === category.id ? "default" : "outline"}
                className={
                  selectedCategory === category.id
                    ? "bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap text-xs sm:text-sm"
                    : "bg-slate-800 text-white border-slate-700 hover:bg-slate-750 whitespace-nowrap text-xs sm:text-sm"
                }
              >
                {category.name}
              </Button>
            ))}
          </div>

          {/* Menu Items Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
            {displayedItems.length === 0 && visibleCustomMenuPresets.length === 0 ? (
              <Card className="col-span-2 sm:col-span-3 p-6 sm:p-8 bg-slate-800 border-slate-700 text-center">
                <p className="text-slate-300 text-sm sm:text-base">Aucun élément trouvé</p>
                {hasSearchQuery && (
                  <p className="text-slate-500 text-xs sm:text-sm mt-1">
                    Essaie un autre mot-clé ou vide la recherche.
                  </p>
                )}
              </Card>
            ) : (
              <>
                {visibleCustomMenuPresets.map(([kind, preset]) => (
                  <Card
                    key={`custom-${kind}`}
                    className="p-3 sm:p-4 bg-indigo-900/25 border-2 border-indigo-700/70 hover:bg-indigo-900/40 cursor-pointer transition-colors"
                    onClick={() => openCustomMenuItemDialog(kind)}
                  >
                    <div className="text-center">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 mb-1">Divers</div>
                      <div className="font-semibold text-sm sm:text-base text-white mb-1">{preset.label}</div>
                      <div className="text-xs sm:text-sm text-indigo-200">TVA {preset.taxRate}%</div>
                    </div>
                  </Card>
                ))}

                {missingSpiritBaseItems.map((baseItem) => (
                  <Card
                    key={`spirit-missing-${baseItem.type}`}
                    className="p-3 sm:p-4 bg-cyan-900/20 border-2 border-cyan-700/70 hover:bg-cyan-900/35 cursor-pointer transition-colors"
                    onClick={() => {
                      void ensureSpiritBaseItemAndOpenDialog(baseItem.type)
                    }}
                  >
                    <div className="text-center">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 mb-1">Alcools</div>
                      <div className="font-semibold text-sm sm:text-base text-white mb-1">{baseItem.name}</div>
                      <div className="text-xs sm:text-sm text-cyan-200">à partir de {baseItem.basePrice.toFixed(2)} €</div>
                    </div>
                  </Card>
                ))}

                {displayedItems.map((item) => {
              const cartItem = cart.find((c) => getCartItemMenuItemId(c) === item.id && c.status === "pending")
              const quantity = cartItem?.quantity || 0
              const isOutOfStock = item.out_of_stock
              const colorClasses = !isOutOfStock ? getMenuButtonColorClasses(item.button_color) : ""
              const itemDetails = isRhumArrangeItem(item.name) ? "" : item.details?.trim()
              const spiritConfig = getSpiritSelectionConfig(item)
              const itemCardPrice = spiritConfig ? Math.min(...spiritConfig.options.map((option) => option.price)) : item.price

              return (
                <Card
                  key={item.id}
                  className={`p-3 sm:p-4 transition-colors ${
                    isOutOfStock
                      ? "bg-red-900/30 border-2 border-red-700 opacity-60 cursor-not-allowed"
                      : item.is_piatto_del_giorno
                        ? `cursor-pointer border-2 border-amber-500/70 ring-1 ring-amber-500/30 ${colorClasses || "bg-slate-800 hover:bg-slate-750"}`
                        : `cursor-pointer ${colorClasses || "bg-slate-800 border-slate-700 hover:bg-slate-750"}`
                  }`}
                  onClick={() => !isOutOfStock && handleMenuItemClick(item)}
                >
                  <div className="text-center">
                    {item.is_piatto_del_giorno && (
                      <div className="text-amber-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">⭐ Suggestion</div>
                    )}
                    <div className="font-semibold text-sm sm:text-base mb-1 truncate text-white">
                      {item.name}
                    </div>
                    {itemDetails && (
                      <div
                        className="text-[10px] sm:text-xs leading-snug mb-1.5 text-slate-300"
                        title={itemDetails}
                      >
                        {itemDetails}
                      </div>
                    )}
                    <div className="text-xs sm:text-sm mb-2 text-slate-400">
                      {itemCardPrice.toFixed(2)} €
                    </div>
                    {isOutOfStock ? (
                      <div className="flex items-center justify-center gap-1 text-red-400">
                        <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4" />
                        <span className="text-xs sm:text-sm font-medium">Rupture</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        {quantity > 0 && (
                          <Badge className="bg-blue-600 text-xs mb-1">
                            {quantity}
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-slate-700 hover:bg-slate-600 border-slate-600 text-white h-6 w-6 sm:h-7 sm:w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleMenuItemClick(item)
                          }}
                        >
                          <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
                        </Button>
                      </div>
                    )}
                    {/* Allergen badges */}
                    {showAllergens && allergenMap[item.id] && allergenMap[item.id].length > 0 && (
                      <div className="flex flex-wrap justify-center gap-0.5 mt-1.5 pt-1.5 border-t border-slate-600/50">
                        {allergenMap[item.id].map((a) => (
                          <span
                            key={a.id}
                            className="text-[10px] leading-tight"
                            title={a.name}
                          >
                            {a.emoji}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              )
                })}
              </>
            )}
          </div>
        </div>

        {/* Cart Section */}
        <div className="lg:col-span-4">
          <Card className="bg-slate-800 border-slate-700 p-3 sm:p-4 lg:sticky lg:top-4">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 sm:mb-4">Commande en cours</h2>

            {/* To Follow Alert */}
            {toFollowCount > 0 && (
              <div className="mb-3 sm:mb-4 p-2 sm:p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-yellow-400">
                    <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span className="text-xs sm:text-sm font-medium">{toFollowCount} plat(s) à suivre</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={fireToFollowItems}
                    className="bg-yellow-600 hover:bg-yellow-700 text-white text-xs"
                  >
                    Envoyer la suite
                  </Button>
                </div>
              </div>
            )}

            {/* Existing Items */}
            {existingItems.length > 0 && (
              <div className="mb-3 sm:mb-4">
                <h3 className="text-xs sm:text-sm font-semibold text-slate-400 mb-2">Déjà commandé</h3>
                <div className="space-y-2 max-h-32 sm:max-h-40 overflow-y-auto">
                  {existingItems.map((item) => {
                    const isSwiped = swipedExistingItemId === item.id
                    const baseItemName = menuItems.find((m) => m.id === item.menu_item_id)?.name || "Article"
                    const { displayName } = getItemDisplayInfo(baseItemName, item.notes)
                    return (
                      <div key={item.id} className="group relative overflow-hidden rounded">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            removeExistingItem(item)
                          }}
                          className={`absolute inset-y-0 right-0 w-20 bg-red-600 hover:bg-red-700 text-white flex flex-col items-center justify-center transition-opacity duration-150 ${
                            isSwiped
                              ? "opacity-100 pointer-events-auto"
                              : "opacity-0 pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto"
                          }`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="text-[10px] leading-tight mt-0.5">Suppr.</span>
                        </button>

                        <div
                          onClick={() => {
                            if (isSwiped) setSwipedExistingItemId(null)
                          }}
                          onTouchStart={(event) => handleExistingItemTouchStart(item.id, event)}
                          onTouchEnd={(event) => handleExistingItemTouchEnd(item.id, event)}
                          className={`relative z-10 flex items-center justify-between text-xs sm:text-sm text-slate-300 bg-slate-900/50 p-2 transition-transform duration-200 ${isSwiped ? "-translate-x-20" : "translate-x-0"}`}
                        >
                          <span>
                            {item.quantity}x {displayName}
                          </span>
                          <Badge variant="default" className="text-xs">
                            {item.status === "fired" ? "Envoyé" : 
                             item.status === "completed" ? "Terminé" : 
                             item.status === "to_follow_1" ? "À suivre 1" :
                             item.status === "to_follow_2" ? "À suivre 2" :
                             "En attente"}
                          </Badge>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Cart Items */}
            <div className="space-y-1.5 sm:space-y-2 mb-3 sm:mb-4 max-h-[55vh] sm:max-h-[60vh] overflow-y-auto">
              {cart.length === 0 && supplements.length === 0 ? (
                <p className="text-center text-slate-500 py-6 sm:py-8 text-sm">Panier vide</p>
              ) : (
                <>
                  {cart.map((item, index) => {
                    const { displayName, displayNote } = getItemDisplayInfo(item.menuItem?.name || "Article inconnu", item.notes)
                    return (
                    <div
                      key={`${item.id}-${index}`}
                      className={`px-2 py-1.5 sm:p-2.5 rounded-lg ${item.isComplimentary ? "bg-green-900/20 border-2 border-green-700" : "bg-slate-900"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className="font-medium text-white text-xs sm:text-sm truncate">
                              {displayName}
                            </h4>
                            {item.isComplimentary && (
                              <Badge className="bg-green-600 text-[10px] px-1 py-0 leading-tight flex items-center gap-0.5">
                                <Gift className="h-2.5 w-2.5" />
                                Offert
                              </Badge>
                            )}
                            <span
                              className={`text-xs ${item.isComplimentary ? "line-through text-slate-500" : "text-slate-400"}`}
                            >
                              {getCartItemPrice(item).toFixed(2)} €
                            </span>
                          </div>
                          {item.isComplimentary && item.complimentaryReason && (
                            <p className="text-[10px] text-green-400 italic">{item.complimentaryReason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeFromCart(item.cartItemId)}
                            className="h-6 w-6 sm:h-7 sm:w-7 p-0 bg-slate-800 border-slate-700 text-white"
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="text-white font-semibold w-5 text-center text-xs sm:text-sm">
                            {item.quantity}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => item.menuItem && addToCart(item.menuItem, item)}
                            className="h-6 w-6 sm:h-7 sm:w-7 p-0 bg-slate-800 border-slate-700 text-white"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        <Button
                          size="sm"
                          variant={item.status === "to_follow_1" || item.status === "to_follow_2" ? "default" : "outline"}
                          onClick={() => toggleToFollow(item.cartItemId)}
                          className={`h-5 sm:h-6 px-1.5 sm:px-2 text-[10px] sm:text-xs ${
                            item.status === "to_follow_1" || item.status === "to_follow_2"
                              ? "bg-yellow-600 hover:bg-yellow-700 text-white"
                              : "bg-slate-800 border-slate-700 text-white"
                          }`}
                        >
                          <Clock className="h-2.5 w-2.5 mr-0.5" />
                          {item.status === "to_follow_1" ? "Suivre 1" : item.status === "to_follow_2" ? "Suivre 2" : "À suivre"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openNotesDialog(item.cartItemId)}
                          className="h-5 sm:h-6 px-1.5 sm:px-2 bg-slate-800 border-slate-700 text-white text-[10px] sm:text-xs"
                        >
                          Notes
                        </Button>
                        <Button
                          size="sm"
                          variant={item.isComplimentary ? "default" : "outline"}
                          onClick={() => toggleComplimentary(item.cartItemId, "cart")}
                          className={`h-5 sm:h-6 px-1.5 sm:px-2 text-[10px] sm:text-xs ${
                            item.isComplimentary
                              ? "bg-green-600 hover:bg-green-700 text-white"
                              : "bg-slate-800 border-slate-700 text-white"
                          }`}
                        >
                          <Gift className="h-2.5 w-2.5 mr-0.5" />
                          Offert
                        </Button>
                      </div>
                      {displayNote && <p className="text-[10px] text-slate-400 mt-0.5 italic">{displayNote}</p>}
                    </div>
                    )
                  })}

                  {/* Supplements */}
                  {supplements.map((supplement) => (
                    <div
                      key={supplement.id}
                      className={`px-2 py-1.5 sm:p-2.5 rounded-lg ${supplement.isComplimentary ? "bg-green-900/20 border-2 border-green-700" : "bg-purple-900/20 border border-purple-700"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3 text-purple-400 flex-shrink-0" />
                            <h4 className="font-medium text-white text-xs sm:text-sm truncate">{supplement.name}</h4>
                            {supplement.isComplimentary && (
                              <Badge className="bg-green-600 text-[10px] px-1 py-0 leading-tight flex items-center gap-0.5">
                                <Gift className="h-2.5 w-2.5" />
                                Offert
                              </Badge>
                            )}
                            <span
                              className={`text-xs ${supplement.isComplimentary ? "line-through text-slate-500" : "text-purple-400"}`}
                            >
                              {supplement.amount.toFixed(2)} €
                            </span>
                          </div>
                          {supplement.notes && <p className="text-[10px] text-slate-400 italic">{supplement.notes}</p>}
                          {supplement.isComplimentary && supplement.complimentaryReason && (
                            <p className="text-[10px] text-green-400 italic">{supplement.complimentaryReason}</p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => removeSupplement(supplement.id)}
                          className="h-6 w-6 sm:h-7 sm:w-7 p-0 bg-slate-800 border-slate-700 text-white ml-2 flex-shrink-0"
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex gap-1 mt-1">
                        <Button
                          size="sm"
                          variant={supplement.isComplimentary ? "default" : "outline"}
                          onClick={() => toggleComplimentary(supplement.id, "supplement")}
                          className={`h-5 sm:h-6 px-1.5 sm:px-2 text-[10px] sm:text-xs ${
                            supplement.isComplimentary
                              ? "bg-green-600 hover:bg-green-700 text-white"
                              : "bg-slate-800 border-slate-700 text-white"
                          }`}
                        >
                          <Gift className="h-2.5 w-2.5 mr-0.5" />
                          Offert
                        </Button>
                        <Badge className="bg-purple-600 text-[10px] px-1.5 py-0">Non imprimé</Badge>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Supplement Button */}
            <Button
              onClick={openSupplementDialog}
              variant="outline"
              size="sm"
              className="w-full mb-3 sm:mb-4 bg-purple-900/30 border-purple-700 text-purple-300 hover:bg-purple-900/50 text-xs sm:text-sm"
            >
              <DollarSign className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Ajouter un supplément
            </Button>

            {/* Total */}
            <div className="border-t border-slate-700 pt-3 sm:pt-4 mb-3 sm:mb-4">
              <div className="flex justify-between items-center text-white">
                <span className="text-base sm:text-lg font-semibold">Total</span>
                <span className="text-xl sm:text-2xl font-bold text-blue-400">{cartTotal.toFixed(2)} €</span>
              </div>
              {/* Afficher le détail du total si des plats sont en attente */}
              {(cart.length > 0 || existingItems.length > 0) && (
                <div className="mt-2 text-xs text-slate-400">
                  {existingItems.length > 0 && (
                    <div>Déjà commandé: {existingItems.reduce((sum, item) => sum + (item.is_complimentary ? 0 : item.price * item.quantity), 0).toFixed(2)} €</div>
                  )}
                  {cart.length > 0 && (
                    <div>Plats en attente: {cart.reduce((sum, item) => sum + (item.isComplimentary ? 0 : getCartItemPrice(item) * item.quantity), 0).toFixed(2)} €</div>
                  )}
                  {supplements.length > 0 && (
                    <div>Suppléments: {supplements.reduce((sum, sup) => sum + (sup.isComplimentary ? 0 : sup.amount), 0).toFixed(2)} €</div>
                  )}
                </div>
              )}
            </div>

            {/* Send Button */}
            <Button
              onClick={sendOrder}
              disabled={cart.length === 0 && supplements.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-base sm:text-lg py-5 sm:py-6"
            >
              <Send className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
              Envoyer la commande
            </Button>
          </Card>
        </div>
      </div>

      {/* Custom Menu Item Dialog */}
      <Dialog
        open={customMenuItemDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeCustomMenuItemDialog()
        }}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{activeCustomMenuPreset?.label || "Article divers"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-2.5 bg-slate-900 border border-slate-700 rounded">
              <p className="text-xs text-slate-400">
                TVA appliquée : <span className="text-white font-semibold">{activeCustomMenuPreset?.taxRate ?? 10}%</span>
              </p>
            </div>
            <div>
              <Label htmlFor="custom-item-name" className="text-slate-300">
                Intitulé
              </Label>
              <Input
                id="custom-item-name"
                value={customMenuItemForm.name}
                onChange={(e) => setCustomMenuItemForm({ ...customMenuItemForm, name: e.target.value })}
                placeholder="Ex: Cocktail du patron"
                className="mt-2 bg-slate-900 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label htmlFor="custom-item-price" className="text-slate-300">
                Prix (€)
              </Label>
              <Input
                id="custom-item-price"
                type="number"
                step="0.5"
                min="0"
                value={customMenuItemForm.price}
                onChange={(e) => setCustomMenuItemForm({ ...customMenuItemForm, price: e.target.value })}
                placeholder="0.00"
                className="mt-2 bg-slate-900 border-slate-700 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCustomMenuItemDialog} className="bg-slate-700 border-slate-600">
              Annuler
            </Button>
            <Button onClick={addCustomMenuItem} disabled={customMenuItemSaving} className="bg-indigo-600 hover:bg-indigo-700">
              {customMenuItemSaving ? "Ajout..." : "Ajouter à la commande"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes Dialog */}
      <Dialog open={notesDialog.open} onOpenChange={(open) => setNotesDialog({ open, itemId: null })}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Ajouter des notes</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="notes" className="text-slate-300">
              Notes pour la cuisine
            </Label>
            <Textarea
              id="notes"
              value={tempNotes}
              onChange={(e) => setTempNotes(e.target.value)}
              placeholder="Ex: Sans oignons, bien cuit..."
              className="mt-2 bg-slate-900 border-slate-700 text-white"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNotesDialog({ open: false, itemId: null })}
              className="bg-slate-700 border-slate-600"
            >
              Annuler
            </Button>
            <Button onClick={saveNotes} className="bg-blue-600 hover:bg-blue-700">
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Menu Enfant Dialog */}
      <Dialog open={menuEnfantDialogOpen} onOpenChange={setMenuEnfantDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Menu enfant</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div>
              <Label className="text-slate-300">Choix du plat (obligatoire)</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {menuEnfantOptions.map((option) => (
                  <Button
                    key={option}
                    variant={menuEnfantChoice === option ? "default" : "outline"}
                    onClick={() => setMenuEnfantChoice(option)}
                    className={
                      menuEnfantChoice === option
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "bg-slate-700 border-slate-600 hover:bg-slate-600"
                    }
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-slate-300">Sirop à l'eau (optionnel)</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {siropOptions.map((option) => (
                  <Button
                    key={option}
                    variant={siropChoice === option ? "default" : "outline"}
                    onClick={() => setSiropChoice(option)}
                    className={
                      siropChoice === option
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-slate-700 border-slate-600 hover:bg-slate-600"
                    }
                  >
                    {option}
                  </Button>
                ))}
              </div>
              <div className="mt-2">
                <Button
                  variant="ghost"
                  onClick={() => setSiropChoice("")}
                  className="text-slate-300 hover:text-white hover:bg-slate-700"
                >
                  Ignorer le sirop
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMenuEnfantDialogOpen(false)}
              className="bg-slate-700 border-slate-600"
            >
              Annuler
            </Button>
            <Button
              onClick={handleMenuEnfantConfirm}
              disabled={!menuEnfantChoice}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cuisson Dialog */}
      <Dialog open={cuissonDialogOpen} onOpenChange={setCuissonDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>🔥 Cuisson — {cuissonItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-3">
            {cuissonOptions.map((cuisson) => (
              <Button
                key={cuisson}
                onClick={() => handleCuissonSelect(cuisson)}
                className="h-14 text-base font-semibold bg-slate-700 border border-slate-600 hover:bg-orange-600 hover:border-orange-500 transition-colors"
              >
                {cuisson}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCuissonDialogOpen(false); setCuissonItem(null) }}
              className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
            >
              Annuler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Jus Artisanal Bio Dialog */}
      <Dialog open={jusFruitDialogOpen} onOpenChange={setJusFruitDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>🍹 Choix du fruit — {jusFruitItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-3">
            {jusFruitOptions.map((fruit) => (
              <Button
                key={fruit}
                onClick={() => handleJusFruitSelect(fruit)}
                className="h-14 text-base font-semibold bg-slate-700 border border-slate-600 hover:bg-emerald-600 hover:border-emerald-500 transition-colors"
              >
                {fruit}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setJusFruitDialogOpen(false); setJusFruitItem(null) }}
              className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
            >
              Annuler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rhum Arrangé Dialog */}
      <Dialog
        open={rhumArrangeDialogOpen}
        onOpenChange={(open) => {
          setRhumArrangeDialogOpen(open)
          if (!open) {
            setRhumArrangeItem(null)
            setRhumArrangeOptions([])
          }
        }}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>🥃 Choix du goût — {rhumArrangeItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-3">
            {rhumArrangeOptions.map((option) => (
              <Button
                key={option}
                onClick={() => handleRhumArrangeSelect(option)}
                className="h-14 text-base font-semibold bg-slate-700 border border-slate-600 hover:bg-amber-600 hover:border-amber-500 transition-colors"
              >
                {option}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRhumArrangeDialogOpen(false)
                setRhumArrangeItem(null)
                setRhumArrangeOptions([])
              }}
              className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
            >
              Annuler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kir Dialog */}
      <Dialog
        open={kirDialogOpen}
        onOpenChange={(open) => {
          setKirDialogOpen(open)
          if (!open) {
            setKirItem(null)
            setKirOptions([])
          }
        }}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>🍷 Choix du goût — {kirItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-3">
            {kirOptions.map((option) => (
              <Button
                key={option}
                onClick={() => handleKirSelect(option)}
                className="h-14 text-base font-semibold bg-slate-700 border border-slate-600 hover:bg-rose-600 hover:border-rose-500 transition-colors"
              >
                {option}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setKirDialogOpen(false)
                setKirItem(null)
                setKirOptions([])
              }}
              className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
            >
              Annuler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Spirit Selection Dialog */}
      <Dialog
        open={spiritDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setSpiritDialogOpen(true)
            return
          }
          closeSpiritDialog()
        }}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{spiritDialogConfig?.title || "Choix de la marque"} — {spiritDialogItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-3">
            {(spiritDialogConfig?.options || []).map((option) => (
              <Button
                key={option.name}
                onClick={() => handleSpiritSelect(option)}
                className="h-12 text-base font-semibold bg-slate-700 border border-slate-600 hover:bg-sky-600 hover:border-sky-500 transition-colors justify-between px-4"
              >
                <span>{option.name}</span>
                <span className="text-sm text-slate-200">{option.price.toFixed(2)}€</span>
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeSpiritDialog}
              className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
            >
              Annuler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Couverts Dialog */}
      <Dialog open={coversDialogOpen} onOpenChange={setCoversDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>👥 Nombre de couverts</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-3 py-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
              <Button
                key={n}
                onClick={() => handleCoversConfirm(n)}
                className={`h-14 text-lg font-bold transition-colors ${
                  coversCount === n
                    ? "bg-blue-600 border-blue-500 hover:bg-blue-700"
                    : "bg-slate-700 border border-slate-600 hover:bg-blue-600 hover:border-blue-500"
                }`}
              >
                {n}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCoversDialogOpen(false)}
              className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
            >
              {hasSavedCovers ? "Fermer" : "Passer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vin Bouteille Dialog */}
      <Dialog open={vinBouteilleDialogOpen} onOpenChange={setVinBouteilleDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>🍷 {vinBouteilleItem?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-400 -mt-2">Combien de verres à apporter ?</p>
          <div className="grid grid-cols-4 gap-3 py-2">
            {verresOptions.map((n) => (
              <Button
                key={n}
                onClick={() => handleVinBouteilleSelect(n)}
                className="h-14 text-lg font-bold bg-slate-700 border border-slate-600 hover:bg-purple-600 hover:border-purple-500 transition-colors"
              >
                {n}
              </Button>
            ))}
          </div>
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => { setVinBouteilleDialogOpen(false); setVinBouteilleItem(null) }}
              className="bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                if (vinBouteilleItem) {
                  addItemsToOrder([{ menuItem: vinBouteilleItem }])
                  setHasOrderedWineBottle(true)
                }
                setVinBouteilleDialogOpen(false)
                setVinBouteilleItem(null)
              }}
              className="bg-purple-600 hover:bg-purple-700"
            >
              Sans préciser
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supplement Dialog */}
      <Dialog open={supplementDialog} onOpenChange={setSupplementDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter un supplément</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="supplement-name" className="text-slate-300">
                Nom du supplément
              </Label>
              <Input
                id="supplement-name"
                value={supplementForm.name}
                onChange={(e) => setSupplementForm({ ...supplementForm, name: e.target.value })}
                placeholder="Ex: Pourboire, Frais de service..."
                className="mt-2 bg-slate-900 border-slate-700 text-white"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="supplement-complimentary"
                checked={supplementForm.isComplimentary}
                onCheckedChange={(checked) =>
                  setSupplementForm({ ...supplementForm, isComplimentary: checked as boolean })
                }
              />
              <Label htmlFor="supplement-complimentary" className="text-slate-300 cursor-pointer">
                Article offert (gratuit)
              </Label>
            </div>
            {!supplementForm.isComplimentary && (
              <div>
                <Label htmlFor="supplement-amount" className="text-slate-300">
                  Montant (€)
                </Label>
                <Input
                  id="supplement-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={supplementForm.amount}
                  onChange={(e) => setSupplementForm({ ...supplementForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="mt-2 bg-slate-900 border-slate-700 text-white"
                />
              </div>
            )}
            {supplementForm.isComplimentary && (
              <div>
                <Label htmlFor="supplement-reason" className="text-slate-300">
                  Raison (optionnel)
                </Label>
                <Input
                  id="supplement-reason"
                  value={supplementForm.complimentaryReason}
                  onChange={(e) => setSupplementForm({ ...supplementForm, complimentaryReason: e.target.value })}
                  placeholder="Ex: Geste commercial, Erreur..."
                  className="mt-2 bg-slate-900 border-slate-700 text-white"
                />
              </div>
            )}
            <div>
              <Label htmlFor="supplement-notes" className="text-slate-300">
                Notes (optionnel)
              </Label>
              <Textarea
                id="supplement-notes"
                value={supplementForm.notes}
                onChange={(e) => setSupplementForm({ ...supplementForm, notes: e.target.value })}
                placeholder="Notes internes..."
                className="mt-2 bg-slate-900 border-slate-700 text-white"
                rows={3}
              />
            </div>
            <div className="p-3 bg-purple-900/20 border border-purple-700 rounded">
              <p className="text-sm text-purple-300">
                Ce supplément sera ajouté au total de la commande mais ne sera pas imprimé sur le ticket de caisse.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSupplementDialog(false)
                setSupplementForm(getDefaultSupplementForm())
              }}
              className="bg-slate-700 border-slate-600"
            >
              Annuler
            </Button>
            <Button onClick={addSupplement} className="bg-purple-600 hover:bg-purple-700">
              Ajouter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complimentary Dialog */}
      <Dialog
        open={complimentaryDialog.open}
        onOpenChange={(open) => setComplimentaryDialog({ open, itemId: null, type: "cart" })}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Marquer comme offert</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="complimentary-reason" className="text-slate-300">
              Raison (optionnel mais recommandé)
            </Label>
            <Input
              id="complimentary-reason"
              value={complimentaryReason}
              onChange={(e) => setComplimentaryReason(e.target.value)}
              placeholder="Ex: Geste commercial, Erreur de commande, Client régulier..."
              className="mt-2 bg-slate-900 border-slate-700 text-white"
            />
            <p className="text-xs text-slate-400 mt-2">
              Les articles offerts seront enregistrés et visibles dans le récapitulatif admin.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setComplimentaryDialog({ open: false, itemId: null, type: "cart" })
                setComplimentaryReason("")
              }}
              className="bg-slate-700 border-slate-600"
            >
              Annuler
            </Button>
            <Button onClick={saveComplimentary} className="bg-green-600 hover:bg-green-700">
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Table Dialog */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Changer la table</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {transferLoading ? (
              <p className="text-sm text-slate-300">Chargement des tables disponibles...</p>
            ) : transferError ? (
              <p className="text-sm text-red-300">{transferError}</p>
            ) : transferTables.length === 0 ? (
              <p className="text-sm text-slate-300">Aucune table disponible.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {transferTables.map((t) => (
                  <Button
                    key={t.id}
                    variant="outline"
                    onClick={() => transferOrderToTable(t.id)}
                    className="w-full justify-between bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
                  >
                    <span>Table {t.table_number}</span>
                    <span className="text-xs text-slate-300">{t.seats} places</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransferDialogOpen(false)}
              className="bg-slate-700 border-slate-600"
            >
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
