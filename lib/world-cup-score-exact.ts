import { createClient as createSupabaseClient } from "@supabase/supabase-js"

export type ScoreExactMatchStatus = "open" | "closed" | "resolved"

export const SCORE_EXACT_MATCH_STATUSES: ScoreExactMatchStatus[] = ["open", "closed", "resolved"]

export const normalizeNamePart = (value: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")

export const buildParticipantKey = (firstName: string, lastName: string) => {
  const first = normalizeNamePart(firstName)
  const last = normalizeNamePart(lastName)
  return `${first}|${last}`
}

export const parseNonNegativeInteger = (value: unknown) => {
  const normalized = String(value ?? "").trim()
  if (!/^\d+$/.test(normalized)) return null

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

const normalizeForSlug = (value: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")

export const buildMatchBaseSlug = (homeTeam: string, awayTeam: string) => {
  const combined = `${homeTeam} ${awayTeam}`.trim()
  const normalized = normalizeForSlug(combined)
  return normalized || "match"
}

export const normalizeMatchSlug = (value: string) => {
  const normalized = normalizeForSlug(value)
  return normalized || ""
}

const PUBLIC_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export const generatePublicCode = (length = 8) => {
  let result = ""
  const size = Math.max(6, length)

  for (let i = 0; i < size; i += 1) {
    const index = Math.floor(Math.random() * PUBLIC_CODE_ALPHABET.length)
    result += PUBLIC_CODE_ALPHABET[index]
  }

  return result
}

export const createAdminSupabaseClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase env NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  return createSupabaseClient(url, serviceKey)
}

export const isScoreExactTableMissingError = (error: any) => {
  const message = String(error?.message || "").toLowerCase()
  return (
    message.includes("world_cup_score_exact_matches") ||
    message.includes("world_cup_score_exact_predictions") ||
    message.includes("public_slug") ||
    String(error?.code || "") === "42703" ||
    String(error?.code || "") === "42P01"
  )
}
