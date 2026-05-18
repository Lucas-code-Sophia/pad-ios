"use client"

import { useEffect, useMemo, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import * as XLSX from "xlsx"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Upload, FileSpreadsheet, RefreshCw, Calculator } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type TvaTotals = {
  ca_ttc: number
  ca_ht: number
  total_tva: number
  ttc_0: number
  ht_0: number
  tva_0: number
  ttc_10: number
  ht_10: number
  tva_10: number
  ttc_20: number
  ht_20: number
  tva_20: number
}

type ExcelDayRow = TvaTotals & {
  date: string
}

type ExcelAnalysis = {
  sourceFileName: string
  sheetName: string
  period: {
    startDate: string
    endDate: string
  }
  totals: TvaTotals
  byDate: ExcelDayRow[]
}

type AppSummaryResponse = {
  period: {
    startDate: string
    endDate: string
  }
  appTotals: TvaTotals & {
    ttc_other: number
    ht_other: number
    tva_other: number
    orders: number
  }
  appByDate: Array<
    ExcelDayRow & {
      ttc_other: number
      ht_other: number
      tva_other: number
      orders: number
    }
  >
}

const round2 = (value: number) => Math.round(value * 100) / 100

const asNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const raw = String(value || "")
    .replace(/\s+/g, "")
    .replace(/€/g, "")
    .replace(",", ".")
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeHeader = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()

const parseDateFromServiceLabel = (raw: unknown) => {
  const text = String(raw || "")
  const match = text.match(/du\s+(\d{2})\/(\d{2})\/(\d{4})/i)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

const buildEmptyTotals = (): TvaTotals => ({
  ca_ttc: 0,
  ca_ht: 0,
  total_tva: 0,
  ttc_0: 0,
  ht_0: 0,
  tva_0: 0,
  ttc_10: 0,
  ht_10: 0,
  tva_10: 0,
  ttc_20: 0,
  ht_20: 0,
  tva_20: 0,
})

const parseTvaExcel = async (file: File): Promise<ExcelAnalysis> => {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error("Aucune feuille détectée dans le fichier.")
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: "" })
  if (!rows || rows.length < 2) {
    throw new Error("Le fichier ne contient pas assez de données.")
  }

  const headers = (rows[0] || []).map((cell) => normalizeHeader(cell))
  const findCol = (tokens: string[]) => headers.findIndex((header) => tokens.every((token) => header.includes(token)))
  const findRateCol = (kind: "ttc" | "ht" | "tva", rate: 0 | 10 | 20) => {
    return headers.findIndex((header) => {
      if (!header.includes(kind)) return false
      const idx = header.indexOf(kind)
      const afterKind = idx >= 0 ? header.slice(idx + kind.length) : header
      const match = afterKind.match(/(\d+(?:[.,]\d+)?)/)
      if (!match) return false
      const parsedRate = Number(String(match[1]).replace(",", "."))
      return Number.isFinite(parsedRate) && Math.round(parsedRate) === rate
    })
  }

  const col = {
    ca_ttc: findCol(["ca", "ttc", "net"]),
    ca_ht: findCol(["ca", "ht"]),
    ttc_0: findRateCol("ttc", 0),
    ht_0: findRateCol("ht", 0),
    tva_0: findRateCol("tva", 0),
    ttc_10: findRateCol("ttc", 10),
    ht_10: findRateCol("ht", 10),
    tva_10: findRateCol("tva", 10),
    ttc_20: findRateCol("ttc", 20),
    ht_20: findRateCol("ht", 20),
    tva_20: findRateCol("tva", 20),
  }

  if (col.ca_ttc < 0 || col.ca_ht < 0 || col.tva_10 < 0 || col.tva_20 < 0) {
    throw new Error("Colonnes TVA non reconnues dans cet export.")
  }

  let totalRow: (string | number)[] | null = null
  const byDate: ExcelDayRow[] = []

  for (const row of rows.slice(1)) {
    const firstCell = String(row[0] || "").trim()
    if (!firstCell) continue

    if (firstCell.toUpperCase() === "TOTAL") {
      totalRow = row
      continue
    }

    const date = parseDateFromServiceLabel(firstCell)
    if (!date) continue

    const dayRow: ExcelDayRow = {
      date,
      ca_ttc: asNumber(row[col.ca_ttc]),
      ca_ht: asNumber(row[col.ca_ht]),
      ttc_0: col.ttc_0 >= 0 ? asNumber(row[col.ttc_0]) : 0,
      ht_0: col.ht_0 >= 0 ? asNumber(row[col.ht_0]) : 0,
      tva_0: col.tva_0 >= 0 ? asNumber(row[col.tva_0]) : 0,
      ttc_10: col.ttc_10 >= 0 ? asNumber(row[col.ttc_10]) : 0,
      ht_10: col.ht_10 >= 0 ? asNumber(row[col.ht_10]) : 0,
      tva_10: col.tva_10 >= 0 ? asNumber(row[col.tva_10]) : 0,
      ttc_20: col.ttc_20 >= 0 ? asNumber(row[col.ttc_20]) : 0,
      ht_20: col.ht_20 >= 0 ? asNumber(row[col.ht_20]) : 0,
      tva_20: col.tva_20 >= 0 ? asNumber(row[col.tva_20]) : 0,
      total_tva: 0,
    }

    dayRow.total_tva = round2(dayRow.tva_0 + dayRow.tva_10 + dayRow.tva_20)
    byDate.push(dayRow)
  }

  if (byDate.length === 0) {
    throw new Error("Aucune ligne de service détectée dans le fichier.")
  }

  byDate.sort((a, b) => a.date.localeCompare(b.date))

  const fallbackTotals = byDate.reduce(
    (acc, row) => {
      acc.ca_ttc += row.ca_ttc
      acc.ca_ht += row.ca_ht
      acc.ttc_0 += row.ttc_0
      acc.ht_0 += row.ht_0
      acc.tva_0 += row.tva_0
      acc.ttc_10 += row.ttc_10
      acc.ht_10 += row.ht_10
      acc.tva_10 += row.tva_10
      acc.ttc_20 += row.ttc_20
      acc.ht_20 += row.ht_20
      acc.tva_20 += row.tva_20
      acc.total_tva += row.total_tva
      return acc
    },
    buildEmptyTotals(),
  )

  const totals: TvaTotals = totalRow
    ? {
        ca_ttc: asNumber(totalRow[col.ca_ttc]),
        ca_ht: asNumber(totalRow[col.ca_ht]),
        ttc_0: col.ttc_0 >= 0 ? asNumber(totalRow[col.ttc_0]) : fallbackTotals.ttc_0,
        ht_0: col.ht_0 >= 0 ? asNumber(totalRow[col.ht_0]) : fallbackTotals.ht_0,
        tva_0: col.tva_0 >= 0 ? asNumber(totalRow[col.tva_0]) : fallbackTotals.tva_0,
        ttc_10: col.ttc_10 >= 0 ? asNumber(totalRow[col.ttc_10]) : fallbackTotals.ttc_10,
        ht_10: col.ht_10 >= 0 ? asNumber(totalRow[col.ht_10]) : fallbackTotals.ht_10,
        tva_10: col.tva_10 >= 0 ? asNumber(totalRow[col.tva_10]) : fallbackTotals.tva_10,
        ttc_20: col.ttc_20 >= 0 ? asNumber(totalRow[col.ttc_20]) : fallbackTotals.ttc_20,
        ht_20: col.ht_20 >= 0 ? asNumber(totalRow[col.ht_20]) : fallbackTotals.ht_20,
        tva_20: col.tva_20 >= 0 ? asNumber(totalRow[col.tva_20]) : fallbackTotals.tva_20,
        total_tva: 0,
      }
    : fallbackTotals

  totals.total_tva = round2(totals.tva_0 + totals.tva_10 + totals.tva_20)

  return {
    sourceFileName: file.name,
    sheetName,
    period: {
      startDate: byDate[0].date,
      endDate: byDate[byDate.length - 1].date,
    },
    totals: {
      ...totals,
      ca_ttc: round2(totals.ca_ttc),
      ca_ht: round2(totals.ca_ht),
      ttc_0: round2(totals.ttc_0),
      ht_0: round2(totals.ht_0),
      tva_0: round2(totals.tva_0),
      ttc_10: round2(totals.ttc_10),
      ht_10: round2(totals.ht_10),
      tva_10: round2(totals.tva_10),
      ttc_20: round2(totals.ttc_20),
      ht_20: round2(totals.ht_20),
      tva_20: round2(totals.tva_20),
      total_tva: round2(totals.total_tva),
    },
    byDate: byDate.map((row) => ({
      ...row,
      ca_ttc: round2(row.ca_ttc),
      ca_ht: round2(row.ca_ht),
      ttc_0: round2(row.ttc_0),
      ht_0: round2(row.ht_0),
      tva_0: round2(row.tva_0),
      ttc_10: round2(row.ttc_10),
      ht_10: round2(row.ht_10),
      tva_10: round2(row.tva_10),
      ttc_20: round2(row.ttc_20),
      ht_20: round2(row.ht_20),
      tva_20: round2(row.tva_20),
      total_tva: round2(row.total_tva),
    })),
  }
}

const formatEuro = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)

export default function TvaAnalystPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  const canOpenModule = Boolean(user && (user.role === "manager" || user.is_tva_analyst))
  const [reportsAccessCode, setReportsAccessCode] = useState("")
  const [enteredReportsCode, setEnteredReportsCode] = useState("")
  const [reportsCodeError, setReportsCodeError] = useState("")
  const [accessCodeLoading, setAccessCodeLoading] = useState(true)
  const [accessUnlocked, setAccessUnlocked] = useState(false)

  const [excelAnalysis, setExcelAnalysis] = useState<ExcelAnalysis | null>(null)
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")
  const [fileError, setFileError] = useState("")
  const [isParsingFile, setIsParsingFile] = useState(false)

  const [appSummary, setAppSummary] = useState<AppSummaryResponse | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState("")

  const requiresAccessCode = reportsAccessCode.trim().length > 0
  const hasAccess = !requiresAccessCode || accessUnlocked

  useEffect(() => {
    if (!isLoading && (!user || !canOpenModule)) {
      router.push("/floor-plan")
    }
  }, [isLoading, user, canOpenModule, router])

  useEffect(() => {
    const fetchReportsAccessCode = async () => {
      try {
        setAccessCodeLoading(true)
        const response = await fetch("/api/admin/reports-access")
        if (!response.ok) {
          setReportsAccessCode("")
          return
        }
        const data = await response.json().catch(() => ({}))
        const accessCode = String(data?.access_code || "").trim()
        setReportsAccessCode(accessCode)
        if (!accessCode) setAccessUnlocked(true)
      } catch (error) {
        console.error("[v0] Error fetching reports access code:", error)
        setReportsAccessCode("")
      } finally {
        setAccessCodeLoading(false)
      }
    }

    if (!user || !canOpenModule) {
      setAccessCodeLoading(false)
      return
    }

    fetchReportsAccessCode()
  }, [user, canOpenModule])

  const unlockModule = () => {
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

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setIsParsingFile(true)
      setFileError("")
      setCompareError("")
      setAppSummary(null)
      const parsed = await parseTvaExcel(file)
      setExcelAnalysis(parsed)
      setPeriodStart(parsed.period.startDate)
      setPeriodEnd(parsed.period.endDate)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de lire ce fichier."
      setFileError(message)
      setExcelAnalysis(null)
    } finally {
      setIsParsingFile(false)
    }
  }

  const handleCompare = async () => {
    if (!excelAnalysis) return
    if (!periodStart || !periodEnd) {
      setCompareError("Sélectionnez une période valide.")
      return
    }

    try {
      setCompareLoading(true)
      setCompareError("")
      const response = await fetch(
        `/api/admin/tva-analyst/summary?startDate=${encodeURIComponent(periodStart)}&endDate=${encodeURIComponent(periodEnd)}`,
      )

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error?.error || "Impossible de comparer les données.")
      }

      const data = (await response.json()) as AppSummaryResponse
      setAppSummary(data)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur de comparaison."
      setCompareError(message)
      setAppSummary(null)
    } finally {
      setCompareLoading(false)
    }
  }

  const comparisonMetrics = useMemo(() => {
    if (!excelAnalysis || !appSummary) return []
    const fields: Array<{ key: keyof TvaTotals; label: string }> = [
      { key: "ca_ttc", label: "CA TTC Net" },
      { key: "ca_ht", label: "CA HT" },
      { key: "total_tva", label: "TVA totale" },
      { key: "tva_10", label: "TVA 10%" },
      { key: "tva_20", label: "TVA 20%" },
      { key: "tva_0", label: "TVA 0%" },
    ]

    return fields.map((field) => {
      const excelValue = excelAnalysis.totals[field.key]
      const appValue = appSummary.appTotals[field.key]
      const diff = round2(appValue - excelValue)
      const diffPct = excelValue !== 0 ? (diff / excelValue) * 100 : null
      return {
        ...field,
        excelValue,
        appValue,
        diff,
        diffPct,
      }
    })
  }, [excelAnalysis, appSummary])

  const tva20Comparison = useMemo(() => {
    if (!excelAnalysis || !appSummary) return null
    const excelValue = excelAnalysis.totals.tva_20
    const appValue = appSummary.appTotals.tva_20
    const diff = round2(appValue - excelValue)
    const diffPct = excelValue !== 0 ? (diff / excelValue) * 100 : null
    return { excelValue, appValue, diff, diffPct }
  }, [excelAnalysis, appSummary])

  const dailyDifferences = useMemo(() => {
    if (!excelAnalysis || !appSummary) return []

    const excelByDate = new Map(excelAnalysis.byDate.map((row) => [row.date, row]))
    const appByDate = new Map(appSummary.appByDate.map((row) => [row.date, row]))
    const allDates = Array.from(new Set([...excelByDate.keys(), ...appByDate.keys()])).sort((a, b) =>
      a.localeCompare(b),
    )

    return allDates.map((date) => {
      const excel = excelByDate.get(date)
      const app = appByDate.get(date)
      const excelTva = excel?.total_tva || 0
      const appTva = app?.total_tva || 0
      const excelTva20 = excel?.tva_20 || 0
      const appTva20 = app?.tva_20 || 0
      const excelTtc = excel?.ca_ttc || 0
      const appTtc = app?.ca_ttc || 0
      return {
        date,
        excelTva,
        appTva,
        tvaDiff: round2(appTva - excelTva),
        excelTva20,
        appTva20,
        tva20Diff: round2(appTva20 - excelTva20),
        excelTtc,
        appTtc,
        ttcDiff: round2(appTtc - excelTtc),
      }
    })
  }, [excelAnalysis, appSummary])

  if (isLoading || accessCodeLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  if (!user || !canOpenModule) return null

  if (requiresAccessCode && !hasAccess) {
    return (
      <div className="min-h-screen bg-slate-900 p-4 sm:p-6 flex items-center justify-center">
        <Card className="w-full max-w-md bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-xl">Accès protégé</CardTitle>
            <CardDescription className="text-slate-300">Code Analyste TVA requis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="password"
              value={enteredReportsCode}
              onChange={(e) => {
                setEnteredReportsCode(e.target.value)
                if (reportsCodeError) setReportsCodeError("")
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") unlockModule()
              }}
              className="bg-slate-700 border-slate-600 text-white"
              placeholder="Entrer le code"
            />
            {reportsCodeError && <p className="text-xs text-rose-400">{reportsCodeError}</p>}
            <div className="flex gap-2">
              <Button onClick={unlockModule} className="bg-rose-600 hover:bg-rose-700 w-full">
                Déverrouiller
              </Button>
              <Button
                onClick={() => router.push("/floor-plan")}
                variant="outline"
                className="bg-slate-700 border-slate-600 text-white"
              >
                Retour
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4">
          <Button
            onClick={() => router.push(user.role === "manager" ? "/admin" : "/floor-plan")}
            variant="outline"
            size="sm"
            className="bg-slate-800 text-white border-slate-700"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-white">Analyste TVA</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">Import Excel et comparaison avec Sophia Pad</p>
          </div>
        </div>
      </div>

      <Card className="bg-slate-800 border-slate-700 mb-6">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Upload className="h-5 w-5 text-cyan-400" />
            Import du fichier export TVA
          </CardTitle>
          <CardDescription className="text-slate-400">
            Fichier attendu: export détaillé (ex: L&apos;Addition) avec colonnes TVA 0/10/20.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} className="bg-slate-700 border-slate-600 text-white" />
          {isParsingFile && <p className="text-sm text-slate-300">Lecture du fichier...</p>}
          {fileError && <p className="text-sm text-rose-400">{fileError}</p>}
          {excelAnalysis && (
            <div className="rounded-lg border border-slate-600 bg-slate-900/60 p-3 text-sm text-slate-200">
              <p>
                <span className="text-slate-400">Fichier:</span> {excelAnalysis.sourceFileName}
              </p>
              <p>
                <span className="text-slate-400">Feuille:</span> {excelAnalysis.sheetName}
              </p>
              <p>
                <span className="text-slate-400">Période détectée:</span> {excelAnalysis.period.startDate} →{" "}
                {excelAnalysis.period.endDate}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {excelAnalysis && (
        <Card className="bg-slate-800 border-slate-700 mb-6">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Calculator className="h-5 w-5 text-emerald-400" />
              Période de comparaison
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300 mb-1 block">Date début</Label>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div>
                <Label className="text-slate-300 mb-1 block">Date fin</Label>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCompare} disabled={compareLoading} className="bg-emerald-600 hover:bg-emerald-700">
                {compareLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Comparaison...
                  </>
                ) : (
                  "Comparer avec les données de l'application"
                )}
              </Button>
            </div>
            {compareError && <p className="text-sm text-rose-400">{compareError}</p>}
          </CardContent>
        </Card>
      )}

      {excelAnalysis && appSummary && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {comparisonMetrics.map((metric) => (
              <Card key={metric.key} className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-white text-sm">{metric.label}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-xs text-slate-400">Excel: {formatEuro(metric.excelValue)}</p>
                  <p className="text-xs text-slate-400">Sophia Pad: {formatEuro(metric.appValue)}</p>
                  <p className={`text-sm font-semibold ${Math.abs(metric.diff) > 0.01 ? "text-amber-300" : "text-emerald-300"}`}>
                    Écart: {formatEuro(metric.diff)}
                  </p>
                  {metric.diffPct != null && (
                    <p className="text-xs text-slate-400">Écart %: {metric.diffPct.toFixed(2)}%</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {tva20Comparison && (
            <Card className="bg-slate-800 border-slate-700 mb-6">
              <CardHeader>
                <CardTitle className="text-white">Écart TVA 20% (Sophia Pad vs Excel)</CardTitle>
                <CardDescription className="text-slate-400">
                  Calcul: valeur TVA 20% App - valeur TVA 20% Excel
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-lg border border-slate-600 bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400">TVA 20% Excel</p>
                  <p className="text-lg font-semibold text-white">{formatEuro(tva20Comparison.excelValue)}</p>
                </div>
                <div className="rounded-lg border border-slate-600 bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400">TVA 20% Sophia Pad</p>
                  <p className="text-lg font-semibold text-white">{formatEuro(tva20Comparison.appValue)}</p>
                </div>
                <div className="rounded-lg border border-slate-600 bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-400">Écart TVA 20%</p>
                  <p className={`text-lg font-semibold ${Math.abs(tva20Comparison.diff) > 0.01 ? "text-amber-300" : "text-emerald-300"}`}>
                    {formatEuro(tva20Comparison.diff)}
                  </p>
                  {tva20Comparison.diffPct != null && (
                    <p className="text-xs text-slate-400 mt-1">Écart %: {tva20Comparison.diffPct.toFixed(2)}%</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-slate-800 border-slate-700 mb-6">
            <CardHeader>
              <CardTitle className="text-white">Détail par jour (TVA totale, TVA 20% et CA TTC)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-600 text-slate-300">
                      <th className="text-left py-2 pr-3">Date</th>
                      <th className="text-right py-2 px-3">TVA Excel</th>
                      <th className="text-right py-2 px-3">TVA App</th>
                      <th className="text-right py-2 px-3">Écart TVA</th>
                      <th className="text-right py-2 px-3">TVA 20% Excel</th>
                      <th className="text-right py-2 px-3">TVA 20% App</th>
                      <th className="text-right py-2 px-3">Écart TVA 20%</th>
                      <th className="text-right py-2 px-3">CA TTC Excel</th>
                      <th className="text-right py-2 px-3">CA TTC App</th>
                      <th className="text-right py-2 pl-3">Écart CA TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyDifferences.map((row) => (
                      <tr key={row.date} className="border-b border-slate-700/60 text-slate-100">
                        <td className="py-2 pr-3">{row.date}</td>
                        <td className="py-2 px-3 text-right">{formatEuro(row.excelTva)}</td>
                        <td className="py-2 px-3 text-right">{formatEuro(row.appTva)}</td>
                        <td className={`py-2 px-3 text-right ${Math.abs(row.tvaDiff) > 0.01 ? "text-amber-300" : "text-emerald-300"}`}>
                          {formatEuro(row.tvaDiff)}
                        </td>
                        <td className="py-2 px-3 text-right">{formatEuro(row.excelTva20)}</td>
                        <td className="py-2 px-3 text-right">{formatEuro(row.appTva20)}</td>
                        <td className={`py-2 px-3 text-right ${Math.abs(row.tva20Diff) > 0.01 ? "text-amber-300" : "text-emerald-300"}`}>
                          {formatEuro(row.tva20Diff)}
                        </td>
                        <td className="py-2 px-3 text-right">{formatEuro(row.excelTtc)}</td>
                        <td className="py-2 px-3 text-right">{formatEuro(row.appTtc)}</td>
                        <td className={`py-2 pl-3 text-right ${Math.abs(row.ttcDiff) > 0.01 ? "text-amber-300" : "text-emerald-300"}`}>
                          {formatEuro(row.ttcDiff)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-violet-400" />
                Contrôle complémentaire
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-300 space-y-2">
              <p>
                Si l&apos;écart est non nul, vérifie d&apos;abord que la période comparée correspond exactement à
                l&apos;export Excel.
              </p>
              <p>
                L&apos;application calcule la TVA à partir des lignes de vente (articles + suppléments), ce qui peut
                révéler des divergences de configuration de taux.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
