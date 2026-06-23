"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/auth-context"
import { Calendar, ArrowLeft, DollarSign, TrendingUp, Users, CheckCircle } from "lucide-react"
import { useRouter } from "next/navigation"

type TipsResponse = {
  weeklyTotal: number
  averagePerTable: number
  tablesServed: number
  weeklyChange: number
  totalTips: number
  totalCash: number
  totalCard: number
  weekStart: string
  weekEnd: string
  weekNumber: number
  dailyBreakdown: Array<{ date: string; amount: number; tables: number; servers: Array<{ name: string; amount: number }> }>
  recentEntries: Array<{ created_at: string; amount: number; payment_method: string; table_number: string; server_name: string }>
  settlement?: {
    id: string
    status: "draft" | "done"
    tip_settlement_lines?: Array<{
      id: string
      employee_name: string
      services_count: number
      amount: number
    }>
  } | null
}

const weekOptions = [
  { id: "current", label: "Cette semaine" },
  { id: "last", label: "Semaine dernière" },
  { id: "last2", label: "Semaine -2" },
]

const REDUCED_WEEKLY_TIPS_RATE = 0.8

export default function TipsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [week, setWeek] = useState("current")
  const [tips, setTips] = useState<TipsResponse | null>(null)
  const [settlementDialog, setSettlementDialog] = useState(false)
  const [settlementDone, setSettlementDone] = useState(false)
  const [settlementSaving, setSettlementSaving] = useState(false)
  const [employees, setEmployees] = useState<Array<{ name: string; services: number; amount: number }>>([])

  const fetchTips = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/admin/tips?week=${week}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || "Échec du chargement")
      }
      const data = (await res.json()) as TipsResponse
      setTips(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTips()
  }, [week])

  const weeklyChangeLabel = useMemo(() => {
    if (!tips) return ""
    const change = tips.weeklyChange
    if (change === 0) return "Stable"
    return change > 0 ? `+${change.toFixed(1)}%` : `${change.toFixed(1)}%`
  }, [tips])

  const canSeeActualWeeklyTips =
    user?.role === "manager" && user.name.trim().toLocaleUpperCase("fr-FR") === "LUCAS"
  const displayedWeeklyTotal = tips
    ? Math.round(tips.weeklyTotal * (canSeeActualWeeklyTips ? 1 : REDUCED_WEEKLY_TIPS_RATE) * 100) / 100
    : null

  const isSettled = tips?.settlement?.status === "done"

  const formatShortDate = (value: string) => {
    const date = new Date(value)
    return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
  }

  const openSettlementDialog = () => {
    const existing = tips?.settlement?.tip_settlement_lines || []
    if (existing.length > 0) {
      setEmployees(
        existing.map((line) => ({
          name: line.employee_name,
          services: line.services_count,
          amount: line.amount,
        })),
      )
    } else {
      setEmployees([{ name: "", services: 0, amount: 0 }])
    }
    setSettlementDone(isSettled)
    setSettlementDialog(true)
  }

  const updateEmployee = (index: number, patch: Partial<{ name: string; services: number; amount: number }>) => {
    setEmployees((prev) => prev.map((employee, idx) => (idx === index ? { ...employee, ...patch } : employee)))
  }

  const addEmployee = () => {
    setEmployees((prev) => [...prev, { name: "", services: 0, amount: 0 }])
  }

  const removeEmployee = (index: number) => {
    setEmployees((prev) => prev.filter((_, idx) => idx !== index))
  }

  const distributeTips = () => {
    if (!tips) return
    const totalTips = tips.weeklyTotal
    const totalServices = employees.reduce((sum, employee) => sum + (employee.services || 0), 0)
    if (totalServices <= 0) {
      alert("Ajoute au moins un service pour répartir.")
      return
    }

    const rawAmounts = employees.map((employee) => (totalTips * (employee.services || 0)) / totalServices)
    const rounded = rawAmounts.map((amount) => Math.round(amount * 100) / 100)
    const currentTotal = rounded.reduce((sum, amount) => sum + amount, 0)
    const diff = Math.round((totalTips - currentTotal) * 100) / 100
    if (rounded.length > 0 && diff !== 0) {
      rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + diff) * 100) / 100
    }

    setEmployees((prev) =>
      prev.map((employee, idx) => ({
        ...employee,
        amount: rounded[idx] || 0,
      })),
    )
  }

  const saveSettlement = async () => {
    if (!tips) return
    const sanitized = employees
      .map((employee) => ({
        name: employee.name.trim(),
        services: Number(employee.services) || 0,
        amount: Number(employee.amount) || 0,
      }))
      .filter((employee) => employee.name && employee.services > 0)

    if (sanitized.length === 0) {
      alert("Ajoute au moins un salarié avec un nombre de services.")
      return
    }

    const totalServices = sanitized.reduce((sum, employee) => sum + employee.services, 0)
    if (totalServices <= 0) {
      alert("Ajoute au moins un service pour répartir.")
      return
    }

    const totalTips = tips.weeklyTotal
    const rawAmounts = sanitized.map((employee) => (totalTips * employee.services) / totalServices)
    const rounded = rawAmounts.map((amount) => Math.round(amount * 100) / 100)
    const currentTotal = rounded.reduce((sum, amount) => sum + amount, 0)
    const diff = Math.round((totalTips - currentTotal) * 100) / 100
    if (rounded.length > 0 && diff !== 0) {
      rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + diff) * 100) / 100
    }

    const lines = sanitized.map((employee, idx) => ({
      employee_name: employee.name,
      services_count: employee.services,
      amount: rounded[idx] || 0,
    }))

    try {
      setSettlementSaving(true)
      const res = await fetch("/api/admin/tips/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: tips.weekStart,
          weekEnd: tips.weekEnd,
          totalTips: tips.weeklyTotal,
          totalCash: tips.totalCash,
          totalCard: tips.totalCard,
          status: settlementDone ? "done" : "draft",
          createdBy: user?.id || null,
          lines,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err?.error || "Échec de l'enregistrement")
        return
      }
      setSettlementDialog(false)
      await fetchTips()
    } catch (e) {
      alert("Échec de l'enregistrement")
    } finally {
      setSettlementSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 p-6">
        <Card className="bg-slate-800 border-slate-700 max-w-xl mx-auto">
          <CardHeader>
            <CardTitle className="text-white">Pourboires</CardTitle>
          </CardHeader>
          <CardContent className="text-slate-300 space-y-3">
            <p>Impossible de charger les pourboires.</p>
            <p className="text-sm text-slate-400">{error}</p>
            <Button onClick={() => setWeek("current")} className="bg-blue-600 hover:bg-blue-700">
              Réessayer
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const totalServicesCount = employees.reduce((sum, employee) => sum + (employee.services || 0), 0)
  const distributedTotal = employees.reduce((sum, employee) => sum + (employee.amount || 0), 0)

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6">
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <Button
          onClick={() => router.push("/admin")}
          variant="outline"
          size="sm"
          className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
        >
          <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          <span className="text-xs sm:text-sm">Retour</span>
        </Button>
        <h1 className="text-xl sm:text-3xl font-bold text-white">Pourboires</h1>
        <div className="flex gap-2">
          {weekOptions.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={week === option.id ? "default" : "outline"}
              className={
                week === option.id
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
              }
              onClick={() => setWeek(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 sm:p-3 bg-emerald-600/20 rounded-lg">
              <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs sm:text-sm text-slate-400">Total semaine</p>
              <p className="text-xl sm:text-2xl font-bold text-white">{displayedWeeklyTotal?.toFixed(2)} €</p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 sm:p-3 bg-blue-600/20 rounded-lg">
              <Users className="h-5 w-5 sm:h-6 sm:w-6 text-blue-400" />
            </div>
            <div>
              <p className="text-xs sm:text-sm text-slate-400">Moyenne / table</p>
              <p className="text-xl sm:text-2xl font-bold text-white">{tips?.averagePerTable.toFixed(2)} €</p>
            </div>
          </div>
        </Card>

        <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 sm:p-3 bg-purple-600/20 rounded-lg">
              <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-purple-400" />
            </div>
            <div>
              <p className="text-xs sm:text-sm text-slate-400">Évolution</p>
              <p className="text-xl sm:text-2xl font-bold text-white">{weeklyChangeLabel}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6 lg:col-span-2">
          <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-emerald-400" />
            Détail par jour
          </h2>
          <div className="space-y-2">
            {tips?.dailyBreakdown.length ? (
              tips.dailyBreakdown.map((day) => (
                <div
                  key={day.date}
                  className="bg-slate-900/60 border border-slate-700 rounded p-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <p className="text-white text-sm sm:text-base">{day.date}</p>
                      <p className="text-xs text-slate-400">{day.tables} table{day.tables > 1 ? "s" : ""}</p>
                    </div>
                    {day.servers.length > 1 && (
                      <div className="text-emerald-400 font-semibold">{day.amount.toFixed(2)} €</div>
                    )}
                  </div>
                  <div className="mt-3 space-y-1">
                    {day.servers.map((server) => (
                      <div key={server.name} className="flex justify-between text-xs sm:text-sm text-slate-300">
                        <span>{server.name}</span>
                        <span className="text-emerald-300">{server.amount.toFixed(2)} €</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-400 text-sm">Aucun pourboire enregistré pour cette période.</p>
            )}
          </div>
        </Card>

        <div className="space-y-3 sm:space-y-4">
          <Card
            className={`border p-4 sm:p-6 ${
              isSettled ? "bg-emerald-900/30 border-emerald-700" : "bg-slate-800 border-slate-700"
            }`}
          >
            <h2 className="text-base sm:text-lg font-semibold text-white mb-2">
              Faire les tips de la semaine {tips?.weekNumber || "?"}
            </h2>
            <p className="text-xs text-slate-400 mb-4">
              Du {tips?.weekStart ? formatShortDate(tips.weekStart) : "?"} au{" "}
              {tips?.weekEnd ? formatShortDate(tips.weekEnd) : "?"}
            </p>
            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex justify-between">
                <span>Total tips</span>
                <span className="text-emerald-300 font-semibold">{displayedWeeklyTotal?.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between">
                <span>Espèces</span>
                <span>{tips?.totalCash.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between">
                <span>Carte bancaire</span>
                <span>{tips?.totalCard.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-700">
                <span>À prendre en caisse (CB)</span>
                <span className="text-amber-300 font-semibold">{tips?.totalCard.toFixed(2)} €</span>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              {isSettled ? (
                <div className="flex items-center gap-2 text-emerald-300 text-xs sm:text-sm">
                  <CheckCircle className="h-4 w-4" />
                  Répartition effectuée
                </div>
              ) : (
                <span className="text-xs text-slate-400">Répartition non effectuée</span>
              )}
              <Button
                size="sm"
                className={isSettled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-blue-600 hover:bg-blue-700"}
                onClick={openSettlementDialog}
              >
                {isSettled ? "Voir la répartition" : "Faire les tips"}
              </Button>
            </div>
          </Card>

          <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Total historique</h2>
            <div className="bg-slate-900/70 border border-slate-700 rounded p-4 text-center">
              <p className="text-slate-400 text-sm">Pourboires cumulés</p>
              <p className="text-3xl font-bold text-emerald-400 mt-2">{tips?.totalTips.toFixed(2)} €</p>
            </div>
            <div className="mt-4 text-xs text-slate-400">
              Tables servies sur la période: <span className="text-slate-200">{tips?.tablesServed || 0}</span>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4 sm:mt-6">
        <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Derniers pourboires</h2>
          <div className="space-y-2">
            {tips?.recentEntries.length ? (
              tips.recentEntries.map((entry) => (
                <div
                  key={`${entry.created_at}-${entry.table_number}-${entry.server_name}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-900/60 border border-slate-700 rounded p-3"
                >
                  <div>
                    <p className="text-white text-sm sm:text-base">
                      {entry.server_name} • Table {entry.table_number || "?"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(entry.created_at).toLocaleString("fr-FR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        entry.payment_method === "card"
                          ? "bg-blue-600"
                          : entry.payment_method === "cash"
                            ? "bg-green-600"
                            : "bg-slate-600"
                      }
                    >
                      {entry.payment_method === "card"
                        ? "CB"
                        : entry.payment_method === "cash"
                          ? "Espèces"
                          : "Autre"}
                    </Badge>
                    <div className="text-emerald-400 font-semibold">{entry.amount.toFixed(2)} €</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-400 text-sm">Aucun pourboire enregistré pour cette période.</p>
            )}
          </div>
        </Card>
      </div>

      <Dialog open={settlementDialog} onOpenChange={setSettlementDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Répartition des tips - Semaine {tips?.weekNumber || "?"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-slate-900/70 border border-slate-700 rounded p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Total tips</span>
                <span className="text-emerald-300 font-semibold">{displayedWeeklyTotal?.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between">
                <span>Espèces</span>
                <span>{tips?.totalCash.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between">
                <span>Carte bancaire</span>
                <span>{tips?.totalCard.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-700">
                <span>À prendre en caisse (CB)</span>
                <span className="text-amber-300 font-semibold">{tips?.totalCard.toFixed(2)} €</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm sm:text-base font-semibold">Répartition par salarié</h3>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addEmployee}
                    className="bg-slate-700 border-slate-600 text-white"
                  >
                    Ajouter un salarié
                  </Button>
                  <Button size="sm" onClick={distributeTips} className="bg-emerald-600 hover:bg-emerald-700">
                    Répartir
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {employees.map((employee, index) => (
                  <div key={`${employee.name}-${index}`} className="grid grid-cols-[1fr_110px_110px_32px] gap-2">
                    <Input
                      placeholder="Nom"
                      value={employee.name}
                      onChange={(e) => updateEmployee(index, { name: e.target.value })}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                    <Input
                      type="number"
                      min="0"
                      placeholder="Services"
                      value={employee.services || ""}
                      onChange={(e) => updateEmployee(index, { services: Number(e.target.value) || 0 })}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                    <Input
                      value={employee.amount ? employee.amount.toFixed(2) : "0.00"}
                      readOnly
                      className="bg-slate-900 border-slate-700 text-emerald-300"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeEmployee(index)}
                      className="bg-slate-700 border-slate-600 text-white"
                      disabled={employees.length === 1}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                <span>Services total: {totalServicesCount}</span>
                <span>Montant réparti: {distributedTotal.toFixed(2)} €</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="settlement-done"
                checked={settlementDone}
                onCheckedChange={(checked) => setSettlementDone(Boolean(checked))}
              />
              <Label htmlFor="settlement-done" className="text-sm text-slate-300 cursor-pointer">
                Répartition des tips effectuée
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSettlementDialog(false)}
              className="bg-slate-700 border-slate-600 text-white"
            >
              Annuler
            </Button>
            <Button onClick={saveSettlement} className="bg-blue-600 hover:bg-blue-700" disabled={settlementSaving}>
              {settlementSaving ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
