"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, CheckCircle2, Loader2, Printer, XCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sampleTicket } from "@/lib/epos"
import { printTicketWithConfiguredMode, type PrintMode, type PrintResult } from "@/lib/print-client"
import {
  discoverNativePrinters,
  isNativeCapacitorRuntime,
  type DiscoveredNativePrinter,
} from "@/lib/capacitor-printer"

type PrinterKind = "kitchen" | "bar" | "caisse"

type PrinterDiagnosticState = {
  running: boolean
  lastCheckedAt?: string
  result?: PrintResult
}

const PRINTER_KINDS: Array<{ kind: PrinterKind; label: string }> = [
  { kind: "kitchen", label: "Cuisine" },
  { kind: "bar", label: "Bar" },
  { kind: "caisse", label: "Caisse" },
]

export default function PrintingSettingsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [kitchenIp, setKitchenIp] = useState("")
  const [barIp, setBarIp] = useState("")
  const [caisseIp, setCaisseIp] = useState("")
  const [printMode, setPrintMode] = useState<PrintMode>("server")
  const [savingPrint, setSavingPrint] = useState(false)
  const [isNativeCapacitor, setIsNativeCapacitor] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState("")
  const [discoveredPrinters, setDiscoveredPrinters] = useState<DiscoveredNativePrinter[]>([])
  const [diagnosticsByKind, setDiagnosticsByKind] = useState<Record<PrinterKind, PrinterDiagnosticState>>({
    kitchen: { running: false },
    bar: { running: false },
    caisse: { running: false },
  })

  useEffect(() => {
    setIsNativeCapacitor(isNativeCapacitorRuntime())
  }, [])

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user?.role === "manager") {
      fetchPrintSettings()
    }
  }, [user])

  const fetchPrintSettings = async () => {
    try {
      const res = await fetch("/api/admin/print-settings")
      if (res.ok) {
        const data = await res.json()
        setKitchenIp(data.kitchen_ip || "")
        setBarIp(data.bar_ip || "")
        setCaisseIp(data.caisse_ip || "")
        const modeFromDb: PrintMode =
          data.print_mode === "direct_epos" || data.print_mode === "escpos_tcp" ? data.print_mode : "server"
        setPrintMode(modeFromDb)
      }
    } catch (error) {
      console.error("[v0] Error fetching print settings:", error)
    }
  }

  const savePrintSettings = async () => {
    try {
      setSavingPrint(true)
      const res = await fetch("/api/admin/print-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kitchen_ip: kitchenIp,
          bar_ip: barIp,
          caisse_ip: caisseIp,
          print_mode: printMode,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err?.error || "Echec de l'enregistrement des parametres d'impression")
      } else {
        alert("Parametres d'impression enregistres")
      }
    } catch {
      alert("Echec de l'enregistrement des parametres d'impression")
    } finally {
      setSavingPrint(false)
    }
  }

  const scanPrinters = async () => {
    try {
      setIsScanning(true)
      setScanMessage("")
      const result = await discoverNativePrinters(5000)
      if (!result.ok) {
        setDiscoveredPrinters([])
        setScanMessage(result.message || "Aucune imprimante detectee.")
        return
      }

      const seen = new Set<string>()
      const unique = result.printers.filter((printer) => {
        if (seen.has(printer.ip)) return false
        seen.add(printer.ip)
        return true
      })

      setDiscoveredPrinters(unique)
      setScanMessage(unique.length > 0 ? `${unique.length} imprimante(s) detectee(s).` : "Aucune imprimante detectee.")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Echec du scan iOS"
      setDiscoveredPrinters([])
      setScanMessage(message)
    } finally {
      setIsScanning(false)
    }
  }

  const getIpForKind = (kind: PrinterKind) => {
    if (kind === "bar") return barIp
    if (kind === "caisse") return caisseIp
    return kitchenIp
  }

  const testPrint = async (kind: PrinterKind) => {
    setDiagnosticsByKind((prev) => ({
      ...prev,
      [kind]: {
        ...prev[kind],
        running: true,
      },
    }))
    try {
      const result = await printTicketWithConfiguredMode({
        kind,
        ticket: sampleTicket(kind),
        modeOverride: printMode,
        ipOverride: getIpForKind(kind),
      })
      setDiagnosticsByKind((prev) => ({
        ...prev,
        [kind]: {
          running: false,
          lastCheckedAt: new Date().toISOString(),
          result,
        },
      }))
      if (result.ok) {
        alert(`Test d'impression envoye (mode: ${result.mode})`)
      } else {
        alert(result.message || "Echec du test d'impression")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Echec du test d'impression"
      setDiagnosticsByKind((prev) => ({
        ...prev,
        [kind]: {
          running: false,
          lastCheckedAt: new Date().toISOString(),
          result: {
            ok: false,
            mode: printMode,
            message,
          },
        },
      }))
      alert("Echec du test d'impression")
    }
  }

  const testAllPrinters = async () => {
    for (const { kind } of PRINTER_KINDS) {
      // Sequence volontaire pour obtenir un ordre de logs stable
      // et éviter de lancer 3 jobs en parallèle sur le même réseau local.
      // eslint-disable-next-line no-await-in-loop
      await testPrint(kind)
    }
  }

  const assignDiscoveredPrinter = (kind: "kitchen" | "bar" | "caisse", ip: string) => {
    if (kind === "kitchen") {
      setKitchenIp(ip)
      setScanMessage(`IP Cuisine assignee: ${ip}. Clique Enregistrer pour sauvegarder.`)
      return
    }
    if (kind === "bar") {
      setBarIp(ip)
      setScanMessage(`IP Bar assignee: ${ip}. Clique Enregistrer pour sauvegarder.`)
      return
    }
    setCaisseIp(ip)
    setScanMessage(`IP Caisse assignee: ${ip}. Clique Enregistrer pour sauvegarder.`)
  }

  const isAssigned = (kind: "kitchen" | "bar" | "caisse", ip: string) => {
    if (kind === "kitchen") return kitchenIp === ip
    if (kind === "bar") return barIp === ip
    return caisseIp === ip
  }

  const hasAnyDiagnosticRunning = PRINTER_KINDS.some(({ kind }) => diagnosticsByKind[kind].running)

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
            onClick={() => router.push("/admin")}
            variant="outline"
            size="sm"
            className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
          >
            <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Retour</span>
          </Button>
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-white">Impression</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">
              Reglages centralises pour toute l'equipe (sauvegardes en base)
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl">
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-slate-600 rounded-lg">
                <Printer className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Parametres d'impression</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">
                  Cuisine, Bar et Caisse
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 sm:p-6 pt-0">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label className="text-sm text-slate-300">Mode d'impression</Label>
                <select
                  value={printMode}
                  onChange={(e) => setPrintMode(e.target.value as PrintMode)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-sm text-white"
                >
                  <option value="server">Serveur (Vercel)</option>
                  <option value="direct_epos">Direct Epson (LAN local)</option>
                  <option value="escpos_tcp">ESC/POS TCP (9100)</option>
                </select>
                <div className="text-xs text-slate-400 mt-1 space-y-1">
                  <p>Reglage global partage: ce mode s'applique a tous les pads de l'equipe.</p>
                  {printMode === "escpos_tcp" ? (
                    <>
                      <p>ESC/POS TCP: port fixe 9100, encodage CP437, sans fallback.</p>
                      <p>Mode disponible uniquement dans l'app native iOS/Android.</p>
                    </>
                  ) : isNativeCapacitor ? (
                    <p>Mode app native actif. Les tests partent en LAN local selon le mode choisi.</p>
                  ) : (
                    <p>Direct Epson doit etre lance depuis un appareil sur le Wi-Fi local du restaurant.</p>
                  )}
                </div>
              </div>
              {isNativeCapacitor && (
                <div className="rounded-md border border-slate-600 bg-slate-900/50 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-sm text-slate-300">Scanner (App native)</Label>
                    <Button size="sm" variant="outline" onClick={scanPrinters} disabled={isScanning}>
                      {isScanning ? "Scan en cours..." : "Scanner les imprimantes"}
                    </Button>
                  </div>

                  {scanMessage && <p className="text-xs text-slate-300">{scanMessage}</p>}

                  {discoveredPrinters.length > 0 && (
                    <div className="space-y-2">
                      {discoveredPrinters.map((printer) => (
                        <div
                          key={`${printer.ip}-${printer.service}-${printer.port}`}
                          className="rounded border border-slate-700 bg-slate-800/80 p-2"
                        >
                          <div className="text-xs text-slate-200">
                            {printer.name} - {printer.ip}
                          </div>
                          <div className="text-[11px] text-slate-400 mb-2">
                            {printer.service || "service inconnu"}{printer.port > 0 ? `:${printer.port}` : ""}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={isAssigned("kitchen", printer.ip) ? "default" : "outline"}
                              onClick={() => assignDiscoveredPrinter("kitchen", printer.ip)}
                              className={isAssigned("kitchen", printer.ip) ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}
                            >
                              Cuisine
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={isAssigned("bar", printer.ip) ? "default" : "outline"}
                              onClick={() => assignDiscoveredPrinter("bar", printer.ip)}
                              className={isAssigned("bar", printer.ip) ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}
                            >
                              Bar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={isAssigned("caisse", printer.ip) ? "default" : "outline"}
                              onClick={() => assignDiscoveredPrinter("caisse", printer.ip)}
                              className={isAssigned("caisse", printer.ip) ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}
                            >
                              Caisse
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div>
                <Label className="text-sm text-slate-300">IP Cuisine</Label>
                <Input
                  value={kitchenIp}
                  onChange={(e) => setKitchenIp(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-sm"
                  placeholder="192.168.1.30"
                />
              </div>
              <div>
                <Label className="text-sm text-slate-300">IP Bar</Label>
                <Input
                  value={barIp}
                  onChange={(e) => setBarIp(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-sm"
                  placeholder="192.168.1.31"
                />
              </div>
              <div>
                <Label className="text-sm text-slate-300">IP Caisse</Label>
                <Input
                  value={caisseIp}
                  onChange={(e) => setCaisseIp(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-sm"
                  placeholder="192.168.1.32"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={savePrintSettings}
                  disabled={savingPrint}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Enregistrer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testPrint("kitchen")}
                  className="bg-slate-600 hover:bg-slate-500 border-slate-500"
                >
                  Test Cuisine
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testPrint("bar")}
                  className="bg-slate-600 hover:bg-slate-500 border-slate-500"
                >
                  Test Bar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testPrint("caisse")}
                  className="bg-slate-600 hover:bg-slate-500 border-slate-500"
                >
                  Test Caisse
                </Button>
              </div>

              <div className="rounded-md border border-slate-600 bg-slate-900/50 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label className="text-sm text-slate-300">Diagnostic impression (retour brut)</Label>
                    <p className="text-xs text-slate-400 mt-1">
                      Lance un test et affiche la reponse detaillee de chaque imprimante (code, message, status,
                      body, delai).
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={testAllPrinters} disabled={hasAnyDiagnosticRunning}>
                    {hasAnyDiagnosticRunning ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyse...
                      </>
                    ) : (
                      "Analyser les 3"
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {PRINTER_KINDS.map(({ kind, label }) => {
                    const state = diagnosticsByKind[kind]
                    const result = state.result
                    const diag = result?.diagnostics
                    return (
                      <div key={kind} className="rounded-md border border-slate-700 bg-slate-800/70 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{label}</span>
                            {state.running ? (
                              <span className="inline-flex items-center rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-200">
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                Analyse
                              </span>
                            ) : result ? (
                              result.ok ? (
                                <span className="inline-flex items-center rounded bg-green-900/40 px-2 py-0.5 text-[11px] text-green-300 border border-green-700/60">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  OK
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded bg-red-900/40 px-2 py-0.5 text-[11px] text-red-300 border border-red-700/60">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Erreur
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                                Non teste
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => testPrint(kind)}
                            disabled={state.running}
                          >
                            Tester
                          </Button>
                        </div>

                        <div className="text-[11px] text-slate-400">
                          IP: {getIpForKind(kind) || "non definie"} • Mode: {printMode}
                        </div>

                        {state.lastCheckedAt && (
                          <div className="text-[11px] text-slate-400">
                            Dernier test: {new Date(state.lastCheckedAt).toLocaleTimeString("fr-FR", { hour12: false })}
                          </div>
                        )}

                        {result?.message && (
                          <div className="text-xs text-slate-200 border border-slate-700 rounded p-2 bg-slate-900/70">
                            {result.message}
                          </div>
                        )}

                        {diag && (
                          <div className="space-y-2">
                            <div className="text-[11px] text-slate-400">
                              Runtime: {diag.runtime} • Duree: {diag.durationMs} ms
                            </div>
                            {diag.entries.length > 0 ? (
                              <div className="space-y-2">
                                {diag.entries.map((entry, index) => (
                                  <div key={`${kind}-${index}`} className="rounded border border-slate-700 bg-slate-900/70 p-2 space-y-1">
                                    <div className="text-[11px] text-slate-300">
                                      {entry.step} • {entry.ok ? "OK" : "KO"}
                                      {typeof entry.durationMs === "number" ? ` • ${entry.durationMs} ms` : ""}
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      {new Date(entry.at).toLocaleTimeString("fr-FR", { hour12: false })}
                                      {typeof entry.status === "number" ? ` • status ${entry.status}` : ""}
                                      {entry.code ? ` • code ${entry.code}` : ""}
                                    </div>
                                    {entry.message && <div className="text-[11px] text-slate-200">{entry.message}</div>}
                                    {entry.bodySnippet && (
                                      <pre className="text-[10px] leading-4 text-slate-300 whitespace-pre-wrap break-all rounded bg-black/30 p-2">
                                        {entry.bodySnippet}
                                      </pre>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[11px] text-slate-500">Aucun detail technique remonte.</div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
