"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Plus, Pencil, Trash2, Search, AlertCircle, CheckCircle, Settings, Edit, ArrowUp, ArrowDown, Palette, ShieldAlert, Star } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import type { MenuCategory, MenuItem, Allergen } from "@/lib/types"
import { MENU_BUTTON_COLORS } from "@/lib/menu-colors"

export default function MenuEditorPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [editDialog, setEditDialog] = useState(false)
  const [categoryDialog, setCategoryDialog] = useState(false)
  const [colorHelpDialog, setColorHelpDialog] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoadingMenu, setIsLoadingMenu] = useState(true)
  const [allergens, setAllergens] = useState<Allergen[]>([])
  const [allergenDialog, setAllergenDialog] = useState(false)
  const [newAllergenName, setNewAllergenName] = useState("")
  const [newAllergenEmoji, setNewAllergenEmoji] = useState("⚠️")
  const [editingAllergen, setEditingAllergen] = useState<Allergen | null>(null)
  const [allergenMap, setAllergenMap] = useState<Record<string, Allergen[]>>({})
  const [itemAllergenIds, setItemAllergenIds] = useState<string[]>([])
  const [newItem, setNewItem] = useState({
    name: "",
    details: "",
    price: "",
    tax_rate: "20",
    category: "",
    routing: "kitchen" as "kitchen" | "bar",
    out_of_stock: false,
    button_color: "",
    status: true,
    is_piatto_del_giorno: false,
  })

  const normalizeEditorValue = (value?: string | null) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()

  const isRhumArrangeName = (value?: string | null) => normalizeEditorValue(value) === "rhum arrange"

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user?.role === "manager") {
      fetchMenu()
    }
  }, [user])

  const fetchMenu = async () => {
    setIsLoadingMenu(true)
    try {
      const [itemsRes, categoriesRes, allergensRes, allergenMapRes] = await Promise.all([
        fetch("/api/menu/items"),
        fetch("/api/menu/categories"),
        fetch("/api/allergens"),
        fetch("/api/menu/allergen-map"),
      ])

      if (itemsRes.ok) {
        const items = await itemsRes.json()
        setMenuItems(items)
      }

      if (categoriesRes.ok) {
        const cats = await categoriesRes.json()
        setCategories(cats)
      }

      if (allergensRes.ok) {
        const data = await allergensRes.json()
        setAllergens(data)
      }

      if (allergenMapRes.ok) {
        const data = await allergenMapRes.json()
        setAllergenMap(data)
      }
    } catch (error) {
      console.error("[v0] Error fetching menu:", error)
    } finally {
      setIsLoadingMenu(false)
    }
  }

  const handleSaveItem = async () => {
    try {
      const itemData = editingItem || newItem
      const url = editingItem ? `/api/menu/items/${editingItem.id}` : "/api/menu/items"
      const method = editingItem ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: itemData.name,
          details: itemData.details || null,
          price: Number.parseFloat(itemData.price.toString()),
          tax_rate: Number.parseFloat(itemData.tax_rate.toString()),
          category: itemData.category,
          routing: itemData.routing,
          out_of_stock: itemData.out_of_stock,
          button_color: itemData.button_color || null,
          status: itemData.status !== undefined ? itemData.status : true,
          is_piatto_del_giorno: (itemData as any).is_piatto_del_giorno || false,
        }),
      })

      if (response.ok) {
        const savedItem = await response.json()
        const itemId = editingItem ? editingItem.id : savedItem.id

        // Save allergen assignments
        if (itemId) {
          await fetch(`/api/menu/items/${itemId}/allergens`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allergen_ids: itemAllergenIds }),
          })
        }

        setEditDialog(false)
        setEditingItem(null)
        setItemAllergenIds([])
        setNewItem({
          name: "",
          details: "",
          price: "",
          tax_rate: "20",
          category: "",
          routing: "kitchen",
          out_of_stock: false,
          button_color: "",
          status: true,
          is_piatto_del_giorno: false,
        })
        fetchMenu()
      }
    } catch (error) {
      console.error("[v0] Error saving item:", error)
    }
  }

  const handleSaveCategory = async () => {
    if (!newCategoryName.trim()) return

    try {
      if (editingCategory) {
        // Modification d'une catégorie existante
        const response = await fetch(`/api/menu/categories/${encodeURIComponent(editingCategory)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newCategoryName.trim() }),
        })

        if (response.ok) {
          setNewCategoryName("")
          setEditingCategory(null)
          fetchCategories()
          fetchMenu() // Mettre à jour les articles qui utilisent cette catégorie
        }
      } else {
        // Création d'une nouvelle catégorie
        const response = await fetch("/api/menu/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newCategoryName.trim(), type: "food" }),
        })

        if (response.ok) {
          setNewCategoryName("")
          setEditingCategory(null)
          fetchCategories()
        }
      }
    } catch (error) {
      console.error("[v0] Error saving category:", error)
    }
  }

  const handleEditCategory = (categoryName: string) => {
    setEditingCategory(categoryName)
    setNewCategoryName(categoryName)
  }

  const handleCancelEdit = () => {
    setEditingCategory(null)
    setNewCategoryName("")
  }

  const handleDeleteCategory = async (categoryName: string) => {
    if (!confirm(`Supprimer la catégorie "${categoryName}" ? Les articles seront déplacés vers "Sans catégorie".`)) return

    try {
      const response = await fetch(`/api/menu/categories/${encodeURIComponent(categoryName)}`, {
        method: "DELETE",
      })

      if (response.ok) {
        fetchCategories()
        fetchMenu()
      }
    } catch (error) {
      console.error("[v0] Error deleting category:", error)
    }
  }

  const fetchCategories = async () => {
    try {
      const categoriesRes = await fetch("/api/menu/categories")
      if (categoriesRes.ok) {
        const cats = await categoriesRes.json()
        setCategories(cats)
      }
    } catch (error) {
      console.error("[v0] Error fetching categories:", error)
    }
  }

  const saveCategoryOrder = async (nextCategories: MenuCategory[]) => {
    try {
      const response = await fetch("/api/menu/categories/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: nextCategories.map((cat, index) => ({
            id: cat.id,
            sort_order: index + 1,
          })),
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to reorder categories")
      }
    } catch (error) {
      console.error("[v0] Error reordering categories:", error)
      fetchCategories()
    }
  }

  const moveCategory = async (categoryId: string, direction: "up" | "down") => {
    const index = categories.findIndex((cat) => cat.id === categoryId)
    if (index === -1) return
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= categories.length) return

    const next = [...categories]
    ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    const reordered = next.map((cat, idx) => ({ ...cat, sort_order: idx + 1 }))
    setCategories(reordered)
    await saveCategoryOrder(reordered)
  }

  const handleDeleteItem = async (id: string) => {
    if (!confirm("Supprimer cet article ?")) return

    try {
      const response = await fetch(`/api/menu/items/${id}`, { method: "DELETE" })
      if (response.ok) {
        fetchMenu()
      }
    } catch (error) {
      console.error("[v0] Error deleting item:", error)
    }
  }

  const toggleOutOfStock = async (id: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/menu/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          out_of_stock: !currentStatus,
        }),
      })

      if (response.ok) {
        fetchMenu()
      }
    } catch (error) {
      console.error("[v0] Error toggling out of stock:", error)
    }
  }

  const toggleSuggestion = async (id: string, current: boolean) => {
    try {
      const response = await fetch(`/api/menu/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_piatto_del_giorno: !current }),
      })
      if (response.ok) {
        setMenuItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, is_piatto_del_giorno: !current } : item))
        )
      }
    } catch (error) {
      console.error("[v0] Error toggling suggestion:", error)
    }
  }

  // --- Allergen CRUD ---
  const handleSaveAllergen = async () => {
    if (!newAllergenName.trim()) return
    try {
      if (editingAllergen) {
        await fetch(`/api/allergens/${editingAllergen.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newAllergenName.trim(), emoji: newAllergenEmoji }),
        })
      } else {
        await fetch("/api/allergens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newAllergenName.trim(), emoji: newAllergenEmoji }),
        })
      }
      setNewAllergenName("")
      setNewAllergenEmoji("⚠️")
      setEditingAllergen(null)
      // Refresh allergens
      const res = await fetch("/api/allergens")
      if (res.ok) setAllergens(await res.json())
    } catch (error) {
      console.error("[v0] Error saving allergen:", error)
    }
  }

  const handleDeleteAllergen = async (id: string) => {
    if (!confirm("Supprimer cet allergène ?")) return
    try {
      await fetch(`/api/allergens/${id}`, { method: "DELETE" })
      const res = await fetch("/api/allergens")
      if (res.ok) setAllergens(await res.json())
    } catch (error) {
      console.error("[v0] Error deleting allergen:", error)
    }
  }

  const openEditItemDialog = async (item: MenuItem) => {
    setEditingItem(item)
    // Load existing allergens for this item
    const itemAllergens = allergenMap[item.id] || []
    setItemAllergenIds(itemAllergens.map((a) => a.id))
    setEditDialog(true)
  }

  const toggleItemAllergen = (allergenId: string) => {
    setItemAllergenIds((prev) =>
      prev.includes(allergenId) ? prev.filter((id) => id !== allergenId) : [...prev, allergenId]
    )
  }

  const filteredMenuItems = menuItems.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.details && item.details.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase())),
  )

  const groupedItems = filteredMenuItems.reduce(
    (acc, item) => {
      const category = item.category || "Sans catégorie"
      if (!acc[category]) acc[category] = []
      acc[category].push(item)
      return acc
    },
    {} as Record<string, MenuItem[]>,
  )

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6">
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4">
          <Button
            onClick={() => router.push("/admin")}
            variant="outline"
            size="sm"
            className="bg-slate-800 text-white border-slate-700"
          >
            <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Retour</span>
          </Button>
          <h1 className="text-xl sm:text-3xl font-bold text-white">Éditeur de menu</h1>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setCategoryDialog(true)}
            variant="outline"
            size="sm"
            className="bg-slate-700 text-white border-slate-600"
          >
            <Settings className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Catégories</span>
          </Button>
          <Button
            onClick={() => setAllergenDialog(true)}
            variant="outline"
            size="sm"
            className="bg-amber-700 text-white border-amber-600 hover:bg-amber-600"
          >
            <ShieldAlert className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Allergènes</span>
          </Button>
          <Button
            onClick={() => setColorHelpDialog(true)}
            variant="outline"
            size="sm"
            className="bg-slate-700 text-white border-slate-600 px-2"
            title="Couleurs disponibles"
          >
            <Palette className="h-3 w-3 sm:h-4 sm:w-4" />
          </Button>
          <Button
            onClick={() => {
              setEditingItem(null)
              setItemAllergenIds([])
              setEditDialog(true)
            }}
            size="sm"
            className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
          >
            <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Ajouter un article</span>
          </Button>
        </div>
      </div>

      <div className="mb-4 sm:mb-6">
        <div className="relative max-w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-slate-400" />
          <Input
            type="text"
            placeholder="Rechercher un plat ou une catégorie..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 sm:pl-10 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm"
          />
        </div>
        {searchQuery && (
          <p className="text-xs sm:text-sm text-slate-400 mt-2">
            {filteredMenuItems.length} résultat{filteredMenuItems.length > 1 ? "s" : ""} trouvé
            {filteredMenuItems.length > 1 ? "s" : ""}
          </p>
        )}
      </div>

      <div className="space-y-4 sm:space-y-6">
        {Object.entries(groupedItems).map(([category, items]) => (
          <Card key={category} className="bg-slate-800 border-slate-700">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-white text-base sm:text-lg">{category}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between p-2 sm:p-3 rounded gap-3 ${
                      item.status === false
                        ? "bg-slate-800/60 border border-slate-600 opacity-60"
                        : item.out_of_stock
                          ? "bg-red-900/30 border-2 border-red-700"
                          : "bg-slate-700"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-white text-sm sm:text-base truncate">{item.name}</div>
                        {item.status === false && (
                          <Badge className="bg-slate-600 text-xs">Masqué</Badge>
                        )}
                        {item.is_piatto_del_giorno && (
                          <Badge className="bg-amber-500 text-black text-xs flex items-center gap-1">
                            <Star className="h-3 w-3 fill-current" />
                            Suggestion
                          </Badge>
                        )}
                        {item.out_of_stock && (
                          <Badge className="bg-red-600 text-xs flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Rupture
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs sm:text-sm text-slate-400">
                        {item.price.toFixed(2)} € • TVA {item.tax_rate}% • {item.routing === "kitchen" ? "Cuisine" : "Bar"}
                      </div>
                      {item.details && (
                        <div className="text-xs text-slate-300 mt-0.5 italic">{item.details}</div>
                      )}
                      {allergenMap[item.id] && allergenMap[item.id].length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {allergenMap[item.id].map((a) => (
                            <span key={a.id} className="text-xs bg-amber-900/40 text-amber-300 border border-amber-700/50 rounded px-1.5 py-0.5">
                              {a.emoji} {a.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1.5 sm:gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleOutOfStock(item.id, item.out_of_stock || false)}
                        className={`${
                          item.out_of_stock
                            ? "bg-green-600 hover:bg-green-700 border-green-500 text-white"
                            : "bg-orange-600 hover:bg-orange-700 border-orange-500 text-white"
                        } px-3 py-1.5 text-xs sm:text-sm font-medium`}
                      >
                        {item.out_of_stock ? (
                          <>
                            <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                            Remettre en stock
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                            Mettre en rupture
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleSuggestion(item.id, item.is_piatto_del_giorno || false)}
                        className={`${
                          item.is_piatto_del_giorno
                            ? "bg-amber-500 hover:bg-amber-600 border-amber-400 text-black"
                            : "bg-slate-600 hover:bg-slate-500 border-slate-500 text-slate-300"
                        } h-8 w-8 sm:h-9 sm:w-9 p-0`}
                        title={item.is_piatto_del_giorno ? "Retirer suggestion" : "Marquer comme suggestion"}
                      >
                        <Star className={`h-3 w-3 sm:h-4 sm:w-4 ${item.is_piatto_del_giorno ? "fill-current" : ""}`} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditItemDialog(item)}
                        className="bg-slate-600 hover:bg-slate-500 border-slate-500 h-8 w-8 sm:h-9 sm:w-9 p-0"
                      >
                        <Pencil className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteItem(item.id)}
                        className="bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 h-8 w-8 sm:h-9 sm:w-9 p-0"
                      >
                        <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {Object.keys(groupedItems).length === 0 && !isLoadingMenu && (
          <Card className="bg-slate-800 border-slate-700 p-6 sm:p-8">
            <p className="text-center text-slate-400 text-sm">
              {searchQuery ? "Aucun résultat trouvé" : "Aucun article dans le menu"}
            </p>
          </Card>
        )}
        {isLoadingMenu && (
          <Card className="bg-slate-800 border-slate-700 p-6 sm:p-8">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              <span className="ml-3 text-slate-400 text-sm">Chargement du menu...</span>
            </div>
          </Card>
        )}
      </div>

      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              {editingItem ? "Modifier l'article" : "Nouvel article"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <div className="md:col-span-2">
              <Label className="text-sm">Nom</Label>
              <Input
                value={editingItem ? editingItem.name ?? "" : newItem.name}
                onChange={(e) =>
                  editingItem
                    ? setEditingItem({ ...editingItem, name: e.target.value })
                    : setNewItem({ ...newItem, name: e.target.value })
                }
                className="bg-slate-700 border-slate-600 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-sm">
                {isRhumArrangeName(editingItem ? editingItem.name : newItem.name)
                  ? "Goûts (séparés par virgules)"
                  : "Détails affichés (optionnel)"}
              </Label>
              <Input
                value={editingItem ? editingItem.details ?? "" : newItem.details}
                onChange={(e) =>
                  editingItem
                    ? setEditingItem({ ...editingItem, details: e.target.value })
                    : setNewItem({ ...newItem, details: e.target.value })
                }
                placeholder={
                  isRhumArrangeName(editingItem ? editingItem.name : newItem.name)
                    ? "Ex: Ananas, Vanille, Mangue"
                    : "Ex: Sec, rond et fruité"
                }
                className="bg-slate-700 border-slate-600 text-sm"
              />
              {isRhumArrangeName(editingItem ? editingItem.name : newItem.name) && (
                <p className="text-[11px] text-slate-400 mt-1">
                  Chaque goût ajouté ici apparaîtra en choix au clic sur la caisse.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:col-span-2">
              <div>
                <Label className="text-sm">Prix (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editingItem ? (Number.isFinite((editingItem as any).price) ? editingItem.price : "") : newItem.price}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, price: Number.parseFloat(e.target.value) })
                      : setNewItem({ ...newItem, price: e.target.value })
                  }
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
              <div>
                <Label className="text-sm">TVA (%)</Label>
                <Input
                  type="number"
                  value={editingItem ? (Number.isFinite((editingItem as any).tax_rate) ? editingItem.tax_rate : "") : newItem.tax_rate}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, tax_rate: Number.parseFloat(e.target.value) })
                      : setNewItem({ ...newItem, tax_rate: e.target.value })
                  }
                  className="bg-slate-700 border-slate-600 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">Catégorie</Label>
              <select
                value={editingItem ? (editingItem.category ?? "") : (newItem.category ?? "")}
                onChange={(e) =>
                  editingItem
                    ? setEditingItem({ ...editingItem, category: e.target.value })
                    : setNewItem({ ...newItem, category: e.target.value })
                }
                className="w-full bg-slate-700 border-slate-600 rounded-md p-2 text-white text-sm"
              >
                <option value="">Sélectionner une catégorie</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-sm">Impression</Label>
              <select
                value={editingItem ? ((editingItem as any).routing || newItem.routing) : newItem.routing}
                onChange={(e) =>
                  editingItem
                    ? setEditingItem({ ...editingItem, routing: e.target.value as "kitchen" | "bar" })
                    : setNewItem({ ...newItem, routing: e.target.value as "kitchen" | "bar" })
                }
                className="w-full bg-slate-700 border-slate-600 rounded-md p-2 text-white text-sm"
              >
                <option value="kitchen">Cuisine</option>
                <option value="bar">Bar</option>
              </select>
            </div>
            <div>
              <Label className="text-sm">Couleur bouton</Label>
              <select
                value={editingItem ? (editingItem.button_color ?? "") : newItem.button_color}
                onChange={(e) =>
                  editingItem
                    ? setEditingItem({ ...editingItem, button_color: e.target.value || null })
                    : setNewItem({ ...newItem, button_color: e.target.value })
                }
                className="w-full bg-slate-700 border-slate-600 rounded-md p-2 text-white text-sm"
              >
                <option value="">Par défaut</option>
                {MENU_BUTTON_COLORS.map((color) => (
                  <option key={color.value} value={color.value}>
                    {color.label} ({color.value})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-sm">Visible pour les serveurs</Label>
              <select
                value={editingItem ? ((editingItem as any).status ?? true ? "true" : "false") : newItem.status ? "true" : "false"}
                onChange={(e) =>
                  editingItem
                    ? setEditingItem({ ...editingItem, status: e.target.value === "true" })
                    : setNewItem({ ...newItem, status: e.target.value === "true" })
                }
                className="w-full bg-slate-700 border-slate-600 rounded-md p-2 text-white text-sm"
              >
                <option value="true">Oui</option>
                <option value="false">Non</option>
              </select>
            </div>
            <div>
              <Label className="text-sm">État de stock</Label>
              <select
                value={
                  editingItem ? (editingItem.out_of_stock ? "true" : "false") : newItem.out_of_stock ? "true" : "false"
                }
                onChange={(e) =>
                  editingItem
                    ? setEditingItem({ ...editingItem, out_of_stock: e.target.value === "true" })
                    : setNewItem({ ...newItem, out_of_stock: e.target.value === "true" })
                }
                className="w-full bg-slate-700 border-slate-600 rounded-md p-2 text-white text-sm"
              >
                <option value="false">En stock</option>
                <option value="true">Rupture</option>
              </select>
            </div>
            {/* Suggestion du chef */}
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-md">
              <div className="flex items-center gap-2">
                <Star className={`h-4 w-4 ${
                  (editingItem ? editingItem.is_piatto_del_giorno : false) ? "text-amber-400 fill-amber-400" : "text-slate-400"
                }`} />
                <Label className="text-sm cursor-pointer">Suggestion du chef</Label>
              </div>
              <button
                type="button"
                onClick={() =>
                  editingItem
                    ? setEditingItem({ ...editingItem, is_piatto_del_giorno: !editingItem.is_piatto_del_giorno })
                    : setNewItem({ ...newItem, is_piatto_del_giorno: !(newItem as any).is_piatto_del_giorno })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  (editingItem ? editingItem.is_piatto_del_giorno : (newItem as any).is_piatto_del_giorno)
                    ? "bg-amber-500"
                    : "bg-slate-600"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    (editingItem ? editingItem.is_piatto_del_giorno : (newItem as any).is_piatto_del_giorno)
                      ? "translate-x-6"
                      : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Allergen assignment */}
            {allergens.length > 0 && (
              <div className="md:col-span-2">
                <Label className="text-sm">Allergènes</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5 p-2 bg-slate-700/50 rounded-md max-h-32 overflow-y-auto">
                  {allergens.map((allergen) => {
                    const isSelected = itemAllergenIds.includes(allergen.id)
                    return (
                      <button
                        key={allergen.id}
                        type="button"
                        onClick={() => toggleItemAllergen(allergen.id)}
                        className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                          isSelected
                            ? "bg-amber-600 border-amber-500 text-white"
                            : "bg-slate-700 border-slate-600 text-slate-300 hover:border-amber-500"
                        }`}
                      >
                        {allergen.emoji} {allergen.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <Button onClick={handleSaveItem} className="w-full md:col-span-2 bg-blue-600 hover:bg-blue-700 text-sm">
              {editingItem ? "Enregistrer" : "Créer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog pour la gestion des allergènes */}
      <Dialog open={allergenDialog} onOpenChange={setAllergenDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-400" />
              Gérer les allergènes
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">
                {editingAllergen ? "Modifier l'allergène" : "Nouvel allergène"}
              </Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={newAllergenEmoji}
                  onChange={(e) => setNewAllergenEmoji(e.target.value)}
                  placeholder="Emoji"
                  className="bg-slate-700 border-slate-600 text-sm w-16 text-center"
                  maxLength={4}
                />
                <Input
                  value={newAllergenName}
                  onChange={(e) => setNewAllergenName(e.target.value)}
                  placeholder="Nom de l'allergène"
                  className="bg-slate-700 border-slate-600 text-sm flex-1"
                />
                <Button
                  onClick={handleSaveAllergen}
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-sm px-3"
                >
                  {editingAllergen ? <CheckCircle className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                </Button>
                {editingAllergen && (
                  <Button
                    onClick={() => {
                      setEditingAllergen(null)
                      setNewAllergenName("")
                      setNewAllergenEmoji("⚠️")
                    }}
                    size="sm"
                    variant="outline"
                    className="bg-slate-600 hover:bg-slate-500 text-sm px-3"
                  >
                    ✕
                  </Button>
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm">Allergènes existants ({allergens.length})</Label>
              <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                {allergens.length === 0 ? (
                  <p className="text-slate-400 text-sm">Aucun allergène</p>
                ) : (
                  allergens.map((allergen) => (
                    <div key={allergen.id} className="flex items-center justify-between p-2 bg-slate-700 rounded">
                      <span className="text-sm text-white">
                        {allergen.emoji} {allergen.name}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingAllergen(allergen)
                            setNewAllergenName(allergen.name)
                            setNewAllergenEmoji(allergen.emoji)
                          }}
                          className="bg-slate-600 hover:bg-slate-500 border-slate-500 text-white h-6 w-6 p-0"
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteAllergen(allergen.id)}
                          className="bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 h-6 w-6 p-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={colorHelpDialog} onOpenChange={setColorHelpDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Couleurs disponibles</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {MENU_BUTTON_COLORS.map((color) => (
              <div key={color.value} className="flex items-center justify-between rounded bg-slate-700/60 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-4 w-4 rounded-full ${color.swatchClassName}`} />
                  <span className="text-sm">{color.label}</span>
                </div>
                <span className="text-xs font-mono text-slate-300">{color.value}</span>
              </div>
            ))}
            <p className="text-xs text-slate-400">
              Utilise la valeur à droite dans le menu ou dans le CSV.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog pour la gestion des catégories */}
      <Dialog open={categoryDialog} onOpenChange={setCategoryDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Gérer les catégories</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">
                {editingCategory ? "Modifier la catégorie" : "Nouvelle catégorie"}
              </Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Nom de la catégorie"
                  className="bg-slate-700 border-slate-600 text-sm flex-1"
                />
                <Button
                  onClick={handleSaveCategory}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-sm px-3"
                >
                  {editingCategory ? <CheckCircle className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                </Button>
                {editingCategory && (
                  <Button
                    onClick={handleCancelEdit}
                    size="sm"
                    variant="outline"
                    className="bg-slate-600 hover:bg-slate-500 text-sm px-3"
                  >
                    ✕
                  </Button>
                )}
              </div>
            </div>
            
            <div>
              <Label className="text-sm">Catégories existantes</Label>
              <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                {categories.length === 0 ? (
                  <p className="text-slate-400 text-sm">Aucune catégorie</p>
                ) : (
                  categories.map((category, index) => (
                    <div key={category.id} className="flex items-center justify-between p-2 bg-slate-700 rounded">
                      <span className="text-sm text-white">{category.name}</span>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => moveCategory(category.id, "up")}
                          disabled={index === 0}
                          className="bg-slate-600 hover:bg-slate-500 border-slate-500 text-white h-6 w-6 p-0 disabled:opacity-50"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => moveCategory(category.id, "down")}
                          disabled={index === categories.length - 1}
                          className="bg-slate-600 hover:bg-slate-500 border-slate-500 text-white h-6 w-6 p-0 disabled:opacity-50"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditCategory(category.name)}
                          className="bg-slate-600 hover:bg-slate-500 border-slate-500 text-white h-6 w-6 p-0"
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteCategory(category.name)}
                          className="bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 h-6 w-6 p-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
