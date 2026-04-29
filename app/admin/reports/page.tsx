"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, TrendingUp, DollarSign, ShoppingBag, Calendar, Gift, Users, Target, Clock, Timer, ChevronDown, ChevronUp, Sun, Moon, Zap } from "lucide-react"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

interface SalesData {
  date: string
  total: number
  orders: number
}

interface HourlySalesData {
  hour: string
  total: number
  orders: number
  average: number
}

interface TopDish {
  menu_item_id?: string
  name: string
  quantity: number
  revenue: number
  dailySales?: Array<{ date: string; quantity: number }>
  bestDay?: { date: string; quantity: number } | null
}

interface ServerStats {
  server_name: string
  total_sales: number
  total_sales_ht?: number
  order_count: number
  average_ticket: number
  complimentary_amount?: number
  complimentary_count?: number
  complimentary_percentage?: number
  avg_duration?: number | null
  total_covers?: number
  revenue_per_cover?: number | null
}

// ── Service Summary types ──
interface ServiceData {
  sales: number
  orders: number
  covers: number
  avg_ticket: number
  avg_duration: number | null
  revenue_per_cover: number | null
  payment_breakdown: {
    cash: { amount: number; orders: number }
    card: { amount: number; orders: number }
    other: { amount: number; orders: number }
  }
  discount_breakdown: {
    seasonal: { amount: number; count: number }
    employee: { amount: number; count: number }
  }
}

interface ServerSummary {
  server_id: string
  server_name: string
  tables_served: number
  total_sales: number
  total_covers: number
  average_ticket: number
  avg_duration: number | null
  revenue_per_cover: number | null
  complimentary_amount: number
  complimentary_count: number
  complimentary_percentage: number
  orders: Array<{
    table_number: string
    amount: number
    covers: number | null
    duration_min: number | null
    service: "midi" | "soir"
    time: string
    payment_method: string
  }>
}

interface Insight {
  icon: string
  label: string
  value: string
  color: string
}

interface ServiceSummaryData {
  date: string
  hasData: boolean
  services: { midi: ServiceData | null; soir: ServiceData | null }
  servers: ServerSummary[]
  topDishes: TopDish[]
  insights: Insight[]
  totals: {
    sales: number
    orders: number
    covers: number
    avg_ticket: number
    avg_duration: number | null
    payment_breakdown: {
      cash: { amount: number; orders: number }
      card: { amount: number; orders: number }
      other: { amount: number; orders: number }
    }
    discount_breakdown: {
      seasonal: { amount: number; count: number }
      employee: { amount: number; count: number }
    }
  }
}

const TOP_DISHES_OPTIONS = [10, 20, 30, 50, 100] as const
const BUSINESS_TIME_ZONE = "Europe/Paris"
const getBusinessDateIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE }).format(new Date())
const shiftIsoDate = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split("-").map((value) => Number.parseInt(value, 10))
  if (!year || !month || !day) return isoDate
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().split("T")[0]
}

export default function ReportsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<"overview" | "service">("overview")
  const [period, setPeriod] = useState<"today" | "7days" | "30days" | "3months" | "custom">("today")
  const [customStartDate, setCustomStartDate] = useState("")
  const [customEndDate, setCustomEndDate] = useState("")
  const [salesData, setSalesData] = useState<SalesData[]>([])
  const [hourlySales, setHourlySales] = useState<HourlySalesData[]>([])
  const [topDishes, setTopDishes] = useState<TopDish[]>([])
  const [topDishesLimit, setTopDishesLimit] = useState<(typeof TOP_DISHES_OPTIONS)[number]>(10)
  const [selectedTopDishId, setSelectedTopDishId] = useState<string | null>(null)
  const [serverStats, setServerStats] = useState<ServerStats[]>([])
  const [loading, setLoading] = useState(true)

  // Service summary state
  const [summaryDate, setSummaryDate] = useState(getBusinessDateIso)
  const [summaryData, setSummaryData] = useState<ServiceSummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [expandedServer, setExpandedServer] = useState<string | null>(null)

  const [stats, setStats] = useState({
    totalSales: 0,
    totalSalesHT: 0,
    totalOrders: 0,
    averageTicket: 0,
    dailyAverage: 0,
    activeDays: 0,
    totalPeriodDays: 0,
    totalTax: 0,
    taxRate10Share: 0,
    taxRate20Share: 0,
    totalCovers: 0,
    averageCoversPerOrder: 0,
    revenuePerCover: 0,
    dailyAverageCovers: 0,
    avgDurationMin: 0,
    minDuration: 0,
    maxDuration: 0,
    tablesWithDuration: 0,
    totalComplimentaryAmount: 0,
    totalComplimentaryCount: 0,
    complimentaryPercentage: 0,
    paymentMix: {
      volume: { cash: 0, card: 0, other: 0 },
      value: { cash: 0, card: 0, other: 0 },
    },
  })

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (user?.role === "manager" && activeTab === "service") {
      fetchServiceSummary()
    }
  }, [user, summaryDate, activeTab])

  useEffect(() => {
    if (user?.role !== "manager" || activeTab !== "overview") return
    if (period === "custom" && (!customStartDate || !customEndDate)) return
    fetchReports()
  }, [user, activeTab, period, customStartDate, customEndDate])

  useEffect(() => {
    if (selectedTopDishId && !topDishes.some((dish) => dish.menu_item_id && dish.menu_item_id === selectedTopDishId)) {
      setSelectedTopDishId(null)
    }
  }, [topDishes, selectedTopDishId])

  const fetchServiceSummary = async () => {
    try {
      setSummaryLoading(true)
      const response = await fetch(`/api/admin/reports/service-summary?date=${summaryDate}`)
      if (response.ok) {
        const data = await response.json()
        setSummaryData(data)
      }
    } catch (error) {
      console.error("[v0] Error fetching service summary:", error)
    } finally {
      setSummaryLoading(false)
    }
  }

  const fetchReports = async () => {
    try {
      setLoading(true)
      let url = `/api/admin/reports?period=${period}`
      if (period === "today") {
        url += `&todayDate=${encodeURIComponent(getBusinessDateIso())}`
      }
      if (period === "custom" && customStartDate && customEndDate) {
        url += `&startDate=${customStartDate}&endDate=${customEndDate}`
      }
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setSalesData(data.salesData || [])
        setHourlySales(data.hourlySales || [])
        setTopDishes(data.topDishes || [])
        setServerStats(data.serverStats || [])
        setStats(data.stats || { 
          totalSales: 0, 
          totalSalesHT: 0,
          totalOrders: 0, 
          averageTicket: 0,
          dailyAverage: 0,
          activeDays: 0,
          totalPeriodDays: 0,
          totalTax: 0, 
          taxRate10Share: 0,
          taxRate20Share: 0,
          totalCovers: 0,
          averageCoversPerOrder: 0,
          revenuePerCover: 0,
          dailyAverageCovers: 0,
          avgDurationMin: 0,
          minDuration: 0,
          maxDuration: 0,
          tablesWithDuration: 0,
          totalComplimentaryAmount: 0,
          totalComplimentaryCount: 0,
          complimentaryPercentage: 0,
          paymentMix: {
            volume: { cash: 0, card: 0, other: 0 },
            value: { cash: 0, card: 0, other: 0 },
          },
        })
      }
    } catch (error) {
      console.error("[v0] Error fetching reports:", error)
    } finally {
      setLoading(false)
    }
  }

  if (isLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  const COLORS = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ]

  const formatDuration = (min: number) => {
    if (min < 60) return `${min}min`
    const h = Math.floor(min / 60)
    const m = min % 60
    return m > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${h}h`
  }

  const displayedTopDishes = topDishes.slice(0, topDishesLimit)
  const displayedTopDishesWithRank = displayedTopDishes.map((dish, index) => {
    const rank = index + 1
    const rankPrefix = rank % 10 === 0 ? `[#${rank}]` : `#${rank}`
    return {
      ...dish,
      rank,
      chartLabel: `${rankPrefix} ${dish.name}`,
    }
  })
  const topDishesChartHeight = Math.max(350, displayedTopDishes.length * 34)
  const selectedTopDish = selectedTopDishId
    ? topDishes.find((dish) => dish.menu_item_id && dish.menu_item_id === selectedTopDishId) || null
    : null
  const selectedTopDishDailyMap = new Map((selectedTopDish?.dailySales || []).map((entry) => [entry.date, entry.quantity]))
  const selectedTopDishDailyRows = salesData.map((day) => ({
    date: day.date,
    quantity: selectedTopDishDailyMap.get(day.date) || 0,
  }))

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6">
      <div className="mb-4 sm:mb-6 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <Button
              onClick={() => router.push("/admin")}
              variant="outline"
              size="sm"
              className="bg-slate-800 text-white border-slate-700"
            >
              <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="text-xs sm:text-sm">Retour</span>
            </Button>
            <h1 className="text-xl sm:text-3xl font-bold text-white">Rapports avancés</h1>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-2 border-b border-slate-700 pb-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActiveTab("overview")}
            className={`${activeTab === "overview" ? "bg-blue-600/20 text-blue-400 border-b-2 border-blue-400" : "text-slate-400 hover:text-white"} rounded-b-none`}
          >
            <TrendingUp className="h-4 w-4 mr-1" />
            Vue d'ensemble
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActiveTab("service")}
            className={`${activeTab === "service" ? "bg-emerald-600/20 text-emerald-400 border-b-2 border-emerald-400" : "text-slate-400 hover:text-white"} rounded-b-none`}
          >
            <Zap className="h-4 w-4 mr-1" />
            Résumé de service
          </Button>
        </div>

        {/* Period selector for overview tab */}
        {activeTab === "overview" && (
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant={period === "today" ? "default" : "outline"}
              onClick={() => setPeriod("today")}
              className={period === "today" ? "bg-green-600 hover:bg-green-700" : "bg-slate-800 border-slate-700"}
            >
              Aujourd'hui
            </Button>
            <Button
              size="sm"
              variant={period === "7days" ? "default" : "outline"}
              onClick={() => setPeriod("7days")}
              className={period === "7days" ? "bg-blue-600" : "bg-slate-800 border-slate-700"}
            >
              7 jours
            </Button>
            <Button
              size="sm"
              variant={period === "30days" ? "default" : "outline"}
              onClick={() => setPeriod("30days")}
              className={period === "30days" ? "bg-blue-600" : "bg-slate-800 border-slate-700"}
            >
              30 jours
            </Button>
            <Button
              size="sm"
              variant={period === "3months" ? "default" : "outline"}
              onClick={() => setPeriod("3months")}
              className={period === "3months" ? "bg-blue-600" : "bg-slate-800 border-slate-700"}
            >
              3 mois
            </Button>
            <Button
              size="sm"
              variant={period === "custom" ? "default" : "outline"}
              onClick={() => setPeriod("custom")}
              className={period === "custom" ? "bg-blue-600" : "bg-slate-800 border-slate-700"}
            >
              <Calendar className="h-3 w-3 mr-1" />
              Personnalisé
            </Button>
          </div>
        )}
      </div>

      {/* ═══════════ OVERVIEW TAB ═══════════ */}
      {activeTab === "overview" && <>

      {period === "custom" && (
        <Card className="bg-slate-800 border-slate-700 mb-6">
          <CardHeader>
            <CardTitle className="text-white text-sm sm:text-base">Sélectionner une période</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date" className="text-slate-400 text-sm">
                  Date de début
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date" className="text-slate-400 text-sm">
                  Date de fin
                </Label>
                <Input
                  id="end-date"
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
        <Card className="bg-gradient-to-br from-blue-900/20 to-blue-800/20 border-blue-700/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-blue-400">CA (TTC)</CardTitle>
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <DollarSign className="h-4 w-4 text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-white">{stats.totalSales.toFixed(2)} €</div>
            <div className="text-xs text-blue-300 mt-1">HT : {stats.totalSalesHT.toFixed(2)} €</div>
            {stats.activeDays > 0 && period !== "today" && (
              <div className="text-xs text-blue-400 mt-1">Moy : {stats.dailyAverage.toFixed(2)} €/jour</div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-900/20 to-green-800/20 border-green-700/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-400">Articles offerts</CardTitle>
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Gift className="h-4 w-4 text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-white">{stats.totalComplimentaryAmount.toFixed(2)} €</div>
            <div className="text-xs text-green-400 mt-1">{stats.totalComplimentaryCount} articles</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-900/20 to-purple-800/20 border-purple-700/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-purple-400">Commandes</CardTitle>
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <ShoppingBag className="h-4 w-4 text-purple-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-white">{stats.totalOrders}</div>
            {period !== "today" && stats.totalPeriodDays > 1 ? (
              <div className="text-xs text-purple-400 mt-1">
                {stats.activeDays}j d'activité / {stats.totalPeriodDays}j
              </div>
            ) : (
              <div className="text-xs text-purple-400 mt-1">Total période</div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-900/20 to-orange-800/20 border-orange-700/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-orange-400">Ticket moyen</CardTitle>
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <TrendingUp className="h-4 w-4 text-orange-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-white">{stats.averageTicket.toFixed(2)} €</div>
            <div className="text-xs text-orange-400 mt-1">Par commande</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-cyan-900/20 to-cyan-800/20 border-cyan-700/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-cyan-400">Couverts</CardTitle>
            <div className="p-2 bg-cyan-500/20 rounded-lg">
              <Users className="h-4 w-4 text-cyan-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-white">{stats.totalCovers}</div>
            {stats.totalCovers > 0 && (
              <>
                <div className="text-xs text-cyan-300 mt-1">{stats.revenuePerCover.toFixed(2)} € / couvert</div>
                {period !== "today" && stats.activeDays > 0 && (
                  <div className="text-xs text-cyan-400 mt-0.5">~{stats.dailyAverageCovers.toFixed(0)} couv./jour</div>
                )}
              </>
            )}
            {stats.totalCovers === 0 && (
              <div className="text-xs text-cyan-400/60 mt-1">Pas encore renseigné</div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-indigo-900/20 to-indigo-800/20 border-indigo-700/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-indigo-400">Durée moy.</CardTitle>
            <div className="p-2 bg-indigo-500/20 rounded-lg">
              <Timer className="h-4 w-4 text-indigo-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-white">
              {stats.avgDurationMin > 0 ? formatDuration(stats.avgDurationMin) : "–"}
            </div>
            {stats.tablesWithDuration > 0 && (
              <>
                <div className="text-xs text-indigo-300 mt-1">Min {formatDuration(stats.minDuration)} · Max {formatDuration(stats.maxDuration)}</div>
                <div className="text-xs text-indigo-400 mt-0.5">Sur {stats.tablesWithDuration} tables</div>
              </>
            )}
            {stats.tablesWithDuration === 0 && (
              <div className="text-xs text-indigo-400/60 mt-1">Aucune donnée</div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-900/20 to-red-800/20 border-red-700/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-red-400">TVA collectée</CardTitle>
            <div className="p-2 bg-red-500/20 rounded-lg">
              <Target className="h-4 w-4 text-red-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-bold text-white">{stats.totalTax.toFixed(2)} €</div>
            <div className="text-xs text-red-300 mt-1">
              {stats.taxRate20Share.toFixed(0)}% du CA à 20%, {stats.taxRate10Share.toFixed(0)}% du CA à 10%
            </div>
            <div className="text-xs text-red-400 mt-1">Calculée précisément</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-800 border-slate-700 mb-6">
        <CardHeader>
          <CardTitle className="text-white">Évolution des ventes</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              total: {
                label: "Ventes",
                color: "hsl(var(--chart-1))",
              },
            }}
            className="h-[300px] [&_.recharts-legend-item-text]:fill-slate-200 [&_.recharts-cartesian-axis-tick_text]:fill-slate-100"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesData}>
                <defs>
                  <linearGradient id="salesLineGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={1} />
                    <stop offset="50%" stopColor="#0ea5e9" stopOpacity={1} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis
                  dataKey="date"
                  stroke="rgba(248,250,252,0.95)"
                  tick={{ fill: "#f8fafc", fontSize: 12 }}
                  tickLine={{ stroke: "rgba(248,250,252,0.8)" }}
                  axisLine={{ stroke: "rgba(248,250,252,0.7)" }}
                />
                <YAxis
                  stroke="rgba(248,250,252,0.95)"
                  tick={{ fill: "#f8fafc", fontSize: 12 }}
                  tickLine={{ stroke: "rgba(248,250,252,0.8)" }}
                  axisLine={{ stroke: "rgba(248,250,252,0.7)" }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend wrapperStyle={{ color: "#e2e8f0" }} />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="url(#salesLineGradient)"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={{ r: 3, fill: "#e2e8f0", stroke: "#0ea5e9", strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: "#0ea5e9", stroke: "#e2e8f0", strokeWidth: 2 }}
                  name="Ventes (€)"
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Hourly sales chart */}
      <Card className="bg-slate-800 border-slate-700 mb-6">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Clock className="h-5 w-5 text-emerald-400" />
            Ventes par heure {period !== "today" && stats.activeDays > 0 && `(moyenne sur ${stats.activeDays}j d'activité)`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{
              total: {
                label: period === "today" ? "Ventes (€)" : "Moy/jour (€)",
                color: "#10b981",
              },
            }}
            className="h-[280px] [&_.recharts-legend-item-text]:fill-slate-200 [&_.recharts-cartesian-axis-tick_text]:fill-slate-100"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlySales}>
                <defs>
                  <linearGradient id="hourlyBarGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                <XAxis
                  dataKey="hour"
                  stroke="rgba(248,250,252,0.95)"
                  tick={{ fill: "#f8fafc", fontSize: 12 }}
                  tickLine={{ stroke: "rgba(248,250,252,0.8)" }}
                  axisLine={{ stroke: "rgba(248,250,252,0.7)" }}
                />
                <YAxis
                  stroke="rgba(248,250,252,0.95)"
                  tick={{ fill: "#f8fafc", fontSize: 12 }}
                  tickLine={{ stroke: "rgba(248,250,252,0.8)" }}
                  axisLine={{ stroke: "rgba(248,250,252,0.7)" }}
                  tickFormatter={(value) => `${value}€`}
                />
                <ChartTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const data = payload[0].payload as HourlySalesData
                    return (
                      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-lg">
                        <p className="text-white font-medium">{data.hour}</p>
                        <p className="text-emerald-400">CA : {data.total.toFixed(2)} €</p>
                        {period !== "today" && (
                          <p className="text-emerald-300 text-xs">Moy/jour : {data.average.toFixed(2)} €</p>
                        )}
                        <p className="text-slate-400 text-xs">{data.orders} commande{data.orders > 1 ? "s" : ""}</p>
                      </div>
                    )
                  }}
                />
                <Bar
                  dataKey={period === "today" ? "total" : "average"}
                  fill="url(#hourlyBarGradient)"
                  name={period === "today" ? "Ventes (€)" : "Moy/jour (€)"}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-gradient-to-br from-amber-900/30 to-orange-800/20 border-amber-700/40 backdrop-blur-md">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-white flex items-center gap-2">
                <div className="p-2 bg-amber-500/30 rounded-lg">
                  <ShoppingBag className="h-4 w-4 text-amber-400" />
                </div>
                Top {topDishesLimit} des plats
              </CardTitle>
              <div className="flex items-center gap-1">
                {TOP_DISHES_OPTIONS.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={topDishesLimit === value ? "default" : "outline"}
                    onClick={() => setTopDishesLimit(value)}
                    className={
                      topDishesLimit === value
                        ? "h-7 px-2 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                        : "h-7 px-2 text-xs bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700"
                    }
                  >
                    Top {value}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <div style={{ height: `${topDishesChartHeight}px` }}>
                <ChartContainer
                  config={{
                    quantity: {
                      label: "Quantité",
                      color: "#f59e0b", // Amber color
                    },
                  }}
                  className="h-full [&_.recharts-cartesian-axis-tick_text]:fill-slate-100 [&_.recharts-legend-item-text]:fill-slate-200"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={displayedTopDishesWithRank} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.18)" />
                      <XAxis
                        type="number"
                        stroke="rgba(248, 250, 252, 0.9)"
                        tick={{ fill: "#f8fafc", fontSize: 12 }}
                        tickLine={{ stroke: "rgba(248, 250, 252, 0.8)" }}
                        axisLine={{ stroke: "rgba(248, 250, 252, 0.7)" }}
                      />
                      <YAxis
                        dataKey="chartLabel"
                        type="category"
                        stroke="rgba(248, 250, 252, 0.9)"
                        tick={{ fill: "#f8fafc", fontSize: 12 }}
                        tickLine={{ stroke: "rgba(248, 250, 252, 0.8)" }}
                        axisLine={{ stroke: "rgba(248, 250, 252, 0.7)" }}
                        width={120}
                      />
                      <ChartTooltip 
                        content={<ChartTooltipContent />}
                      />
                      <Bar
                        dataKey="quantity"
                        fill="#f59e0b"
                        name="Quantité vendue"
                        radius={[4, 4, 0, 0]}
                        cursor="pointer"
                        onClick={(_, index) => {
                          const dish = displayedTopDishesWithRank[index]
                          if (!dish?.menu_item_id) return
                          setSelectedTopDishId(dish.menu_item_id)
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            </div>
            <div className="mt-3 text-xs text-amber-300">Clique sur un plat du graphique pour voir le détail par jour.</div>
            {selectedTopDish && (
              <div className="mt-3 rounded-lg border border-amber-700/50 bg-slate-900/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white">{selectedTopDish.name}</div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-amber-600 text-white">Total: {selectedTopDish.quantity}</Badge>
                    {selectedTopDish.bestDay && (
                      <span className="text-xs text-amber-200">
                        Meilleur jour:{" "}
                        {new Date(`${selectedTopDish.bestDay.date}T00:00:00`).toLocaleDateString("fr-FR", {
                          weekday: "long",
                          day: "2-digit",
                          month: "2-digit",
                        })}{" "}
                        ({selectedTopDish.bestDay.quantity})
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
                  {selectedTopDishDailyRows.map((row) => (
                    <div
                      key={`${selectedTopDish.menu_item_id || selectedTopDish.name}-${row.date}`}
                      className="flex items-center justify-between rounded bg-slate-800/70 px-2 py-1 text-xs"
                    >
                      <span className="text-slate-200">
                        {new Date(`${row.date}T00:00:00`).toLocaleDateString("fr-FR", {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                      <span className={`font-semibold ${row.quantity > 0 ? "text-amber-300" : "text-slate-500"}`}>
                        {row.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-violet-900/30 to-purple-800/20 border-violet-700/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <div className="p-2 bg-violet-500/30 rounded-lg">
                <Users className="h-4 w-4 text-violet-400" />
              </div>
              Répartition par serveur
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                sales: {
                  label: "Ventes",
                  color: "#8b5cf6", // Violet color
                },
              }}
              className="h-[350px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={serverStats}
                    dataKey="total_sales"
                    nameKey="server_name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }) => {
                      const RADIAN = Math.PI / 180
                      const radius = innerRadius + (outerRadius - innerRadius) * 0.5
                      const x = cx + radius * Math.cos(-midAngle * RADIAN)
                      const y = cy + radius * Math.sin(-midAngle * RADIAN)

                      return (
                        <text 
                          x={x} 
                          y={y} 
                          fill="white" 
                          textAnchor={x > cx ? 'start' : 'end'} 
                          dominantBaseline="central"
                          className="text-xs font-medium"
                        >
                          {`${(percent * 100).toFixed(0)}%`}
                        </text>
                      )
                    }}
                  >
                    {serverStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gradient-to-br from-slate-900/60 to-slate-800/40 border-slate-700/60 backdrop-blur-md mt-6">
        <CardHeader>
          <CardTitle className="text-white">Répartition des paiements</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-900/40 border border-slate-700/60 rounded-lg p-4">
            <div className="text-sm text-slate-300 mb-2">Volume (nombre de ventes)</div>
            <div className="text-white text-base">
              CB {stats.paymentMix.volume.card.toFixed(0)}% · Espèces {stats.paymentMix.volume.cash.toFixed(0)}%
            </div>
          </div>
          <div className="bg-slate-900/40 border border-slate-700/60 rounded-lg p-4">
            <div className="text-sm text-slate-300 mb-2">Valeur (CA)</div>
            <div className="text-white text-base">
              CB {stats.paymentMix.value.card.toFixed(0)}% · Espèces {stats.paymentMix.value.cash.toFixed(0)}%
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-indigo-900/20 to-indigo-800/20 border-indigo-700/50 backdrop-blur-sm mt-6">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Users className="h-5 w-5" />
            Performance des serveurs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-indigo-700/50">
                  <th className="text-left py-3 px-4 text-indigo-400 font-medium">Serveur</th>
                  <th className="text-right py-3 px-4 text-indigo-400 font-medium">Tables</th>
                  <th className="text-right py-3 px-4 text-indigo-400 font-medium">CA TTC</th>
                  <th className="text-right py-3 px-4 text-indigo-400 font-medium hidden sm:table-cell">CA HT</th>
                  <th className="text-right py-3 px-4 text-indigo-400 font-medium">Ticket moy</th>
                  <th className="text-right py-3 px-4 text-indigo-400 font-medium hidden sm:table-cell">Couverts</th>
                  <th className="text-right py-3 px-4 text-indigo-400 font-medium hidden sm:table-cell">Durée moy</th>
                  <th className="text-right py-3 px-4 text-indigo-400 font-medium">Offerts</th>
                </tr>
              </thead>
              <tbody>
                {serverStats.map((server, index) => (
                  <tr key={index} className="border-b border-indigo-700/30 hover:bg-indigo-800/30 transition-colors">
                    <td className="py-3 px-4 text-white font-medium">{server.server_name}</td>
                    <td className="py-3 px-4 text-right text-white">{server.order_count}</td>
                    <td className="py-3 px-4 text-right text-white">{server.total_sales.toFixed(2)} €</td>
                    <td className="py-3 px-4 text-right text-white hidden sm:table-cell">{(server.total_sales_ht ?? 0).toFixed(2)} €</td>
                    <td className="py-3 px-4 text-right text-white">{server.average_ticket.toFixed(2)} €</td>
                    <td className="py-3 px-4 text-right hidden sm:table-cell">
                      <div className="text-cyan-400">{server.total_covers || 0}</div>
                      {server.revenue_per_cover != null && (
                        <div className="text-xs text-cyan-500">{server.revenue_per_cover.toFixed(1)} €/couv.</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right hidden sm:table-cell">
                      {server.avg_duration != null ? (
                        <div className="text-indigo-400">{formatDuration(server.avg_duration)}</div>
                      ) : (
                        <div className="text-slate-500">–</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="text-green-400">{server.complimentary_amount?.toFixed(2) || '0.00'} €</div>
                      <div className="text-xs text-green-500">({server.complimentary_count || 0} art.)</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      </>}

      {/* ═══════════ SERVICE SUMMARY TAB ═══════════ */}
      {activeTab === "service" && (
        <>
          {/* Date selector */}
          <Card className="bg-slate-800 border-slate-700 mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <Calendar className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                <div className="flex-1 w-full">
                  <Label htmlFor="summary-date" className="text-slate-400 text-sm mb-1 block">
                    Sélectionner une date
                  </Label>
                  <Input
                    id="summary-date"
                    type="date"
                    value={summaryDate}
                    onChange={(e) => setSummaryDate(e.target.value)}
                    className="bg-slate-700 border-slate-600 text-white max-w-xs"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSummaryDate(shiftIsoDate(summaryDate, -1))}
                    className="bg-slate-700 border-slate-600 text-white"
                  >
                    ← Veille
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSummaryDate(getBusinessDateIso())}
                    className="bg-emerald-700 border-emerald-600 text-white"
                  >
                    Aujourd'hui
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSummaryDate(shiftIsoDate(summaryDate, 1))}
                    className="bg-slate-700 border-slate-600 text-white"
                  >
                    Lendemain →
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {summaryLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-white text-xl">Chargement...</div>
            </div>
          )}

          {!summaryLoading && summaryData && !summaryData.hasData && (
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="py-16 text-center">
                <div className="text-4xl mb-3">📭</div>
                <div className="text-white text-lg font-medium">Aucune donnée</div>
                <div className="text-slate-400 text-sm mt-1">
                  Pas de service enregistré le {new Date(summaryDate + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </div>
              </CardContent>
            </Card>
          )}

          {!summaryLoading && summaryData?.hasData && (
            <>
              {/* Date banner */}
              <div className="text-center mb-6">
                <h2 className="text-xl sm:text-2xl font-bold text-white">
                  {new Date(summaryDate + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </h2>
              </div>

              {/* Cash / CB / remises breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
                <Card className="bg-gradient-to-br from-emerald-900/25 to-emerald-800/20 border-emerald-700/50">
                  <CardContent className="pt-4 pb-4">
                    <div className="text-xs text-emerald-300 uppercase tracking-wide">Cash</div>
                    <div className="text-2xl font-bold text-white mt-1">
                      {summaryData.totals.payment_breakdown.cash.amount.toFixed(2)} €
                    </div>
                    <div className="text-xs text-emerald-200 mt-1">
                      {summaryData.totals.payment_breakdown.cash.orders} encaissement
                      {summaryData.totals.payment_breakdown.cash.orders > 1 ? "s" : ""}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-blue-900/25 to-blue-800/20 border-blue-700/50">
                  <CardContent className="pt-4 pb-4">
                    <div className="text-xs text-blue-300 uppercase tracking-wide">CB</div>
                    <div className="text-2xl font-bold text-white mt-1">
                      {summaryData.totals.payment_breakdown.card.amount.toFixed(2)} €
                    </div>
                    <div className="text-xs text-blue-200 mt-1">
                      {summaryData.totals.payment_breakdown.card.orders} encaissement
                      {summaryData.totals.payment_breakdown.card.orders > 1 ? "s" : ""}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-slate-800/90 to-slate-700/70 border-slate-600/80">
                  <CardContent className="pt-4 pb-4">
                    <div className="text-xs text-slate-300 uppercase tracking-wide">Autres</div>
                    <div className="text-2xl font-bold text-white mt-1">
                      {summaryData.totals.payment_breakdown.other.amount.toFixed(2)} €
                    </div>
                    <div className="text-xs text-slate-300 mt-1">
                      {summaryData.totals.payment_breakdown.other.orders} encaissement
                      {summaryData.totals.payment_breakdown.other.orders > 1 ? "s" : ""}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-amber-900/25 to-amber-800/20 border-amber-700/50">
                  <CardContent className="pt-4 pb-4">
                    <div className="text-xs text-amber-300 uppercase tracking-wide">Remise saisonnier</div>
                    <div className="text-2xl font-bold text-white mt-1">
                      {summaryData.totals.discount_breakdown.seasonal.amount.toFixed(2)} €
                    </div>
                    <div className="text-xs text-amber-200 mt-1">
                      {summaryData.totals.discount_breakdown.seasonal.count} remise
                      {summaryData.totals.discount_breakdown.seasonal.count > 1 ? "s" : ""}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-rose-900/25 to-rose-800/20 border-rose-700/50">
                  <CardContent className="pt-4 pb-4">
                    <div className="text-xs text-rose-300 uppercase tracking-wide">Remise salarié</div>
                    <div className="text-2xl font-bold text-white mt-1">
                      {summaryData.totals.discount_breakdown.employee.amount.toFixed(2)} €
                    </div>
                    <div className="text-xs text-rose-200 mt-1">
                      {summaryData.totals.discount_breakdown.employee.count} remise
                      {summaryData.totals.discount_breakdown.employee.count > 1 ? "s" : ""}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Insights grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                {summaryData.insights.map((insight, i) => (
                  <Card key={i} className={`bg-gradient-to-br from-${insight.color}-900/20 to-${insight.color}-800/20 border-${insight.color}-700/50 backdrop-blur-sm`}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{insight.icon}</span>
                        <span className="text-xs text-slate-400">{insight.label}</span>
                      </div>
                      <div className="text-lg sm:text-xl font-bold text-white">{insight.value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Service breakdown (Midi / Soir) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {/* Midi */}
                <Card className={`border backdrop-blur-sm ${summaryData.services.midi ? "bg-gradient-to-br from-amber-900/20 to-amber-800/20 border-amber-700/50" : "bg-slate-800/50 border-slate-700"}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-amber-400 flex items-center gap-2 text-base">
                      <Sun className="h-5 w-5" />
                      Service Midi
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {summaryData.services.midi ? (
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">CA TTC</span>
                          <span className="text-white font-bold">{summaryData.services.midi.sales.toFixed(2)} €</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Tables</span>
                          <span className="text-white">{summaryData.services.midi.orders}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Couverts</span>
                          <span className="text-white">{summaryData.services.midi.covers || "–"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Ticket moyen</span>
                          <span className="text-white">{summaryData.services.midi.avg_ticket.toFixed(2)} €</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Cash</span>
                          <span className="text-emerald-300">
                            {summaryData.services.midi.payment_breakdown.cash.amount.toFixed(2)} €
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">CB</span>
                          <span className="text-blue-300">
                            {summaryData.services.midi.payment_breakdown.card.amount.toFixed(2)} €
                          </span>
                        </div>
                        {summaryData.services.midi.discount_breakdown.seasonal.amount > 0 && (
                          <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Remise saisonnier</span>
                            <span className="text-amber-300">
                              {summaryData.services.midi.discount_breakdown.seasonal.amount.toFixed(2)} €
                            </span>
                          </div>
                        )}
                        {summaryData.services.midi.discount_breakdown.employee.amount > 0 && (
                          <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Remise salarié</span>
                            <span className="text-rose-300">
                              {summaryData.services.midi.discount_breakdown.employee.amount.toFixed(2)} €
                            </span>
                          </div>
                        )}
                        {summaryData.services.midi.avg_duration && (
                          <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Durée moy.</span>
                            <span className="text-white">{formatDuration(summaryData.services.midi.avg_duration)}</span>
                          </div>
                        )}
                        {summaryData.services.midi.revenue_per_cover && (
                          <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">€/couvert</span>
                            <span className="text-white">{summaryData.services.midi.revenue_per_cover.toFixed(2)} €</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-slate-500 text-sm text-center py-4">Pas de service midi</div>
                    )}
                  </CardContent>
                </Card>

                {/* Soir */}
                <Card className={`border backdrop-blur-sm ${summaryData.services.soir ? "bg-gradient-to-br from-indigo-900/20 to-indigo-800/20 border-indigo-700/50" : "bg-slate-800/50 border-slate-700"}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-indigo-400 flex items-center gap-2 text-base">
                      <Moon className="h-5 w-5" />
                      Service Soir
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {summaryData.services.soir ? (
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">CA TTC</span>
                          <span className="text-white font-bold">{summaryData.services.soir.sales.toFixed(2)} €</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Tables</span>
                          <span className="text-white">{summaryData.services.soir.orders}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Couverts</span>
                          <span className="text-white">{summaryData.services.soir.covers || "–"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Ticket moyen</span>
                          <span className="text-white">{summaryData.services.soir.avg_ticket.toFixed(2)} €</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Cash</span>
                          <span className="text-emerald-300">
                            {summaryData.services.soir.payment_breakdown.cash.amount.toFixed(2)} €
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">CB</span>
                          <span className="text-blue-300">
                            {summaryData.services.soir.payment_breakdown.card.amount.toFixed(2)} €
                          </span>
                        </div>
                        {summaryData.services.soir.discount_breakdown.seasonal.amount > 0 && (
                          <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Remise saisonnier</span>
                            <span className="text-amber-300">
                              {summaryData.services.soir.discount_breakdown.seasonal.amount.toFixed(2)} €
                            </span>
                          </div>
                        )}
                        {summaryData.services.soir.discount_breakdown.employee.amount > 0 && (
                          <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Remise salarié</span>
                            <span className="text-rose-300">
                              {summaryData.services.soir.discount_breakdown.employee.amount.toFixed(2)} €
                            </span>
                          </div>
                        )}
                        {summaryData.services.soir.avg_duration && (
                          <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">Durée moy.</span>
                            <span className="text-white">{formatDuration(summaryData.services.soir.avg_duration)}</span>
                          </div>
                        )}
                        {summaryData.services.soir.revenue_per_cover && (
                          <div className="flex justify-between">
                            <span className="text-slate-400 text-sm">€/couvert</span>
                            <span className="text-white">{summaryData.services.soir.revenue_per_cover.toFixed(2)} €</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-slate-500 text-sm text-center py-4">Pas de service soir</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Top dishes of the day */}
              {summaryData.topDishes.length > 0 && (
                <Card className="bg-slate-800 border-slate-700 mb-6">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2 text-base">
                      🍽️ Top plats du jour
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {summaryData.topDishes.slice(0, 8).map((dish, i) => (
                        <div key={i} className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${i < 3 ? "text-amber-400" : "text-slate-400"}`}>#{i + 1}</span>
                            <span className="text-white text-sm truncate">{dish.name}</span>
                          </div>
                          <div className="text-right flex-shrink-0 ml-2">
                            <span className="text-white font-medium text-sm">×{dish.quantity}</span>
                            <span className="text-slate-400 text-xs ml-2">{dish.revenue.toFixed(0)}€</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Per-server detailed breakdown */}
              <Card className="bg-gradient-to-br from-violet-900/20 to-violet-800/20 border-violet-700/50 backdrop-blur-sm mb-6">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Users className="h-5 w-5 text-violet-400" />
                    Détail par serveur
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {summaryData.servers.map((server) => (
                    <div key={server.server_id} className="bg-slate-900/50 rounded-lg border border-slate-700/50 overflow-hidden">
                      <button
                        onClick={() => setExpandedServer(expandedServer === server.server_id ? null : server.server_id)}
                        className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-slate-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-violet-600/30 flex items-center justify-center text-violet-300 font-bold text-sm">
                            {server.server_name.charAt(0)}
                          </div>
                          <div className="text-left">
                            <div className="text-white font-medium">{server.server_name}</div>
                            <div className="text-xs text-slate-400">
                              {server.tables_served} tables · {server.total_covers > 0 ? `${server.total_covers} couv.` : ""} 
                              {server.avg_duration != null ? ` · ~${formatDuration(server.avg_duration)}` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-white font-bold">{server.total_sales.toFixed(2)} €</div>
                            <div className="text-xs text-slate-400">Moy. {server.average_ticket.toFixed(2)} €</div>
                          </div>
                          {expandedServer === server.server_id ? (
                            <ChevronUp className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          )}
                        </div>
                      </button>

                      {/* Expanded: list of tables */}
                      {expandedServer === server.server_id && (
                        <div className="border-t border-slate-700/50 px-3 sm:px-4 py-2 space-y-1">
                          {server.orders.map((order, i) => (
                            <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={`text-[10px] px-1.5 ${order.service === "midi" ? "border-amber-500/50 text-amber-400" : "border-indigo-500/50 text-indigo-400"}`}>
                                  {order.service === "midi" ? "☀" : "🌙"}
                                </Badge>
                                <span className="text-white font-medium">{order.table_number}</span>
                                <span className="text-slate-500 text-xs">{order.time}</span>
                                {order.covers != null && order.covers > 0 && (
                                  <span className="text-cyan-400 text-xs">👥{order.covers}</span>
                                )}
                                {order.duration_min != null && (
                                  <span className="text-indigo-400 text-xs">⏱{formatDuration(order.duration_min)}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-white font-medium">{order.amount.toFixed(2)} €</span>
                                <Badge variant="outline" className="text-[10px] px-1.5 border-slate-600 text-slate-400">
                                  {order.payment_method === "card"
                                    ? "💳"
                                    : order.payment_method === "cash"
                                      ? "💵"
                                      : order.payment_method === "mixed"
                                        ? "💳💵"
                                        : "💰"}
                                </Badge>
                              </div>
                            </div>
                          ))}
                          {server.complimentary_amount > 0 && (
                            <div className="pt-1 border-t border-slate-700/30 mt-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-green-400">🎁 Offerts</span>
                                <span className="text-green-400">{server.complimentary_amount.toFixed(2)} € ({server.complimentary_count} art.)</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
