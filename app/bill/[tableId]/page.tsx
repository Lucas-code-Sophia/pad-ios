"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import type { Table, Order, OrderItem, MenuItem, PaymentItem, Supplement } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ArrowLeft, CreditCard, Banknote, Printer, Users, CheckCircle, Gift, Plus, Minus } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

interface OrderItemWithMenu extends OrderItem {
  menu_item: MenuItem
  paid_quantity: number
}

const PAYMENT_STATE_KEY = "payment_state_"

export default function BillPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const tableId = params.tableId as string

  const [table, setTable] = useState<Table | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItemWithMenu[]>([])
  const [supplements, setSupplements] = useState<Supplement[]>([])
  const [loading, setLoading] = useState(true)
  const [splitMode, setSplitMode] = useState<"full" | "equal" | "items">("full")
  const [splitCount, setSplitCount] = useState(2)
  const [selectedItemQuantities, setSelectedItemQuantities] = useState<Map<string, number>>(new Map())
  const [paymentDialog, setPaymentDialog] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash")
  const [cashGiven, setCashGiven] = useState("")
  const [tipAmount, setTipAmount] = useState("")
  const [cardTipDialog, setCardTipDialog] = useState(false)
  const [cardTipDraft, setCardTipDraft] = useState("")
  const [paidAmount, setPaidAmount] = useState(0)
  const [paymentsCount, setPaymentsCount] = useState(0)
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
  const [customAmount, setCustomAmount] = useState("")
  const [showCustomAmount, setShowCustomAmount] = useState(false)
  const [offerDialog, setOfferDialog] = useState<{
    open: boolean
    itemId: string | null
    itemName: string
    maxQuantity: number
    itemPrice: number
  }>({
    open: false,
    itemId: null,
    itemName: "",
    maxQuantity: 0,
    itemPrice: 0,
  })
  const [offerQuantity, setOfferQuantity] = useState(1)
  const [complimentaryReason, setComplimentaryReason] = useState("")
  const canAccessBill = user?.role === "manager" || Boolean(user?.can_access_bill)

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user && tableId && canAccessBill) {
      fetchData()
    }
  }, [user, tableId, canAccessBill])

  useEffect(() => {
    if (!isLoading && user && !canAccessBill) {
      router.push(`/order/${tableId}`)
    }
  }, [user, isLoading, canAccessBill, router, tableId])

  useEffect(() => {
    if (tableId) {
      const savedState = localStorage.getItem(PAYMENT_STATE_KEY + tableId)
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState)
          setSplitMode(parsed.splitMode || "full")
          setSplitCount(parsed.splitCount || 2)
          setSelectedItemQuantities(new Map(Object.entries(parsed.selectedItemQuantities || {})))
          setCustomAmount(parsed.customAmount || "")
          setShowCustomAmount(parsed.showCustomAmount || false)
        } catch (error) {
          console.error("[v0] Error loading payment state:", error)
        }
      }
    }
  }, [tableId])

  useEffect(() => {
    if (tableId && !loading) {
      const state = {
        splitMode,
        splitCount,
        selectedItemQuantities: Object.fromEntries(selectedItemQuantities),
        customAmount,
        showCustomAmount,
      }
      localStorage.setItem(PAYMENT_STATE_KEY + tableId, JSON.stringify(state))
    }
  }, [tableId, splitMode, splitCount, selectedItemQuantities, customAmount, showCustomAmount, loading])

  const fetchData = async () => {
    try {
      const [tableRes, orderRes] = await Promise.all([
        fetch(`/api/tables/${tableId}`),
        fetch(`/api/orders/table/${tableId}`),
      ])

      if (tableRes.ok) {
        const tableData = await tableRes.json()
        setTable(tableData)
      }

      if (orderRes.ok) {
        const orderData = await orderRes.json()
        if (orderData) {
          setOrder(orderData.order)

          const [menuRes, paymentsRes, supplementsRes] = await Promise.all([
            fetch("/api/menu/items"),
            fetch(`/api/payments?orderId=${orderData.order.id}`),
            fetch(`/api/supplements?orderId=${orderData.order.id}`),
          ])

          const paidItemQuantities = new Map<string, number>()
          if (paymentsRes.ok) {
            const paymentsData = await paymentsRes.json()
            const totalPaid = paymentsData.reduce((sum: number, p: any) => sum + Number.parseFloat(p.amount), 0)
            setPaidAmount(totalPaid)
            setPaymentsCount(paymentsData.length)

            paymentsData.forEach((payment: any) => {
              if (payment.items && payment.items.length > 0) {
                payment.items.forEach((item: PaymentItem) => {
                  const currentPaid = paidItemQuantities.get(item.order_item_id) || 0
                  paidItemQuantities.set(item.order_item_id, currentPaid + item.quantity)
                })
              }
            })
          }

          if (menuRes.ok) {
            const menuItems = await menuRes.json()
            const itemsWithMenu = orderData.items.map((item: OrderItem) => ({
              ...item,
              menu_item: menuItems.find((m: MenuItem) => m.id === item.menu_item_id),
              paid_quantity: paidItemQuantities.get(item.id) || 0,
            }))
            setItems(itemsWithMenu)
          }

          if (supplementsRes.ok) {
            const supplementsData = await supplementsRes.json()
            setSupplements(supplementsData)
          }
        }
      }
    } catch (error) {
      console.error("[v0] Error fetching data:", error)
    } finally {
      setLoading(false)
    }
  }

  const calculateTotal = () => {
    const itemsTotal = items.reduce((sum, item) => {
      const itemPrice = item.is_complimentary ? 0 : item.price * item.quantity
      return sum + itemPrice
    }, 0)

    const supplementsTotal = supplements.reduce((sum, sup) => {
      const supPrice = sup.is_complimentary ? 0 : sup.amount
      return sum + supPrice
    }, 0)

    return itemsTotal + supplementsTotal
  }

  const calculateRemainingAmount = () => {
    return Math.max(0, calculateTotal() - paidAmount)
  }

  const calculateSplitAmount = () => {
    if (showCustomAmount && customAmount && Number.parseFloat(customAmount) > 0) {
      return Number.parseFloat(customAmount)
    }

    const remaining = calculateRemainingAmount()
    let amount = 0

    if (splitMode === "equal") {
      amount = remaining / splitCount
    } else if (splitMode === "items") {
      amount = items.reduce((sum, item) => {
        const selectedQty = selectedItemQuantities.get(item.id) || 0
        const itemPrice = item.is_complimentary ? 0 : item.price
        return sum + itemPrice * selectedQty
      }, 0)
    } else {
      amount = remaining
    }

    return amount
  }

  const handleQuantityChange = (itemId: string, quantity: number, maxQuantity: number) => {
    setSelectedItemQuantities((prev) => {
      const newMap = new Map(prev)
      if (quantity <= 0) {
        newMap.delete(itemId)
      } else {
        newMap.set(itemId, Math.min(quantity, maxQuantity))
      }
      return newMap
    })
  }

  const toggleItemSelection = (itemId: string, maxQuantity: number) => {
    setSelectedItemQuantities((prev) => {
      const newMap = new Map(prev)
      if (newMap.has(itemId) && newMap.get(itemId) === maxQuantity) {
        newMap.delete(itemId)
      } else {
        newMap.set(itemId, maxQuantity)
      }
      return newMap
    })
  }

  const handlePayment = async () => {
    try {
      const amount = calculateSplitAmount()
      const tipValue = Math.max(0, Number.parseFloat(tipAmount) || 0)
      const recordedBy = user?.id || null

      const itemQuantities = splitMode === "items" ? Object.fromEntries(selectedItemQuantities) : null

      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order?.id,
          amount,
          paymentMethod,
          tableId,
          splitMode,
          itemQuantities,
          customAmount: showCustomAmount ? customAmount : null,
          tipAmount: tipValue,
          recordedBy,
        }),
      })

      if (response.ok) {
        const result = await response.json()
        setPaymentDialog(false)
        setCustomAmount("")
        setShowCustomAmount(false)
        setCashGiven("")
        setTipAmount("")
        setCardTipDraft("")

        if (result.isFullyPaid) {
          localStorage.removeItem(PAYMENT_STATE_KEY + tableId)
          setShowSuccessDialog(true)
          setTimeout(() => {
            router.push("/floor-plan")
          }, 2000)
        } else {
          await fetchData()
          setSelectedItemQuantities(new Map())
          alert(`Paiement enregistré ! Reste à payer: ${result.remainingAmount.toFixed(2)} €`)
        }
      }
    } catch (error) {
      console.error("[v0] Error processing payment:", error)
    }
  }

  const handleOfferPartial = (itemId: string, itemName: string, maxQuantity: number, itemPrice: number) => {
    // Si c'est un article simple (maxQuantity = 1), offrir directement sans dialog
    if (maxQuantity === 1) {
      handleSaveOffer(itemId, 1, itemName)
      return
    }

    // Pour les articles multiples, ouvrir le dialog
    setOfferDialog({
      open: true,
      itemId,
      itemName,
      maxQuantity,
      itemPrice,
    })
    setOfferQuantity(1)
    setComplimentaryReason("")
  }

  const handleSaveOffer = async (itemId?: string, quantity?: number, itemName?: string) => {
    const targetItemId = itemId || offerDialog.itemId
    const targetQuantity = quantity || offerQuantity
    const targetItemName = itemName || offerDialog.itemName

    if (!targetItemId || !user) return

    try {
      const response = await fetch("/api/order-items/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: targetItemId,
          offerQuantity: targetQuantity,
          serverId: user.id,
          complimentaryReason: quantity === 1 ? "Offert à l'addition" : complimentaryReason || "Offert à l'addition",
        }),
      })

      if (response.ok) {
        setOfferDialog({ open: false, itemId: null, itemName: "", maxQuantity: 0, itemPrice: 0 })
        await fetchData()
      } else {
        const error = await response.json()
        alert(error.error || "Erreur lors de l'offre")
      }
    } catch (error) {
      console.error("[v0] Error offering item:", error)
      alert("Erreur lors de l'offre")
    }
  }

  const handleCancelOffer = async (originalItemId: string, complimentaryItemId: string) => {
    if (!confirm("Annuler l'offre ? Cet article redeviendra payant.")) return

    try {
      // Pour un article simple, les deux IDs sont les mêmes
      const response = await fetch("/api/order-items/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalItemId,
          complimentaryItemId,
        }),
      })

      if (response.ok) {
        await fetchData()
      } else {
        const error = await response.json()
        alert(error.error || "Erreur lors de l'annulation de l'offre")
      }
    } catch (error) {
      console.error("[v0] Error cancelling offer:", error)
      alert("Erreur lors de l'annulation de l'offre")
    }
  }

  const printBill = () => {
    const printWindow = window.open("", "_blank")
    if (printWindow) {
      const total = calculateTotal()
      const formatCurrency = (value: number) => `${value.toFixed(2)} €`

      const taxBreakdown = items.reduce(
        (acc, item) => {
          if (item.is_complimentary) return acc
          const rate = Number(item.menu_item?.tax_rate) || 0
          const lineTotal = item.price * item.quantity
          const lineTax = rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0
          if (rate === 10) acc.tax10 += lineTax
          if (rate === 20) acc.tax20 += lineTax
          return acc
        },
        { tax10: 0, tax20: 0 },
      )

      const supplementTax = supplements.reduce(
        (acc, sup) => {
          if (sup.is_complimentary) return acc
          const rate = Number(sup.tax_rate ?? 10)
          const lineTotal = sup.amount
          const lineTax = rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0
          if (rate === 10) acc.tax10 += lineTax
          if (rate === 20) acc.tax20 += lineTax
          return acc
        },
        { tax10: 0, tax20: 0 },
      )

      const tax10 = taxBreakdown.tax10 + supplementTax.tax10
      const tax20 = taxBreakdown.tax20 + supplementTax.tax20
      const subtotal = Math.max(0, total - tax10 - tax20)

      printWindow.document.write(`
        <html>
          <head>
            <title>Addition - Table ${table?.table_number}</title>
            <style>
              body { font-family: monospace; padding: 12px; max-width: 320px; margin: 0 auto; }
              .divider { border-top: 1px dashed #000; margin: 8px 0; }
              .item { display: flex; justify-content: space-between; margin: 4px 0; }
              .note { font-size: 10px; color: #333; font-style: italic; margin-left: 8px; }
              .complimentary { color: #666; text-decoration: line-through; }
              .total { border-top: 1px solid #000; margin-top: 8px; padding-top: 6px; font-size: 13px; font-weight: bold; display: flex; justify-content: space-between; }
              .kv { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; }
              .footer { text-align: center; margin-top: 12px; font-size: 10px; }
            </style>
          </head>
          <body>
            <div style="text-align:center;font-weight:bold;font-size:16px;">RESTAURANT SOPHIA</div>
            <div style="text-align:center;font-size:10px;">67 Boulevard de la plage</div>
            <div style="text-align:center;font-size:10px;">33970, Cap-Ferret</div>
            <div style="text-align:center;font-size:10px;">SIRET : 940 771 488 00027</div>
            <div class="divider"></div>
            <div style="display:flex;justify-content:space-between;font-size:10px;">
              <div style="font-weight:bold;font-size:12px;">Table ${table?.table_number}</div>
              <div>Serveur : ${user?.name || "-"}</div>
            </div>
            <div style="font-size:10px;color:#333;">${new Date().toLocaleString("fr-FR")}</div>
            <div style="margin: 10px 0;">
              ${items
                .map(
                  (item) => `
                <div>
                  <div class="item ${item.is_complimentary ? "complimentary" : ""}">
                    <span>${item.quantity}x ${item.menu_item?.name}${item.is_complimentary ? " (OFFERT)" : ""}</span>
                    <span>${item.is_complimentary ? "0.00" : (item.price * item.quantity).toFixed(2)} €</span>
                  </div>
                  ${item.notes ? `<div class="note">↳ ${item.notes}</div>` : ""}
                </div>
              `,
                )
                .join("")}
            </div>
            <div class="kv"><span>Sous total</span><span>${formatCurrency(subtotal)}</span></div>
            <div class="kv"><span>TVA 10%</span><span>${formatCurrency(tax10)}</span></div>
            <div class="kv"><span>TVA 20%</span><span>${formatCurrency(tax20)}</span></div>
            <div class="total">
              <span>TOTAL</span>
              <span>${formatCurrency(total)}</span>
            </div>
            <div class="divider"></div>
            <div class="footer">Merci de votre visite chez SOPHIA</div>
            <div class="footer">Tel pour réserver : 05 57 18 21 88</div>
            <div class="footer">À très vite chez nous !</div>
          </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.print()
    }
  }

  if (isLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  if (user && !canAccessBill) {
    return null
  }

  if (!order || (items.length === 0 && supplements.length === 0)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <Card className="bg-slate-800 border-slate-700 p-8 text-center">
          <p className="text-white text-xl mb-4">Aucune commande pour cette table</p>
          <Button onClick={() => router.push("/floor-plan")} className="bg-blue-600 hover:bg-blue-700">
            Retour au plan de salle
          </Button>
        </Card>
      </div>
    )
  }

  const total = calculateTotal()
  const remainingAmount = calculateRemainingAmount()
  const splitAmount = calculateSplitAmount()
  const cashGivenValue = Number.parseFloat(cashGiven) || 0
  const tipValue = Math.max(0, Number.parseFloat(tipAmount) || 0)
  const totalWithTip = splitAmount + tipValue
  const changeDue = paymentMethod === "cash" ? cashGivenValue - totalWithTip : 0
  const selectedItemsCount = Array.from(selectedItemQuantities.values()).reduce((sum, qty) => sum + qty, 0)
  const complimentaryCount =
    items.filter((item) => item.is_complimentary).length + supplements.filter((sup) => sup.is_complimentary).length

  return (
    <div className="min-h-screen bg-slate-900 p-2 sm:p-4">
      <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
        <Button
          onClick={() => router.push("/floor-plan")}
          variant="outline"
          size="sm"
          className="bg-slate-800 text-white border-slate-700"
        >
          <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          <span className="text-xs sm:text-sm">Retour</span>
        </Button>
        <div className="text-center flex-1">
          <h1 className="text-lg sm:text-2xl font-bold text-white">Addition - Table {table?.table_number}</h1>
          {complimentaryCount > 0 && (
            <Badge className="bg-green-600 text-xs mt-1">
              <Gift className="h-3 w-3 mr-1" />
              {complimentaryCount} article{complimentaryCount > 1 ? "s" : ""} offert{complimentaryCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <Button onClick={printBill} variant="outline" size="sm" className="bg-slate-800 text-white border-slate-700">
          <Printer className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
          <span className="text-xs sm:text-sm">Imprimer</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4">
        <div className="lg:col-span-7">
          <Card className="bg-slate-800 border-slate-700 p-3 sm:p-6">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 sm:mb-4">Détail de la commande</h2>
            <div className="space-y-2 sm:space-y-3">
              {items.map((item) => {
                const remainingQty = item.quantity - item.paid_quantity
                const selectedQty = selectedItemQuantities.get(item.id) || 0
                const isSelected = selectedQty > 0
                const isFullyPaid = item.paid_quantity >= item.quantity

                return (
                  <div
                    key={item.id}
                    className={`p-2 sm:p-3 rounded ${
                      splitMode === "items" ? "border-2" : "border"
                    } ${isSelected ? "bg-blue-900/30 border-blue-700" : isFullyPaid ? "bg-green-900/20 border-green-700" : item.is_complimentary ? "bg-green-900/20 border-green-700" : "bg-slate-900 border-slate-700"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                        {splitMode === "items" && !isFullyPaid && !item.is_complimentary && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleItemSelection(item.id, remainingQty)}
                            className="flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p
                              className={`text-white font-medium text-sm sm:text-base ${isFullyPaid || item.is_complimentary ? "line-through text-slate-500" : ""}`}
                            >
                              {item.quantity}x {item.menu_item?.name}
                            </p>
                            {item.is_complimentary && (
                              <Badge className="bg-green-600 text-xs flex items-center gap-1">
                                <Gift className="h-3 w-3" />
                                Offert
                              </Badge>
                            )}
                            {isFullyPaid && !item.is_complimentary && (
                              <Badge className="bg-green-600 text-xs">Payé</Badge>
                            )}
                          </div>
                          {item.paid_quantity > 0 && !isFullyPaid && !item.is_complimentary && (
                            <span className="text-green-400 text-xs sm:text-sm">
                              ({item.paid_quantity} payé{item.paid_quantity > 1 ? "s" : ""})
                            </span>
                          )}
                          <p
                            className={`text-xs sm:text-sm ${isFullyPaid || item.is_complimentary ? "text-slate-600" : "text-slate-400"}`}
                          >
                            {item.price.toFixed(2)} € / unité
                          </p>
                          {item.is_complimentary && item.complimentary_reason && (
                            <p className="text-xs text-green-400 italic">{item.complimentary_reason}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p
                          className={`text-white font-bold text-sm sm:text-base ${isFullyPaid || item.is_complimentary ? "line-through text-slate-500" : ""}`}
                        >
                          {item.is_complimentary ? "0.00" : (item.price * item.quantity).toFixed(2)} €
                        </p>
                        {item.paid_quantity > 0 && !isFullyPaid && !item.is_complimentary && (
                          <p className="text-xs sm:text-sm text-green-400">
                            Reste: {(item.price * remainingQty).toFixed(2)} €
                          </p>
                        )}
                        {/* Bouton Offrir pour les articles payants avec quantité restante */}
                        {!item.is_complimentary && remainingQty > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOfferPartial(item.id, item.menu_item?.name || "", remainingQty, item.price)}
                            className="bg-green-600 hover:bg-green-700 border-green-500 text-white h-6 w-6 p-0 mt-1"
                            title={`Offrir une partie (${remainingQty} disponible${remainingQty > 1 ? "s" : ""})`}
                          >
                            <Gift className="h-3 w-3" />
                          </Button>
                        )}
                        {/* Bouton Annuler offre pour les articles offerts */}
                        {item.is_complimentary && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              // Pour un article simple, utiliser le même ID
                              // Pour un article split, trouver l'original
                              const originalItem = items.find(i => 
                                !i.is_complimentary && 
                                i.menu_item_id === item.menu_item_id && 
                                i.id !== item.id
                              )
                              
                              if (originalItem) {
                                // Cas split : fusionner les deux items
                                handleCancelOffer(originalItem.id, item.id)
                              } else {
                                // Cas simple : juste dé-marquer comme offert
                                handleCancelOffer(item.id, item.id)
                              }
                            }}
                            className="bg-orange-600 hover:bg-orange-700 border-orange-500 text-white h-6 w-6 p-0 mt-1"
                            title="Annuler l'offre"
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {splitMode === "items" && remainingQty > 1 && !isFullyPaid && !item.is_complimentary && (
                      <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-slate-700 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                        <Label className="text-slate-400 text-xs sm:text-sm">Quantité à payer:</Label>
                        <div className="flex items-center gap-2 flex-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleQuantityChange(item.id, selectedQty - 1, remainingQty)}
                            disabled={selectedQty <= 0}
                            className="h-7 w-7 sm:h-8 sm:w-8 p-0 bg-slate-700 border-slate-600"
                          >
                            -
                          </Button>
                          <Input
                            type="number"
                            min="0"
                            max={remainingQty}
                            value={selectedQty}
                            onChange={(e) =>
                              handleQuantityChange(item.id, Number.parseInt(e.target.value) || 0, remainingQty)
                            }
                            className="w-12 sm:w-16 h-7 sm:h-8 text-center bg-slate-700 border-slate-600 text-white text-sm"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleQuantityChange(item.id, selectedQty + 1, remainingQty)}
                            disabled={selectedQty >= remainingQty}
                            className="h-7 w-7 sm:h-8 sm:w-8 p-0 bg-slate-700 border-slate-600"
                          >
                            +
                          </Button>
                          <span className="text-slate-400 text-xs sm:text-sm">/ {remainingQty}</span>
                          {selectedQty > 0 && (
                            <span className="text-blue-400 text-xs sm:text-sm ml-auto">
                              {(item.price * selectedQty).toFixed(2)} €
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {supplements.map((supplement) => (
                <div
                  key={supplement.id}
                  className={`p-2 sm:p-3 rounded border ${supplement.is_complimentary ? "bg-green-900/20 border-green-700" : "bg-purple-900/20 border-purple-700"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-white font-medium text-sm sm:text-base ${supplement.is_complimentary ? "line-through text-slate-500" : ""}`}
                        >
                          {supplement.name} (supplément)
                        </p>
                        {supplement.is_complimentary && (
                          <Badge className="bg-green-600 text-xs flex items-center gap-1">
                            <Gift className="h-3 w-3" />
                            Offert
                          </Badge>
                        )}
                      </div>
                      {supplement.notes && <p className="text-xs text-slate-400 italic">{supplement.notes}</p>}
                      {supplement.is_complimentary && supplement.complimentary_reason && (
                        <p className="text-xs text-green-400 italic">{supplement.complimentary_reason}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p
                        className={`text-white font-bold text-sm sm:text-base ${supplement.is_complimentary ? "line-through text-slate-500" : ""}`}
                      >
                        {supplement.is_complimentary ? "0.00" : supplement.amount.toFixed(2)} €
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-700 mt-4 sm:mt-6 pt-3 sm:pt-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-base sm:text-lg font-semibold text-white">Total</span>
                <span className="text-xl sm:text-2xl font-bold text-white">{total.toFixed(2)} €</span>
              </div>
              {paidAmount > 0 && (
                <>
                  <div className="flex justify-between items-center text-green-400">
                    <span className="text-xs sm:text-sm">
                      Déjà payé ({paymentsCount} paiement{paymentsCount > 1 ? "s" : ""})
                    </span>
                    <span className="text-base sm:text-lg font-semibold">-{paidAmount.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-600">
                    <span className="text-lg sm:text-xl font-bold text-blue-400">Reste à payer</span>
                    <span className="text-2xl sm:text-3xl font-bold text-blue-400">{remainingAmount.toFixed(2)} €</span>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-5">
          <Card className="bg-slate-800 border-slate-700 p-3 sm:p-6">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 sm:mb-4">Mode de paiement</h2>

            <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
              <div>
                <Label className="text-white mb-2 block text-sm sm:text-base">Type de règlement</Label>
                <RadioGroup value={splitMode} onValueChange={(value: any) => setSplitMode(value)}>
                  <div className="flex items-center space-x-2 p-2 sm:p-3 rounded bg-slate-900 hover:bg-slate-750 cursor-pointer">
                    <RadioGroupItem value="full" id="full" />
                    <Label htmlFor="full" className="text-white cursor-pointer flex-1 text-sm sm:text-base">
                      Addition complète
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-2 sm:p-3 rounded bg-slate-900 hover:bg-slate-750 cursor-pointer">
                    <RadioGroupItem value="equal" id="equal" />
                    <Label htmlFor="equal" className="text-white cursor-pointer flex-1 text-sm sm:text-base">
                      <div className="flex items-center gap-2">
                        <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                        Partage égal
                      </div>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 p-2 sm:p-3 rounded bg-slate-900 hover:bg-slate-750 cursor-pointer">
                    <RadioGroupItem value="items" id="items" />
                    <Label htmlFor="items" className="text-white cursor-pointer flex-1 text-sm sm:text-base">
                      Par articles
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {splitMode === "equal" && (
                <div>
                  <Label htmlFor="splitCount" className="text-white mb-2 block text-sm sm:text-base">
                    Nombre de personnes
                  </Label>
                  <Input
                    id="splitCount"
                    type="number"
                    min="2"
                    max="20"
                    value={splitCount}
                    onChange={(e) => setSplitCount(Number.parseInt(e.target.value) || 2)}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
              )}

              {splitMode === "items" && (
                <div className="p-2 sm:p-3 bg-blue-900/20 border border-blue-700 rounded">
                  <p className="text-xs sm:text-sm text-blue-300">
                    {selectedItemsCount > 0
                      ? `${selectedItemsCount} article${selectedItemsCount > 1 ? "s" : ""} sélectionné${selectedItemsCount > 1 ? "s" : ""}`
                      : "Sélectionnez les articles et quantités à payer"}
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-white text-sm sm:text-base">Montant personnalisé</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCustomAmount(!showCustomAmount)}
                    className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600 text-xs sm:text-sm"
                  >
                    {showCustomAmount ? "Annuler" : "Modifier"}
                  </Button>
                </div>
                {showCustomAmount && (
                  <div className="space-y-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Montant que le client veut payer (€)"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      className="bg-slate-900 border-slate-700 text-white text-sm"
                    />
                    <p className="text-xs text-slate-400">
                      Le serveur peut saisir le montant exact que le client souhaite payer.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-900 p-3 sm:p-4 rounded-lg mb-4 sm:mb-6">
              <div className="text-center">
                <p className="text-slate-400 text-xs sm:text-sm mb-1">Montant à régler</p>
                <p className="text-3xl sm:text-4xl font-bold text-blue-400">{splitAmount.toFixed(2)} €</p>
                {splitMode === "equal" && !showCustomAmount && (
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    ({remainingAmount.toFixed(2)} € ÷ {splitCount})
                  </p>
                )}
                {showCustomAmount && customAmount && (
                  <p className="text-xs sm:text-sm text-blue-400 mt-1">(Montant personnalisé)</p>
                )}
              </div>
            </div>

            <div className="space-y-2 sm:space-y-3">
              <Button
                onClick={() => {
                  setPaymentMethod("cash")
                  setPaymentDialog(true)
                  setCashGiven("")
                  setTipAmount("")
                  setCardTipDraft("")
                }}
                className="w-full bg-green-600 hover:bg-green-700 text-white text-base sm:text-lg py-5 sm:py-6"
                disabled={splitMode === "items" && selectedItemsCount === 0}
              >
                <Banknote className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                Espèces
              </Button>
              <Button
                onClick={() => {
                  setPaymentMethod("card")
                  setPaymentDialog(true)
                  setCashGiven("")
                  setTipAmount("")
                  setCardTipDraft("")
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-base sm:text-lg py-5 sm:py-6"
                disabled={splitMode === "items" && selectedItemsCount === 0}
              >
                <CreditCard className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                Carte bancaire
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <Dialog
        open={paymentDialog}
        onOpenChange={(open) => {
          setPaymentDialog(open)
          if (!open) {
            setCardTipDialog(false)
          }
        }}
      >
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Confirmer le paiement</DialogTitle>
          </DialogHeader>
          <div className="py-6">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center">
                {paymentMethod === "cash" ? (
                  <Banknote className="h-16 w-16 text-green-500" />
                ) : (
                  <CreditCard className="h-16 w-16 text-blue-500" />
                )}
              </div>
              <div>
                <p className="text-slate-400 text-sm">Montant</p>
                <p className="text-4xl font-bold text-blue-400">{splitAmount.toFixed(2)} €</p>
              </div>
              <div>
                <Badge className={paymentMethod === "cash" ? "bg-green-600" : "bg-blue-600"}>
                  {paymentMethod === "cash" ? "Espèces" : "Carte bancaire"}
                </Badge>
              </div>
            </div>
            {paymentMethod === "card" && (
              <div className="mt-6 space-y-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setCardTipDraft(tipAmount || "")
                    setCardTipDialog(true)
                  }}
                  className="bg-slate-700 border-slate-600 text-white"
                >
                  Tips
                </Button>
                <div className="bg-slate-900 p-3 rounded-lg space-y-2">
                  <div className="flex justify-between text-sm text-slate-400">
                    <span>Pourboire</span>
                    <span>{tipValue.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between text-sm text-slate-400">
                    <span>Total carte</span>
                    <span>{totalWithTip.toFixed(2)} €</span>
                  </div>
                </div>
              </div>
            )}
            {paymentMethod === "cash" && (
              <div className="mt-6 space-y-4">
                <div>
                  <Label htmlFor="cash-given" className="text-slate-300">
                    Espèces données
                  </Label>
                  <Input
                    id="cash-given"
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashGiven}
                    onChange={(e) => setCashGiven(e.target.value)}
                    placeholder="0.00"
                    className="mt-2 bg-slate-900 border-slate-700 text-white"
                  />
                </div>
                <div>
                  <Label htmlFor="tip-amount" className="text-slate-300">
                    Pourboire (optionnel)
                  </Label>
                  <Input
                    id="tip-amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                    placeholder="0.00"
                    className="mt-2 bg-slate-900 border-slate-700 text-white"
                  />
                </div>
                <div className="bg-slate-900 p-3 rounded-lg">
                  <div className="flex justify-between text-sm text-slate-400">
                    <span>Total à régler</span>
                    <span>{totalWithTip.toFixed(2)} €</span>
                  </div>
                  {cashGivenValue > 0 && (
                    <div className="flex justify-between text-base mt-2">
                      <span className="text-slate-300">
                        {changeDue >= 0 ? "Rendu" : "Manque"}
                      </span>
                      <span className={changeDue >= 0 ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
                        {Math.abs(changeDue).toFixed(2)} €
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(false)} className="bg-slate-700 border-slate-600">
              Annuler
            </Button>
            <Button onClick={handlePayment} className="bg-blue-600 hover:bg-blue-700">
              Confirmer le paiement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cardTipDialog} onOpenChange={setCardTipDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tips CB</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="card-tip" className="text-slate-300">
              Montant du pourboire
            </Label>
            <Input
              id="card-tip"
              type="number"
              step="0.01"
              min="0"
              value={cardTipDraft}
              onChange={(e) => setCardTipDraft(e.target.value)}
              placeholder="0.00"
              className="mt-2 bg-slate-900 border-slate-700 text-white"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCardTipDialog(false)}
              className="bg-slate-700 border-slate-600"
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                setTipAmount(cardTipDraft)
                setCardTipDialog(false)
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Valider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-400">
              <CheckCircle className="h-6 w-6" />
              Paiement complet !
            </DialogTitle>
          </DialogHeader>
          <div className="py-6 text-center">
            <p className="text-lg">La commande a été entièrement réglée.</p>
            <p className="text-slate-400 mt-2">Redirection vers le plan de salle...</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog pour offrir des articles */}
      <Dialog open={offerDialog.open} onOpenChange={(open) => setOfferDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="bg-slate-800 text-white border-slate-700 max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg flex items-center gap-2">
              <Gift className="h-4 w-4 sm:h-5 sm:w-5" />
              Offrir une partie de l'article
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-300 mb-2">
                Article: <span className="font-semibold text-white">{offerDialog.itemName}</span>
              </p>
              <p className="text-xs text-slate-400">
                Maximum disponible: {offerDialog.maxQuantity} article{offerDialog.maxQuantity > 1 ? "s" : ""}
              </p>
            </div>
            
            <div>
              <Label className="text-sm">Quantité à offrir</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOfferQuantity(Math.max(1, offerQuantity - 1))}
                  disabled={offerQuantity <= 1}
                  className="bg-slate-700 border-slate-600 h-8 w-8 p-0"
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <Input
                  type="number"
                  min="1"
                  max={offerDialog.maxQuantity}
                  value={offerQuantity}
                  onChange={(e) => setOfferQuantity(Math.min(offerDialog.maxQuantity, Math.max(1, Number.parseInt(e.target.value) || 1)))}
                  className="bg-slate-700 border-slate-600 text-white text-center w-16 h-8"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOfferQuantity(Math.min(offerDialog.maxQuantity, offerQuantity + 1))}
                  disabled={offerQuantity >= offerDialog.maxQuantity}
                  className="bg-slate-700 border-slate-600 h-8 w-8 p-0"
                >
                  <Plus className="h-3 w-3" />
                </Button>
                <span className="text-xs text-slate-400">/ {offerDialog.maxQuantity}</span>
              </div>
            </div>

            <div>
              <Label className="text-sm">Raison (optionnel)</Label>
              <Input
                value={complimentaryReason}
                onChange={(e) => setComplimentaryReason(e.target.value)}
                placeholder="Ex: Service client, erreur cuisine..."
                className="bg-slate-700 border-slate-600 text-white text-sm mt-1"
              />
            </div>

            <div className="bg-slate-900 p-3 rounded-lg">
              <p className="text-xs text-slate-400">
                <span className="font-semibold text-green-400">{offerQuantity}</span> article{offerQuantity > 1 ? "s" : ""} sera/seront offert{offerQuantity > 1 ? "s" : ""}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Valeur: {(offerQuantity * offerDialog.itemPrice).toFixed(2)} €
              </p>
            </div>
          </div>
          
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setOfferDialog({ open: false, itemId: null, itemName: "", maxQuantity: 0, itemPrice: 0 })}
              className="bg-slate-700 border-slate-600"
            >
              Annuler
            </Button>
            <Button
              onClick={() => handleSaveOffer()}
              className="bg-green-600 hover:bg-green-700"
            >
              <Gift className="h-3 w-3 mr-2" />
              Offrir {offerQuantity} article{offerQuantity > 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
