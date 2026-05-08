import { type NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient, isScoreExactTableMissingError } from "@/lib/world-cup-score-exact"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const status = String(body?.status || "").trim()

    if (status !== "open" && status !== "closed") {
      return NextResponse.json({ error: "Statut invalide (open|closed)" }, { status: 400 })
    }

    const supabase = createAdminSupabaseClient()

    const { data: currentMatch, error: currentMatchError } = await supabase
      .from("world_cup_score_exact_matches")
      .select("id, status")
      .eq("id", id)
      .maybeSingle()

    if (currentMatchError) throw currentMatchError
    if (!currentMatch) {
      return NextResponse.json({ error: "Match introuvable" }, { status: 404 })
    }

    if (currentMatch.status === "resolved") {
      return NextResponse.json(
        { error: "Impossible de rouvrir/fermer un match déjà résolu via cet endpoint" },
        { status: 409 },
      )
    }

    const { data, error } = await supabase
      .from("world_cup_score_exact_matches")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, status, updated_at")
      .single()

    if (error) throw error

    return NextResponse.json({
      id: data.id,
      status: data.status,
      updatedAt: data.updated_at,
    })
  } catch (error: any) {
    console.error("[v0] Error updating score exact match status:", error)

    if (isScoreExactTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Coupe du monde Score Exact n'est pas encore activé en base. Lancez la migration scripts/021_add_world_cup_score_exact.sql puis scripts/022_add_world_cup_score_exact_slug.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to update match status" }, { status: 500 })
  }
}
