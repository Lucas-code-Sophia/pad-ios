"use client"

import { useEffect, useMemo } from "react"
import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Printer } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const formatCurrency = (value: number) => `${value.toFixed(2)} €`

const Divider = () => <div className="border-t border-dashed border-slate-300 my-2" />

const DoubleDivider = () => (
  <div className="my-2">
    <div className="border-t border-slate-300" />
    <div className="border-t border-slate-300 mt-1" />
  </div>
)

const TotalDivider = () => <div className="border-t border-slate-300 my-2" />

const TicketPaper = ({ children }: { children: ReactNode }) => (
  <div className="bg-white text-black font-mono text-[11px] sm:text-[12px] leading-4 p-4 shadow-sm border border-slate-200 rounded-md">
    {children}
  </div>
)

const KeyValueRow = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div className={`flex items-start justify-between gap-3 ${bold ? "font-bold" : ""}`}>
    <span className="truncate">{label}</span>
    <span className="whitespace-nowrap">{value}</span>
  </div>
)

export default function PrintPreviewPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  const receiptItems = useMemo(
    () => [
      { name: "Burger Classic", qty: 2, price: 14.5 },
      { name: "Frites maison", qty: 1, price: 4.0, note: "Sans sel" },
      { name: "Salade César", qty: 1, price: 12.0 },
      { name: "Coca-Cola", qty: 2, price: 3.5 },
      { name: "Café", qty: 1, price: 2.2, complimentary: true },
    ],
    [],
  )

  const receiptTotals = useMemo(() => {
    const ttc10 = receiptItems.reduce((sum, item) => {
      if (item.complimentary) return sum
      return sum + item.price * item.qty
    }, 0)
    const ht10 = ttc10 / 1.1
    const tax10 = ttc10 - ht10
    const tax20 = 0
    return {
      subtotal: ht10,
      tax10,
      tax20,
      total: ttc10 + tax20,
    }
  }, [receiptItems])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
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
            <h1 className="text-xl sm:text-3xl font-bold text-white">Aperçu des tickets</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">Zone temporaire pour valider le format d'impression</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-600 rounded-lg">
                <Printer className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base">Ticket de caisse</CardTitle>
                <CardDescription className="text-slate-400">Aperçu client</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <TicketPaper>
              <div className="text-center font-bold text-base">RESTAURANT SOPHIA</div>
              <div className="text-center text-[10px]">67 Boulevard de la plage</div>
              <div className="text-center text-[10px]">33970, Cap-Ferret</div>
              <div className="text-center text-[10px]">SIRET : 940 771 488 00027</div>
              <Divider />
              <div className="flex items-start justify-between text-[10px]">
                <div className="font-bold text-[12px]">Table 12</div>
                <div>Serveur : Maxime</div>
              </div>
              <div className="text-[10px] text-slate-700">{new Date().toLocaleString("fr-FR")}</div>
              <div className="mt-3 space-y-1">
                {receiptItems.map((item) => (
                  <div key={`${item.name}-${item.qty}`}>
                    <KeyValueRow
                      label={`${item.qty}x ${item.name}${item.complimentary ? " (OFFERT)" : ""}`}
                      value={item.complimentary ? "0.00 €" : formatCurrency(item.qty * item.price)}
                    />
                    {item.note ? <div className="text-[10px] italic text-slate-700">↳ {item.note}</div> : null}
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1">
                <KeyValueRow label="Sous total" value={formatCurrency(receiptTotals.subtotal)} />
                <KeyValueRow label="TVA 10%" value={formatCurrency(receiptTotals.tax10)} />
                <KeyValueRow label="TVA 20%" value={formatCurrency(receiptTotals.tax20)} />
              </div>
              <TotalDivider />
              <div className="flex items-start justify-between gap-3 font-bold text-[13px]">
                <span className="truncate">TOTAL</span>
                <span className="whitespace-nowrap">{formatCurrency(receiptTotals.total)}</span>
              </div>
              <Divider />
              <div className="mt-3 text-center text-[10px]">Merci de votre visite chez SOPHIA</div>
              <div className="text-center text-[10px]">Tel pour réserver : 05 57 18 21 88</div>
              <div className="text-center text-[10px]">À très vite chez nous !</div>
            </TicketPaper>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-600 rounded-lg">
                <Printer className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base">Ticket Cuisine</CardTitle>
                <CardDescription className="text-slate-400">Aperçu production</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <TicketPaper>
              <div className="text-center font-bold text-base">CUISINE</div>
              <div className="flex items-start justify-between text-[10px]">
                <div className="font-bold text-[12px]">Table 12</div>
                <div className="font-bold text-[12px]">Serveur : Maxime</div>
              </div>
              <div className="text-[10px] text-slate-700">19:42 • Commande #A-104</div>
              <Divider />
              <div className="text-[10px] font-bold tracking-wide">DIRECT</div>
              <div className="space-y-1 mt-1">
                <div>
                  <div className="font-bold text-[12px]">2x Burger Classic</div>
                  <div className="text-[10px] italic text-slate-700">↳ Sans oignon</div>
                </div>
                <div>
                  <div className="font-bold text-[12px]">1x Saumon grillé</div>
                  <div className="text-[10px] italic text-slate-700">↳ Sauce à part</div>
                </div>
              </div>
              <DoubleDivider />
              <div className="text-[9px] tracking-wide">À SUIVRE 1</div>
              <div className="space-y-1 mt-1 text-[9px]">
                <div>
                  <div className="font-normal">1x Burrata crémeuse</div>
                  <div className="text-[9px] italic">↳ Sans basilic</div>
                </div>
              </div>
              <DoubleDivider />
              <div className="text-[9px] tracking-wide">À SUIVRE 2</div>
              <div className="space-y-1 mt-1 text-[9px]">
                <div className="font-normal">1x Fondant chocolat</div>
              </div>
            </TicketPaper>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Printer className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base">Ticket Bar</CardTitle>
                <CardDescription className="text-slate-400">Aperçu production</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <TicketPaper>
              <div className="text-center font-bold text-base">BAR</div>
              <div className="flex items-start justify-between text-[10px]">
                <div className="font-bold text-[12px]">Table 12</div>
                <div className="font-bold text-[12px]">Serveur : Maxime</div>
              </div>
              <div className="text-[10px] text-slate-700">19:42 • Commande #A-104</div>
              <Divider />
              <div className="text-[10px] font-bold tracking-wide">DIRECT</div>
              <div className="space-y-1 mt-1">
                <div className="font-bold text-[12px]">2x Mojito</div>
                <div className="text-[10px] italic text-slate-700">↳ Sans sucre</div>
                <div className="font-bold text-[12px]">1x IPA pression</div>
                <div className="font-bold text-[12px]">2x Coca-Cola</div>
              </div>
              <DoubleDivider />
              <div className="text-[9px] tracking-wide">À SUIVRE 1</div>
              <div className="space-y-1 mt-1 text-[9px]">
                <div className="font-normal">2x Espresso</div>
              </div>
              <DoubleDivider />
              <div className="text-[9px] tracking-wide">À SUIVRE 2</div>
              <div className="space-y-1 mt-1 text-[9px]">
                <div className="font-normal">1x Digestif maison</div>
              </div>
            </TicketPaper>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
