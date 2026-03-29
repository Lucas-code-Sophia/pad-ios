"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Printer } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sampleTicket } from "@/lib/epos"
import { printTicketWithConfiguredMode, type PrintMode } from "@/lib/print-client"
import {
  discoverNativePrinters,
  isNativeCapacitorRuntime,
  type DiscoveredNativePrinter,
} from "@/lib/capacitor-printer"

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
          data.print_mode === "direct_epos" || data.print_mode === "airprint" ? data.print_mode : "server"
        const effectiveMode = isNativeCapacitorRuntime() && modeFromDb === "server" ? "direct_epos" : modeFromDb
        setPrintMode(effectiveMode)
      }
    } catch (error) {
      console.error("[v0] Error fetching print settings:", error)
    }
  }

  useEffect(() => {
    if (isNativeCapacitor && printMode === "server") {
      setPrintMode("direct_epos")
    }
  }, [isNativeCapacitor, printMode])

  const savePrintSettings = async () => {
    try {
      setSavingPrint(true)
      const effectivePrintMode: PrintMode = isNativeCapacitor && printMode === "server" ? "direct_epos" : printMode
      const res = await fetch("/api/admin/print-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kitchen_ip: kitchenIp,
          bar_ip: barIp,
          caisse_ip: caisseIp,
          print_mode: effectivePrintMode,
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

  const testPrint = async (kind: "kitchen" | "bar" | "caisse") => {
    try {
      const result = await printTicketWithConfiguredMode({
        kind,
        ticket: sampleTicket(kind),
        modeOverride: printMode,
        ipOverride: kind === "bar" ? barIp : kind === "caisse" ? caisseIp : kitchenIp,
      })
      if (result.ok) {
        alert(`Test d'impression envoye (mode: ${result.mode})`)
      } else {
        alert(result.message || "Echec du test d'impression")
      }
    } catch {
      alert("Echec du test d'impression")
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
                  {!isNativeCapacitor && <option value="server">Serveur (Vercel)</option>}
                  <option value="direct_epos">Direct Epson (LAN local)</option>
                  <option value="airprint">Impression systeme (AirPrint / Android)</option>
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  {isNativeCapacitor
                    ? "Mode app native: Epson LAN local avec fallback impression systeme."
                    : "Direct Epson et AirPrint doivent etre lances depuis un appareil sur le Wi-Fi local du restaurant."}
                </p>
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
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
