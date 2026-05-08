"use client"

import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { ArrowLeft, Check, Copy, QrCode, RefreshCw, Target, Trash2, Trophy, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

type MatchStatus = "open" | "closed" | "resolved"

type ScoreExactMatch = {
  id: string
  homeTeam: string
  awayTeam: string
  matchSlug: string
  publicCode: string
  status: MatchStatus
  finalHomeScore: number | null
  finalAwayScore: number | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  predictionCount: number
  winnerCount: number
}

type ScoreExactPrediction = {
  id: string
  matchId: string
  firstName: string
  lastName: string
  participantKey: string
  predictedHomeScore: number
  predictedAwayScore: number
  createdAt: string
  isWinner: boolean
}

type ScoreExactDetailPayload = {
  match: Omit<ScoreExactMatch, "predictionCount" | "winnerCount">
  predictions: ScoreExactPrediction[]
  winners: ScoreExactPrediction[]
}

const getStatusLabel = (status: MatchStatus) => {
  switch (status) {
    case "open":
      return "Ouvert"
    case "closed":
      return "Fermé"
    case "resolved":
      return "Résolu"
    default:
      return status
  }
}

const getStatusClass = (status: MatchStatus) => {
  switch (status) {
    case "open":
      return "bg-emerald-600"
    case "closed":
      return "bg-amber-600"
    case "resolved":
      return "bg-blue-600"
    default:
      return "bg-slate-600"
  }
}

const formatDateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("fr-FR")
}

const normalizeBaseUrl = (value: string) => {
  const rawInput = String(value || "").trim()
  if (!rawInput) return ""

  const repairedInput = rawInput.replace(/^(https?):\/(?!\/)/i, "$1://")
  const raw = /^https?:\/\//i.test(repairedInput) ? repairedInput : `https://${repairedInput}`

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ""
  }

  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.host) return ""

  const normalizedPath = url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : ""
  return `${url.protocol}//${url.host}${normalizedPath}`
}

const isLocalhostOrigin = (value: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(normalizeBaseUrl(value))

export default function ScoreExactAdminPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  const [matches, setMatches] = useState<ScoreExactMatch[]>([])
  const [loadingMatches, setLoadingMatches] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detail, setDetail] = useState<ScoreExactDetailPayload | null>(null)
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)

  const [homeTeam, setHomeTeam] = useState("")
  const [awayTeam, setAwayTeam] = useState("")
  const [creatingMatch, setCreatingMatch] = useState(false)

  const [savingStatus, setSavingStatus] = useState(false)
  const [savingResult, setSavingResult] = useState(false)

  const [resultHomeScore, setResultHomeScore] = useState("")
  const [resultAwayScore, setResultAwayScore] = useState("")
  const [swipedMatchId, setSwipedMatchId] = useState<string | null>(null)
  const matchTouchRef = useRef<{ matchId: string; startX: number } | null>(null)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [isLoading, user, router])

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin)
    }
  }, [])

  const fetchMatches = async () => {
    try {
      setLoadingMatches(true)
      setErrorMessage(null)

      const response = await fetch("/api/admin/world-cup/score-exact/matches")
      const payload = await response.json().catch(() => [])

      if (!response.ok) {
        setErrorMessage(payload?.error || "Impossible de charger les matchs")
        setMatches([])
        return
      }

      const nextMatches = Array.isArray(payload) ? (payload as ScoreExactMatch[]) : []
      setMatches(nextMatches)

      setSelectedMatchId((currentSelected) => {
        if (!nextMatches.length) return null
        if (currentSelected && nextMatches.some((match) => match.id === currentSelected)) {
          return currentSelected
        }
        return nextMatches[0].id
      })
    } catch (error) {
      console.error("[v0] Error fetching score exact matches:", error)
      setErrorMessage("Erreur réseau pendant le chargement des matchs")
      setMatches([])
    } finally {
      setLoadingMatches(false)
    }
  }

  const fetchMatchDetail = async (matchId: string) => {
    try {
      setLoadingDetail(true)
      const response = await fetch(`/api/admin/world-cup/score-exact/matches/${matchId}`)
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDetail(null)
        setErrorMessage(payload?.error || "Impossible de charger les détails du match")
        return
      }

      setDetail(payload as ScoreExactDetailPayload)
      setErrorMessage(null)
    } catch (error) {
      console.error("[v0] Error fetching score exact match detail:", error)
      setDetail(null)
      setErrorMessage("Erreur réseau pendant le chargement du match")
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => {
    if (user?.role === "manager") {
      fetchMatches()
    }
  }, [user])

  useEffect(() => {
    if (!selectedMatchId) {
      setDetail(null)
      return
    }
    fetchMatchDetail(selectedMatchId)
  }, [selectedMatchId])

  useEffect(() => {
    if (!detail?.match) return

    const { finalHomeScore, finalAwayScore } = detail.match
    setResultHomeScore(finalHomeScore !== null ? String(finalHomeScore) : "")
    setResultAwayScore(finalAwayScore !== null ? String(finalAwayScore) : "")
  }, [detail?.match])

  useEffect(() => {
    if (!swipedMatchId) return
    const stillExists = matches.some((match) => match.id === swipedMatchId)
    if (!stillExists) {
      setSwipedMatchId(null)
    }
  }, [matches, swipedMatchId])

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) || null,
    [matches, selectedMatchId],
  )

  const normalizedOrigin = normalizeBaseUrl(origin)
  const normalizedEnvBase = normalizeBaseUrl(process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "")
  const isRunningOnLocalhost = isLocalhostOrigin(normalizedOrigin)
  const effectivePublicBaseUrl = isRunningOnLocalhost ? normalizedEnvBase : normalizedOrigin || normalizedEnvBase

  // Keep QR links backward-compatible with older deployments that may not yet have
  // the French public route.
  const matchPublicIdentifier = selectedMatch?.publicCode || selectedMatch?.matchSlug || ""
  const publicUrl = selectedMatch && effectivePublicBaseUrl && matchPublicIdentifier
    ? `${effectivePublicBaseUrl}/world-cup/score-exact/${matchPublicIdentifier}`
    : ""

  const qrCodeUrl = publicUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(publicUrl)}`
    : ""

  const handleCreateMatch = async () => {
    const trimmedHome = homeTeam.trim()
    const trimmedAway = awayTeam.trim()

    if (!trimmedHome || !trimmedAway) {
      alert("Renseignez les deux équipes")
      return
    }

    try {
      setCreatingMatch(true)
      const response = await fetch("/api/admin/world-cup/score-exact/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeTeam: trimmedHome,
          awayTeam: trimmedAway,
          createdBy: user?.id,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        alert(payload?.error || "Impossible de créer le match")
        return
      }

      setHomeTeam("")
      setAwayTeam("")
      await fetchMatches()
      if (payload?.id) {
        setSelectedMatchId(payload.id)
      }
    } catch (error) {
      console.error("[v0] Error creating score exact match:", error)
      alert("Erreur réseau pendant la création du match")
    } finally {
      setCreatingMatch(false)
    }
  }

  const handleSetStatus = async (status: "open" | "closed") => {
    if (!selectedMatchId) return

    try {
      setSavingStatus(true)
      const response = await fetch(`/api/admin/world-cup/score-exact/matches/${selectedMatchId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        alert(payload?.error || "Impossible de changer le statut")
        return
      }

      await Promise.all([fetchMatches(), fetchMatchDetail(selectedMatchId)])
    } catch (error) {
      console.error("[v0] Error updating score exact status:", error)
      alert("Erreur réseau pendant la mise à jour du statut")
    } finally {
      setSavingStatus(false)
    }
  }

  const handleSaveResult = async () => {
    if (!selectedMatchId) return

    if (!/^\d+$/.test(resultHomeScore) || !/^\d+$/.test(resultAwayScore)) {
      alert("Le score final doit être un entier positif")
      return
    }

    try {
      setSavingResult(true)
      const response = await fetch(`/api/admin/world-cup/score-exact/matches/${selectedMatchId}/result`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finalHomeScore: resultHomeScore,
          finalAwayScore: resultAwayScore,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        alert(payload?.error || "Impossible d'enregistrer le score final")
        return
      }

      await Promise.all([fetchMatches(), fetchMatchDetail(selectedMatchId)])
    } catch (error) {
      console.error("[v0] Error saving score exact result:", error)
      alert("Erreur réseau pendant l'enregistrement du résultat")
    } finally {
      setSavingResult(false)
    }
  }

  const handleMatchTouchStart = (matchId: string, event: TouchEvent<HTMLDivElement>) => {
    matchTouchRef.current = {
      matchId,
      startX: event.changedTouches[0]?.clientX ?? 0,
    }
  }

  const handleMatchTouchEnd = (matchId: string, event: TouchEvent<HTMLDivElement>) => {
    const touchState = matchTouchRef.current
    if (!touchState || touchState.matchId !== matchId) return

    const endX = event.changedTouches[0]?.clientX ?? touchState.startX
    const deltaX = endX - touchState.startX

    if (deltaX <= -45) {
      setSwipedMatchId(matchId)
    } else if (deltaX >= 30 && swipedMatchId === matchId) {
      setSwipedMatchId(null)
    }

    matchTouchRef.current = null
  }

  const handleDeleteMatch = async (match: ScoreExactMatch) => {
    const shouldDelete = window.confirm(
      `Supprimer le match ${match.homeTeam} - ${match.awayTeam} ?\nCette action supprimera aussi tous les pronostics liés.`,
    )

    if (!shouldDelete) return

    try {
      const response = await fetch(`/api/admin/world-cup/score-exact/matches/${match.id}`, {
        method: "DELETE",
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        alert(payload?.error || "Impossible de supprimer le match")
        return
      }

      setSwipedMatchId(null)
      await fetchMatches()
    } catch (error) {
      console.error("[v0] Error deleting score exact match:", error)
      alert("Erreur réseau pendant la suppression du match")
    }
  }

  const copyPublicUrl = async () => {
    if (!publicUrl) {
      alert("Aucune URL publique disponible pour ce match")
      return
    }

    try {
      await navigator.clipboard.writeText(publicUrl)
      alert("Lien copié")
    } catch (error) {
      console.error("[v0] Error copying public URL:", error)
      alert("Impossible de copier le lien")
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
            onClick={() => router.push("/admin/world-cup")}
            variant="outline"
            size="sm"
            className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
          >
            <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Retour</span>
          </Button>
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-white">Jeu Score Exact</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">Créez des matchs, collectez les pronostics et trouvez les gagnants</p>
          </div>
        </div>

        <Button
          onClick={fetchMatches}
          disabled={loadingMatches}
          className="bg-slate-700 hover:bg-slate-600 text-white"
          size="sm"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualiser
        </Button>
      </div>

      {errorMessage && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{errorMessage}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4 sm:gap-6">
        <div className="space-y-4 sm:space-y-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-white text-base sm:text-lg">Créer un match</CardTitle>
              <CardDescription className="text-slate-400 text-xs sm:text-sm">Ex: France vs Sénégal</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0 space-y-3">
              <div>
                <Label className="text-slate-200">Équipe domicile</Label>
                <Input
                  value={homeTeam}
                  onChange={(e) => setHomeTeam(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white"
                  placeholder="France"
                />
              </div>
              <div>
                <Label className="text-slate-200">Équipe extérieur</Label>
                <Input
                  value={awayTeam}
                  onChange={(e) => setAwayTeam(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white"
                  placeholder="Sénégal"
                />
              </div>
              <Button
                onClick={handleCreateMatch}
                disabled={creatingMatch}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {creatingMatch ? "Création..." : "Créer le match"}
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-white text-base sm:text-lg">Matchs créés</CardTitle>
              <CardDescription className="text-slate-400 text-xs sm:text-sm">Cliquez sur un match pour gérer le QR et les résultats</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0">
              {loadingMatches ? (
                <div className="text-sm text-slate-400">Chargement...</div>
              ) : matches.length === 0 ? (
                <div className="text-sm text-slate-400">Aucun match pour le moment.</div>
              ) : (
                <div className="space-y-2">
                  {matches.map((match) => {
                    const isSelected = selectedMatchId === match.id
                    const isSwiped = swipedMatchId === match.id
                    return (
                      <div key={match.id} className="group relative overflow-hidden rounded-md">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleDeleteMatch(match)
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
                            if (isSwiped) {
                              setSwipedMatchId(null)
                              return
                            }
                            setSelectedMatchId(match.id)
                          }}
                          onTouchStart={(event) => handleMatchTouchStart(match.id, event)}
                          onTouchEnd={(event) => handleMatchTouchEnd(match.id, event)}
                          className={`relative z-10 cursor-pointer rounded-md border px-3 py-2 text-left transition-colors transition-transform duration-200 ${
                            isSelected
                              ? "border-blue-500 bg-blue-500/10"
                              : "border-slate-700 bg-slate-900/40 hover:border-slate-500"
                          } ${isSwiped ? "-translate-x-20" : "translate-x-0"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-white truncate">
                              {match.homeTeam} - {match.awayTeam}
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge className={`${getStatusClass(match.status)} text-white`}>{getStatusLabel(match.status)}</Badge>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleDeleteMatch(match)
                                }}
                                className="h-6 w-6 rounded bg-red-600/20 hover:bg-red-600/40 text-red-200 flex items-center justify-center"
                                aria-label={`Supprimer le match ${match.homeTeam} ${match.awayTeam}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-xs text-slate-300">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" /> {match.predictionCount}
                            </span>
                            {match.status === "resolved" && (
                              <span className="inline-flex items-center gap-1">
                                <Trophy className="h-3 w-3" /> {match.winnerCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-slate-800 border-slate-700 min-h-[520px]">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-white text-base sm:text-lg">Détails du match</CardTitle>
            <CardDescription className="text-slate-400 text-xs sm:text-sm">
              QR code, pronostics, fermeture et résultat final
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            {!selectedMatchId ? (
              <div className="text-sm text-slate-400">Sélectionnez un match.</div>
            ) : loadingDetail ? (
              <div className="text-sm text-slate-400">Chargement du match...</div>
            ) : !detail ? (
              <div className="text-sm text-slate-400">Impossible de charger le match.</div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-xl font-bold text-white">
                    {detail.match.homeTeam} - {detail.match.awayTeam}
                  </div>
                  <Badge className={`${getStatusClass(detail.match.status)} text-white`}>{getStatusLabel(detail.match.status)}</Badge>
                  {detail.match.status === "resolved" && detail.match.finalHomeScore !== null && detail.match.finalAwayScore !== null && (
                    <Badge className="bg-indigo-600 text-white">
                      Score final: {detail.match.finalHomeScore}-{detail.match.finalAwayScore}
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-200">Lien public</Label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input value={publicUrl} readOnly className="bg-slate-700 border-slate-600 text-white" />
                      <Button onClick={copyPublicUrl} className="bg-slate-600 hover:bg-slate-500 text-white">
                        <Copy className="h-4 w-4 mr-2" /> Copier
                      </Button>
                    </div>
                    {!publicUrl && (
                      <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                        {isRunningOnLocalhost
                          ? "Impossible de générer un QR public depuis localhost. Déployez l'app ou définissez NEXT_PUBLIC_PUBLIC_BASE_URL."
                          : "URL publique indisponible pour le moment."}
                      </div>
                    )}
                    <p className="text-xs text-slate-400">
                      Créé le {formatDateTime(detail.match.createdAt)} - Code: <span className="font-mono">{detail.match.publicCode}</span>
                    </p>
                  </div>

                  <div className="rounded-md border border-slate-700 bg-slate-900/50 p-3 flex flex-col items-center">
                    <div className="text-xs text-slate-300 mb-2 inline-flex items-center gap-1">
                      <QrCode className="h-3.5 w-3.5" /> QR Code
                    </div>
                    {qrCodeUrl ? (
                      <img src={qrCodeUrl} alt="QR Code Score Exact" className="h-56 w-56 rounded bg-white p-2" />
                    ) : (
                      <div className="h-56 w-56 rounded bg-slate-700" />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-3">
                    <div className="text-sm font-semibold text-white">Statut pronostics</div>
                    {detail.match.status === "resolved" ? (
                      <div className="text-xs text-slate-300">
                        Match déjà résolu. Les pronostics sont définitivement fermés.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => handleSetStatus("open")}
                          disabled={savingStatus || detail.match.status === "open"}
                          className="bg-emerald-600 hover:bg-emerald-700"
                          size="sm"
                        >
                          Ouvrir
                        </Button>
                        <Button
                          onClick={() => handleSetStatus("closed")}
                          disabled={savingStatus || detail.match.status === "closed"}
                          className="bg-amber-600 hover:bg-amber-700"
                          size="sm"
                        >
                          Fermer
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-3">
                    <div className="text-sm font-semibold text-white inline-flex items-center gap-2">
                      <Target className="h-4 w-4" /> Résultat réel
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-slate-300">Score domicile</Label>
                        <Input
                          type="number"
                          min={0}
                          value={resultHomeScore}
                          onChange={(e) => setResultHomeScore(e.target.value)}
                          className="bg-slate-700 border-slate-600 text-white"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-300">Score extérieur</Label>
                        <Input
                          type="number"
                          min={0}
                          value={resultAwayScore}
                          onChange={(e) => setResultAwayScore(e.target.value)}
                          className="bg-slate-700 border-slate-600 text-white"
                        />
                      </div>
                    </div>
                    <Button onClick={handleSaveResult} disabled={savingResult} className="w-full bg-blue-600 hover:bg-blue-700" size="sm">
                      {savingResult ? "Enregistrement..." : "Valider le score final et calculer les gagnants"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-white">Pronostics ({detail.predictions.length})</div>
                    {detail.match.status === "resolved" && (
                      <div className="text-xs text-slate-300 inline-flex items-center gap-1">
                        <Trophy className="h-3.5 w-3.5" /> Gagnants: {detail.winners.length}
                      </div>
                    )}
                  </div>

                  {detail.predictions.length === 0 ? (
                    <div className="text-xs text-slate-400">Aucun pronostic pour ce match.</div>
                  ) : (
                    <div className="max-h-[320px] overflow-auto space-y-2 pr-1">
                      {detail.predictions.map((prediction) => (
                        <div
                          key={prediction.id}
                          className={`rounded border px-3 py-2 text-sm ${
                            prediction.isWinner
                              ? "border-emerald-500/50 bg-emerald-500/10"
                              : "border-slate-700 bg-slate-800/40"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-white font-medium">
                              {prediction.firstName} {prediction.lastName}
                            </div>
                            <div className="text-slate-200 font-semibold">
                              {prediction.predictedHomeScore} - {prediction.predictedAwayScore}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                            <span>{formatDateTime(prediction.createdAt)}</span>
                            {prediction.isWinner && (
                              <span className="inline-flex items-center gap-1 text-emerald-300">
                                <Check className="h-3.5 w-3.5" /> Gagnant
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {detail.match.status === "resolved" && detail.winners.length === 0 && (
                    <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      Aucun gagnant sur ce match.
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
