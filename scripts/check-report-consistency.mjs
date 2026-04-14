import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

const envPath = path.resolve(process.cwd(), ".env.local")
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const [key, ...rest] = trimmed.split("=")
    const value = rest.join("=").trim()
    if (key && !(key in process.env)) process.env[key] = value
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const round2 = (value) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100

const getLocalDateIso = () => {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

const parseDateArg = () => {
  const arg = process.argv.find((x) => x.startsWith("--date="))
  if (arg) return arg.slice("--date=".length)
  return getLocalDateIso()
}

const formatMoney = (value) => `${round2(value).toFixed(2)} €`

const fetchRowsByOrderIds = async (table, select, orderIds, chunkSize = 200) => {
  const rows = []
  for (let i = 0; i < orderIds.length; i += chunkSize) {
    const chunk = orderIds.slice(i, i + chunkSize)
    if (chunk.length === 0) continue
    const { data, error } = await supabase.from(table).select(select).in("order_id", chunk)
    if (error) throw error
    rows.push(...(data || []))
  }
  return rows
}

async function main() {
  const date = parseDateArg()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Invalid date format: "${date}" (expected YYYY-MM-DD)`)
    process.exit(1)
  }

  const dayStart = `${date}T00:00:00`
  const dayEnd = `${date}T23:59:59`

  const { data: dailySalesData, error: dailySalesError } = await supabase
    .from("daily_sales")
    .select("order_id, total_amount, complimentary_amount, complimentary_count, created_at")
    .eq("date", date)

  if (dailySalesError) throw dailySalesError
  const dailySales = dailySalesData || []

  const { data: legacyOrdersData, error: legacyOrdersError } = await supabase
    .from("orders")
    .select("id, created_at, closed_at, status")
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd)
    .eq("status", "closed")

  if (legacyOrdersError) throw legacyOrdersError
  const legacyOrders = legacyOrdersData || []

  const saleByOrderId = new Map(
    dailySales
      .map((sale) => [String(sale.order_id || ""), sale])
      .filter(([orderId]) => orderId.length > 0),
  )

  const orderIdsFromSales = Array.from(saleByOrderId.keys())

  const orderItems = orderIdsFromSales.length
    ? await fetchRowsByOrderIds(
        "order_items",
        "order_id, quantity, price, is_complimentary",
        orderIdsFromSales,
      )
    : []
  const supplements = orderIdsFromSales.length
    ? await fetchRowsByOrderIds(
        "supplements",
        "order_id, amount, is_complimentary",
        orderIdsFromSales,
      )
    : []

  const overviewTotal = round2(
    dailySales.reduce((sum, sale) => sum + toNumber(sale.total_amount), 0),
  )

  const summaryCurrentTotal = round2(
    dailySales.reduce((sum, sale) => sum + toNumber(sale.total_amount), 0),
  )

  const summaryLegacyTotal = round2(
    legacyOrders.reduce((sum, order) => {
      const sale = saleByOrderId.get(String(order.id))
      return sum + toNumber(sale?.total_amount)
    }, 0),
  )

  const reconstructedItemsTotal = round2(
    orderItems.reduce((sum, item) => {
      if (item.is_complimentary) return sum
      return sum + toNumber(item.quantity) * toNumber(item.price)
    }, 0),
  )
  const reconstructedSupplementsTotal = round2(
    supplements.reduce((sum, supplement) => {
      if (supplement.is_complimentary) return sum
      return sum + toNumber(supplement.amount)
    }, 0),
  )
  const reconstructedTotal = round2(reconstructedItemsTotal + reconstructedSupplementsTotal)

  const legacyOrderIdSet = new Set(legacyOrders.map((order) => String(order.id)))
  const salesOrderIdSet = new Set(orderIdsFromSales)

  const salesNotInLegacy = orderIdsFromSales.filter((orderId) => !legacyOrderIdSet.has(orderId))
  const legacyNotInSales = legacyOrders
    .map((order) => String(order.id))
    .filter((orderId) => !salesOrderIdSet.has(orderId))

  const lineTotalByOrder = new Map()
  for (const item of orderItems) {
    const orderId = String(item.order_id || "")
    if (!orderId) continue
    if (item.is_complimentary) continue
    lineTotalByOrder.set(orderId, toNumber(lineTotalByOrder.get(orderId)) + toNumber(item.quantity) * toNumber(item.price))
  }
  for (const supplement of supplements) {
    const orderId = String(supplement.order_id || "")
    if (!orderId) continue
    if (supplement.is_complimentary) continue
    lineTotalByOrder.set(orderId, toNumber(lineTotalByOrder.get(orderId)) + toNumber(supplement.amount))
  }

  const orderMismatches = orderIdsFromSales
    .map((orderId) => {
      const sale = saleByOrderId.get(orderId)
      const saleTotal = toNumber(sale?.total_amount)
      const lineTotal = toNumber(lineTotalByOrder.get(orderId))
      const diff = round2(saleTotal - lineTotal)
      return {
        orderId,
        saleTotal: round2(saleTotal),
        lineTotal: round2(lineTotal),
        diff,
      }
    })
    .filter((row) => Math.abs(row.diff) > 0.01)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

  console.log("=== Controle Coherence Rapports ===")
  console.log(`Date: ${date}`)
  console.log("")
  console.log(`Ventes enregistrees (daily_sales): ${dailySales.length}`)
  console.log(`Commandes scope legacy (orders.created_at du jour): ${legacyOrders.length}`)
  console.log("")
  console.log(`CA Vue d'ensemble (daily_sales): ${formatMoney(overviewTotal)}`)
  console.log(`CA Resume service (logique actuelle): ${formatMoney(summaryCurrentTotal)}`)
  console.log(`CA Resume service (ancienne logique): ${formatMoney(summaryLegacyTotal)}`)
  console.log(`CA reconstruit lignes (articles + supplements): ${formatMoney(reconstructedTotal)}`)
  console.log("")
  console.log(`Ecart overview vs resume actuel: ${formatMoney(round2(overviewTotal - summaryCurrentTotal))}`)
  console.log(`Ecart overview vs resume legacy: ${formatMoney(round2(overviewTotal - summaryLegacyTotal))}`)
  console.log(`Ecart overview vs lignes reconstruites: ${formatMoney(round2(overviewTotal - reconstructedTotal))}`)
  console.log("")

  if (salesNotInLegacy.length > 0) {
    console.log(`Orders dans daily_sales mais hors scope legacy: ${salesNotInLegacy.length}`)
    console.log(salesNotInLegacy.slice(0, 20).join(", "))
    console.log("")
  }

  if (legacyNotInSales.length > 0) {
    console.log(`Orders scope legacy sans ligne daily_sales: ${legacyNotInSales.length}`)
    console.log(legacyNotInSales.slice(0, 20).join(", "))
    console.log("")
  }

  if (orderMismatches.length > 0) {
    console.log(`Orders avec ecart total vs lignes: ${orderMismatches.length}`)
    for (const row of orderMismatches.slice(0, 20)) {
      console.log(
        `- ${row.orderId}: daily_sales=${row.saleTotal.toFixed(2)} vs lignes=${row.lineTotal.toFixed(2)} (diff ${row.diff.toFixed(2)})`,
      )
    }
    if (orderMismatches.length > 20) {
      console.log(`... ${orderMismatches.length - 20} autres`)
    }
  } else {
    console.log("Aucun ecart par commande detecte entre daily_sales et total lignes.")
  }
}

main().catch((error) => {
  console.error("Erreur controle coherence:", error)
  process.exit(1)
})
