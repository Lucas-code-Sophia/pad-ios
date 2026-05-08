"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Trophy } from "lucide-react"

type MatchStatus = "open" | "closed" | "resolved"

type PublicMatch = {
  id: string
  homeTeam: string
  awayTeam: string
  publicCode: string
  status: MatchStatus
  finalHomeScore: number | null
  finalAwayScore: number | null
  createdAt: string
  canPredict: boolean
}

const getStatusLabel = (status: MatchStatus) => {
  switch (status) {
    case "open":
      return "Pronostics ouverts"
    case "closed":
      return "Pronostics fermés"
    case "resolved":
      return "Match résolu"
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

export default function PublicScoreExactPage() {
  const params = useParams<{ publicCode?: string; matchSlug?: string }>()
  const publicIdentifier = useMemo(() => {
    const raw = params?.matchSlug ?? params?.publicCode
    if (Array.isArray(raw)) return raw[0] || ""
    return raw || ""
  }, [params])

  const [match, setMatch] = useState<PublicMatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [predictedHomeScore, setPredictedHomeScore] = useState("")
  const [predictedAwayScore, setPredictedAwayScore] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const fetchMatch = async () => {
    if (!publicIdentifier) return

    try {
      setLoading(true)
      setErrorMessage(null)
      const response = await fetch(`/api/world-cup/score-exact/${encodeURIComponent(publicIdentifier)}`)
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        setMatch(null)
        setErrorMessage(payload?.error || "Impossible de charger ce match")
        return
      }

      setMatch(payload as PublicMatch)
    } catch (error) {
      console.error("[v0] Error fetching public score exact match:", error)
      setMatch(null)
      setErrorMessage("Erreur réseau pendant le chargement")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMatch()
  }, [publicIdentifier])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!match || !match.canPredict) return

    if (!firstName.trim() || !lastName.trim()) {
      setErrorMessage("Nom et prénom sont obligatoires")
      return
    }

    if (!/^\d+$/.test(predictedHomeScore) || !/^\d+$/.test(predictedAwayScore)) {
      setErrorMessage("Saisissez des scores entiers positifs")
      return
    }

    try {
      setSubmitting(true)
      setErrorMessage(null)
      setSuccessMessage(null)

      const response = await fetch(`/api/world-cup/score-exact/${encodeURIComponent(publicIdentifier)}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          predictedHomeScore,
          predictedAwayScore,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        setErrorMessage(payload?.error || "Impossible d'enregistrer votre pronostic")
        return
      }

      setSuccessMessage("Pronostic enregistré. Merci et bonne chance !")
      setFirstName("")
      setLastName("")
      setPredictedHomeScore("")
      setPredictedAwayScore("")

      await fetchMatch()
    } catch (error) {
      console.error("[v0] Error submitting score exact prediction:", error)
      setErrorMessage("Erreur réseau pendant l'envoi")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4 sm:p-6">
      <div className="mx-auto w-full max-w-xl">
        <Card className="bg-slate-800/95 border-slate-700 text-white">
          <CardHeader className="text-center space-y-3">
            <CardTitle className="text-2xl sm:text-3xl font-bold">Jeu Score Exact</CardTitle>
            <CardDescription className="text-slate-300">Coupe du monde</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {loading ? (
              <div className="text-center text-slate-300">Chargement du match...</div>
            ) : !match ? (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {errorMessage || "Match introuvable"}
              </div>
            ) : (
              <>
                <div className="rounded-md border border-slate-600 bg-slate-900/60 px-4 py-3 text-center">
                  <div className="text-2xl font-bold tracking-wide">
                    {match.homeTeam} - {match.awayTeam}
                  </div>
                  <div className="mt-2">
                    <Badge className={`${getStatusClass(match.status)} text-white`}>{getStatusLabel(match.status)}</Badge>
                  </div>
                  {match.status === "resolved" && match.finalHomeScore !== null && match.finalAwayScore !== null && (
                    <div className="mt-3 inline-flex items-center gap-2 rounded bg-indigo-600/25 px-3 py-1 text-indigo-100">
                      <Trophy className="h-4 w-4" />
                      Score final: {match.finalHomeScore} - {match.finalAwayScore}
                    </div>
                  )}
                </div>

                {errorMessage && (
                  <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {errorMessage}
                  </div>
                )}

                {successMessage && (
                  <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    {successMessage}
                  </div>
                )}

                {match.canPredict ? (
                  <form className="space-y-3" onSubmit={handleSubmit}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-slate-200">Prénom</Label>
                        <Input
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          className="bg-slate-700 border-slate-600 text-white"
                          placeholder="Prénom"
                          required
                        />
                      </div>
                      <div>
                        <Label className="text-slate-200">Nom</Label>
                        <Input
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          className="bg-slate-700 border-slate-600 text-white"
                          placeholder="Nom"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-slate-200">Score {match.homeTeam}</Label>
                        <Input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={predictedHomeScore}
                          onChange={(e) => setPredictedHomeScore(e.target.value)}
                          className="bg-slate-700 border-slate-600 text-white"
                          placeholder="0"
                          required
                        />
                      </div>
                      <div>
                        <Label className="text-slate-200">Score {match.awayTeam}</Label>
                        <Input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={predictedAwayScore}
                          onChange={(e) => setPredictedAwayScore(e.target.value)}
                          className="bg-slate-700 border-slate-600 text-white"
                          placeholder="0"
                          required
                        />
                      </div>
                    </div>

                    <Button type="submit" disabled={submitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                      {submitting ? "Envoi en cours..." : "Valider mon pronostic"}
                    </Button>
                  </form>
                ) : (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    Les pronostics sont fermés pour ce match.
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
