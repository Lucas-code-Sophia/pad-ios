"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ArrowLeft,
  Users,
  Download,
  MenuIcon,
  Printer,
  Upload,
  Table2,
  TrendingUp,
  History,
  Gift,
  FileText,
  BarChart3,
  Calendar,
  DollarSign,
  LayoutGrid,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { DailySales, User } from "@/lib/types"

export default function AdminPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [dailySales, setDailySales] = useState<DailySales | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: "", pin: "", role: "server" as "server" | "manager" })
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [exportingMenu, setExportingMenu] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editUserDialog, setEditUserDialog] = useState(false)
  const [showUsersDialog, setShowUsersDialog] = useState(false)

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user?.role === "manager") {
      fetchDailySales()
      fetchUsers()
    }
  }, [user])

  const fetchDailySales = async () => {
    try {
      const response = await fetch("/api/admin/sales/daily")
      if (response.ok) {
        const data = await response.json()
        setDailySales(data)
      }
    } catch (error) {
      console.error("[v0] Error fetching sales:", error)
    }
  }

  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/admin/users")
      if (response.ok) {
        const data = await response.json()
        setUsers(data)
      }
    } catch (error) {
      console.error("[v0] Error fetching users:", error)
    }
  }

  const handleAddUser = async () => {
    if (newUser.pin.length !== 6) {
      alert("Le code PIN doit contenir exactement 6 chiffres")
      return
    }
    
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      })

      if (response.ok) {
        setShowAddUser(false)
        setNewUser({ name: "", pin: "", role: "server" })
        fetchUsers()
      }
    } catch (error) {
      console.error("[v0] Error adding user:", error)
    }
  }

  const handleEditUser = async () => {
    if (!editingUser) return

    // Valider le PIN seulement s'il est fourni (non vide)
    if (editingUser.pin && editingUser.pin.length !== 6) {
      alert("Le code PIN doit contenir exactement 6 chiffres")
      return
    }

    try {
      const response = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingUser.name,
          pin: editingUser.pin,
        }),
      })

      if (response.ok) {
        setEditUserDialog(false)
        setEditingUser(null)
        fetchUsers()
      }
    } catch (error) {
      console.error("[v0] Error editing user:", error)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cet utilisateur ?")) return

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      })

      if (response.ok) {
        fetchUsers()
      }
    } catch (error) {
      console.error("[v0] Error deleting user:", error)
    }
  }

  const handleToggleDisabled = async (userId: string, disabled: boolean) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      })

      if (response.ok) {
        fetchUsers()
      }
    } catch (error) {
      console.error("[v0] Error toggling user disabled:", error)
    }
  }

  const handleToggleBillAccess = async (userId: string, canAccessBill: boolean) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ can_access_bill: canAccessBill }),
      })

      if (response.ok) {
        fetchUsers()
        return
      }

      const error = await response.json().catch(() => ({}))
      alert(error?.error || "Impossible de modifier l'accès addition")
    } catch (error) {
      console.error("[v0] Error toggling bill access:", error)
      alert("Erreur lors de la mise à jour du droit addition")
    }
  }

  const handleExportSales = async () => {
    try {
      const response = await fetch("/api/admin/sales/export")
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `ventes_${new Date().toISOString().split("T")[0]}.csv`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }
    } catch (error) {
      console.error("[v0] Error exporting sales:", error)
    }
  }

  const handleImportMenu = async () => {
    if (!csvFile) return

    const formData = new FormData()
    formData.append("file", csvFile)

    try {
      const response = await fetch("/api/admin/menu/import", {
        method: "POST",
        body: formData,
      })

      if (response.ok) {
        const result = await response.json().catch(() => ({}))
        const imported = Number(result?.imported || 0)
        const skipped = Number(result?.skipped || 0)
        alert(`Menu importé avec succès (${imported} lignes importées${skipped > 0 ? `, ${skipped} ignorées` : ""})`)
        setCsvFile(null)
      } else {
        const error = await response.json()
        alert(`Erreur: ${error.error}`)
      }
    } catch (error) {
      console.error("[v0] Error importing menu:", error)
      alert("Erreur lors de l'import")
    }
  }

  const handleExportMenu = async () => {
    try {
      setExportingMenu(true)
      const response = await fetch("/api/admin/menu/export")

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        alert(error?.error || "Erreur lors de l'export du menu")
        return
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `menu_export_${new Date().toISOString().split("T")[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error("[v0] Error exporting menu:", error)
      alert("Erreur lors de l'export du menu")
    } finally {
      setExportingMenu(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  if (!user || user.role !== "manager") {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6">
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
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
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-white">Administration</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">Gérez votre restaurant en toute simplicité</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <Card className="bg-gradient-to-br from-blue-600 to-blue-700 border-blue-500">
          <CardHeader className="pb-2 p-3 sm:p-6">
            <CardTitle className="text-xs sm:text-sm font-medium text-blue-100">Ventes du jour (TTC)</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-3xl font-bold text-white">
              {dailySales?.total_sales.toFixed(2) || "0.00"}€
            </div>
            <p className="text-xs text-blue-200 mt-1">HT : {dailySales?.total_sales_ht.toFixed(2) || "0.00"}€</p>
            <p className="text-xs text-blue-200 mt-1">
              <TrendingUp className="h-3 w-3 inline mr-1" />
              {dailySales?.order_count || 0} commandes
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-600 to-green-700 border-green-500">
          <CardHeader className="pb-2 p-3 sm:p-6">
            <CardTitle className="text-xs sm:text-sm font-medium text-green-100">TVA collectée</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-3xl font-bold text-white">
              {dailySales?.total_tax.toFixed(2) || "0.00"}€
            </div>
            <p className="text-xs text-green-200 mt-1">Taxes du jour</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-600 to-purple-700 border-purple-500">
          <CardHeader className="pb-2 p-3 sm:p-6">
            <CardTitle className="text-xs sm:text-sm font-medium text-purple-100">Ticket moyen</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-3xl font-bold text-white">
              {dailySales?.average_ticket.toFixed(2) || "0.00"}€
            </div>
            <p className="text-xs text-purple-200 mt-1">Par commande</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-600 to-orange-700 border-orange-500">
          <CardHeader className="pb-2 p-3 sm:p-6">
            <CardTitle className="text-xs sm:text-sm font-medium text-orange-100">Utilisateurs</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-xl sm:text-3xl font-bold text-white">{users.length}</div>
            <p className="text-xs text-orange-200 mt-1">Serveurs actifs</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card
          className="bg-slate-800 border-slate-700 hover:border-blue-500 transition-colors cursor-pointer"
          onClick={() => setShowUsersDialog(true)}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-blue-600 rounded-lg">
                <Users className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Utilisateurs</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Gérer les serveurs</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">
              Créer, modifier et supprimer les comptes serveurs et managers
            </p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-blue-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/planning")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Calendar className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Planning</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">
                  Gestion des plannings
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">
              Créer et gérer les dossiers de planning du personnel
            </p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-teal-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/recruitment")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-teal-600 rounded-lg">
                <Users className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Recrutement</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Gestion des candidatures</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">
              Suivi des candidatures, CV et entretiens
            </p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-green-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/tables")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-green-600 rounded-lg">
                <Table2 className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Tables</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">
                  Configuration des tables
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">
              Modifier les noms et la disposition des tables du restaurant
            </p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-sky-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/floor-plan-layout")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-sky-600 rounded-lg">
                <LayoutGrid className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Plan de salle</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">
                  Dispositions disponibles
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">
              Choisir la disposition active pour tous les serveurs
            </p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-purple-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/menu-editor")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-purple-600 rounded-lg">
                <MenuIcon className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Menu</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Éditeur de menu</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">Ajouter, modifier et organiser les plats et boissons</p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-pink-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/reports")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-pink-600 rounded-lg">
                <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Rapports</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Analyses avancées</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">Graphiques de ventes, top plats et statistiques</p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-emerald-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/tips")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-emerald-600 rounded-lg">
                <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Pourboires</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Récapitulatif hebdomadaire</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">Total et répartition des pourboires</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-700 hover:border-orange-500 transition-colors">
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-orange-600 rounded-lg">
                <Upload className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Import Excel / CSV</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Importer un menu avec détails</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 sm:p-6 pt-0">
            <Input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              className="bg-slate-700 border-slate-600 text-white text-sm"
            />
            <Button
              onClick={handleImportMenu}
              disabled={!csvFile}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
              size="sm"
            >
              Importer
            </Button>
            <Button
              onClick={handleExportMenu}
              disabled={exportingMenu}
              className="w-full bg-cyan-600 hover:bg-cyan-700 text-white border border-cyan-500 disabled:opacity-50"
              size="sm"
            >
              {exportingMenu ? "Export en cours..." : "Exporter le menu actuel (.csv)"}
            </Button>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-cyan-500 transition-colors cursor-pointer"
          onClick={handleExportSales}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-cyan-600 rounded-lg">
                <Download className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Export</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Exporter les ventes</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">Télécharger un fichier CSV des ventes du jour</p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-yellow-500 transition-colors cursor-pointer"
          onClick={() => router.push("/history")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-yellow-600 rounded-lg">
                <History className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Historique</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Ventes et statistiques</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">Consulter l'historique des ventes et stats par serveur</p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-green-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/complimentary")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-green-600 rounded-lg">
                <Gift className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Articles Offerts</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Suivi des offerts</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">Consulter tous les articles offerts avec traçabilité</p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-rose-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/print-preview")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-rose-600 rounded-lg">
                <Printer className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Aperçu Tickets</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Visualiser les formats</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">Ticket caisse, cuisine et bar en un coup d'œil</p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-slate-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/printing")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-slate-600 rounded-lg">
                <Printer className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Impression</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Parametres centralises</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">
              Un seul ecran pour regler les IP et le mode d'impression pour tous les appareils.
            </p>
          </CardContent>
        </Card>

        <Card
          className="bg-slate-800 border-slate-700 hover:border-indigo-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/settings")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-indigo-600 rounded-lg">
                <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Documentation</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Fonctionnalités</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">Liste complète des fonctionnalités par rôle</p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showUsersDialog} onOpenChange={setShowUsersDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Gestion des utilisateurs</DialogTitle>
                <DialogDescription className="text-slate-400">Créer et gérer les comptes serveurs</DialogDescription>
              </div>
              <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
                <DialogTrigger asChild>
                  <Button className="bg-green-600 hover:bg-green-700">
                    <Users className="h-4 w-4 mr-2" />
                    Ajouter
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-md">
                  <DialogHeader>
                    <DialogTitle>Créer un nouvel utilisateur</DialogTitle>
                    <DialogDescription className="text-slate-400">
                      Ajouter un compte serveur ou manager
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Nom</Label>
                      <Input
                        value={newUser.name}
                        onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                        className="bg-slate-700 border-slate-600"
                        placeholder="Nom du serveur"
                      />
                    </div>
                    <div>
                      <Label>Code PIN (6 chiffres)</Label>
                      <Input
                        type="password"
                        maxLength={6}
                        value={newUser.pin}
                        onChange={(e) => setNewUser({ ...newUser, pin: e.target.value })}
                        className="bg-slate-700 border-slate-600"
                        placeholder="123456"
                      />
                    </div>
                    <div>
                      <Label>Rôle</Label>
                      <select
                        value={newUser.role}
                        onChange={(e) => setNewUser({ ...newUser, role: e.target.value as "server" | "manager" })}
                        className="w-full bg-slate-700 border-slate-600 rounded-md p-2 text-white"
                      >
                        <option value="server">Serveur</option>
                        <option value="manager">Manager</option>
                      </select>
                    </div>
                    <Button onClick={handleAddUser} className="w-full bg-green-600 hover:bg-green-700">
                      Créer l'utilisateur
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </DialogHeader>
          <div className="space-y-2 mt-4">
            {users.map((u) => (
              <Card key={u.id} className="bg-slate-700 border-slate-600 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-white flex items-center gap-2">
                      <span className="truncate max-w-[40vw] md:max-w-[28rem]">{u.name}</span>
                      {u.disabled && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-500 text-white/90 uppercase tracking-wide">Off</span>
                      )}
                    </div>
                    <div className="text-sm text-slate-300 flex flex-wrap items-center gap-2">
                      <span>{u.role === "manager" ? "Manager" : "Serveur"}</span>
                      {u.role === "server" && (
                        <>
                          <span className="text-slate-600">•</span>
                          <span className={u.can_access_bill ? "text-blue-300" : "text-slate-400"}>
                            Addition: {u.can_access_bill ? "autorisée" : "masquée"}
                          </span>
                        </>
                      )}
                      <span className="text-slate-600">•</span>
                      <span>PIN: <span className="font-mono font-bold text-blue-400">{u.pin}</span></span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingUser(u)
                        setEditUserDialog(true)
                      }}
                      className="bg-slate-600 hover:bg-slate-500 border-slate-500"
                    >
                      Modifier
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggleDisabled(u.id, !u.disabled)}
                      className={`${u.disabled ? "bg-green-900/30 hover:bg-green-900/50 border-green-700 text-green-400" : "bg-yellow-900/30 hover:bg-yellow-900/50 border-yellow-700 text-yellow-400"}`}
                    >
                      {u.disabled ? "Activer" : "Désactiver"}
                    </Button>
                    {u.role === "server" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleBillAccess(u.id, !u.can_access_bill)}
                        className={`${u.can_access_bill ? "bg-blue-900/30 hover:bg-blue-900/50 border-blue-700 text-blue-300" : "bg-slate-900/40 hover:bg-slate-900/60 border-slate-500 text-slate-300"}`}
                      >
                        {u.can_access_bill ? "Addition ON" : "Addition OFF"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteUser(u.id)}
                      className="bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400"
                    >
                      Supprimer
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editUserDialog} onOpenChange={setEditUserDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700">
          <DialogHeader>
            <DialogTitle>Modifier l'utilisateur</DialogTitle>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4">
              <div>
                <Label>Nom</Label>
                <Input
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="bg-slate-700 border-slate-600"
                />
              </div>
              <div>
                <Label>Nouveau PIN (6 chiffres)</Label>
                <Input
                  type="password"
                  maxLength={6}
                  value={editingUser.pin || ""}
                  onChange={(e) => setEditingUser({ ...editingUser, pin: e.target.value })}
                  className="bg-slate-700 border-slate-600"
                  placeholder="Laisser vide pour ne pas changer"
                />
              </div>
              <Button onClick={handleEditUser} className="w-full bg-blue-600 hover:bg-blue-700">
                Enregistrer les modifications
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
