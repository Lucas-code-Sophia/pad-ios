"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CalendarDays, Clock, Target, TrendingUp, Users, Zap } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/auth-context"

type ServicePeriod = "midi" | "afternoon" | "soir"
type StaffLoadLevel = "closed" | "normal" | "reinforced" | "full"

interface ServiceTotals {
  totalTtc: number
  covers: number
}

interface DaySnapshot {
  date: string
  monthDay?: string
  weekday?: string
  totalTtc: number
  covers: number
  averageTicket?: number
  orderCount?: number
  services: Record<ServicePeriod, ServiceTotals>
}

interface DailyComparison {
  date: string
  monthDay: string
  weekday2025: string
  isElapsed: boolean
  loadLevel: StaffLoadLevel
  loadLabel: string
  lastYear: DaySnapshot
  current: DaySnapshot | null
  deltaTtc: number | null
  deltaPercent: number | null
}

interface WeekBaseline {
  startDate: string
  endDate: string
  comparableStartDate: string
  comparableEndDate: string
  totalTtc: number
  averageTtc: number
  activeDays: number
  covers: number
  loadLevel: StaffLoadLevel
}

interface YearComparisonPayload {
  meta: {
    sourceLabel: string
    currentYear: number
    lastYear: number
    startDate: string
    endDate: string
    seasonEndDate: string
    reinforcedThreshold: number
    fullStaffThreshold: number
  }
  summary: {
    currentTotal: number
    currentCovers: number
    currentOrders: number
    currentActiveDays: number
    lastYearElapsedTotal: number
    lastYearElapsedCovers: number
    lastYearElapsedActiveDays: number
    lastYearFullTotal: number
    lastYearFullCovers: number
    deltaTtc: number
    deltaPercent: number | null
    paceRatio: number | null
    projectedSeasonTotal: number | null
  }
  recommendations: {
    reinforcedFrom: WeekBaseline | null
    fullStaffFrom: WeekBaseline | null
    fullStaffUntil: WeekBaseline | null
    serviceMix: Array<{
      period: ServicePeriod
      label: string
      totalTtc: number
      covers: number
      share: number
    }>
  }
  weeklyBaseline: WeekBaseline[]
  busiestDays: Array<{
    date: string
    comparableDate: string
    weekday: string
    totalTtc: number
    covers: number
    loadLevel: StaffLoadLevel
    loadLabel: string
    services: Record<ServicePeriod, ServiceTotals>
  }>
  dailyComparison: DailyComparison[]
}

interface TooltipPayloadItem {
  name?: string
  value?: number | null
  color?: string
}

const comparisonChartConfig = {
  lastYear: { label: "2025", color: "#f59e0b" },
  current: { label: "2026", color: "#22c55e" },
}

const weeklyChartConfig = {
  averageTtc: { label: "Moyenne/jour", color: "#38bdf8" },
}

const loadClasses: Record<StaffLoadLevel, string> = {
  closed: "border-slate-600 bg-slate-700 text-slate-200",
  normal: "border-blue-500/40 bg-blue-500/15 text-blue-100",
  reinforced: "border-amber-500/50 bg-amber-500/15 text-amber-100",
  full: "border-red-500/50 bg-red-500/15 text-red-100",
}

const formatEuro = (value: number | null | undefined, maximumFractionDigits = 0) => {
  if (value == null || Number.isNaN(value)) return "-"
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits,
  }).format(value)
}

const formatSignedEuro = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return "-"
  const prefix = value > 0 ? "+" : ""
  return `${prefix}${formatEuro(value)}`
}

const formatPercent = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return "-"
  const prefix = value > 0 ? "+" : ""
  return `${prefix}${value.toFixed(1)} %`
}

const toDate = (date: string) => new Date(`${date}T00:00:00.000Z`)

const formatShortDate = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(toDate(date))

const formatFullDate = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(toDate(date))

const formatRange = (startDate: string, endDate: string) => `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`

function EuroTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white shadow-xl">
      <div className="mb-2 font-medium text-slate-200">{label}</div>
      <div className="space-y-1">
        {payload
          .filter((item) => item.value != null)
          .map((item) => (
            <div key={item.name} className="flex min-w-32 items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-slate-300">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.name}
              </span>
              <span className="font-mono font-semibold">{formatEuro(Number(item.value), 0)}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

export default function YearComparisonPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [data, setData] = useState<YearComparisonPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reportsAccessCode, setReportsAccessCode] = useState("")
  const [enteredReportsCode, setEnteredReportsCode] = useState("")
  const [reportsCodeError, setReportsCodeError] = useState("")
  const [accessCodeLoading, setAccessCodeLoading] = useState(true)
  const [accessUnlocked, setAccessUnlocked] = useState(false)
  const requiresAccessCode = reportsAccessCode.trim().length > 0
  const hasReportsAccess = !requiresAccessCode || accessUnlocked

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (!user || user.role !== "manager") return

    const fetchReportsAccessCode = async () => {
      try {
        setAccessCodeLoading(true)
        const response = await fetch("/api/admin/reports-access", { cache: "no-store" })
        if (!response.ok) {
          setReportsAccessCode("")
          setAccessUnlocked(true)
          return
        }

        const payload = await response.json().catch(() => ({}))
        const accessCode = String(payload?.access_code || "").trim()
        setReportsAccessCode(accessCode)
        if (!accessCode) setAccessUnlocked(true)
      } catch (fetchError) {
        console.error("[v0] Error fetching reports access code:", fetchError)
        setReportsAccessCode("")
        setAccessUnlocked(true)
      } finally {
        setAccessCodeLoading(false)
      }
    }

    fetchReportsAccessCode()
  }, [user])

  useEffect(() => {
    if (!user || user.role !== "manager" || accessCodeLoading || !hasReportsAccess) return

    const fetchComparison = async () => {
      try {
        setLoading(true)
        setError("")
        const response = await fetch("/api/admin/year-comparison", { cache: "no-store" })
        if (!response.ok) {
          throw new Error("Impossible de charger l'analyse")
        }
        const payload = (await response.json()) as YearComparisonPayload
        setData(payload)
      } catch (fetchError) {
        console.error("[v0] Error fetching year comparison:", fetchError)
        setError("Impossible de charger l'analyse comparaison année dernière.")
      } finally {
        setLoading(false)
      }
    }

    fetchComparison()
  }, [user, accessCodeLoading, hasReportsAccess])

  const unlockReportsAccess = () => {
    if (!requiresAccessCode) {
      setAccessUnlocked(true)
      return
    }

    if (enteredReportsCode.trim() !== reportsAccessCode.trim()) {
      setReportsCodeError("Code invalide")
      return
    }

    setReportsCodeError("")
    setAccessUnlocked(true)
  }

  const comparisonChartData = useMemo(() => {
    if (!data) return []
    return data.dailyComparison.map((day) => ({
      label: formatShortDate(day.date),
      lastYear: day.lastYear.totalTtc > 0 ? day.lastYear.totalTtc : null,
      current: day.current ? day.current.totalTtc : null,
    }))
  }, [data])

  const weeklyChartData = useMemo(() => {
    if (!data) return []
    return data.weeklyBaseline.map((week) => ({
      label: formatRange(week.comparableStartDate, week.comparableEndDate),
      averageTtc: week.averageTtc,
      loadLevel: week.loadLevel,
    }))
  }, [data])

  if (isLoading || accessCodeLoading || (hasReportsAccess && loading && !data)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="text-lg font-semibold text-white">Chargement...</div>
      </div>
    )
  }

  if (!user || user.role !== "manager") {
    return null
  }

  if (requiresAccessCode && !hasReportsAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 sm:p-6">
        <Card className="w-full max-w-md border-slate-800 bg-slate-900">
          <CardHeader>
            <CardTitle className="text-xl text-white">Accès protégé</CardTitle>
            <CardDescription className="text-slate-400">
              Entrez le code des rapports avancés pour ouvrir l'analyse.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="year-comparison-access-input" className="text-slate-200">
                Code Rapports avancés
              </Label>
              <Input
                id="year-comparison-access-input"
                type="password"
                value={enteredReportsCode}
                onChange={(event) => {
                  setEnteredReportsCode(event.target.value)
                  if (reportsCodeError) setReportsCodeError("")
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") unlockReportsAccess()
                }}
                className="border-slate-700 bg-slate-800 text-white"
                placeholder="Entrer le code d'accès"
              />
              {reportsCodeError && <p className="text-xs text-rose-400">{reportsCodeError}</p>}
            </div>
            <div className="flex gap-2">
              <Button onClick={unlockReportsAccess} className="w-full bg-amber-600 hover:bg-amber-700">
                Déverrouiller
              </Button>
              <Button
                onClick={() => router.push("/admin")}
                variant="outline"
                className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
              >
                Retour
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
        <Button
          onClick={() => router.push("/admin")}
          variant="outline"
          className="mb-6 border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour admin
        </Button>
        <Card className="border-red-500/40 bg-red-950/40 text-white">
          <CardHeader>
            <CardTitle>Analyse indisponible</CardTitle>
            <CardDescription className="text-red-100">{error || "Aucune donnée disponible."}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const { meta, summary, recommendations } = data
  const fullStaffPeriod =
    recommendations.fullStaffFrom && recommendations.fullStaffUntil
      ? `${formatShortDate(recommendations.fullStaffFrom.comparableStartDate)} au ${formatShortDate(
          recommendations.fullStaffUntil.comparableEndDate,
        )}`
      : "-"

  return (
    <div className="min-h-screen bg-slate-950 p-3 text-white sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            onClick={() => router.push("/admin")}
            variant="outline"
            size="sm"
            className="border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Button>
          <div>
            <h1 className="text-xl font-bold sm:text-3xl">Analyse comparaison année dernière</h1>
            <p className="mt-1 text-xs text-slate-400 sm:text-sm">
              Depuis le 1er juillet {meta.currentYear} vs {meta.sourceLabel}
            </p>
          </div>
        </div>
        <Badge className="w-fit border border-slate-700 bg-slate-900 px-3 py-1 text-slate-200">
          Données au {formatShortDate(meta.endDate)}
        </Badge>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-emerald-500/40 bg-emerald-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-emerald-100">
              <TrendingUp className="h-4 w-4" />
              CA {meta.currentYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatEuro(summary.currentTotal)}</div>
            <p className="mt-1 text-xs text-emerald-100">
              {summary.currentActiveDays} jours avec ventes, {summary.currentOrders} commandes
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/40 bg-amber-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-100">
              <CalendarDays className="h-4 w-4" />
              Écart vs {meta.lastYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={summary.deltaTtc >= 0 ? "text-3xl font-bold text-emerald-200" : "text-3xl font-bold text-red-200"}>
              {formatSignedEuro(summary.deltaTtc)}
            </div>
            <p className="mt-1 text-xs text-amber-100">
              {formatPercent(summary.deltaPercent)} vs {formatEuro(summary.lastYearElapsedTotal)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-sky-500/40 bg-sky-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-sky-100">
              <Target className="h-4 w-4" />
              Projection saison
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatEuro(summary.projectedSeasonTotal)}</div>
            <p className="mt-1 text-xs text-sky-100">
              Base {meta.lastYear} complète : {formatEuro(summary.lastYearFullTotal)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-500/40 bg-red-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-red-100">
              <Users className="h-4 w-4" />
              Plein effectif
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fullStaffPeriod}</div>
            <p className="mt-1 text-xs text-red-100">Seuil 2025 : {formatEuro(meta.fullStaffThreshold)} / jour ouvert</p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="border-slate-800 bg-slate-900 xl:col-span-2">
          <CardHeader>
            <CardTitle>CA jour par jour</CardTitle>
            <CardDescription className="text-slate-400">
              Courbe {meta.lastYear} complète et ventes {meta.currentYear} déjà enregistrées
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={comparisonChartConfig} className="h-[320px] w-full">
              <LineChart data={comparisonChartData} margin={{ left: 8, right: 8, top: 12, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={6} stroke="#94a3b8" />
                <YAxis tickLine={false} axisLine={false} stroke="#94a3b8" tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                <ChartTooltip content={<EuroTooltip />} />
                <Line
                  type="monotone"
                  dataKey="lastYear"
                  name={`${meta.lastYear}`}
                  stroke="var(--color-lastYear)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="current"
                  name={`${meta.currentYear}`}
                  stroke="var(--color-current)"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900">
          <CardHeader>
            <CardTitle>Lecture 2025</CardTitle>
            <CardDescription className="text-slate-400">Seuils calculés sur les jours ouverts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                <Zap className="h-4 w-4" />
                Montée durable
              </div>
              <div className="mt-2 text-2xl font-bold">
                {recommendations.reinforcedFrom ? formatShortDate(recommendations.reinforcedFrom.comparableStartDate) : "-"}
              </div>
              <p className="mt-1 text-xs text-amber-100">
                Moyenne semaine : {formatEuro(recommendations.reinforcedFrom?.averageTtc)} / jour ouvert
              </p>
            </div>

            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-100">
                <Users className="h-4 w-4" />
                Période très forte
              </div>
              <div className="mt-2 text-2xl font-bold">{fullStaffPeriod}</div>
              <p className="mt-1 text-xs text-red-100">
                Semaines autour de {formatEuro(recommendations.fullStaffFrom?.averageTtc)} à{" "}
                {formatEuro(recommendations.fullStaffUntil?.averageTtc)} / jour ouvert
              </p>
            </div>

            <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-100">
                <Clock className="h-4 w-4" />
                Services lourds sur les gros jours
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {recommendations.serviceMix.map((service) => (
                  <div key={service.period} className="rounded-md bg-slate-950/60 p-2">
                    <div className="text-xs text-slate-300">{service.label}</div>
                    <div className="text-lg font-bold">{service.share.toFixed(0)}%</div>
                    <div className="text-xs text-slate-400">{service.covers} couverts</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="border-slate-800 bg-slate-900 xl:col-span-2">
          <CardHeader>
            <CardTitle>Moyenne par semaine en 2025</CardTitle>
            <CardDescription className="text-slate-400">
              Renfort à partir de {formatEuro(meta.reinforcedThreshold)} / jour, plein effectif à partir de{" "}
              {formatEuro(meta.fullStaffThreshold)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={weeklyChartConfig} className="h-[260px] w-full">
              <BarChart data={weeklyChartData} margin={{ left: 8, right: 8, top: 12, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} stroke="#94a3b8" fontSize={11} />
                <YAxis tickLine={false} axisLine={false} stroke="#94a3b8" tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                <ChartTooltip content={<EuroTooltip />} />
                <Bar dataKey="averageTtc" name="Moyenne/jour" fill="var(--color-averageTtc)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900">
          <CardHeader>
            <CardTitle>Plus gros jours 2025</CardTitle>
            <CardDescription className="text-slate-400">Dates à surveiller en priorité</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.busiestDays.slice(0, 5).map((day) => (
              <div key={day.date} className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-3">
                <div>
                  <div className="text-sm font-semibold">{formatFullDate(day.comparableDate)}</div>
                  <div className="text-xs text-slate-400">
                    {day.covers} couverts en {meta.lastYear}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold">{formatEuro(day.totalTtc)}</div>
                  <Badge className={`mt-1 border ${loadClasses[day.loadLevel]}`}>{day.loadLabel}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle>Calendrier de charge</CardTitle>
          <CardDescription className="text-slate-400">Comparaison date à date sur juillet et août</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[560px] overflow-auto rounded-md border border-slate-800">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-950 text-left text-xs text-slate-300">
                <tr>
                  <th className="px-3 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Charge</th>
                  <th className="px-3 py-3 text-right font-medium">CA {meta.lastYear}</th>
                  <th className="px-3 py-3 text-right font-medium">Couverts {meta.lastYear}</th>
                  <th className="px-3 py-3 text-right font-medium">CA {meta.currentYear}</th>
                  <th className="px-3 py-3 text-right font-medium">Écart</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyComparison.map((day) => (
                  <tr key={day.date} className="border-t border-slate-800 hover:bg-slate-800/60">
                    <td className="px-3 py-3">
                      <div className="font-medium">{formatFullDate(day.date)}</div>
                      <div className="text-xs text-slate-500">{day.weekday2025} en {meta.lastYear}</div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={`border ${loadClasses[day.loadLevel]}`}>{day.loadLabel}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{formatEuro(day.lastYear.totalTtc)}</td>
                    <td className="px-3 py-3 text-right font-mono">{day.lastYear.covers}</td>
                    <td className="px-3 py-3 text-right font-mono">
                      {day.current ? formatEuro(day.current.totalTtc) : day.isElapsed ? "Aucune vente" : "-"}
                    </td>
                    <td
                      className={
                        day.deltaTtc == null
                          ? "px-3 py-3 text-right text-slate-500"
                          : day.deltaTtc >= 0
                            ? "px-3 py-3 text-right font-mono text-emerald-300"
                            : "px-3 py-3 text-right font-mono text-red-300"
                      }
                    >
                      <div>{formatSignedEuro(day.deltaTtc)}</div>
                      <div className="text-xs">{formatPercent(day.deltaPercent)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
