"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import type { Table } from "@/lib/types"
import { sortTablesForDisplay } from "@/lib/table-sort"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Edit2, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function TablesManagementPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)
  const [editingTable, setEditingTable] = useState<Table | null>(null)
  const [editDialog, setEditDialog] = useState(false)
  const [newTableName, setNewTableName] = useState("")

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user?.role === "manager") {
      fetchTables()
    }
  }, [user])

  const fetchTables = async () => {
    try {
      const response = await fetch("/api/tables")
      if (response.ok) {
        const data = await response.json()
        setTables(sortTablesForDisplay(data))
      }
    } catch (error) {
      console.error("[v0] Error fetching tables:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleRenameTable = async () => {
    if (!editingTable || !newTableName) return

    try {
      const response = await fetch(`/api/tables/${editingTable.id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table_number: newTableName }),
      })

      if (response.ok) {
        setEditDialog(false)
        setEditingTable(null)
        setNewTableName("")
        fetchTables()
      }
    } catch (error) {
      console.error("[v0] Error renaming table:", error)
    }
  }

  const handleDeleteTable = async (tableId: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette table ?")) return

    try {
      const response = await fetch(`/api/tables/${tableId}`, {
        method: "DELETE",
      })

      if (response.ok) {
        fetchTables()
      }
    } catch (error) {
      console.error("[v0] Error deleting table:", error)
    }
  }

  if (isLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6">
      <div className="mb-4 sm:mb-6 flex items-center justify-between gap-3">
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
          <h1 className="text-xl sm:text-3xl font-bold text-white">Gestion des tables</h1>
        </div>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-white text-base sm:text-lg">Tables du restaurant</CardTitle>
          <CardDescription className="text-slate-400 text-xs sm:text-sm">
            Modifier les noms des tables de façon permanente
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
            {tables.map((table) => (
              <Card key={table.id} className="bg-slate-700 border-slate-600 p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-base sm:text-lg text-white truncate">{table.table_number}</div>
                    <div className="text-xs sm:text-sm text-slate-400">{table.seats} places</div>
                  </div>
                  <div className="flex gap-1.5 sm:gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingTable(table)
                        setNewTableName(table.table_number)
                        setEditDialog(true)
                      }}
                      className="bg-slate-600 hover:bg-slate-500 border-slate-500 h-8 w-8 sm:h-9 sm:w-9 p-0"
                    >
                      <Edit2 className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteTable(table.id)}
                      className="bg-red-900/30 hover:bg-red-900/50 border-red-700 text-red-400 h-8 w-8 sm:h-9 sm:w-9 p-0"
                    >
                      <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Renommer la table</DialogTitle>
            <DialogDescription className="text-slate-400 text-xs sm:text-sm">
              Modifier le nom de la table {editingTable?.table_number}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 sm:space-y-4">
            <div>
              <Label className="text-sm">Nouveau nom de table</Label>
              <Input
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                className="bg-slate-700 border-slate-600 text-sm"
                placeholder="Ex: T1, I5, C2..."
              />
            </div>
            <Button onClick={handleRenameTable} className="w-full bg-blue-600 hover:bg-blue-700 text-sm">
              Enregistrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
