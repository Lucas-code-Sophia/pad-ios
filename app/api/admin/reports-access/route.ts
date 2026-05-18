import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const SETTINGS_KEY = "advanced_reports_access"

const normalizeAccessCode = (value: unknown) => {
  return String(value || "").trim()
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("settings")
      .select("setting_value")
      .eq("setting_key", SETTINGS_KEY)
      .single()

    if (error && error.code !== "PGRST116") throw error

    const rawValue = (data?.setting_value as any) || {}
    return NextResponse.json({
      access_code: normalizeAccessCode(rawValue.access_code),
    })
  } catch (error) {
    console.error("[v0] Error fetching reports access settings:", error)
    return NextResponse.json({ error: "Failed to fetch reports access settings" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const accessCode = normalizeAccessCode(body?.access_code)

    if (accessCode.length > 32) {
      return NextResponse.json({ error: "Le code d'accès doit faire 32 caractères maximum." }, { status: 400 })
    }

    const supabase = await createClient()

    const { error } = await supabase
      .from("settings")
      .upsert(
        {
          setting_key: SETTINGS_KEY,
          setting_value: {
            access_code: accessCode,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" },
      )

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error saving reports access settings:", error)
    return NextResponse.json({ error: "Failed to save reports access settings" }, { status: 500 })
  }
}
