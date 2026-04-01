"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Loader2, Printer, RefreshCw, Search, TriangleAlert, XCircle } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  discoverNativePrinters,
  isNativeCapacitorRuntime,
  nativeGetPrinterStatus,
  type DiscoveredNativePrinter,
} from "@/lib/capacitor-printer"
import type { PrintMode } from "@/lib/print-client"

type PrinterRole = "kitchen" | "bar" | "caisse"

type PrinterStatus = {
  reachable: boolean | null
  message: string
  checking: boolean
}

const createInitialStatuses = (): Record<PrinterRole, PrinterStatus> => ({
  kitchen: { reachable: null, message: "Non verifiee", checking: false },
  bar: { reachable: null, message: "Non verifiee", checking: false },
  caisse: { reachable: null, message: "Non verifiee", checking: false },
})

const PRINTER_ROLES: Array<{ role: PrinterRole; label: string }> = [
  { role: "kitchen", label: "Cuisine" },
  { role: "bar", label: "Bar" },
  { role: "caisse", label: "Caisse" },
]

export default function PrinterSyncPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [returnTo, setReturnTo] = useState("/floor-plan")

  const [kitchenIp, setKitchenIp] = useState("")
  const [barIp, setBarIp] = useState("")
  const [caisseIp, setCaisseIp] = useState("")
  const [printMode, setPrintMode] = useState<PrintMode>("server")

  const [loadingSettings, setLoadingSettings] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [checkingAll, setCheckingAll] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState("")
  const [discoveredPrinters, setDiscoveredPrinters] = useState<DiscoveredNativePrinter[]>([])
  const [printerStatuses, setPrinterStatuses] = useState<Record<PrinterRole, PrinterStatus>>(createInitialStatuses)
  const [lastCheckedAt, setLastCheckedAt] = useState("")

  const isNativeCapacitor = isNativeCapacitorRuntime()

  const allConnected = PRINTER_ROLES.every(({ role }) => printerStatuses[role].reachable === true)
  const anyChecked = PRINTER_ROLES.some(({ role }) => printerStatuses[role].reachable !== null)

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [isLoading, router, user])

  useEffect(() => {
    if (typeof window === "undefined") return
    const rawValue = new URLSearchParams(window.location.search).get("returnTo")
    if (rawValue && rawValue.startsWith("/")) {
      setReturnTo(rawValue)
    }
  }, [])

  const runConnectivityCheck = async (overrides?: { kitchen: string; bar: string; caisse: string }) => {
    const targetIps = overrides || {
      kitchen: kitchenIp,
      bar: barIp,
      caisse: caisseIp,
    }

    setCheckingAll(true)
    setPrinterStatuses({
      kitchen: { reachable: null, message: "Verification...", checking: true },
      bar: { reachable: null, message: "Verification...", checking: true },
      caisse: { reachable: null, message: "Verification...", checking: true },
    })

    if (!isNativeCapacitor) {
      const nativeMessage = "Disponible uniquement dans l'app iOS/Android native."
      setPrinterStatuses({
        kitchen: { reachable: false, message: nativeMessage, checking: false },
        bar: { reachable: false, message: nativeMessage, checking: false },
        caisse: { reachable: false, message: nativeMessage, checking: false },
      })
      setLastCheckedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }))
      setCheckingAll(false)
      return
    }

    try {
      const checks = await Promise.all(
        PRINTER_ROLES.map(async ({ role }) => {
          const ip = targetIps[role].trim()
          if (!ip) {
            return [
              role,
              {
                reachable: false,
                message: "IP non configuree",
                checking: false,
              },
            ] as const
          }

          const result = await nativeGetPrinterStatus({ ip })
          if (result.ok && result.reachable) {
            return [
              role,
              {
                reachable: true,
                message: "Connectee",
                checking: false,
              },
            ] as const
          }

          return [
            role,
            {
              reachable: false,
              message: result.message || "Injoignable depuis ce pad",
              checking: false,
            },
          ] as const
        }),
      )

      setPrinterStatuses({
        kitchen: checks.find(([role]) => role === "kitchen")?.[1] || { reachable: false, message: "Erreur", checking: false },
        bar: checks.find(([role]) => role === "bar")?.[1] || { reachable: false, message: "Erreur", checking: false },
        caisse: checks.find(([role]) => role === "caisse")?.[1] || { reachable: false, message: "Erreur", checking: false },
      })
      setLastCheckedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Echec de verification"
      setPrinterStatuses({
        kitchen: { reachable: false, message, checking: false },
        bar: { reachable: false, message, checking: false },
        caisse: { reachable: false, message, checking: false },
      })
    } finally {
      setCheckingAll(false)
    }
  }

  const fetchPrintSettings = async () => {
    setLoadingSettings(true)
    try {
      const response = await fetch("/api/admin/print-settings")
      if (!response.ok) {
        throw new Error("Impossible de charger les imprimantes configurees.")
      }

      const data = await response.json()
      const nextIps = {
        kitchen: String(data?.kitchen_ip || ""),
        bar: String(data?.bar_ip || ""),
        caisse: String(data?.caisse_ip || ""),
      }
      const modeFromApi: PrintMode =
        data?.print_mode === "direct_epos" || data?.print_mode === "airprint" ? data.print_mode : "server"

      setKitchenIp(nextIps.kitchen)
      setBarIp(nextIps.bar)
      setCaisseIp(nextIps.caisse)
      setPrintMode(modeFromApi)
      await runConnectivityCheck(nextIps)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Echec de chargement"
      setScanMessage(message)
      setPrinterStatuses({
        kitchen: { reachable: false, message, checking: false },
        bar: { reachable: false, message, checking: false },
        caisse: { reachable: false, message, checking: false },
      })
    } finally {
      setLoadingSettings(false)
    }
  }

  useEffect(() => {
    if (user) {
      void fetchPrintSettings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const savePrintSettings = async () => {
    try {
      setSavingSettings(true)
      setScanMessage("")

      const response = await fetch("/api/admin/print-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kitchen_ip: kitchenIp.trim(),
          bar_ip: barIp.trim(),
          caisse_ip: caisseIp.trim(),
          print_mode: printMode,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error || "Echec de sauvegarde")
      }

      setScanMessage("Imprimantes enregistrees. Verification en cours...")
      await runConnectivityCheck()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Echec de sauvegarde"
      setScanMessage(message)
    } finally {
      setSavingSettings(false)
    }
  }

  const assignDiscoveredPrinter = (role: PrinterRole, ip: string) => {
    if (role === "kitchen") {
      setKitchenIp(ip)
    } else if (role === "bar") {
      setBarIp(ip)
    } else {
      setCaisseIp(ip)
    }
    setScanMessage(`IP ${role === "kitchen" ? "Cuisine" : role === "bar" ? "Bar" : "Caisse"} assignee: ${ip}`)
  }

  const isAssigned = (role: PrinterRole, ip: string) => {
    if (role === "kitchen") return kitchenIp.trim() === ip.trim()
    if (role === "bar") return barIp.trim() === ip.trim()
    return caisseIp.trim() === ip.trim()
  }

  const scanAndResync = async () => {
    setIsScanning(true)
    setScanMessage("")

    try {
      const result = await discoverNativePrinters(5000)
      if (!result.ok) {
        setDiscoveredPrinters([])
        setScanMessage(result.message || "Aucune imprimante detectee.")
        await runConnectivityCheck()
        return
      }

      const seen = new Set<string>()
      const unique = result.printers.filter((printer) => {
        if (seen.has(printer.ip)) return false
        seen.add(printer.ip)
        return true
      })

      setDiscoveredPrinters(unique)
      if (unique.length > 0) {
        setScanMessage(`${unique.length} imprimante(s) detectee(s). Assigne-les si besoin puis enregistre.`)
      } else {
        setScanMessage("Aucune imprimante detectee. Rapproche-toi des imprimantes puis reessaie.")
      }

      await runConnectivityCheck()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Echec de resynchronisation"
      setDiscoveredPrinters([])
      setScanMessage(message)
      await runConnectivityCheck()
    } finally {
      setIsScanning(false)
    }
  }

  if (isLoading || loadingSettings) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-lg">Chargement...</div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              onClick={() => router.push(returnTo)}
              variant="outline"
              size="sm"
              className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
            <div>
              <h1 className="text-white text-xl sm:text-2xl font-bold">Resynchronisation imprimantes</h1>
              <p className="text-slate-400 text-xs sm:text-sm">
                Verifie que ce pad est bien connecte aux imprimantes Cuisine, Bar et Caisse.
              </p>
            </div>
          </div>
        </div>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base sm:text-lg flex items-center gap-2">
              <Printer className="h-4 w-4 sm:h-5 sm:w-5" />
              Etat de connexion
            </CardTitle>
            <CardDescription className="text-slate-400 text-xs sm:text-sm">
              Dernier controle: {lastCheckedAt || "jamais"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PRINTER_ROLES.map(({ role, label }) => {
                const status = printerStatuses[role]
                const targetIp = role === "kitchen" ? kitchenIp : role === "bar" ? barIp : caisseIp
                const stateClass =
                  status.reachable === true
                    ? "border-green-700 bg-green-900/20"
                    : status.reachable === false
                      ? "border-red-700 bg-red-900/20"
                      : "border-slate-600 bg-slate-900/60"

                return (
                  <div key={role} className={`rounded-lg border p-3 ${stateClass}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">{label}</p>
                      {status.checking ? (
                        <Loader2 className="h-4 w-4 text-slate-300 animate-spin" />
                      ) : status.reachable === true ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : status.reachable === false ? (
                        <XCircle className="h-4 w-4 text-red-400" />
                      ) : (
                        <TriangleAlert className="h-4 w-4 text-slate-400" />
                      )}
                    </div>
                    <p className="text-xs text-slate-300 mt-1">IP: {targetIp || "Non configuree"}</p>
                    <p className="text-xs mt-1 text-slate-200">{status.message}</p>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => runConnectivityCheck()}
                disabled={checkingAll}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {checkingAll ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Verifier la connexion
              </Button>
              <Button
                onClick={scanAndResync}
                variant="outline"
                disabled={isScanning || checkingAll}
                className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
              >
                {isScanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                Re-synchroniser les imprimantes
              </Button>
            </div>

            {allConnected && anyChecked ? (
              <div className="rounded-lg border border-green-700 bg-green-900/20 p-3">
                <p className="text-green-300 text-sm font-semibold">Les 3 imprimantes sont connectees sur ce pad.</p>
                <Button onClick={() => router.push(returnTo)} className="mt-2 bg-green-600 hover:bg-green-700">
                  Valide
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-700 bg-amber-900/20 p-3">
                <p className="text-amber-300 text-sm font-semibold">Re-synchroniser les imprimantes</p>
                <p className="text-amber-200/90 text-xs mt-1">
                  Au moins une imprimante est injoignable. Rapproche-toi de la zone des imprimantes, relance la
                  detection, puis refais la verification.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base sm:text-lg">Imprimantes configurees</CardTitle>
            <CardDescription className="text-slate-400 text-xs sm:text-sm">
              Mets a jour les IP si besoin, puis enregistre.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-slate-300 text-sm">Cuisine</Label>
              <Input
                value={kitchenIp}
                onChange={(event) => setKitchenIp(event.target.value)}
                className="bg-slate-700 border-slate-600 text-white mt-1"
                placeholder="Ex: 192.168.1.101"
              />
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Bar</Label>
              <Input
                value={barIp}
                onChange={(event) => setBarIp(event.target.value)}
                className="bg-slate-700 border-slate-600 text-white mt-1"
                placeholder="Ex: 192.168.1.102"
              />
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Caisse</Label>
              <Input
                value={caisseIp}
                onChange={(event) => setCaisseIp(event.target.value)}
                className="bg-slate-700 border-slate-600 text-white mt-1"
                placeholder="Ex: 192.168.1.103"
              />
            </div>

            <Button onClick={savePrintSettings} disabled={savingSettings} className="bg-indigo-600 hover:bg-indigo-700">
              {savingSettings ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Enregistrer les imprimantes
            </Button>

            {scanMessage && <p className="text-xs text-slate-300">{scanMessage}</p>}
          </CardContent>
        </Card>

        {discoveredPrinters.length > 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-base sm:text-lg">Imprimantes detectees</CardTitle>
              <CardDescription className="text-slate-400 text-xs sm:text-sm">
                Assigne rapidement une imprimante a Cuisine, Bar ou Caisse.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {discoveredPrinters.map((printer) => (
                <div
                  key={`${printer.ip}-${printer.service}-${printer.port}`}
                  className="rounded border border-slate-700 bg-slate-900/50 p-3"
                >
                  <p className="text-sm text-white">
                    {printer.name} - {printer.ip}
                  </p>
                  <p className="text-xs text-slate-400 mb-2">
                    {printer.service || "service inconnu"}
                    {printer.port > 0 ? `:${printer.port}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {PRINTER_ROLES.map(({ role, label }) => (
                      <Button
                        key={`${printer.ip}-${role}`}
                        variant={isAssigned(role, printer.ip) ? "default" : "outline"}
                        onClick={() => assignDiscoveredPrinter(role, printer.ip)}
                        className={
                          isAssigned(role, printer.ip)
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : "bg-slate-700 border-slate-600 text-slate-100 hover:bg-slate-600"
                        }
                        size="sm"
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
