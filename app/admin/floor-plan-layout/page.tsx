"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, GripVertical, Plus, Trash2, Square, Type, MousePointer, Save, Users, LayoutGrid, Copy } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/use-toast"
import type { Table } from "@/lib/types"
import { sortTablesForDisplay } from "@/lib/table-sort"
import type {
  VisualFloorPlan,
  VisualFloorPlanItem,
  UserFloorPlanAssignments,
} from "@/lib/floor-plan-layouts"

// ─── Helpers ───

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const snap = (v: number, step = 1) => Math.round(v / step) * step

const DECO_COLORS = [
  { value: "#64748b", label: "Gris" },
  { value: "#0ea5e9", label: "Bleu" },
  { value: "#22c55e", label: "Vert" },
  { value: "#eab308", label: "Jaune" },
  { value: "#ef4444", label: "Rouge" },
  { value: "#a855f7", label: "Violet" },
  { value: "#f97316", label: "Orange" },
  { value: "#78716c", label: "Brun" },
]

const TABLE_DEFAULT_W = 5
const TABLE_DEFAULT_H = 7
const DECO_DEFAULT_W = 15
const DECO_DEFAULT_H = 5

// ─── Types for drag state ───

type DragState = {
  itemId: string
  offsetX: number
  offsetY: number
  // For multi-move: offsets of ALL selected items relative to pointer
  multiOffsets?: { id: string; ox: number; oy: number }[]
  type: "move"
} | {
  itemId: string
  startX: number
  startY: number
  startW: number
  startH: number
  type: "resize"
} | null

type LassoState = {
  startX: number
  startY: number
  currentX: number
  currentY: number
} | null

// ─── Main component ───

export default function FloorPlanLayoutAdminPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  // Data state
  const [tables, setTables] = useState<Table[]>([])
  const [users, setUsers] = useState<{ id: string; name: string; role: string; disabled?: boolean }[]>([])
  const [visualLayouts, setVisualLayouts] = useState<VisualFloorPlan[]>([])
  const [assignments, setAssignments] = useState<UserFloorPlanAssignments>({ assignments: {}, default_layout: "" })

  // Editor state
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null)
  const [items, setItems] = useState<VisualFloorPlanItem[]>([])
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [newLayoutName, setNewLayoutName] = useState("")
  const [dragState, setDragState] = useState<DragState>(null)
  const [lassoState, setLassoState] = useState<LassoState>(null)

  // Loading
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)

  // ─── Auth guard ───

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  // ─── Data fetching ───

  const fetchAll = useCallback(async () => {
    try {
      const [tablesRes, usersRes, layoutsRes, assignRes] = await Promise.all([
        fetch("/api/tables"),
        fetch("/api/admin/users"),
        fetch("/api/settings/floor-plan-visual-layouts"),
        fetch("/api/settings/user-floor-plan-assignments"),
      ])

      if (tablesRes.ok) setTables(sortTablesForDisplay(await tablesRes.json()))
      if (usersRes.ok) setUsers(await usersRes.json())
      if (layoutsRes.ok) {
        const data = await layoutsRes.json()
        const layouts: VisualFloorPlan[] = Array.isArray(data?.layouts) ? data.layouts : []
        setVisualLayouts(layouts)
        // Auto-select first layout
        if (layouts.length > 0 && !selectedLayoutId) {
          setSelectedLayoutId(layouts[0].id)
          setItems(JSON.parse(JSON.stringify(layouts[0].items)))
        }
      }
      if (assignRes.ok) {
        const data = await assignRes.json()
        setAssignments({
          assignments: data?.assignments || {},
          default_layout: data?.default_layout || "",
        })
      }
    } catch (e) {
      console.error("Fetch error:", e)
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user?.role === "manager") fetchAll()
  }, [user, fetchAll])

  // ─── Layout management ───

  const currentLayout = useMemo(
    () => visualLayouts.find((l) => l.id === selectedLayoutId) || null,
    [visualLayouts, selectedLayoutId],
  )

  const selectLayout = (id: string) => {
    // Save current edits into the layouts array before switching
    if (selectedLayoutId) {
      setVisualLayouts((prev) =>
        prev.map((l) => (l.id === selectedLayoutId ? { ...l, items: [...items] } : l)),
      )
    }
    setSelectedLayoutId(id)
    const layout = visualLayouts.find((l) => l.id === id)
    setItems(layout ? JSON.parse(JSON.stringify(layout.items)) : [])
    setSelectedItemIds(new Set())
  }

  const createLayout = () => {
    const name = newLayoutName.trim()
    if (!name) return
    const base = slugify(name) || "plan"
    let id = base
    let i = 1
    while (visualLayouts.some((l) => l.id === id)) {
      id = `${base}-${i++}`
    }
    const newLayout: VisualFloorPlan = { id, label: name, items: [] }
    // Save current layout items first
    const updated = selectedLayoutId
      ? visualLayouts.map((l) => (l.id === selectedLayoutId ? { ...l, items: [...items] } : l))
      : [...visualLayouts]
    const all = [...updated, newLayout]
    setVisualLayouts(all)
    setSelectedLayoutId(id)
    setItems([])
    setSelectedItemIds(new Set())
    setNewLayoutName("")
  }

  const duplicateLayout = () => {
    if (!selectedLayoutId) return
    const source = visualLayouts.find((l) => l.id === selectedLayoutId)
    if (!source) return
    const base = slugify(source.label + " copie") || "plan-copie"
    let id = base
    let i = 1
    while (visualLayouts.some((l) => l.id === id)) {
      id = `${base}-${i++}`
    }
    const copy: VisualFloorPlan = {
      id,
      label: source.label + " (copie)",
      items: JSON.parse(JSON.stringify(items)),
    }
    // Save current first
    const updated = visualLayouts.map((l) =>
      l.id === selectedLayoutId ? { ...l, items: [...items] } : l,
    )
    const all = [...updated, copy]
    setVisualLayouts(all)
    setSelectedLayoutId(id)
    setItems(JSON.parse(JSON.stringify(copy.items)))
    setSelectedItemIds(new Set())
  }

  const deleteLayout = () => {
    if (!selectedLayoutId) return
    if (!confirm("Supprimer ce plan ?")) return
    const updated = visualLayouts.filter((l) => l.id !== selectedLayoutId)
    setVisualLayouts(updated)
    if (updated.length > 0) {
      setSelectedLayoutId(updated[0].id)
      setItems(JSON.parse(JSON.stringify(updated[0].items)))
    } else {
      setSelectedLayoutId(null)
      setItems([])
    }
    setSelectedItemIds(new Set())
  }

  const renameLayout = (newLabel: string) => {
    if (!selectedLayoutId) return
    setVisualLayouts((prev) =>
      prev.map((l) => (l.id === selectedLayoutId ? { ...l, label: newLabel } : l)),
    )
  }

  // ─── Save all ───

  const saveVisualLayouts = async () => {
    setSaving(true)
    try {
      // Merge current editor items into layouts
      const layoutsToSave = visualLayouts.map((l) =>
        l.id === selectedLayoutId ? { ...l, items: [...items] } : l,
      )

      const res = await fetch("/api/settings/floor-plan-visual-layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layouts: layoutsToSave }),
      })
      if (!res.ok) throw new Error("Save failed")
      setVisualLayouts(layoutsToSave)
      toast({ title: "OK", description: "Plans visuels enregistrés" })
    } catch {
      toast({ title: "Erreur", description: "Échec de la sauvegarde", variant: "destructive" as any })
    } finally {
      setSaving(false)
    }
  }

  const saveAssignments = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/settings/user-floor-plan-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignments),
      })
      if (!res.ok) throw new Error("Save failed")
      toast({ title: "OK", description: "Assignations enregistrées" })
    } catch {
      toast({ title: "Erreur", description: "Échec de la sauvegarde", variant: "destructive" as any })
    } finally {
      setSaving(false)
    }
  }

  // ─── Canvas item operations ───

  const placedTableIds = useMemo(() => new Set(items.filter((i) => i.type === "table").map((i) => i.tableId)), [items])

  const unplacedTables = useMemo(
    () => sortTablesForDisplay(tables.filter((t) => !placedTableIds.has(t.id))),
    [tables, placedTableIds],
  )

  const addTableToCanvas = (table: Table) => {
    const isOlivier = table.location === "O"
    const newItem: VisualFloorPlanItem = {
      id: `t_${table.id}_${Date.now()}`,
      type: "table",
      tableId: table.id,
      x: 45,
      y: 45,
      width: isOlivier ? 7 : TABLE_DEFAULT_W,
      height: isOlivier ? 7 : TABLE_DEFAULT_H,
      shape: isOlivier ? "round" : undefined,
    }
    setItems((prev) => [...prev, newItem])
    setSelectedItemIds(new Set([newItem.id]))
  }

  const addDecoration = () => {
    const newItem: VisualFloorPlanItem = {
      id: `d_${Date.now()}`,
      type: "decoration",
      x: 40,
      y: 40,
      width: DECO_DEFAULT_W,
      height: DECO_DEFAULT_H,
      label: "Élément",
      color: "#64748b",
    }
    setItems((prev) => [...prev, newItem])
    setSelectedItemIds(new Set([newItem.id]))
  }

  const removeItems = (ids: Set<string>) => {
    setItems((prev) => prev.filter((i) => !ids.has(i.id)))
    setSelectedItemIds(new Set())
  }

  const updateItem = (id: string, patch: Partial<VisualFloorPlanItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  // Single selected item (for property panel, only when exactly 1 selected)
  const selectedItem = useMemo(
    () => (selectedItemIds.size === 1 ? items.find((i) => selectedItemIds.has(i.id)) || null : null),
    [items, selectedItemIds],
  )

  const getTableLabel = (tableId?: string) => {
    if (!tableId) return "?"
    const t = tables.find((t) => t.id === tableId)
    return t?.table_number || "?"
  }

  // ─── Drag & Drop handlers ───

  const getCanvasPercent = useCallback(
    (clientX: number, clientY: number): { px: number; py: number } => {
      const canvas = canvasRef.current
      if (!canvas) return { px: 0, py: 0 }
      const rect = canvas.getBoundingClientRect()
      return {
        px: ((clientX - rect.left) / rect.width) * 100,
        py: ((clientY - rect.top) / rect.height) * 100,
      }
    },
    [],
  )

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    // Click on blank canvas → start lasso or deselect
    if ((e.target as HTMLElement) === canvasRef.current) {
      const { px, py } = getCanvasPercent(e.clientX, e.clientY)
      if (!e.ctrlKey && !e.metaKey) {
        setSelectedItemIds(new Set())
      }
      setLassoState({ startX: px, startY: py, currentX: px, currentY: py })
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    }
  }

  const handleItemPointerDown = (e: React.PointerEvent, itemId: string) => {
    e.stopPropagation()
    e.preventDefault()
    const { px, py } = getCanvasPercent(e.clientX, e.clientY)
    const item = items.find((i) => i.id === itemId)
    if (!item) return

    // Multi-select with Ctrl/Cmd
    if (e.ctrlKey || e.metaKey) {
      setSelectedItemIds((prev) => {
        const next = new Set(prev)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        return next
      })
      return // Don't start drag on Ctrl+Click toggle
    }

    // If item is already part of selection, keep selection; otherwise single-select
    const newSelection = selectedItemIds.has(itemId) ? selectedItemIds : new Set([itemId])
    setSelectedItemIds(newSelection)

    // Build multi-offsets for all selected items
    const multiOffsets = items
      .filter((i) => newSelection.has(i.id))
      .map((i) => ({ id: i.id, ox: px - i.x, oy: py - i.y }))

    setDragState({
      itemId,
      offsetX: px - item.x,
      offsetY: py - item.y,
      multiOffsets,
      type: "move",
    })
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const handleResizePointerDown = (e: React.PointerEvent, itemId: string) => {
    e.stopPropagation()
    e.preventDefault()
    const item = items.find((i) => i.id === itemId)
    if (!item) return
    const { px, py } = getCanvasPercent(e.clientX, e.clientY)
    setDragState({
      itemId,
      startX: px,
      startY: py,
      startW: item.width,
      startH: item.height,
      type: "resize",
    })
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Lasso selection
      if (lassoState) {
        const { px, py } = getCanvasPercent(e.clientX, e.clientY)
        setLassoState((prev) => (prev ? { ...prev, currentX: px, currentY: py } : null))
        return
      }

      if (!dragState) return
      const { px, py } = getCanvasPercent(e.clientX, e.clientY)

      if (dragState.type === "move" && dragState.multiOffsets) {
        // Move all selected items together
        setItems((prev) =>
          prev.map((i) => {
            const offset = dragState.multiOffsets!.find((o) => o.id === i.id)
            if (!offset) return i
            const newX = snap(Math.max(0, Math.min(100 - 3, px - offset.ox)), 0.5)
            const newY = snap(Math.max(0, Math.min(100 - 3, py - offset.oy)), 0.5)
            return { ...i, x: newX, y: newY }
          }),
        )
      } else if (dragState.type === "resize") {
        const dx = px - dragState.startX
        const dy = py - dragState.startY
        const newW = snap(Math.max(2, dragState.startW + dx), 0.5)
        const newH = snap(Math.max(2, dragState.startH + dy), 0.5)
        setItems((prev) =>
          prev.map((i) => (i.id === dragState.itemId ? { ...i, width: newW, height: newH } : i)),
        )
      }
    },
    [dragState, lassoState, getCanvasPercent],
  )

  const handlePointerUp = useCallback(() => {
    // Finalize lasso selection
    if (lassoState) {
      const lx1 = Math.min(lassoState.startX, lassoState.currentX)
      const lx2 = Math.max(lassoState.startX, lassoState.currentX)
      const ly1 = Math.min(lassoState.startY, lassoState.currentY)
      const ly2 = Math.max(lassoState.startY, lassoState.currentY)
      // Only select if lasso was big enough (>1% in both dimensions)
      if (lx2 - lx1 > 1 && ly2 - ly1 > 1) {
        const hits = items.filter((item) => {
          const ix1 = item.x
          const iy1 = item.y
          const ix2 = item.x + item.width
          const iy2 = item.y + item.height
          // Item overlaps lasso rectangle
          return ix1 < lx2 && ix2 > lx1 && iy1 < ly2 && iy2 > ly1
        })
        setSelectedItemIds((prev) => {
          const next = new Set(prev)
          for (const h of hits) next.add(h.id)
          return next
        })
      }
      setLassoState(null)
    }
    setDragState(null)
  }, [lassoState, items])

  // ─── Keyboard shortcuts ───

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't delete if user is typing in an input
        if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return
        if (selectedItemIds.size > 0) {
          removeItems(selectedItemIds)
        }
      }
      // Ctrl+A to select all
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return
        e.preventDefault()
        setSelectedItemIds(new Set(items.map((i) => i.id)))
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [selectedItemIds, items]) // eslint-disable-line react-hooks/exhaustive-deps

  // All layout options for assignment (visual + grid-based presets)
  // Must be before any early return to maintain hook order
  const allLayoutOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "none", label: "— Aucun (défaut global) —" },
    ]
    visualLayouts.forEach((l) => opts.push({ value: `visual:${l.id}`, label: `🎨 ${l.label}` }))
    opts.push(
      { value: "grid:base_list", label: "📋 Liste base (grille)" },
      { value: "grid:zones", label: "📋 Zones (grille)" },
      { value: "grid:compact", label: "📋 Compact (grille)" },
    )
    return opts
  }, [visualLayouts])

  // ─── Loading state ───

  if (isLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  // ─── Render helpers ───

  const renderCanvasItem = (item: VisualFloorPlanItem) => {
    const isSelected = selectedItemIds.has(item.id)
    const isOnlySelected = isSelected && selectedItemIds.size === 1
    const isTable = item.type === "table"
    const isMissing = isTable && item.tableId && !tables.some((t) => t.id === item.tableId)
    const label = isTable
      ? isMissing
        ? "⚠ Introuvable"
        : getTableLabel(item.tableId)
      : item.label || ""
    const bgColor = isMissing ? "#991b1b" : isTable ? "#0ea5e9" : item.color || "#64748b"
    const isRound = item.shape === "round"

    return (
      <div
        key={item.id}
        className={`absolute flex items-center justify-center text-white font-bold text-xs select-none cursor-grab active:cursor-grabbing transition-shadow ${
          isSelected ? "ring-2 ring-yellow-400 ring-offset-1 ring-offset-slate-900 z-20" : "z-10"
        }`}
        style={{
          left: `${item.x}%`,
          top: `${item.y}%`,
          width: `${item.width}%`,
          height: `${item.height}%`,
          backgroundColor: bgColor,
          borderRadius: isRound ? "50%" : isTable ? "6px" : "4px",
          transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
          fontSize: isTable ? "clamp(9px, 1.2vw, 14px)" : "clamp(8px, 1vw, 12px)",
          border: isMissing
            ? "2px dashed #fca5a5"
            : isTable
              ? "2px solid rgba(255,255,255,0.3)"
              : "1px solid rgba(255,255,255,0.2)",
          boxShadow: isSelected ? "0 0 0 2px #facc15" : "0 1px 3px rgba(0,0,0,0.3)",
        }}
        onPointerDown={(e) => handleItemPointerDown(e, item.id)}
      >
        <span className="pointer-events-none truncate px-1 leading-tight text-center">{label}</span>
        {/* Resize handle — only for single-selected item */}
        {isOnlySelected && (
          <div
            className="absolute bottom-0 right-0 w-3 h-3 bg-yellow-400 cursor-se-resize rounded-tl-sm"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => handleResizePointerDown(e, item.id)}
          />
        )}
      </div>
    )
  }

  const renderCanvas = () => (
    <div
      ref={canvasRef}
      className="relative w-full bg-slate-800 border-2 border-slate-600 rounded-lg overflow-hidden select-none"
      style={{
        aspectRatio: "16 / 10",
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
        backgroundSize: "5% 5%",
        touchAction: "none",
      }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm pointer-events-none">
          Ajoutez des tables et des éléments depuis le panneau de droite
        </div>
      )}
      {items.map(renderCanvasItem)}
      {/* Lasso selection rectangle */}
      {lassoState && (
        <div
          className="absolute border-2 border-blue-400 bg-blue-400/10 pointer-events-none z-30"
          style={{
            left: `${Math.min(lassoState.startX, lassoState.currentX)}%`,
            top: `${Math.min(lassoState.startY, lassoState.currentY)}%`,
            width: `${Math.abs(lassoState.currentX - lassoState.startX)}%`,
            height: `${Math.abs(lassoState.currentY - lassoState.startY)}%`,
          }}
        />
      )}
    </div>
  )

  const renderSidebar = () => (
    <div className="w-full lg:w-72 xl:w-80 space-y-4 flex-shrink-0">
      {/* Layout selector */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="p-3">
          <CardTitle className="text-white text-sm">Plans</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          {visualLayouts.length > 0 && (
            <Select value={selectedLayoutId || ""} onValueChange={selectLayout}>
              <SelectTrigger className="bg-slate-700 border-slate-600 text-sm">
                <SelectValue placeholder="Choisir un plan" />
              </SelectTrigger>
              <SelectContent className="bg-slate-700 border-slate-600">
                {visualLayouts.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-1.5">
            <Input
              value={newLayoutName}
              onChange={(e) => setNewLayoutName(e.target.value)}
              className="bg-slate-700 border-slate-600 text-xs h-8"
              placeholder="Nom du plan"
              onKeyDown={(e) => e.key === "Enter" && createLayout()}
            />
            <Button size="sm" onClick={createLayout} className="bg-green-600 hover:bg-green-700 h-8 px-2">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {selectedLayoutId && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={duplicateLayout} className="flex-1 bg-slate-700 hover:bg-slate-600 border-slate-600 text-white text-xs h-7">
                <Copy className="h-3 w-3 mr-1" /> Dupliquer
              </Button>
              <Button size="sm" variant="outline" onClick={deleteLayout} className="bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 text-xs h-7">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
          {selectedLayoutId && currentLayout && (
            <div>
              <Label className="text-xs text-slate-400">Renommer</Label>
              <Input
                value={currentLayout.label}
                onChange={(e) => renameLayout(e.target.value)}
                className="bg-slate-700 border-slate-600 text-xs h-8"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unplaced tables */}
      {selectedLayoutId && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="p-3">
            <CardTitle className="text-white text-sm">Tables non placées</CardTitle>
            <CardDescription className="text-slate-400 text-xs">
              Cliquez pour ajouter au plan
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {unplacedTables.length === 0 ? (
              <div className="text-xs text-slate-500 text-center py-2">Toutes les tables sont placées ✓</div>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                {unplacedTables.map((table) => (
                  <button
                    key={table.id}
                    onClick={() => addTableToCanvas(table)}
                    className="px-2 py-1 rounded text-xs font-medium bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 border border-sky-700/50 transition-colors"
                  >
                    {table.table_number}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add decoration */}
      {selectedLayoutId && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="p-3">
            <CardTitle className="text-white text-sm">Décoration</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <Button size="sm" onClick={addDecoration} className="w-full bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-xs">
              <Square className="h-3.5 w-3.5 mr-2" /> Ajouter un rectangle
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Multi-selection panel */}
      {selectedItemIds.size > 1 && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="p-3">
            <CardTitle className="text-white text-sm">
              {selectedItemIds.size} éléments sélectionnés
            </CardTitle>
            <CardDescription className="text-slate-400 text-xs">
              Ctrl+Clic pour modifier la sélection · Glissez pour déplacer le groupe
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => removeItems(selectedItemIds)}
              className="w-full bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 text-xs h-7"
            >
              <Trash2 className="h-3 w-3 mr-1" /> Retirer les {selectedItemIds.size} éléments
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedItemIds(new Set())}
              className="w-full bg-slate-700 hover:bg-slate-600 border-slate-600 text-white text-xs h-7"
            >
              Tout désélectionner
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Single selected item properties */}
      {selectedItem && (
        <Card className={`border-slate-700 ${
          selectedItem.type === "table" && selectedItem.tableId && !tables.some((t) => t.id === selectedItem.tableId)
            ? "bg-red-950 border-red-700"
            : "bg-slate-800"
        }`}>
          <CardHeader className="p-3">
            <CardTitle className="text-white text-sm">
              {selectedItem.type === "table"
                ? selectedItem.tableId && !tables.some((t) => t.id === selectedItem.tableId)
                  ? "⚠ Table supprimée"
                  : `Table ${getTableLabel(selectedItem.tableId)}`
                : "Décoration"}
            </CardTitle>
            {selectedItem.type === "table" && selectedItem.tableId && !tables.some((t) => t.id === selectedItem.tableId) && (
              <CardDescription className="text-red-400 text-xs">
                Cette table n&apos;existe plus en base. Retirez-la du plan.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-slate-400">X (%)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={selectedItem.x}
                  onChange={(e) => updateItem(selectedItem.id, { x: Number(e.target.value) })}
                  className="bg-slate-700 border-slate-600 text-xs h-7"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-400">Y (%)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={selectedItem.y}
                  onChange={(e) => updateItem(selectedItem.id, { y: Number(e.target.value) })}
                  className="bg-slate-700 border-slate-600 text-xs h-7"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-400">Largeur (%)</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="2"
                  value={selectedItem.width}
                  onChange={(e) => updateItem(selectedItem.id, { width: Math.max(2, Number(e.target.value)) })}
                  className="bg-slate-700 border-slate-600 text-xs h-7"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-400">Hauteur (%)</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="2"
                  value={selectedItem.height}
                  onChange={(e) => updateItem(selectedItem.id, { height: Math.max(2, Number(e.target.value)) })}
                  className="bg-slate-700 border-slate-600 text-xs h-7"
                />
              </div>
            </div>
            {/* Shape toggle (for all item types) */}
            <div>
              <Label className="text-xs text-slate-400">Forme</Label>
              <div className="flex gap-1.5 mt-1">
                <button
                  onClick={() => updateItem(selectedItem.id, { shape: undefined })}
                  className={`flex-1 h-7 rounded text-xs font-medium border transition-all ${
                    !selectedItem.shape || selectedItem.shape === "rect"
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  ▭ Rectangle
                </button>
                <button
                  onClick={() => updateItem(selectedItem.id, { shape: "round" })}
                  className={`flex-1 h-7 rounded text-xs font-medium border transition-all ${
                    selectedItem.shape === "round"
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  ● Rond
                </button>
              </div>
            </div>
            {selectedItem.type === "decoration" && (
              <>
                <div>
                  <Label className="text-xs text-slate-400">Label</Label>
                  <Input
                    value={selectedItem.label || ""}
                    onChange={(e) => updateItem(selectedItem.id, { label: e.target.value })}
                    className="bg-slate-700 border-slate-600 text-xs h-7"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-400">Couleur</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DECO_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => updateItem(selectedItem.id, { color: c.value })}
                        className={`w-6 h-6 rounded border-2 transition-all ${
                          selectedItem.color === c.value ? "border-white scale-110" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c.value }}
                        title={c.label}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => removeItems(new Set([selectedItem.id]))}
              className="w-full bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 text-xs h-7"
            >
              <Trash2 className="h-3 w-3 mr-1" /> Retirer du plan
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Save */}
      {selectedLayoutId && (
        <Button onClick={saveVisualLayouts} disabled={saving} className="w-full bg-blue-600 hover:bg-blue-700">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Enregistrement..." : "Enregistrer les plans"}
        </Button>
      )}
    </div>
  )

  const renderEditorTab = () => (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">{renderCanvas()}</div>
      {renderSidebar()}
    </div>
  )

  const renderAssignmentTab = () => (
    <div className="space-y-6 max-w-3xl">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="p-4">
          <CardTitle className="text-white text-base">Disposition par défaut</CardTitle>
          <CardDescription className="text-slate-400 text-xs">
            La disposition utilisée pour les comptes sans assignation spécifique
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <Select
            value={assignments.default_layout || "none"}
            onValueChange={(v) => setAssignments((prev) => ({ ...prev, default_layout: v === "none" ? "" : v }))}
          >
            <SelectTrigger className="bg-slate-700 border-slate-600 text-sm">
              <SelectValue placeholder="Choisir la disposition par défaut" />
            </SelectTrigger>
            <SelectContent className="bg-slate-700 border-slate-600">
              <SelectItem value="none">— Grille classique (base_list) —</SelectItem>
              {visualLayouts.map((l) => (
                <SelectItem key={l.id} value={`visual:${l.id}`}>
                  🎨 {l.label}
                </SelectItem>
              ))}
              <SelectItem value="grid:base_list">📋 Liste base (grille)</SelectItem>
              <SelectItem value="grid:zones">📋 Zones (grille)</SelectItem>
              <SelectItem value="grid:compact">📋 Compact (grille)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="p-4">
          <CardTitle className="text-white text-base">Assignation par compte</CardTitle>
          <CardDescription className="text-slate-400 text-xs">
            Choisir une disposition spécifique pour chaque utilisateur
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {users.filter((u) => !u.disabled).map((u) => (
            <div key={u.id} className="flex items-center gap-3 border border-slate-700 rounded-md p-3">
              <div className="flex-1">
                <div className="text-sm text-white font-medium">{u.name}</div>
                <div className="text-xs text-slate-400">{u.role === "manager" ? "Manager" : "Serveur"}</div>
              </div>
              <Select
                value={assignments.assignments[u.id] || "none"}
                onValueChange={(v) =>
                  setAssignments((prev) => ({
                    ...prev,
                    assignments: { ...prev.assignments, [u.id]: v === "none" ? "" : v },
                  }))
                }
              >
                <SelectTrigger className="bg-slate-700 border-slate-600 text-xs w-52">
                  <SelectValue placeholder="Par défaut" />
                </SelectTrigger>
                <SelectContent className="bg-slate-700 border-slate-600">
                  {allLayoutOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={saveAssignments} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
        <Save className="h-4 w-4 mr-2" />
        {saving ? "Enregistrement..." : "Enregistrer les assignations"}
      </Button>
    </div>
  )

  // ─── Main render ───

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Button
          onClick={() => router.push("/admin")}
          variant="outline"
          size="sm"
          className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
        >
          <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          <span className="text-xs sm:text-sm">Retour</span>
        </Button>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Plan de salle — Éditeur visuel</h1>
          <p className="text-slate-400 text-xs sm:text-sm">Créer, personnaliser et assigner des dispositions</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="editor" className="space-y-4">
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="editor" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-300 text-xs sm:text-sm">
            <LayoutGrid className="h-3.5 w-3.5 mr-1.5" />
            Éditeur visuel
          </TabsTrigger>
          <TabsTrigger value="assignments" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-300 text-xs sm:text-sm">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Assignation aux comptes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor">{renderEditorTab()}</TabsContent>
        <TabsContent value="assignments">{renderAssignmentTab()}</TabsContent>
      </Tabs>
    </div>
  )
}
