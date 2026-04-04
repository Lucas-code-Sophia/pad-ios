type ItemDisplayInfo = {
  displayName: string
  displayNote?: string
}

const normalizeForSearch = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()

const SPIRIT_NOTE_REGEX = /^(gin|whisky|rhum|tequila|vodka)\s*:\s*(.+)$/i
const PRICE_SUFFIX_REGEX = /\s*\((?:\+\s*)?[\d.,]+\s*€\s*\)\s*$/i

const parseNoteLines = (note?: string | null) =>
  String(note || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const shouldDisplaySpiritVariant = (baseName: string) => {
  const normalizedBaseName = normalizeForSearch(baseName)
  if (normalizedBaseName.includes("gin tonic")) return true
  if (normalizedBaseName.includes("whisky")) return true
  if (normalizedBaseName.includes("tequila")) return true
  if (normalizedBaseName.includes("vodka")) return true
  if (normalizedBaseName === "rhum") return true
  if (normalizedBaseName.startsWith("rhum ") && !normalizedBaseName.includes("arrange")) return true
  return false
}

const buildDisplayName = (baseName: string, spiritVariant?: string) => {
  if (!spiritVariant) return baseName
  if (!shouldDisplaySpiritVariant(baseName)) return baseName
  const cleanVariant = spiritVariant.replace(PRICE_SUFFIX_REGEX, "").trim()
  if (!cleanVariant) return baseName
  return `${baseName} - ${cleanVariant}`
}

export const getItemDisplayInfo = (baseName: string, note?: string | null): ItemDisplayInfo => {
  const safeBaseName = String(baseName || "").trim() || "Article"
  const noteLines = parseNoteLines(note)

  let spiritVariant: string | undefined
  const remainingNoteLines: string[] = []

  for (const line of noteLines) {
    const match = line.match(SPIRIT_NOTE_REGEX)
    if (match && !spiritVariant) {
      spiritVariant = match[2]?.trim()
      continue
    }
    remainingNoteLines.push(line)
  }

  const displayName = buildDisplayName(safeBaseName, spiritVariant)
  const displayNote = remainingNoteLines.join("\n").trim() || undefined

  return { displayName, displayNote }
}
