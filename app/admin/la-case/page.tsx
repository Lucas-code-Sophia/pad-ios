"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ArrowLeft,
  FileDown,
  Image as ImageIcon,
  Loader2,
  Printer,
  RefreshCcw,
  Share2,
  Ticket,
  Users,
} from "lucide-react"
import { printTicketWithConfiguredMode } from "@/lib/print-client"
import { nativePrintAirPrint } from "@/lib/capacitor-printer"
import type { EposTicket } from "@/lib/epos"
import {
  buildReceiptPrintLines,
  buildReceiptTicketHtml,
  buildTicketPaymentRows,
  formatTicketDateTime,
  generateRandomTicketRef,
  type TicketLayoutData,
  type TicketPrintLine,
  type TicketTaxRow,
} from "@/lib/ticket-layout"

const sanitizeIntegerInput = (value: string) => value.replace(/\D/g, "")

const parseBoundedIntegerInput = (value: string, min: number, max: number, fallback: number) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const toDateTimeLocalInput = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

const toSafeAmount = (value: string) => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const buildEposTicketFromLines = (title: string, lines: TicketPrintLine[]): EposTicket => ({
  title,
  lines: lines.map((line) => ({
    content: line.content,
    align: line.align || "left",
    fontScale: line.fontScale,
    font: line.font || "font_b",
  })),
  cut: true,
  beep: true,
})

export default function LaCasePage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  const [ticketRef, setTicketRef] = useState(() => generateRandomTicketRef())
  const [ticketLabel, setTicketLabel] = useState("Ticket repas")
  const [serverName, setServerName] = useState("")
  const [serviceType, setServiceType] = useState("Sur place")
  const [tableLabel, setTableLabel] = useState("Table -")
  const [ticketDate, setTicketDate] = useState(() => toDateTimeLocalInput(new Date()))
  const [mealsCount, setMealsCount] = useState("3")
  const [totalAmount, setTotalAmount] = useState("")
  const [includeTax, setIncludeTax] = useState(true)
  const [taxRate, setTaxRate] = useState<10 | 20>(10)
  const [customNote, setCustomNote] = useState("")

  const [printingTicket, setPrintingTicket] = useState(false)
  const [airPrinting, setAirPrinting] = useState(false)
  const [downloadingPng, setDownloadingPng] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [sharing, setSharing] = useState(false)

  const mealsCountValue = parseBoundedIntegerInput(mealsCount, 1, 300, 1)
  const totalAmountValue = toSafeAmount(totalAmount)

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user?.name && !serverName) {
      setServerName(user.name)
    }
  }, [user, serverName])

  const ticketLayoutData = useMemo<TicketLayoutData>(() => {
    const parsedDate = ticketDate ? new Date(ticketDate) : new Date()
    const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate
    const formattedDate = formatTicketDateTime(safeDate)
    const safeServerName = serverName.trim() || "-"
    const safeService = serviceType.trim() || "Sur place"
    const serviceLine = `${safeService} - ${mealsCountValue} Couvert${mealsCountValue > 1 ? "s" : ""} - ${safeServerName}`
    const selectedTaxRate = Number(taxRate)

    const taxRows: TicketTaxRow[] = includeTax
      ? ([10, 20] as const).map((rate) => {
          const ttc = rate === selectedTaxRate ? totalAmountValue : 0
          const ht = ttc > 0 ? ttc / (1 + rate / 100) : 0
          const tva = ttc - ht
          return { rate, ht, tva, ttc }
        })
      : [
          { rate: 10, ht: 0, tva: 0, ttc: 0 },
          { rate: 20, ht: 0, tva: 0, ttc: 0 },
        ]

    return {
      documentTitle: `${ticketLabel || "Ticket repas"} - ${tableLabel || "Table -"}`,
      metaDate: formattedDate,
      serviceLine,
      tableLine: tableLabel.trim() || "Table -",
      items: [
        {
          label: `${mealsCountValue} ${ticketLabel.trim() || "Ticket repas"}`,
          amount: totalAmountValue,
          note: customNote.trim() || undefined,
        },
      ],
      perPersonAmount: totalAmountValue / Math.max(1, mealsCountValue),
      totalTtc: totalAmountValue,
      discountsIncluded: 0,
      alreadyPaid: 0,
      dueAmount: totalAmountValue,
      taxRows,
      payments: buildTicketPaymentRows({}),
      ticketRef,
      printedAt: formattedDate,
    }
  }, [
    customNote,
    includeTax,
    mealsCountValue,
    serverName,
    serviceType,
    tableLabel,
    taxRate,
    ticketDate,
    ticketLabel,
    ticketRef,
    totalAmountValue,
  ])

  const ticketHtml = useMemo(() => buildReceiptTicketHtml(ticketLayoutData), [ticketLayoutData])
  const ticketPrintLines = useMemo(() => buildReceiptPrintLines(ticketLayoutData), [ticketLayoutData])

  const renderTicketCanvas = async () => {
    if (typeof window === "undefined") return null

    const html2canvas = (await import("html2canvas")).default
    const iframe = document.createElement("iframe")
    iframe.setAttribute("aria-hidden", "true")
    iframe.style.position = "fixed"
    iframe.style.left = "-10000px"
    iframe.style.top = "0"
    iframe.style.width = "420px"
    iframe.style.height = "10px"
    iframe.style.opacity = "0"
    iframe.style.pointerEvents = "none"
    document.body.appendChild(iframe)

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Timeout de chargement du ticket")), 5000)

        iframe.onload = () => {
          window.clearTimeout(timeout)
          resolve()
        }
        iframe.onerror = () => {
          window.clearTimeout(timeout)
          reject(new Error("Impossible de charger le ticket"))
        }

        iframe.srcdoc = ticketHtml
      })

      const doc = iframe.contentDocument
      if (!doc) return null

      await new Promise((resolve) => window.setTimeout(resolve, 80))
      const target = doc.getElementById("ticket-root") || doc.body
      const rect = target.getBoundingClientRect()
      const captureWidth = Math.ceil(rect.width || target.scrollWidth || 380)
      const captureHeight = Math.ceil(rect.height || target.scrollHeight || 740)

      return await html2canvas(target, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        width: captureWidth,
        height: captureHeight,
        windowWidth: captureWidth,
        windowHeight: captureHeight,
      })
    } finally {
      iframe.remove()
    }
  }

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(anchor)
  }

  const buildFileBaseName = () => {
    const safeRef = ticketRef.replace(/[^a-zA-Z0-9_-]/g, "")
    const dateTag = new Date().toISOString().split("T")[0]
    return `ticket_repas_${safeRef || "la_case"}_${dateTag}`
  }

  const handlePrintTicket = async () => {
    setPrintingTicket(true)
    try {
      const result = await printTicketWithConfiguredMode({
        kind: "caisse",
        ticket: buildEposTicketFromLines("TICKET REPAS", ticketPrintLines),
      })

      if (!result.ok) {
        alert(result.message || "Echec de l'impression ticket")
      }
    } catch (error) {
      console.error("[v0] Error printing custom meal ticket:", error)
      alert("Echec de l'impression ticket")
    } finally {
      setPrintingTicket(false)
    }
  }

  const handleAirPrint = async () => {
    setAirPrinting(true)
    try {
      const result = await nativePrintAirPrint({
        html: ticketHtml,
        jobName: `${ticketLabel || "Ticket repas"} - ${ticketRef}`,
      })

      if (!result.ok) {
        alert(result.message || "Echec de l'ouverture AirPrint")
      }
    } catch (error) {
      console.error("[v0] Error launching AirPrint:", error)
      alert("Echec de l'ouverture AirPrint")
    } finally {
      setAirPrinting(false)
    }
  }

  const handleBrowserPrint = () => {
    if (typeof window === "undefined") return

    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=480,height=900")
    if (!printWindow) {
      alert("Popup bloquee. Autorise les popups pour lancer l'impression PDF.")
      return
    }

    printWindow.document.open()
    printWindow.document.write(ticketHtml)
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => {
      printWindow.print()
    }, 150)
  }

  const handleDownloadPng = async () => {
    setDownloadingPng(true)
    try {
      const canvas = await renderTicketCanvas()
      if (!canvas) {
        alert("Impossible de generer l'image du ticket")
        return
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
      if (!blob) {
        alert("Impossible de generer le PNG")
        return
      }

      downloadBlob(blob, `${buildFileBaseName()}.png`)
    } catch (error) {
      console.error("[v0] Error exporting PNG:", error)
      alert("Erreur lors de l'export PNG")
    } finally {
      setDownloadingPng(false)
    }
  }

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      const canvas = await renderTicketCanvas()
      if (!canvas) {
        alert("Impossible de generer l'image du ticket")
        return
      }

      const dataUrl = canvas.toDataURL("image/png")
      const { jsPDF } = await import("jspdf")
      const pxToMm = 25.4 / 96
      const widthMm = Math.max(10, canvas.width * pxToMm)
      const heightMm = Math.max(10, canvas.height * pxToMm)

      const pdf = new jsPDF({
        orientation: widthMm > heightMm ? "landscape" : "portrait",
        unit: "mm",
        format: [widthMm, heightMm],
      })
      pdf.addImage(dataUrl, "PNG", 0, 0, widthMm, heightMm, undefined, "FAST")
      pdf.save(`${buildFileBaseName()}.pdf`)
    } catch (error) {
      console.error("[v0] Error exporting PDF:", error)
      alert("Erreur lors de l'export PDF")
    } finally {
      setDownloadingPdf(false)
    }
  }

  const handleShareTicket = async () => {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      alert("Le partage n'est pas disponible sur cet appareil.")
      return
    }

    setSharing(true)
    try {
      const canvas = await renderTicketCanvas()
      if (!canvas) {
        alert("Impossible de generer l'image du ticket")
        return
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
      if (!blob) {
        alert("Impossible de preparer le partage")
        return
      }

      const fileName = `${buildFileBaseName()}.png`
      const file = new File([blob], fileName, { type: "image/png" })

      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: ticketLayoutData.documentTitle,
          text: "Ticket repas genere depuis La Case",
          files: [file],
        })
        return
      }

      await navigator.share({
        title: ticketLayoutData.documentTitle,
        text: "Ticket repas genere depuis La Case",
      })
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return
      }
      console.error("[v0] Error sharing ticket:", error)
      alert("Erreur pendant le partage")
    } finally {
      setSharing(false)
    }
  }

  const resetToNow = () => {
    setTicketDate(toDateTimeLocalInput(new Date()))
    setTicketRef(generateRandomTicketRef())
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
            <h1 className="text-xl sm:text-3xl font-bold text-white">La Case</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">
              Generateur de ticket repas modifiable avec impression, export et partage AirDrop
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="p-4 sm:p-6 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-blue-600 rounded-lg">
                <Ticket className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Parametres ticket</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">
                  Tous les champs sont modifiables
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6 pt-0">
            <div>
              <Label className="text-sm text-slate-300">Intitule</Label>
              <Input
                value={ticketLabel}
                onChange={(event) => setTicketLabel(event.target.value)}
                className="bg-slate-900 border-slate-700 mt-1"
                placeholder="Ticket repas"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm text-slate-300">Serveuse / Serveur</Label>
                <Input
                  value={serverName}
                  onChange={(event) => setServerName(event.target.value)}
                  className="bg-slate-900 border-slate-700 mt-1"
                  placeholder="Ex: Camille"
                />
              </div>
              <div>
                <Label className="text-sm text-slate-300">Type de service</Label>
                <Input
                  value={serviceType}
                  onChange={(event) => setServiceType(event.target.value)}
                  className="bg-slate-900 border-slate-700 mt-1"
                  placeholder="Sur place"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm text-slate-300">Date et heure</Label>
                <Input
                  type="datetime-local"
                  value={ticketDate}
                  onChange={(event) => setTicketDate(event.target.value)}
                  className="bg-slate-900 border-slate-700 mt-1"
                />
              </div>
              <div>
                <Label className="text-sm text-slate-300">Ligne table</Label>
                <Input
                  value={tableLabel}
                  onChange={(event) => setTableLabel(event.target.value)}
                  className="bg-slate-900 border-slate-700 mt-1"
                  placeholder="Table -"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm text-slate-300">Nombre de repas</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={mealsCount}
                  onChange={(event) => setMealsCount(sanitizeIntegerInput(event.target.value))}
                  onBlur={() => setMealsCount(String(mealsCountValue))}
                  className="bg-slate-900 border-slate-700 mt-1"
                  placeholder="3"
                />
              </div>
              <div>
                <Label className="text-sm text-slate-300">Montant total</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={totalAmount}
                  onChange={(event) => setTotalAmount(event.target.value)}
                  className="bg-slate-900 border-slate-700 mt-1"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <Label className="text-sm text-slate-300">Note libre (optionnel)</Label>
              <Input
                value={customNote}
                onChange={(event) => setCustomNote(event.target.value)}
                className="bg-slate-900 border-slate-700 mt-1"
                placeholder="Ex: Service midi"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox checked={includeTax} onCheckedChange={(checked) => setIncludeTax(checked === true)} id="la-case-tax" />
              <Label htmlFor="la-case-tax" className="text-sm text-slate-300 cursor-pointer">
                Afficher le detail TVA
              </Label>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant={taxRate === 10 ? "default" : "outline"}
                className={
                  taxRate === 10 ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-900 border-slate-700 text-white"
                }
                onClick={() => setTaxRate(10)}
                disabled={!includeTax}
              >
                10%
              </Button>
              <Button
                type="button"
                variant={taxRate === 20 ? "default" : "outline"}
                className={
                  taxRate === 20 ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-900 border-slate-700 text-white"
                }
                onClick={() => setTaxRate(20)}
                disabled={!includeTax}
              >
                20%
              </Button>
            </div>

            <div className="rounded border border-slate-700 bg-slate-900/60 p-3">
              <div className="text-xs text-slate-400 mb-1">Reference ticket</div>
              <div className="font-mono text-sm text-white break-all">{ticketRef}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="bg-slate-800 border-slate-600 text-white"
                  onClick={() => setTicketRef(generateRandomTicketRef())}
                >
                  <RefreshCcw className="h-3 w-3 mr-1" />
                  Nouvelle ref
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="bg-slate-800 border-slate-600 text-white"
                  onClick={resetToNow}
                >
                  Maintenant
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                onClick={handlePrintTicket}
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={printingTicket || totalAmountValue <= 0}
              >
                {printingTicket ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
                {printingTicket ? "Impression..." : "Imprimer ticket caisse"}
              </Button>

              <Button
                onClick={handleAirPrint}
                className="w-full bg-violet-600 hover:bg-violet-700"
                disabled={airPrinting || totalAmountValue <= 0}
              >
                {airPrinting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Users className="h-4 w-4 mr-2" />}
                {airPrinting ? "Ouverture..." : "Imprimer AirPrint"}
              </Button>

              <Button
                onClick={handleBrowserPrint}
                className="w-full bg-slate-600 hover:bg-slate-500"
                disabled={totalAmountValue <= 0}
              >
                <FileDown className="h-4 w-4 mr-2" />
                Imprimer / Enregistrer PDF
              </Button>

              <Button
                onClick={handleDownloadPdf}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={downloadingPdf || totalAmountValue <= 0}
              >
                {downloadingPdf ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
                {downloadingPdf ? "Export..." : "Telecharger PDF"}
              </Button>

              <Button
                onClick={handleDownloadPng}
                className="w-full bg-cyan-600 hover:bg-cyan-700"
                disabled={downloadingPng || totalAmountValue <= 0}
              >
                {downloadingPng ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ImageIcon className="h-4 w-4 mr-2" />}
                {downloadingPng ? "Export..." : "Telecharger PNG"}
              </Button>

              <Button
                onClick={handleShareTicket}
                className="w-full bg-orange-600 hover:bg-orange-700"
                disabled={sharing || totalAmountValue <= 0}
              >
                {sharing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Share2 className="h-4 w-4 mr-2" />}
                {sharing ? "Partage..." : "Partager (AirDrop)"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="p-4 sm:p-6 pb-3">
            <CardTitle className="text-white text-base sm:text-lg">Apercu du ticket</CardTitle>
            <CardDescription className="text-slate-400 text-xs sm:text-sm">
              Le rendu ci-dessous est celui utilise pour PNG, PDF et partage.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <div className="bg-white rounded border border-slate-600 overflow-hidden">
              <iframe
                title="Apercu ticket repas la case"
                srcDoc={ticketHtml}
                className="w-full h-[65vh] bg-white pointer-events-none sm:pointer-events-auto"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
