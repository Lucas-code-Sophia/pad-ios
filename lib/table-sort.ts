import type { Table } from "@/lib/types"

const LOCATION_PRIORITY = ["B", "C", "I"] as const
const LOCATION_LAST = ["T"] as const
const COLLATOR = new Intl.Collator("fr", { numeric: true, sensitivity: "base" })

const extractPrefix = (tableNumber: string): string => {
  const match = String(tableNumber || "").trim().match(/^([A-Za-z]+)/)
  return match?.[1]?.toUpperCase() || ""
}

const extractNumericPart = (tableNumber: string): number => {
  const match = String(tableNumber || "").trim().match(/^[A-Za-z]+(\d+)/)
  if (!match) return Number.POSITIVE_INFINITY
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

const getLocationKey = (table: Table): string => {
  const location = String(table.location || "").toUpperCase()
  if (location) return location
  return extractPrefix(table.table_number)
}

const getLocationRank = (location: string): number => {
  const upper = String(location || "").toUpperCase()

  const priorityIndex = LOCATION_PRIORITY.indexOf(upper as (typeof LOCATION_PRIORITY)[number])
  if (priorityIndex >= 0) return priorityIndex

  const lastIndex = LOCATION_LAST.indexOf(upper as (typeof LOCATION_LAST)[number])
  if (lastIndex >= 0) return 1000 + lastIndex

  if (!upper) return 900
  return 100 + upper.charCodeAt(0)
}

export const compareTablesForDisplay = (a: Table, b: Table): number => {
  const locationA = getLocationKey(a)
  const locationB = getLocationKey(b)

  const rankDiff = getLocationRank(locationA) - getLocationRank(locationB)
  if (rankDiff !== 0) return rankDiff

  if (locationA !== locationB) {
    const locCmp = COLLATOR.compare(locationA, locationB)
    if (locCmp !== 0) return locCmp
  }

  const numA = extractNumericPart(a.table_number)
  const numB = extractNumericPart(b.table_number)
  if (numA !== numB) return numA - numB

  return COLLATOR.compare(a.table_number, b.table_number)
}

export const sortTablesForDisplay = (tables: Table[]): Table[] => {
  return [...tables].sort(compareTablesForDisplay)
}

