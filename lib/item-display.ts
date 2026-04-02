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

const GIN_NOTE_REGEX = /^gin\s*:\s*(.+)$/i

const parseNoteLines = (note?: string | null) =>
  String(note || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

const buildDisplayName = (baseName: string, ginVariant?: string) => {
  if (!ginVariant) return baseName
  if (!normalizeForSearch(baseName).includes("gin tonic")) return baseName
  return `${baseName} - ${ginVariant}`
}

export const getItemDisplayInfo = (baseName: string, note?: string | null): ItemDisplayInfo => {
  const safeBaseName = String(baseName || "").trim() || "Article"
  const noteLines = parseNoteLines(note)

  let ginVariant: string | undefined
  const remainingNoteLines: string[] = []

  for (const line of noteLines) {
    const match = line.match(GIN_NOTE_REGEX)
    if (match && !ginVariant) {
      ginVariant = match[1]?.trim()
      continue
    }
    remainingNoteLines.push(line)
  }

  const displayName = buildDisplayName(safeBaseName, ginVariant)
  const displayNote = remainingNoteLines.join("\n").trim() || undefined

  return { displayName, displayNote }
}
