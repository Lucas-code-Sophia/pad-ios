"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import type { DailySalesRecord } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Calendar, TrendingUp, Users, DollarSign, CreditCard, Banknote, Printer } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface ServerStats {
  server_id: string
  server_name: string
  total_revenue: number
  order_count: number
  tables: Array<{
    table_number: string
    amount: number
    payment_method: string
    created_at: string
  }>
}

interface DailySalesData {
  date: string
  sales: DailySalesRecord[]
  statistics: {
    totalRevenue: number
    orderCount: number
    averageTicket: number
    totalTax: number
  }
  serverStats: ServerStats[]
}

interface TransactionItemDetail {
  id: string
  menu_item_id: string
  menu_name: string
  tax_rate?: number
  quantity: number
  price: number
  notes?: string
  status: string
  is_complimentary: boolean
  complimentary_reason?: string
  line_total: number
}

interface TransactionSupplementDetail {
  id: string
  name: string
  amount: number
  notes?: string
  is_complimentary: boolean
  complimentary_reason?: string
  created_at: string
}

interface TransactionPaymentDetail {
  id: string
  amount: number
  payment_method: "cash" | "card" | "other"
  tip_amount?: number
  created_at: string
}

interface TransactionDetailResponse {
  sale: DailySalesRecord
  order: {
    id: string
    table_id: string
    server_id: string
    created_at: string
    closed_at?: string
  } | null
  items: TransactionItemDetail[]
  supplements: TransactionSupplementDetail[]
  payments: TransactionPaymentDetail[]
  paymentBreakdown: {
    cash: number
    card: number
    other: number
    total: number
  }
}

export default function HistoryPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  const today = new Date().toISOString().split("T")[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0]
  const [selectedDate, setSelectedDate] = useState(today)
  // </CHANGE>

  const [salesData, setSalesData] = useState<DailySalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const [selectedTransaction, setSelectedTransaction] = useState<DailySalesRecord | null>(null)
  const [transactionDetail, setTransactionDetail] = useState<TransactionDetailResponse | null>(null)
  const [transactionDetailLoading, setTransactionDetailLoading] = useState(false)
  const [transactionDetailError, setTransactionDetailError] = useState<string | null>(null)
  const [billTicketDialogOpen, setBillTicketDialogOpen] = useState(false)
  const [mealTicketDialogOpen, setMealTicketDialogOpen] = useState(false)
  const [mealTicketMealsCount, setMealTicketMealsCount] = useState(3)
  const [mealTicketTotal, setMealTicketTotal] = useState("")
  const [mealTicketIncludeTax, setMealTicketIncludeTax] = useState(true)
  const [mealTicketTaxRate, setMealTicketTaxRate] = useState<10 | 20>(10)

  useEffect(() => {
    if (isLoading) return

    if (!user) {
      router.push("/login")
      return
    }

    if (user.role !== "manager") {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user?.role === "manager") {
      fetchSalesData()
    }
  }, [user, selectedDate])

  const fetchSalesData = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/daily-sales?date=${selectedDate}`)
      if (response.ok) {
        const data = await response.json()
        setSalesData(data)
      }
    } catch (error) {
      console.error("[v0] Error fetching sales data:", error)
    } finally {
      setLoading(false)
    }
  }

  const openTransactionDetail = async (sale: DailySalesRecord) => {
    setSelectedTransaction(sale)
    setTransactionDetail(null)
    setTransactionDetailError(null)
    setTransactionDetailLoading(true)
    setBillTicketDialogOpen(false)
    setMealTicketDialogOpen(false)

    try {
      const response = await fetch(`/api/daily-sales/${sale.id}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData?.error || "Chargement du détail impossible")
      }
      const detailData = await response.json()
      setTransactionDetail(detailData)
    } catch (error) {
      setTransactionDetailError(error instanceof Error ? error.message : "Erreur de chargement")
    } finally {
      setTransactionDetailLoading(false)
    }
  }

  const formatCurrency = (value: number) => `${Number(value || 0).toFixed(2)} €`

  const escapeHtml = (value: string | undefined | null) =>
    (value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")

  const openPrintWindow = (html: string) => {
    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      alert("Le navigateur a bloqué la fenêtre d'impression. Autorisez les popups puis réessayez.")
      return
    }

    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.onafterprint = () => {
      printWindow.close()
    }
    setTimeout(() => {
      printWindow.print()
    }, 150)
  }

  const buildTicketHtml = (title: string, body: string) => `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: monospace; margin: 0; background: #fff; }
          #ticket-root { padding: 12px; width: 320px; margin: 0 auto; color: #000; background: #fff; display: block; }
          .center { text-align: center; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
          .item-name { max-width: 70%; word-break: break-word; }
          .note { font-size: 10px; color: #333; font-style: italic; margin-left: 8px; }
          .section-title { font-size: 10px; font-weight: bold; margin: 8px 0 2px; text-transform: uppercase; }
          .complimentary { color: #666; text-decoration: line-through; }
          .total { border-top: 1px solid #000; margin-top: 8px; padding-top: 6px; font-size: 13px; font-weight: bold; display: flex; justify-content: space-between; }
          .kv { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; gap: 8px; }
          .footer { text-align: center; margin-top: 12px; font-size: 10px; }
          .meta { display:flex; justify-content:space-between; font-size:10px; gap:8px; }
          @media print {
            html, body { margin: 0; padding: 0; }
            #ticket-root { padding: 6px; width: auto; display: block; }
          }
        </style>
      </head>
      <body><div id="ticket-root">${body}</div></body>
    </html>
  `

  const getTicketHeaderHtml = () => {
    const sale = transactionDetail?.sale || selectedTransaction
    return `
      <div class="center" style="font-weight:bold;font-size:16px;">RESTAURANT SOPHIA</div>
      <div class="center" style="font-size:10px;">67 Boulevard de la plage</div>
      <div class="center" style="font-size:10px;">33970, Cap-Ferret</div>
      <div class="center" style="font-size:10px;">SIRET : 940 771 488 00027</div>
      <div class="divider"></div>
      <div class="meta">
        <div style="font-weight:bold;font-size:12px;">Table ${escapeHtml(sale?.table_number || "-")}</div>
        <div>Serveur : ${escapeHtml(sale?.server_name || "-")}</div>
      </div>
      <div style="font-size:10px;color:#333;">${escapeHtml(sale?.created_at ? new Date(sale.created_at).toLocaleString("fr-FR") : new Date().toLocaleString("fr-FR"))}</div>
      <div style="font-size:10px;color:#666;">Réimpression: ${escapeHtml(new Date().toLocaleString("fr-FR"))}</div>
    `
  }

  const getTransactionTaxBreakdown = () => {
    if (!transactionDetail) return { total: 0, subtotal: 0, tax10: 0, tax20: 0 }

    const total = Number(transactionDetail.sale.total_amount || 0)
    const itemTax = transactionDetail.items.reduce(
      (acc, item) => {
        if (item.is_complimentary) return acc
        const rate = Number(item.tax_rate || 0)
        const lineTotal = Number(item.price || 0) * Number(item.quantity || 0)
        const lineTax = rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0
        if (rate === 10) acc.tax10 += lineTax
        else if (rate === 20) acc.tax20 += lineTax
        return acc
      },
      { tax10: 0, tax20: 0 },
    )

    const supplementTax = transactionDetail.supplements.reduce(
      (acc, supplement) => {
        if (supplement.is_complimentary) return acc
        const rate = 10
        const amount = Number(supplement.amount || 0)
        const lineTax = amount - amount / (1 + rate / 100)
        acc.tax10 += lineTax
        return acc
      },
      { tax10: 0, tax20: 0 },
    )

    const tax10 = itemTax.tax10 + supplementTax.tax10
    const tax20 = itemTax.tax20 + supplementTax.tax20
    const subtotal = Math.max(0, total - tax10 - tax20)

    return { total, subtotal, tax10, tax20 }
  }

  const buildHistoryBillTicketHtml = () => {
    if (!transactionDetail) return ""
    const { total, subtotal, tax10, tax20 } = getTransactionTaxBreakdown()

    const itemsHtml = transactionDetail.items
      .map((item) => {
        const lineTotal = item.is_complimentary ? 0 : Number(item.line_total || 0)
        return `
          <div>
            <div class="row ${item.is_complimentary ? "complimentary" : ""}">
              <span class="item-name">${item.quantity}x ${escapeHtml(item.menu_name)}${item.is_complimentary ? " (OFFERT)" : ""}</span>
              <span>${formatCurrency(lineTotal)}</span>
            </div>
            ${item.notes ? `<div class="note">↳ ${escapeHtml(item.notes)}</div>` : ""}
          </div>
        `
      })
      .join("")

    const supplementsHtml =
      transactionDetail.supplements.length === 0
        ? ""
        : `
          <div class="section-title">Suppléments</div>
          ${transactionDetail.supplements
            .map((supplement) => {
              const lineTotal = supplement.is_complimentary ? 0 : Number(supplement.amount || 0)
              return `
                <div>
                  <div class="row ${supplement.is_complimentary ? "complimentary" : ""}">
                    <span class="item-name">${escapeHtml(supplement.name)}${supplement.is_complimentary ? " (OFFERT)" : ""}</span>
                    <span>${formatCurrency(lineTotal)}</span>
                  </div>
                  ${supplement.notes ? `<div class="note">↳ ${escapeHtml(supplement.notes)}</div>` : ""}
                </div>
              `
            })
            .join("")}
        `

    const body = `
      ${getTicketHeaderHtml()}
      <div style="margin: 10px 0;">
        ${itemsHtml}
        ${supplementsHtml}
      </div>
      <div class="kv"><span>Sous total</span><span>${formatCurrency(subtotal)}</span></div>
      <div class="kv"><span>TVA 10%</span><span>${formatCurrency(tax10)}</span></div>
      <div class="kv"><span>TVA 20%</span><span>${formatCurrency(tax20)}</span></div>
      <div class="total">
        <span>TOTAL</span>
        <span>${formatCurrency(total)}</span>
      </div>
      <div class="divider"></div>
      <div class="footer">Réimpression ticket addition</div>
      <div class="footer">Merci de votre visite chez SOPHIA</div>
    `

    return buildTicketHtml(`Réimpression addition - Table ${transactionDetail.sale.table_number || "-"}`, body)
  }

  const buildHistoryMealTicketHtml = () => {
    const total = Math.max(0, Number.parseFloat(mealTicketTotal) || 0)
    const rate = Number(mealTicketTaxRate)
    const taxAmount = mealTicketIncludeTax && rate > 0 ? total - total / (1 + rate / 100) : 0
    const subtotal = mealTicketIncludeTax ? Math.max(0, total - taxAmount) : total
    const mealsCount = Math.max(1, mealTicketMealsCount || 1)

    const body = `
      ${getTicketHeaderHtml()}
      <div class="center" style="font-weight:bold;font-size:14px;margin-top:6px;">TICKET REPAS</div>
      <div style="margin: 10px 0;">
        <div class="row">
          <span class="item-name">${mealsCount} repas</span>
          <span>${formatCurrency(total)}</span>
        </div>
        <div class="note">Ticket simplifié sans détail des articles</div>
      </div>
      ${
        mealTicketIncludeTax
          ? `
            <div class="kv"><span>Sous total HT</span><span>${formatCurrency(subtotal)}</span></div>
            <div class="kv"><span>TVA ${rate}%</span><span>${formatCurrency(taxAmount)}</span></div>
          `
          : `<div class="kv"><span>TVA</span><span>Non affichée</span></div>`
      }
      <div class="total">
        <span>TOTAL</span>
        <span>${formatCurrency(total)}</span>
      </div>
      <div class="divider"></div>
      <div class="footer">Réimpression ticket repas</div>
    `

    return buildTicketHtml(`Réimpression ticket repas - Table ${transactionDetail?.sale.table_number || "-"}`, body)
  }

  const openMealTicketPreview = () => {
    if (!transactionDetail) return
    setMealTicketMealsCount(3)
    setMealTicketTotal(Number(transactionDetail.sale.total_amount || 0).toFixed(2))
    setMealTicketIncludeTax(true)
    setMealTicketTaxRate(10)
    setMealTicketDialogOpen(true)
  }

  const openBillTicketPreview = () => {
    if (!transactionDetail) return
    setBillTicketDialogOpen(true)
  }

  if (isLoading || (user?.role === "manager" && loading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  if (!user || user.role !== "manager") {
    return null
  }

  const getPaymentIcon = (method: string) => {
    switch (method) {
      case "cash":
        return <Banknote className="h-4 w-4" />
      case "card":
        return <CreditCard className="h-4 w-4" />
      default:
        return <DollarSign className="h-4 w-4" />
    }
  }

  const getPaymentLabel = (method: string) => {
    switch (method) {
      case "cash":
        return "Espèces"
      case "card":
        return "Carte"
      default:
        return "Autre"
    }
  }

  const isAdmin = user.role === "manager"

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-4">
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <Button
          onClick={() => router.push("/floor-plan")}
          variant="outline"
          size="sm"
          className="bg-slate-800 text-white border-slate-700"
        >
          <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          <span className="text-xs sm:text-sm">Retour</span>
        </Button>
        <h1 className="text-xl sm:text-3xl font-bold text-white">Historique des encaissements</h1>
        <div className="w-0 sm:w-32" />
      </div>

      {/* Date Selector */}
      <div className="mb-4 sm:mb-6">
        <Card className="bg-slate-800 border-slate-700 p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
            <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-blue-400" />
            <div className="flex-1 w-full">
              <Label htmlFor="date" className="text-white mb-2 block text-sm">
                Sélectionner une date
              </Label>
              <Input
                id="date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white text-sm"
                min={isAdmin ? undefined : yesterday}
                max={today}
              />
              {/* </CHANGE> */}
            </div>
          </div>
        </Card>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-green-600/20 rounded-lg">
                <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-green-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm text-slate-400">Ventes du jour</p>
                <p className="text-xl sm:text-2xl font-bold text-white">
                  {salesData?.statistics.totalRevenue.toFixed(2) || "0.00"} €
                </p>
              </div>
            </div>
          </Card>

          <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-purple-600/20 rounded-lg">
                <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-purple-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm text-slate-400">TVA collectée</p>
                <p className="text-xl sm:text-2xl font-bold text-white">
                  {salesData?.statistics.totalTax.toFixed(2) || "0.00"} €
                </p>
              </div>
            </div>
          </Card>

          <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-blue-600/20 rounded-lg">
                <Users className="h-5 w-5 sm:h-6 sm:w-6 text-blue-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm text-slate-400">Nombre de tables</p>
                <p className="text-xl sm:text-2xl font-bold text-white">{salesData?.statistics.orderCount || 0}</p>
              </div>
            </div>
          </Card>

          <Card className="bg-slate-800 border-slate-700 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-orange-600/20 rounded-lg">
                <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-orange-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm text-slate-400">Ticket moyen</p>
                <p className="text-xl sm:text-2xl font-bold text-white">
                  {salesData?.statistics.averageTicket.toFixed(2) || "0.00"} €
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
      {/* </CHANGE> */}

      {isAdmin && (
        <div className="mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-3 sm:mb-4">Statistiques par serveur</h2>
          <div className="space-y-2 sm:space-y-3">
            {salesData?.serverStats && salesData.serverStats.length > 0 ? (
              salesData.serverStats.map((server) => (
                <Card key={server.server_id} className="bg-slate-800 border-slate-700">
                  <button
                    onClick={() => setExpandedServer(expandedServer === server.server_id ? null : server.server_id)}
                    className="w-full p-3 sm:p-4 text-left hover:bg-slate-750 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        <div className="p-1.5 sm:p-2 bg-blue-600/20 rounded-lg flex-shrink-0">
                          <Users className="h-4 w-4 sm:h-5 sm:w-5 text-blue-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white text-sm sm:text-lg truncate">{server.server_name}</p>
                          <p className="text-xs sm:text-sm text-slate-400">{server.order_count} tables encaissées</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-lg sm:text-2xl font-bold text-green-400">
                          {server.total_revenue.toFixed(2)} €
                        </p>
                        <p className="text-xs sm:text-sm text-slate-400">
                          Moy: {(server.total_revenue / server.order_count).toFixed(2)} €
                        </p>
                      </div>
                    </div>
                  </button>

                  {expandedServer === server.server_id && (
                    <div className="border-t border-slate-700 p-3 sm:p-4 bg-slate-900/50">
                      <h3 className="text-xs sm:text-sm font-semibold text-slate-400 mb-2 sm:mb-3">
                        Détail des tables
                      </h3>
                      <div className="space-y-2">
                        {server.tables.map((table, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-2 sm:p-3 bg-slate-800 rounded-lg gap-3"
                          >
                            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                              <Badge className="bg-blue-600 text-white font-semibold text-xs whitespace-nowrap">
                                {table.table_number}
                              </Badge>
                              <div className="flex items-center gap-1.5 sm:gap-2 text-slate-300 min-w-0">
                                {getPaymentIcon(table.payment_method)}
                                <span className="text-xs sm:text-sm truncate">
                                  {getPaymentLabel(table.payment_method)}
                                </span>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="font-semibold text-white text-sm sm:text-base">
                                {Number(table.amount).toFixed(2)} €
                              </p>
                              <p className="text-xs text-slate-400">
                                {new Date(table.created_at).toLocaleTimeString("fr-FR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              ))
            ) : (
              <Card className="bg-slate-800 border-slate-700 p-6 sm:p-8 text-center">
                <p className="text-slate-400 text-sm">Aucun encaissement pour cette date</p>
              </Card>
            )}
          </div>
        </div>
      )}
      {/* </CHANGE> */}

      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-3 sm:mb-4">Toutes les tables encaissées</h2>
        <p className="text-xs sm:text-sm text-slate-400 mb-2">Cliquez sur une ligne pour voir le détail complet.</p>
        <Card className="bg-slate-800 border-slate-700">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="border-b border-slate-700">
                <tr>
                  <th className="text-left p-3 sm:p-4 text-slate-400 font-semibold text-xs sm:text-sm">Heure</th>
                  <th className="text-left p-3 sm:p-4 text-slate-400 font-semibold text-xs sm:text-sm">Table</th>
                  <th className="text-left p-3 sm:p-4 text-slate-400 font-semibold text-xs sm:text-sm">Serveur</th>
                  <th className="text-left p-3 sm:p-4 text-slate-400 font-semibold text-xs sm:text-sm">Paiement</th>
                  <th className="text-right p-3 sm:p-4 text-slate-400 font-semibold text-xs sm:text-sm">Montant</th>
                </tr>
              </thead>
              <tbody>
                {salesData?.sales && salesData.sales.length > 0 ? (
                  salesData.sales.map((sale) => (
                    <tr
                      key={sale.id}
                      className="border-b border-slate-700 hover:bg-slate-750 cursor-pointer"
                      onClick={() => openTransactionDetail(sale)}
                    >
                      <td className="p-3 sm:p-4 text-slate-300 text-xs sm:text-sm">
                        {new Date(sale.created_at).toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-3 sm:p-4">
                        <Badge className="bg-blue-600 text-white text-xs">{sale.table_number}</Badge>
                      </td>
                      <td className="p-3 sm:p-4 text-white text-xs sm:text-sm">{sale.server_name}</td>
                      <td className="p-3 sm:p-4">
                        <div className="flex items-center gap-1.5 sm:gap-2 text-slate-300">
                          {getPaymentIcon(sale.payment_method)}
                          <span className="text-xs sm:text-sm">{getPaymentLabel(sale.payment_method)}</span>
                        </div>
                      </td>
                      <td className="p-3 sm:p-4 text-right font-semibold text-green-400 text-xs sm:text-sm">
                        {Number(sale.total_amount).toFixed(2)} €
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="p-6 sm:p-8 text-center text-slate-400 text-sm">
                      Aucune donnée disponible
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Dialog
        open={selectedTransaction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTransaction(null)
            setTransactionDetail(null)
            setTransactionDetailError(null)
            setTransactionDetailLoading(false)
            setBillTicketDialogOpen(false)
            setMealTicketDialogOpen(false)
          }
        }}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Détail de la transaction</DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedTransaction
                ? `Table ${selectedTransaction.table_number} • ${new Date(selectedTransaction.created_at).toLocaleString("fr-FR")}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {transactionDetailLoading ? (
            <div className="py-6 text-center text-slate-300">Chargement du détail...</div>
          ) : transactionDetailError ? (
            <div className="py-6 text-center text-red-400">{transactionDetailError}</div>
          ) : transactionDetail ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button
                  onClick={openBillTicketPreview}
                  variant="outline"
                  className="bg-slate-900 border-slate-600 text-white hover:bg-slate-700"
                >
                  <Printer className="h-4 w-4 mr-2" />
                  Ticket addition
                </Button>
                <Button
                  onClick={openMealTicketPreview}
                  variant="outline"
                  className="bg-slate-900 border-slate-600 text-white hover:bg-slate-700"
                >
                  <Users className="h-4 w-4 mr-2" />
                  Ticket repas
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="bg-slate-900 border-slate-700 p-3">
                  <p className="text-xs text-slate-400 mb-1">Montant transaction</p>
                  <p className="text-lg font-semibold text-green-400">
                    {Number(transactionDetail.sale.total_amount).toFixed(2)} €
                  </p>
                </Card>
                <Card className="bg-slate-900 border-slate-700 p-3">
                  <p className="text-xs text-slate-400 mb-1">Serveur</p>
                  <p className="text-sm font-semibold text-white">{transactionDetail.sale.server_name}</p>
                </Card>
                <Card className="bg-slate-900 border-slate-700 p-3">
                  <p className="text-xs text-slate-400 mb-1">Date ciblée</p>
                  <p className="text-sm font-semibold text-white">{transactionDetail.sale.date}</p>
                </Card>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-2">Ventilation des paiements</h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
                  <Card className="bg-slate-900 border-slate-700 p-2">
                    <p className="text-xs text-slate-400">Espèces</p>
                    <p className="text-sm font-semibold text-white">{transactionDetail.paymentBreakdown.cash.toFixed(2)} €</p>
                  </Card>
                  <Card className="bg-slate-900 border-slate-700 p-2">
                    <p className="text-xs text-slate-400">Carte</p>
                    <p className="text-sm font-semibold text-white">{transactionDetail.paymentBreakdown.card.toFixed(2)} €</p>
                  </Card>
                  <Card className="bg-slate-900 border-slate-700 p-2">
                    <p className="text-xs text-slate-400">Autre</p>
                    <p className="text-sm font-semibold text-white">{transactionDetail.paymentBreakdown.other.toFixed(2)} €</p>
                  </Card>
                  <Card className="bg-slate-900 border-slate-700 p-2">
                    <p className="text-xs text-slate-400">Total encaissé</p>
                    <p className="text-sm font-semibold text-green-400">{transactionDetail.paymentBreakdown.total.toFixed(2)} €</p>
                  </Card>
                </div>

                <div className="space-y-2">
                  {transactionDetail.payments.length > 0 ? (
                    transactionDetail.payments.map((payment) => (
                      <div key={payment.id} className="flex items-center justify-between bg-slate-900 border border-slate-700 rounded p-2">
                        <div className="flex items-center gap-2 text-slate-300">
                          {getPaymentIcon(payment.payment_method)}
                          <span className="text-sm">{getPaymentLabel(payment.payment_method)}</span>
                          <span className="text-xs text-slate-500">
                            {new Date(payment.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-white">{Number(payment.amount).toFixed(2)} €</p>
                          {(payment.tip_amount || 0) > 0 && (
                            <p className="text-xs text-amber-400">Pourboire: {Number(payment.tip_amount).toFixed(2)} €</p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400">Aucun détail de paiement disponible.</p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-2">Détail de la commande</h3>
                <div className="space-y-2">
                  {transactionDetail.items.length > 0 ? (
                    transactionDetail.items.map((item) => (
                      <div key={item.id} className="bg-slate-900 border border-slate-700 rounded p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm text-white">
                            {item.quantity} x {item.menu_name}
                          </p>
                          <p className={`text-sm font-semibold ${item.is_complimentary ? "text-slate-500 line-through" : "text-white"}`}>
                            {(item.is_complimentary ? 0 : item.line_total).toFixed(2)} €
                          </p>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Prix unit.: {Number(item.price).toFixed(2)} € • Statut: {item.status}
                        </div>
                        {item.notes && <div className="text-xs text-slate-400 italic mt-1">Note: {item.notes}</div>}
                        {item.is_complimentary && (
                          <div className="text-xs text-green-400 mt-1">
                            Offert{item.complimentary_reason ? ` • ${item.complimentary_reason}` : ""}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400">Aucun article trouvé.</p>
                  )}
                </div>
              </div>

              {transactionDetail.supplements.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-300 mb-2">Suppléments</h3>
                  <div className="space-y-2">
                    {transactionDetail.supplements.map((supplement) => (
                      <div key={supplement.id} className="bg-slate-900 border border-slate-700 rounded p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm text-white">{supplement.name}</p>
                          <p
                            className={`text-sm font-semibold ${
                              supplement.is_complimentary ? "text-slate-500 line-through" : "text-white"
                            }`}
                          >
                            {(supplement.is_complimentary ? 0 : Number(supplement.amount)).toFixed(2)} €
                          </p>
                        </div>
                        {supplement.notes && <div className="text-xs text-slate-400 italic mt-1">Note: {supplement.notes}</div>}
                        {supplement.is_complimentary && (
                          <div className="text-xs text-green-400 mt-1">
                            Offert{supplement.complimentary_reason ? ` • ${supplement.complimentary_reason}` : ""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center text-slate-400">Aucun détail disponible.</div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={mealTicketDialogOpen} onOpenChange={setMealTicketDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-3xl max-h-[90dvh] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Ticket repas - Réimpression</DialogTitle>
            <DialogDescription className="text-slate-400">
              Table {transactionDetail?.sale.table_number || "-"} • transaction du{" "}
              {transactionDetail?.sale.created_at
                ? new Date(transactionDetail.sale.created_at).toLocaleString("fr-FR")
                : "-"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div>
                <Label className="text-sm">Nombre de repas</Label>
                <Input
                  type="number"
                  min="1"
                  max="30"
                  value={mealTicketMealsCount}
                  onChange={(e) => setMealTicketMealsCount(Math.max(1, Number.parseInt(e.target.value) || 1))}
                  className="bg-slate-900 border-slate-700 mt-1"
                />
              </div>

              <div>
                <Label className="text-sm">Montant total</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={mealTicketTotal}
                  onChange={(e) => setMealTicketTotal(e.target.value)}
                  className="bg-slate-900 border-slate-700 mt-1"
                  placeholder="0.00"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="history-meal-tax"
                  type="checkbox"
                  checked={mealTicketIncludeTax}
                  onChange={(e) => setMealTicketIncludeTax(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-500 bg-slate-900"
                />
                <Label htmlFor="history-meal-tax" className="text-sm cursor-pointer">
                  Afficher le détail TVA
                </Label>
              </div>

              <div>
                <Label className="text-sm">Taux de TVA</Label>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant={mealTicketTaxRate === 10 ? "default" : "outline"}
                    className={
                      mealTicketTaxRate === 10
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "bg-slate-900 border-slate-700 text-white"
                    }
                    onClick={() => setMealTicketTaxRate(10)}
                    disabled={!mealTicketIncludeTax}
                  >
                    10%
                  </Button>
                  <Button
                    type="button"
                    variant={mealTicketTaxRate === 20 ? "default" : "outline"}
                    className={
                      mealTicketTaxRate === 20
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "bg-slate-900 border-slate-700 text-white"
                    }
                    onClick={() => setMealTicketTaxRate(20)}
                    disabled={!mealTicketIncludeTax}
                  >
                    20%
                  </Button>
                </div>
              </div>

              <Button
                onClick={() => openPrintWindow(buildHistoryMealTicketHtml())}
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={(Number.parseFloat(mealTicketTotal) || 0) <= 0}
              >
                <Printer className="h-4 w-4 mr-2" />
                Imprimer le ticket repas
              </Button>
            </div>

            <div className="bg-white rounded border border-slate-600 overflow-hidden">
              <iframe title="Aperçu ticket repas historique" srcDoc={buildHistoryMealTicketHtml()} className="w-full h-[45vh] sm:h-[60vh] bg-white pointer-events-none sm:pointer-events-auto" />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={billTicketDialogOpen} onOpenChange={setBillTicketDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-4xl max-h-[90dvh] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Aperçu ticket addition - Table {transactionDetail?.sale.table_number || "-"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded border border-slate-600 overflow-hidden">
              <iframe title="Aperçu ticket addition historique" srcDoc={buildHistoryBillTicketHtml()} className="w-full h-[45vh] sm:h-[60vh] bg-white pointer-events-none sm:pointer-events-auto" />
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-300">Cet aperçu correspond au ticket addition de la transaction sélectionnée.</p>
              <Button
                onClick={() => openPrintWindow(buildHistoryBillTicketHtml())}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                <Printer className="h-4 w-4 mr-2" />
                Imprimer le ticket addition
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
