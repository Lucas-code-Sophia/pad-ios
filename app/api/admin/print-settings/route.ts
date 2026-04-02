import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const normalizePrintMode = (value: unknown): "server" | "direct_epos" | "escpos_tcp" => {
  if (value === "direct_epos") return "direct_epos"
  if (value === "escpos_tcp") return "escpos_tcp"
  if (value === "airprint") return "direct_epos"
  return "server"
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("settings")
      .select("setting_value")
      .eq("setting_key", "printer_ips")
      .single()

    if (error && error.code !== "PGRST116") throw error

    const rawValue = (data?.setting_value as any) || {}
    const value = {
      kitchen_ip: rawValue.kitchen_ip || "",
      bar_ip: rawValue.bar_ip || "",
      caisse_ip: rawValue.caisse_ip || "",
      print_mode: normalizePrintMode(rawValue.print_mode),
    }
    return NextResponse.json(value)
  } catch (error) {
    console.error("[v0] Error fetching print settings:", error)
    return NextResponse.json({ error: "Failed to fetch print settings" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { kitchen_ip, bar_ip, caisse_ip, print_mode } = body || {}

    const supabase = await createClient()

    const { error } = await supabase
      .from("settings")
      .upsert(
        {
          setting_key: "printer_ips",
          setting_value: {
            kitchen_ip: kitchen_ip || "",
            bar_ip: bar_ip || "",
            caisse_ip: caisse_ip || "",
            print_mode: normalizePrintMode(print_mode),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" }
      )

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error saving print settings:", error)
    return NextResponse.json({ error: "Failed to save print settings" }, { status: 500 })
  }
}
