export const WINE_GLASS_FACTOR = 0.2

const STOP_WORDS = new Set([
  "vin",
  "vins",
  "verre",
  "verres",
  "bouteille",
  "bouteilles",
  "au",
  "aux",
  "a",
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "un",
  "une",
  "cl",
  "ml",
  "l",
])

const normalizeForSearch = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const tokenizeWineName = (value: string) =>
  normalizeForSearch(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))

const extractCategoryName = (row: any) => {
  const category = row?.menu_categories
  if (!category) return null
  if (Array.isArray(category)) {
    return typeof category[0]?.name === "string" ? category[0].name : null
  }
  return typeof category?.name === "string" ? category.name : null
}

export const isWineInventoryTableMissingError = (error: any) => {
  const code = String(error?.code || "")
  const message = String(error?.message || "").toLowerCase()
  return (
    code === "42P01" ||
    (message.includes("relation") && message.includes("wine_inventory")) ||
    message.includes("wine_inventory")
  )
}

export const isWineBottleCategoryName = (categoryName: string | null | undefined) => {
  const normalized = normalizeForSearch(categoryName || "")
  if (!normalized) return false
  return normalized.includes("vin") && normalized.includes("bouteille")
}

export const isWineGlassCategoryName = (categoryName: string | null | undefined) => {
  const normalized = normalizeForSearch(categoryName || "")
  if (!normalized) return false
  return normalized.includes("vin") && normalized.includes("verre")
}

export const isWineGlassCandidate = (categoryName: string | null | undefined, itemName: string | null | undefined) => {
  if (isWineGlassCategoryName(categoryName)) return true

  const normalizedName = normalizeForSearch(itemName || "")
  if (!normalizedName) return false
  return normalizedName.includes("vin") && normalizedName.includes("verre")
}

export const isMenuItemActive = (status: unknown) => status === null || status === undefined || status === true

export const scoreWineNameSimilarity = (glassName: string, bottleName: string) => {
  const normalizedGlass = normalizeForSearch(glassName)
  const normalizedBottle = normalizeForSearch(bottleName)

  if (!normalizedGlass || !normalizedBottle) return 0
  if (normalizedGlass === normalizedBottle) return 1

  const strippedGlass = normalizedGlass.replace(/\bverre?s?\b/g, "").trim()
  const strippedBottle = normalizedBottle.replace(/\bbouteille?s?\b/g, "").trim()

  if (strippedGlass && strippedBottle && strippedGlass === strippedBottle) {
    return 0.95
  }

  if (strippedGlass && strippedBottle) {
    if (strippedGlass.includes(strippedBottle) || strippedBottle.includes(strippedGlass)) {
      return 0.9
    }
  }

  const glassTokens = tokenizeWineName(glassName)
  const bottleTokens = tokenizeWineName(bottleName)

  if (glassTokens.length === 0 || bottleTokens.length === 0) return 0

  const bottleTokenSet = new Set(bottleTokens)
  const overlap = glassTokens.filter((token) => bottleTokenSet.has(token)).length
  if (overlap === 0) return 0

  return overlap / Math.min(glassTokens.length, bottleTokens.length)
}

export const parseNonNegativeNumber = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === "") return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export const buildGaugeStatus = (currentBottles: number, redThreshold: number, yellowThreshold: number, isActive: boolean) => {
  if (!isActive) return "inactive"
  if (currentBottles < redThreshold) return "red"
  if (currentBottles < yellowThreshold) return "yellow"
  return "green"
}

export const bootstrapWineInventory = async (supabase: any, userId?: string | null) => {
  const now = new Date().toISOString()

  const { data: categories, error: categoriesError } = await supabase
    .from("menu_categories")
    .select("id, name")

  if (categoriesError) throw categoriesError

  const bottleCategoryIds = (categories || [])
    .filter((category: any) => isWineBottleCategoryName(category?.name))
    .map((category: any) => category.id)

  if (bottleCategoryIds.length === 0) {
    return {
      createdItemsCount: 0,
      proposedLinksCount: 0,
      unmatchedGlassCount: 0,
      bottleItemsCount: 0,
      message: "Catégorie 'Vins Bouteille' introuvable.",
    }
  }

  const { data: bottleItems, error: bottleItemsError } = await supabase
    .from("menu_items")
    .select("id, name, category_id, status")
    .in("category_id", bottleCategoryIds)

  if (bottleItemsError) throw bottleItemsError

  const bottleRows = (bottleItems || []).filter((item: any) => isMenuItemActive(item?.status))
  if (bottleRows.length === 0) {
    return {
      createdItemsCount: 0,
      proposedLinksCount: 0,
      unmatchedGlassCount: 0,
      bottleItemsCount: 0,
      message: "Aucun article trouvé dans la catégorie 'Vins Bouteille'.",
    }
  }

  const { error: settingsUpsertError } = await supabase
    .from("wine_inventory_settings")
    .upsert({ id: 1 }, { onConflict: "id" })
  if (settingsUpsertError) throw settingsUpsertError

  const { data: existingInventoryRows, error: existingInventoryError } = await supabase
    .from("wine_inventory_items")
    .select("id, bottle_menu_item_id")

  if (existingInventoryError) throw existingInventoryError

  const existingBottleIds = new Set((existingInventoryRows || []).map((row: any) => row.bottle_menu_item_id))
  const missingBottleRows = bottleRows.filter((item: any) => !existingBottleIds.has(item.id))

  if (missingBottleRows.length > 0) {
    const insertPayload = missingBottleRows.map((item: any) => ({
      bottle_menu_item_id: item.id,
      current_bottles: 0,
      is_active: true,
      created_at: now,
      updated_at: now,
      created_by: userId || null,
      updated_by: userId || null,
    }))

    const { error: insertMissingError } = await supabase.from("wine_inventory_items").insert(insertPayload)

    if (insertMissingError && String(insertMissingError?.code || "") !== "23505") {
      throw insertMissingError
    }
  }

  const { data: trackedRows, error: trackedRowsError } = await supabase
    .from("wine_inventory_items")
    .select("id, bottle_menu_item_id")

  if (trackedRowsError) throw trackedRowsError

  const trackedByBottleId = new Map((trackedRows || []).map((row: any) => [row.bottle_menu_item_id, row.id]))

  const { data: drinkRows, error: drinkRowsError } = await supabase
    .from("menu_items")
    .select(
      `
      id,
      name,
      status,
      category_id,
      menu_categories!menu_items_category_id_fkey (
        name
      )
    `,
    )
    .eq("type", "drink")

  if (drinkRowsError) throw drinkRowsError

  const bottleIdSet = new Set(bottleRows.map((item: any) => item.id))
  const glassCandidates = (drinkRows || []).filter((item: any) => {
    if (bottleIdSet.has(item.id)) return false
    if (!isMenuItemActive(item?.status)) return false
    return isWineGlassCandidate(extractCategoryName(item), item?.name)
  })

  const { data: existingLinks, error: existingLinksError } = await supabase
    .from("wine_inventory_glass_links")
    .select("glass_menu_item_id")

  if (existingLinksError) throw existingLinksError

  const existingGlassIds = new Set((existingLinks || []).map((row: any) => row.glass_menu_item_id))

  const proposedLinks: any[] = []
  let unmatchedGlassCount = 0

  for (const glassItem of glassCandidates) {
    if (existingGlassIds.has(glassItem.id)) continue

    let bestMatch: { bottleId: string; score: number } | null = null

    for (const bottleItem of bottleRows) {
      const score = scoreWineNameSimilarity(glassItem.name, bottleItem.name)
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { bottleId: bottleItem.id, score }
      }
    }

    if (!bestMatch || bestMatch.score < 0.55) {
      unmatchedGlassCount += 1
      continue
    }

    const wineInventoryItemId = trackedByBottleId.get(bestMatch.bottleId)
    if (!wineInventoryItemId) {
      unmatchedGlassCount += 1
      continue
    }

    proposedLinks.push({
      wine_inventory_item_id: wineInventoryItemId,
      glass_menu_item_id: glassItem.id,
      factor: WINE_GLASS_FACTOR,
      is_active: true,
      created_at: now,
      updated_at: now,
      created_by: userId || null,
      updated_by: userId || null,
    })
  }

  if (proposedLinks.length > 0) {
    const { error: insertLinksError } = await supabase.from("wine_inventory_glass_links").insert(proposedLinks)
    if (insertLinksError && String(insertLinksError?.code || "") !== "23505") {
      throw insertLinksError
    }
  }

  return {
    createdItemsCount: missingBottleRows.length,
    proposedLinksCount: proposedLinks.length,
    unmatchedGlassCount,
    bottleItemsCount: bottleRows.length,
    message: null,
  }
}
