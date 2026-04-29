"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, AlertTriangle, RefreshCw, RotateCcw, Save, Wine } from "lucide-react"
import type { WineInventorySummary } from "@/lib/types"

type WineInventoryLineDraft = {
  currentBottles: string
  isActive: boolean
  glassMenuItemIds: string[]
}

const parseInputNumber = (raw: string) => {
  const normalized = String(raw || "").replace(",", ".").trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

const formatStock = (value: number) => {
  if (!Number.isFinite(value)) return "0.00"
  return value.toFixed(2)
}

const formatDateTime = (value: string | null) => {
  if (!value) return "Non démarré"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Non démarré"
  return date.toLocaleString("fr-FR")
}

const buildLineDrafts = (summary: WineInventorySummary): Record<string, WineInventoryLineDraft> => {
  const nextDrafts: Record<string, WineInventoryLineDraft> = {}
  for (const item of summary.items) {
    nextDrafts[item.id] = {
      currentBottles: formatStock(item.currentBottles),
      isActive: item.isActive,
      glassMenuItemIds: item.links.map((link) => link.glassMenuItemId),
    }
  }
  return nextDrafts
}

const buildRecountDrafts = (summary: WineInventorySummary): Record<string, string> => {
  const nextDrafts: Record<string, string> = {}
  for (const item of summary.items) {
    nextDrafts[item.id] = formatStock(item.currentBottles)
  }
  return nextDrafts
}

const getGaugeFillClass = (gauge: "green" | "yellow" | "red" | "inactive") => {
  switch (gauge) {
    case "red":
      return "bg-red-500"
    case "yellow":
      return "bg-amber-400"
    case "inactive":
      return "bg-slate-500"
    case "green":
    default:
      return "bg-emerald-500"
  }
}

const getGaugeLabel = (gauge: "green" | "yellow" | "red" | "inactive") => {
  switch (gauge) {
    case "red":
      return "Critique"
    case "yellow":
      return "Surveillance"
    case "inactive":
      return "Désactivé"
    case "green":
    default:
      return "OK"
  }
}

export default function WineInventoryPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  const [summary, setSummary] = useState<WineInventorySummary | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [settingsDraft, setSettingsDraft] = useState({ redThreshold: "3", yellowThreshold: "5" })
  const [savingSettings, setSavingSettings] = useState(false)

  const [lineDrafts, setLineDrafts] = useState<Record<string, WineInventoryLineDraft>>({})
  const [savingLines, setSavingLines] = useState<Record<string, boolean>>({})

  const [recountMode, setRecountMode] = useState(false)
  const [recountDrafts, setRecountDrafts] = useState<Record<string, string>>({})
  const [savingRecount, setSavingRecount] = useState(false)
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")

  const [bootstrapping, setBootstrapping] = useState(false)

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [isLoading, router, user])

  const fetchSummary = async () => {
    try {
      setLoadingData(true)
      setErrorMessage(null)
      const response = await fetch("/api/admin/wine-inventory")
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        setSummary(null)
        setErrorMessage(payload?.error || "Impossible de charger l'inventaire vin.")
        return
      }

      setSummary(payload as WineInventorySummary)
    } catch (error) {
      console.error("[v0] Error fetching wine inventory summary:", error)
      setSummary(null)
      setErrorMessage("Erreur réseau pendant le chargement de l'inventaire vin.")
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    if (user?.role === "manager") {
      fetchSummary()
    }
  }, [user])

  useEffect(() => {
    if (!summary) return
    setSettingsDraft({
      redThreshold: formatStock(summary.settings.redThreshold),
      yellowThreshold: formatStock(summary.settings.yellowThreshold),
    })
    setLineDrafts(buildLineDrafts(summary))
    setRecountDrafts(buildRecountDrafts(summary))
  }, [summary])

  const sortedItems = useMemo(() => {
    const items = [...(summary?.items || [])]
    items.sort((a, b) => {
      const delta = sortDirection === "asc" ? a.currentBottles - b.currentBottles : b.currentBottles - a.currentBottles
      if (delta !== 0) return delta
      return a.bottleName.localeCompare(b.bottleName, "fr", { sensitivity: "base" })
    })
    return items
  }, [summary, sortDirection])

  const saveSettings = async () => {
    const redThreshold = parseInputNumber(settingsDraft.redThreshold)
    const yellowThreshold = parseInputNumber(settingsDraft.yellowThreshold)

    if (redThreshold === null || yellowThreshold === null) {
      alert("Seuils invalides")
      return
    }

    if (yellowThreshold < redThreshold) {
      alert("Le seuil jaune doit être supérieur ou égal au seuil rouge")
      return
    }

    try {
      setSavingSettings(true)
      const response = await fetch("/api/admin/wine-inventory/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redThreshold,
          yellowThreshold,
          userId: user?.id,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(payload?.error || "Impossible de sauvegarder les seuils")
        return
      }

      await fetchSummary()
    } catch (error) {
      console.error("[v0] Error saving wine inventory settings:", error)
      alert("Erreur réseau pendant la sauvegarde des seuils")
    } finally {
      setSavingSettings(false)
    }
  }

  const saveLine = async (itemId: string) => {
    const draft = lineDrafts[itemId]
    if (!draft) return

    const parsedStock = parseInputNumber(draft.currentBottles)
    if (parsedStock === null) {
      alert("Stock invalide")
      return
    }

    try {
      setSavingLines((prev) => ({ ...prev, [itemId]: true }))
      const response = await fetch(`/api/admin/wine-inventory/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentBottles: parsedStock,
          isActive: draft.isActive,
          glassMenuItemIds: draft.glassMenuItemIds,
          userId: user?.id,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(payload?.error || "Impossible de sauvegarder cette ligne")
        return
      }

      await fetchSummary()
    } catch (error) {
      console.error("[v0] Error saving wine inventory row:", error)
      alert("Erreur réseau pendant la sauvegarde")
    } finally {
      setSavingLines((prev) => ({ ...prev, [itemId]: false }))
    }
  }

  const handleBootstrap = async () => {
    try {
      setBootstrapping(true)
      const response = await fetch("/api/admin/wine-inventory/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user?.id }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(payload?.error || "Impossible d'initialiser l'inventaire vin")
        return
      }

      const created = Number(payload?.createdItemsCount || 0)
      const links = Number(payload?.proposedLinksCount || 0)
      const unmatched = Number(payload?.unmatchedGlassCount || 0)
      const message = payload?.message ? `${payload.message}\n` : ""
      alert(
        `${message}Initialisation terminée.\n- Références créées: ${created}\n- Liaisons verre proposées: ${links}\n- Verres non rapprochés: ${unmatched}`,
      )
      await fetchSummary()
    } catch (error) {
      console.error("[v0] Error bootstrapping wine inventory:", error)
      alert("Erreur réseau pendant l'initialisation")
    } finally {
      setBootstrapping(false)
    }
  }

  const resetRecountDrafts = () => {
    if (!summary) return
    setRecountDrafts(buildRecountDrafts(summary))
  }

  const validateRecount = async () => {
    if (!summary) return

    const items = summary.items.map((item) => {
      const parsed = parseInputNumber(recountDrafts[item.id] || "")
      return {
        wineInventoryItemId: item.id,
        currentBottles: parsed,
      }
    })

    const hasInvalid = items.some((row) => row.currentBottles === null)
    if (hasInvalid) {
      alert("Certaines valeurs de recomptage sont invalides")
      return
    }

    try {
      setSavingRecount(true)
      const response = await fetch("/api/admin/wine-inventory/recount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user?.id,
          items: items.map((row) => ({
            wineInventoryItemId: row.wineInventoryItemId,
            currentBottles: row.currentBottles,
          })),
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(payload?.error || "Impossible de valider le recomptage")
        return
      }

      const updatedCount = Number(payload?.updatedCount || 0)
      alert(`Recomptage validé (${updatedCount} lignes). Le suivi repart à partir de maintenant.`)
      setRecountMode(false)
      await fetchSummary()
    } catch (error) {
      console.error("[v0] Error applying wine recount:", error)
      alert("Erreur réseau pendant la validation du recomptage")
    } finally {
      setSavingRecount(false)
    }
  }

  if (isLoading || loadingData) {
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
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            onClick={() => router.push("/admin")}
            variant="outline"
            size="sm"
            className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-white">Inventaire vin</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">Suivi séparé des bouteilles et des ventes verre/bouteille</p>
          </div>
        </div>
        <Button onClick={fetchSummary} className="bg-slate-700 hover:bg-slate-600">
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualiser
        </Button>
      </div>

      {errorMessage && (
        <Card className="mb-6 bg-red-950/40 border-red-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-red-300 flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5" />
              Module indisponible
            </CardTitle>
            <CardDescription className="text-red-200">{errorMessage}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-slate-200 text-sm">Références suivies</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-white text-2xl font-bold">{summary.items.length}</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-slate-200 text-sm">Références critiques</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-red-400 text-2xl font-bold">{summary.criticalCount}</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-slate-200 text-sm">Seuil rouge</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-white text-2xl font-bold">{formatStock(summary.settings.redThreshold)}</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-slate-200 text-sm">Suivi démarré</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-slate-200 text-sm">{formatDateTime(summary.settings.trackingStartedAt)}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-lg">Seuils de jauge</CardTitle>
                <CardDescription className="text-slate-400">
                  Le badge admin utilise le seuil rouge courant.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-slate-300">Seuil rouge</Label>
                    <Input
                      value={settingsDraft.redThreshold}
                      onChange={(event) =>
                        setSettingsDraft((prev) => ({ ...prev, redThreshold: event.target.value }))
                      }
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Seuil jaune</Label>
                    <Input
                      value={settingsDraft.yellowThreshold}
                      onChange={(event) =>
                        setSettingsDraft((prev) => ({ ...prev, yellowThreshold: event.target.value }))
                      }
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                  </div>
                </div>
                <Button onClick={saveSettings} disabled={savingSettings} className="bg-blue-600 hover:bg-blue-700">
                  <Save className="h-4 w-4 mr-2" />
                  {savingSettings ? "Enregistrement..." : "Sauvegarder les seuils"}
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-lg">Actions inventaire</CardTitle>
                <CardDescription className="text-slate-400">
                  Recompter complètement redémarre le suivi des déductions à la validation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button onClick={handleBootstrap} disabled={bootstrapping} className="bg-violet-600 hover:bg-violet-700 w-full">
                  <Wine className="h-4 w-4 mr-2" />
                  {bootstrapping ? "Initialisation..." : "Initialiser les liaisons (setup)"}
                </Button>
                <Button
                  onClick={() => {
                    if (!recountMode) {
                      resetRecountDrafts()
                    }
                    setRecountMode((prev) => !prev)
                  }}
                  className="bg-amber-600 hover:bg-amber-700 w-full"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {recountMode ? "Fermer le recomptage" : "Refaire inventaire"}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="mb-4 flex items-center gap-2">
            <span className="text-slate-300 text-sm">Trier par stock :</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSortDirection("asc")}
              className={
                sortDirection === "asc"
                  ? "bg-slate-600 text-white border-slate-500"
                  : "bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-700"
              }
            >
              Croissant
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSortDirection("desc")}
              className={
                sortDirection === "desc"
                  ? "bg-slate-600 text-white border-slate-500"
                  : "bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-700"
              }
            >
              Décroissant
            </Button>
          </div>

          {recountMode && (
            <Card className="bg-slate-800 border-amber-600 mb-6">
              <CardHeader>
                <CardTitle className="text-white text-lg">Recomptage complet</CardTitle>
                <CardDescription className="text-slate-300">
                  Saisissez toutes les quantités puis validez en une fois.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {sortedItems.map((item) => (
                    <div key={`recount-${item.id}`} className="p-3 rounded-lg bg-slate-700/60 border border-slate-600">
                      <p className="text-white text-sm font-semibold">{item.bottleName}</p>
                      <p className="text-slate-400 text-xs mb-2">Stock actuel: {formatStock(item.currentBottles)}</p>
                      <Input
                        value={recountDrafts[item.id] || ""}
                        onChange={(event) =>
                          setRecountDrafts((prev) => ({
                            ...prev,
                            [item.id]: event.target.value,
                          }))
                        }
                        className="bg-slate-800 border-slate-500 text-white"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button onClick={validateRecount} disabled={savingRecount} className="bg-emerald-600 hover:bg-emerald-700">
                    <Save className="h-4 w-4 mr-2" />
                    {savingRecount ? "Validation..." : "Valider le recomptage"}
                  </Button>
                  <Button
                    variant="outline"
                    className="bg-slate-700 text-white border-slate-500 hover:bg-slate-600"
                    onClick={resetRecountDrafts}
                    disabled={savingRecount}
                  >
                    Réinitialiser les valeurs
                  </Button>
                </div>
                <p className="text-slate-400 text-xs mt-3">
                  Après saisie des stocks, clique sur <strong>Valider le recomptage</strong>.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedItems.map((item) => {
              const draft = lineDrafts[item.id]
              if (!draft) return null

              const maxGaugeBase = Math.max(summary.settings.yellowThreshold, summary.settings.redThreshold, 1)
              const gaugeValue = Math.max(0, Math.min(100, (item.currentBottles / maxGaugeBase) * 100))
              const gaugeClass = getGaugeFillClass(item.gauge)

              return (
                <Card key={item.id} className="bg-slate-800 border-slate-700">
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-white text-base">{item.bottleName}</CardTitle>
                        <CardDescription className="text-slate-400 text-xs">
                          {item.bottleCategory || "Catégorie inconnue"}
                        </CardDescription>
                      </div>
                      <Badge
                        className={
                          item.gauge === "red"
                            ? "bg-red-600"
                            : item.gauge === "yellow"
                              ? "bg-amber-500 text-black"
                              : item.gauge === "inactive"
                                ? "bg-slate-600"
                                : "bg-emerald-600"
                        }
                      >
                        {getGaugeLabel(item.gauge)}
                      </Badge>
                    </div>
                    <div className="mt-3">
                      <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                        <div className={`h-full ${gaugeClass}`} style={{ width: `${gaugeValue}%` }} />
                      </div>
                      <p className="text-slate-300 text-xs mt-2">Stock actuel: {formatStock(item.currentBottles)} bouteille(s)</p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label className="text-slate-300">Stock (bouteilles)</Label>
                        <Input
                          value={draft.currentBottles}
                          onChange={(event) =>
                            setLineDrafts((prev) => ({
                              ...prev,
                              [item.id]: {
                                ...prev[item.id],
                                currentBottles: event.target.value,
                              },
                            }))
                          }
                          className="bg-slate-700 border-slate-600 text-white"
                        />
                      </div>
                      <div className="flex items-end">
                        <div className="flex items-center gap-3 px-3 py-2 rounded-md border border-slate-600 bg-slate-700 w-full">
                          <Switch
                            checked={draft.isActive}
                            onCheckedChange={(checked) =>
                              setLineDrafts((prev) => ({
                                ...prev,
                                [item.id]: {
                                  ...prev[item.id],
                                  isActive: checked,
                                },
                              }))
                            }
                          />
                          <span className="text-slate-200 text-sm">Suivi actif</span>
                        </div>
                      </div>
                      <div className="flex items-end">
                        <Button
                          onClick={() => saveLine(item.id)}
                          disabled={Boolean(savingLines[item.id])}
                          className="bg-blue-600 hover:bg-blue-700 w-full"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          {savingLines[item.id] ? "Sauvegarde..." : "Sauvegarder la ligne"}
                        </Button>
                      </div>
                    </div>

                    <p className="text-slate-500 text-xs">
                      Liaisons vins au verre configurées automatiquement.
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
