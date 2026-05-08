import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/world-cup-score-exact"

const SETTINGS_KEY = "world_cup_score_exact_settings"

type ScoreExactSettings = {
  public_base_url?: string
}

const normalizePublicBaseUrl = (value: unknown) => {
  const rawInput = String(value || "").trim()
  if (!rawInput) return ""

  const repairedInput = rawInput.replace(/^(https?):\/(?!\/)/i, "$1://")
  const raw = /^https?:\/\//i.test(repairedInput) ? repairedInput : `https://${repairedInput}`

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null

  if (!url.host) return null

  const normalizedPath = url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : ""
  return `${url.protocol}//${url.host}${normalizedPath}`
}

export async function GET() {
  try {
    const supabase = createAdminSupabaseClient()

    const { data, error } = await supabase
      .from("settings")
      .select("setting_value")
      .eq("setting_key", SETTINGS_KEY)
      .maybeSingle()

    if (error) throw error

    const settings = (data?.setting_value as ScoreExactSettings | null) || {}
    const normalizedPublicBaseUrl = normalizePublicBaseUrl(settings.public_base_url || "")
    const normalizedEnvDefault = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || "")

    return NextResponse.json({
      publicBaseUrl:
        normalizedPublicBaseUrl === null
          ? normalizedEnvDefault === null
            ? ""
            : normalizedEnvDefault
          : normalizedPublicBaseUrl || (normalizedEnvDefault === null ? "" : normalizedEnvDefault),
    })
  } catch (error) {
    console.error("[v0] Error fetching world cup score exact settings:", error)
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const normalized = normalizePublicBaseUrl(body?.publicBaseUrl)

    if (normalized === null) {
      return NextResponse.json(
        { error: "URL invalide. Utilisez une URL complète (ex: https://pad-ios.vercel.app)" },
        { status: 400 },
      )
    }

    const supabase = createAdminSupabaseClient()

    const { error } = await supabase
      .from("settings")
      .upsert(
        {
          setting_key: SETTINGS_KEY,
          setting_value: {
            public_base_url: normalized,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" },
      )

    if (error) throw error

    return NextResponse.json({ publicBaseUrl: normalized })
  } catch (error) {
    console.error("[v0] Error saving world cup score exact settings:", error)
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 })
  }
}
