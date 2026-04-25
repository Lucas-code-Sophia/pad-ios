import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

const ENV_FILE = path.resolve(process.cwd(), ".env.local")
const BATCH_SIZE = 500
const EXAMPLES_LIMIT = 20

const ALLERGEN_KEYS = [
  "gluten",
  "crustaces",
  "oeufs",
  "poissons",
  "arachides",
  "soja",
  "lait",
  "fruits_a_coque",
  "celeri",
  "moutarde",
  "sesame",
  "lupin",
  "mollusques",
]

const ALLERGEN_KEY_TO_NAME = {
  gluten: "Gluten",
  crustaces: "Crustaces",
  oeufs: "Oeufs",
  poissons: "Poissons",
  arachides: "Arachides",
  soja: "Soja",
  lait: "Lait",
  fruits_a_coque: "Fruits a coque",
  celeri: "Celeri",
  moutarde: "Moutarde",
  sesame: "Sesame",
  lupin: "Lupin",
  mollusques: "Mollusques",
}

const NORMALIZED_ALLERGEN_NAME_TO_KEY = {
  gluten: "gluten",
  crustaces: "crustaces",
  oeufs: "oeufs",
  poissons: "poissons",
  arachides: "arachides",
  soja: "soja",
  lait: "lait",
  "fruits a coque": "fruits_a_coque",
  celeri: "celeri",
  moutarde: "moutarde",
  sesame: "sesame",
  lupin: "lupin",
  mollusques: "mollusques",
}

const RULES = {
  gluten: [/\b(burger|pain|pita|pizza|pates|pate|pasta|sandwich|wrap|biere|pression|ipa|blanche|ale|lager|stout)\b/],
  crustaces: [/\b(crevette|crevettes|gamba|gambas|homard|langoustine|langouste|crabe)\b/],
  oeufs: [/\b(oeuf|oeufs|mayo|mayonnaise|omelette)\b/],
  poissons: [/\b(poisson|saumon|thon|anchois|cabillaud|daurade|sardine|truite|maquereau)\b/],
  arachides: [/\b(arachide|arachides|cacahuete|cacahuetes|peanut|satay)\b/],
  soja: [/\b(soja|soy)\b/],
  lait: [/\b(lait|creme|beurre|fromage|mozzarella|parmesan|burrata|cheddar|yaourt|tiramisu|latte|cappuccino)\b/],
  fruits_a_coque: [/\b(noix|noisette|amande|pistache|cajou|pecan|macadamia|praline)\b/],
  celeri: [/\b(celeri)\b/],
  moutarde: [/\b(moutarde)\b/],
  sesame: [/\b(sesame|tahini)\b/],
  lupin: [/\b(lupin)\b/],
  mollusques: [/\b(huitre|huitres|moule|moules|calamar|calamars|encornet|encornets|poulpe|seiche|coquillage|coquillages)\b/],
}

const BEER_CATEGORY_NAMES = new Set(["bieres"])
const MILK_FALSE_POSITIVE_PHRASES = ["the glace", "ice tea", "eau glacee"]

const normalizeText = (value) =>
  String(value || "")
    .replace(/[œŒ]/g, "oe")
    .replace(/[æÆ]/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, "utf8")
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#") || !line.includes("=")) continue
    const index = line.indexOf("=")
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && !(key in process.env)) process.env[key] = value
  }
}

const fetchAllRows = async (supabase, table, select, orderColumn) => {
  const rows = []
  let offset = 0
  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + BATCH_SIZE - 1)
    if (orderColumn) {
      query = query.order(orderColumn, { ascending: true })
    }
    const { data, error } = await query
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }
  return rows
}

const countDuplicatePairs = (links) => {
  const seen = new Set()
  let duplicates = 0
  for (const link of links) {
    const pair = `${link.menu_item_id}::${link.allergen_id}`
    if (seen.has(pair)) duplicates += 1
    else seen.add(pair)
  }
  return duplicates
}

const inferAllergenKeys = ({ name, details, categoryName }) => {
  const text = normalizeText(`${name || ""} ${details || ""}`)
  const normalizedCategoryName = normalizeText(categoryName || "")
  const keys = new Set()

  for (const key of ALLERGEN_KEYS) {
    const regexes = RULES[key] || []
    if (regexes.some((regex) => regex.test(text))) {
      keys.add(key)
    }
  }

  if (BEER_CATEGORY_NAMES.has(normalizedCategoryName)) {
    keys.add("gluten")
  }

  if (MILK_FALSE_POSITIVE_PHRASES.some((phrase) => text.includes(phrase))) {
    keys.delete("lait")
  }

  return keys
}

const assertContains = (set, expected, label) => {
  if (!set.has(expected)) {
    throw new Error(`Self-test failed: "${label}" should include "${expected}"`)
  }
}

const assertNotContains = (set, unexpected, label) => {
  if (set.has(unexpected)) {
    throw new Error(`Self-test failed: "${label}" should not include "${unexpected}"`)
  }
}

const runSelfTests = () => {
  const cases = [
    {
      label: "Tartare de saumon",
      input: { name: "Tartare de saumon", details: "", categoryName: "" },
      mustContain: ["poissons"],
    },
    {
      label: "Bud pression 50cl",
      input: { name: "Bud pression 50cl", details: "", categoryName: "" },
      mustContain: ["gluten"],
    },
    {
      label: "Cafe latte",
      input: { name: "Cafe latte", details: "", categoryName: "" },
      mustContain: ["lait"],
    },
    {
      label: "The glace maison",
      input: { name: "The glace maison", details: "", categoryName: "" },
      mustNotContain: ["lait"],
    },
    {
      label: "Category fallback bieres",
      input: { name: "Inconnu", details: "", categoryName: "Bieres" },
      mustContain: ["gluten"],
    },
  ]

  for (const testCase of cases) {
    const inferred = inferAllergenKeys(testCase.input)
    for (const key of testCase.mustContain || []) {
      assertContains(inferred, key, testCase.label)
    }
    for (const key of testCase.mustNotContain || []) {
      assertNotContains(inferred, key, testCase.label)
    }
  }
}

const printTopAllergens = (newRows, allergenIdToDisplayName) => {
  const countByName = new Map()
  for (const row of newRows) {
    const name = allergenIdToDisplayName.get(row.allergen_id) || row.allergen_id
    countByName.set(name, (countByName.get(name) || 0) + 1)
  }
  const entries = [...countByName.entries()].sort((a, b) => b[1] - a[1])
  if (entries.length === 0) {
    console.log("Top allergenes affectes: aucun")
    return
  }
  console.log(
    `Top allergenes affectes: ${entries
      .map(([name, count]) => `${name}:${count}`)
      .join(" | ")}`,
  )
}

const printExamples = (itemNameById, newRows, allergenIdToDisplayName) => {
  const byItem = new Map()
  for (const row of newRows) {
    const list = byItem.get(row.menu_item_id) || []
    list.push(allergenIdToDisplayName.get(row.allergen_id) || row.allergen_id)
    byItem.set(row.menu_item_id, list)
  }

  const examples = [...byItem.entries()]
    .map(([menuItemId, allergenNames]) => ({
      item: itemNameById.get(menuItemId) || menuItemId,
      allergenes: [...new Set(allergenNames)].sort((a, b) => a.localeCompare(b, "fr")),
    }))
    .sort((a, b) => a.item.localeCompare(b.item, "fr"))
    .slice(0, EXAMPLES_LIMIT)

  if (examples.length === 0) {
    console.log("Exemples (20 max): aucun")
    return
  }

  console.log("Exemples (20 max):")
  for (const example of examples) {
    console.log(`- ${example.item} => ${example.allergenes.join(", ")}`)
  }
}

async function main() {
  loadEnvFile(ENV_FILE)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing env vars NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY")
  }

  runSelfTests()
  console.log("Self-tests inference: OK")

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const [allergens, menuItems, categories, linksBefore] = await Promise.all([
    fetchAllRows(supabase, "allergens", "id,name,emoji,sort_order", "sort_order"),
    fetchAllRows(supabase, "menu_items", "id,name,details,category_id", "name"),
    fetchAllRows(supabase, "menu_categories", "id,name", "name"),
    fetchAllRows(supabase, "menu_item_allergens", "menu_item_id,allergen_id,created_at", "created_at"),
  ])

  const allergenKeyToId = new Map()
  const allergenIdToDisplayName = new Map()
  for (const allergen of allergens) {
    const normalizedName = normalizeText(allergen.name)
    const key = NORMALIZED_ALLERGEN_NAME_TO_KEY[normalizedName]
    if (!key) continue
    allergenKeyToId.set(key, allergen.id)
    const display = `${allergen.emoji || ""}${allergen.name}`.trim()
    allergenIdToDisplayName.set(allergen.id, display || allergen.name)
  }

  const missingAllergenKeys = ALLERGEN_KEYS.filter((key) => !allergenKeyToId.has(key))
  if (missingAllergenKeys.length > 0) {
    throw new Error(`Missing allergen rows in DB for keys: ${missingAllergenKeys.join(", ")}`)
  }

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]))
  const itemNameById = new Map(menuItems.map((item) => [item.id, item.name]))

  const existingAllergensByItem = new Map()
  const existingPairs = new Set()
  for (const link of linksBefore) {
    const pair = `${link.menu_item_id}::${link.allergen_id}`
    existingPairs.add(pair)
    const set = existingAllergensByItem.get(link.menu_item_id) || new Set()
    set.add(link.allergen_id)
    existingAllergensByItem.set(link.menu_item_id, set)
  }

  const itemsWithoutAllergensBefore = menuItems.filter((item) => !(existingAllergensByItem.get(item.id)?.size > 0)).length
  const duplicatePairsBefore = countDuplicatePairs(linksBefore)

  console.log("=== Auto-remplissage allergenes ===")
  console.log(`Items scannes: ${menuItems.length}`)
  console.log(`Items deja renseignes (intouchables): ${menuItems.length - itemsWithoutAllergensBefore}`)
  console.log(`Items sans allergenes avant: ${itemsWithoutAllergensBefore}`)
  console.log(`Liens existants avant: ${linksBefore.length}`)
  console.log(`Doublons de paires avant: ${duplicatePairsBefore}`)

  const rowsToInsert = []
  const stagedPairs = new Set()
  for (const item of menuItems) {
    const hasExisting = existingAllergensByItem.get(item.id)?.size > 0
    if (hasExisting) continue

    const inferredKeys = inferAllergenKeys({
      name: item.name,
      details: item.details,
      categoryName: categoryNameById.get(item.category_id) || "",
    })

    if (inferredKeys.size === 0) continue

    for (const key of inferredKeys) {
      const allergenId = allergenKeyToId.get(key)
      if (!allergenId) continue
      const pair = `${item.id}::${allergenId}`
      if (existingPairs.has(pair) || stagedPairs.has(pair)) continue
      rowsToInsert.push({ menu_item_id: item.id, allergen_id: allergenId })
      stagedPairs.add(pair)
    }
  }

  if (rowsToInsert.length === 0) {
    console.log("Aucun nouveau lien a inserer. Base deja a jour pour cette logique.")
    return
  }

  for (let index = 0; index < rowsToInsert.length; index += BATCH_SIZE) {
    const chunk = rowsToInsert.slice(index, index + BATCH_SIZE)
    const { error } = await supabase.from("menu_item_allergens").insert(chunk)
    if (error) throw error
  }

  const linksAfter = await fetchAllRows(supabase, "menu_item_allergens", "menu_item_id,allergen_id,created_at", "created_at")

  const allergensByItemAfter = new Map()
  for (const link of linksAfter) {
    const set = allergensByItemAfter.get(link.menu_item_id) || new Set()
    set.add(link.allergen_id)
    allergensByItemAfter.set(link.menu_item_id, set)
  }

  const itemsWithoutAllergensAfter = menuItems.filter((item) => !(allergensByItemAfter.get(item.id)?.size > 0)).length
  const duplicatePairsAfter = countDuplicatePairs(linksAfter)
  const enrichedItemsCount = new Set(rowsToInsert.map((row) => row.menu_item_id)).size

  console.log(`Items enrichis: ${enrichedItemsCount}`)
  console.log(`Nouveaux liens crees: ${rowsToInsert.length}`)
  console.log(`Items sans allergenes apres: ${itemsWithoutAllergensAfter}`)
  console.log(`Liens totaux apres: ${linksAfter.length}`)
  console.log(`Doublons de paires apres: ${duplicatePairsAfter}`)

  printTopAllergens(rowsToInsert, allergenIdToDisplayName)
  printExamples(itemNameById, rowsToInsert, allergenIdToDisplayName)
}

main().catch((error) => {
  console.error("Erreur auto-remplissage allergenes:", error)
  process.exit(1)
})
