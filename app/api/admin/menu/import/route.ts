import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { normalizeMenuButtonColor } from "@/lib/menu-colors"
import * as XLSX from "xlsx"

type MenuImportColumn =
  | "name"
  | "price"
  | "taxRate"
  | "category"
  | "routing"
  | "buttonColor"
  | "status"
  | "details"
  | "outOfStock"
  | "isSuggestion"

const HEADER_ALIASES: Record<MenuImportColumn, string[]> = {
  name: ["name", "nom", "intitule", "intitulé", "article"],
  price: ["price", "prix", "montant", "tarif"],
  taxRate: ["taxrate", "tax_rate", "tax", "vat", "tva"],
  category: ["category", "categorie", "catégorie"],
  routing: ["routing", "impression", "station", "destination"],
  buttonColor: ["buttoncolor", "button_color", "color", "couleur", "couleur_bouton"],
  status: ["status", "visible", "actif", "active"],
  details: ["details", "detail", "détails", "description", "caracteristiques", "caractéristiques"],
  outOfStock: ["out_of_stock", "rupture", "en_rupture", "stock_out", "stockout"],
  isSuggestion: ["is_piatto_del_giorno", "suggestion", "suggestion_chef", "chef_special", "special"],
}

const normalizeLabel = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")

const readCell = (
  row: unknown[],
  mappedHeaders: Partial<Record<MenuImportColumn, number>>,
  key: MenuImportColumn,
  legacyIndex: number,
) => {
  const mappedIndex = mappedHeaders[key]
  const value = row[(mappedIndex ?? legacyIndex)] ?? ""
  return String(value).trim()
}

const parseBooleanField = (rawValue: string | undefined, defaultValue: boolean) => {
  if (!rawValue) return defaultValue
  const normalized = rawValue.trim().toLowerCase()
  if (!normalized) return defaultValue
  if (["false", "0", "no", "non"].includes(normalized)) return false
  if (["true", "1", "yes", "oui"].includes(normalized)) return true
  return defaultValue
}

const parseStatus = (rawStatus?: string) => parseBooleanField(rawStatus, true)
const parseOutOfStock = (rawOutOfStock?: string) => parseBooleanField(rawOutOfStock, false)
const parseSuggestion = (rawSuggestion?: string) => parseBooleanField(rawSuggestion, false)

const parsePrice = (rawValue: string) => {
  const parsed = Number.parseFloat(rawValue.replace(",", "."))
  return Number.isFinite(parsed) ? parsed : null
}

const parseRouting = (rawValue: string): "kitchen" | "bar" | null => {
  const normalized = rawValue.trim().toLowerCase()
  if (!normalized) return null

  if (["bar", "drink", "boisson", "boissons"].includes(normalized)) return "bar"
  if (["kitchen", "cuisine", "food", "plat", "plats"].includes(normalized)) return "kitchen"
  return null
}

const countDelimiterOutsideQuotes = (value: string, delimiter: string) => {
  let count = 0
  let inQuotes = false

  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '"') {
      if (inQuotes && value[i + 1] === '"') {
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      count += 1
    }
  }

  return count
}

const detectCsvDelimiter = (csvText: string) => {
  const firstLine = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0) ?? ""

  const semicolonCount = countDelimiterOutsideQuotes(firstLine, ";")
  const commaCount = countDelimiterOutsideQuotes(firstLine, ",")
  return semicolonCount >= commaCount ? ";" : ","
}

const parseCsvRows = (csvText: string): string[][] => {
  const text = csvText.replace(/^\uFEFF/, "")
  const delimiter = detectCsvDelimiter(text)
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentField += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      currentRow.push(currentField)
      currentField = ""
      continue
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1
      }
      currentRow.push(currentField)
      if (currentRow.some((cell) => cell.trim() !== "")) {
        rows.push(currentRow)
      }
      currentRow = []
      currentField = ""
      continue
    }

    currentField += char
  }

  currentRow.push(currentField)
  if (currentRow.some((cell) => cell.trim() !== "")) {
    rows.push(currentRow)
  }

  return rows
}

const normalizeRows = (rows: unknown[][]) => {
  const hasMultiColumnRows = rows.some((row) => Array.isArray(row) && row.length > 1)
  if (hasMultiColumnRows) return rows

  const semicolonRows = rows.map((row) => {
    const firstCell = String((Array.isArray(row) ? row[0] : row) ?? "")
    return firstCell.split(";").map((cell) => cell.trim())
  })

  const hasSplitColumns = semicolonRows.some((row) => row.length > 1)
  return hasSplitColumns ? semicolonRows : rows
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const lowerFileName = file.name?.toLowerCase() || ""
    const isCsvFile = lowerFileName.endsWith(".csv") || file.type.includes("csv")
    let rows: unknown[][]

    if (isCsvFile) {
      rows = parseCsvRows(await file.text())
    } else {
      const fileBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(fileBuffer, { type: "array" })
      const firstSheetName = workbook.SheetNames[0]

      if (!firstSheetName) {
        return NextResponse.json({ error: "No sheet found in file" }, { status: 400 })
      }

      const firstSheet = workbook.Sheets[firstSheetName]
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
        header: 1,
        blankrows: false,
        defval: "",
      })
      rows = normalizeRows(rawRows as unknown[][])
    }

    if (rows.length === 0) {
      return NextResponse.json({ success: true, imported: 0, skipped: 0 })
    }

    const headerRow = rows[0] || []
    const normalizedHeaders = headerRow.map((cell) => normalizeLabel(cell))
    const allAliases = new Set(Object.values(HEADER_ALIASES).flatMap((aliases) => aliases.map(normalizeLabel)))
    const hasRecognizedHeader = normalizedHeaders.some((header) => allAliases.has(header))
    const dataStartIndex = hasRecognizedHeader ? 1 : 0

    if (rows.length <= dataStartIndex) {
      return NextResponse.json({ success: true, imported: 0, skipped: 0 })
    }

    const mappedHeaders: Partial<Record<MenuImportColumn, number>> = {}

    if (hasRecognizedHeader) {
      for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<[MenuImportColumn, string[]]>) {
        const aliasSet = new Set(aliases.map(normalizeLabel))
        const index = normalizedHeaders.findIndex((header) => aliasSet.has(header))
        if (index >= 0) mappedHeaders[key] = index
      }
    }

    let importedCount = 0
    let skippedCount = 0
    const categoryCache = new Map<string, { id: string }>()

    for (let i = dataStartIndex; i < rows.length; i++) {
      const row = rows[i] || []
      const name = readCell(row, mappedHeaders, "name", 0)
      const price = readCell(row, mappedHeaders, "price", 1)
      const taxRate = readCell(row, mappedHeaders, "taxRate", 2)
      const categoryName = readCell(row, mappedHeaders, "category", 3)
      const routingRaw = readCell(row, mappedHeaders, "routing", 4)
      const buttonColor = readCell(row, mappedHeaders, "buttonColor", 5)
      const status = readCell(row, mappedHeaders, "status", 6)
      const details = readCell(row, mappedHeaders, "details", 7)
      const outOfStock = readCell(row, mappedHeaders, "outOfStock", 8)
      const isSuggestion = readCell(row, mappedHeaders, "isSuggestion", 9)

      const routing = parseRouting(routingRaw)
      const parsedPrice = parsePrice(price)
      const parsedTaxRate = parsePrice(taxRate || "20")

      if (!name || !categoryName || !routing || parsedPrice === null) {
        skippedCount += 1
        continue
      }

      const normalizedCategoryName = categoryName.trim()
      const categoryKey = normalizedCategoryName.toLowerCase()
      let category = categoryCache.get(categoryKey) || null

      if (!category) {
        const { data: existingCategory } = await supabase
          .from("menu_categories")
          .select("id")
          .eq("name", normalizedCategoryName)
          .maybeSingle()

        if (existingCategory) {
          category = existingCategory
        } else {
          const type = routing === "bar" ? "drink" : "food"
          const { data: newCategory, error: categoryInsertError } = await supabase
            .from("menu_categories")
            .insert({ name: normalizedCategoryName, type, sort_order: 0 })
            .select("id")
            .single()

          if (categoryInsertError || !newCategory) {
            console.error("[v0] Error creating category during import:", categoryInsertError)
            skippedCount += 1
            continue
          }

          category = newCategory
        }

        categoryCache.set(categoryKey, category)
      }

      if (category) {
        const newItem: Record<string, any> = {
          category_id: category.id,
          name,
          details: details || null,
          price: parsedPrice,
          tax_rate: parsedTaxRate === null ? 20 : parsedTaxRate,
          type: routing === "bar" ? "drink" : "food",
          routing,
          status: parseStatus(status),
          out_of_stock: parseOutOfStock(outOfStock),
          is_piatto_del_giorno: parseSuggestion(isSuggestion),
        }

        newItem.out_of_stock_date = newItem.out_of_stock ? new Date().toISOString().split("T")[0] : null

        if (buttonColor !== undefined && buttonColor !== "") {
          newItem.button_color = normalizeMenuButtonColor(buttonColor)
        }

        const { error: insertError } = await supabase.from("menu_items").insert(newItem)
        if (insertError) {
          console.error("[v0] Error importing menu item:", insertError)
          skippedCount += 1
          continue
        }
        importedCount += 1
      }
    }

    return NextResponse.json({ success: true, imported: importedCount, skipped: skippedCount })
  } catch (error) {
    console.error("[v0] Error importing menu:", error)
    return NextResponse.json({ error: "Failed to import menu" }, { status: 500 })
  }
}
