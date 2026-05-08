import { type NextRequest, NextResponse } from "next/server"
import {
  createAdminSupabaseClient,
  isScoreExactTableMissingError,
  parseNonNegativeInteger,
} from "@/lib/world-cup-score-exact"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const finalHomeScore = parseNonNegativeInteger(body?.finalHomeScore)
    const finalAwayScore = parseNonNegativeInteger(body?.finalAwayScore)

    if (finalHomeScore === null || finalAwayScore === null) {
      return NextResponse.json({ error: "Le score final est invalide" }, { status: 400 })
    }

    const supabase = createAdminSupabaseClient()

    const { data: existingMatch, error: existingMatchError } = await supabase
      .from("world_cup_score_exact_matches")
      .select("id")
      .eq("id", id)
      .maybeSingle()

    if (existingMatchError) throw existingMatchError
    if (!existingMatch) {
      return NextResponse.json({ error: "Match introuvable" }, { status: 404 })
    }

    const { data: updatedMatch, error: updateError } = await supabase
      .from("world_cup_score_exact_matches")
      .update({
        final_home_score: finalHomeScore,
        final_away_score: finalAwayScore,
        status: "resolved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, status, final_home_score, final_away_score, updated_at")
      .single()

    if (updateError) throw updateError

    const { data: winners, error: winnersError } = await supabase
      .from("world_cup_score_exact_predictions")
      .select("id, first_name, last_name, predicted_home_score, predicted_away_score, created_at")
      .eq("match_id", id)
      .eq("predicted_home_score", finalHomeScore)
      .eq("predicted_away_score", finalAwayScore)
      .order("created_at", { ascending: true })

    if (winnersError) throw winnersError

    return NextResponse.json({
      match: {
        id: updatedMatch.id,
        status: updatedMatch.status,
        finalHomeScore: Number(updatedMatch.final_home_score),
        finalAwayScore: Number(updatedMatch.final_away_score),
        updatedAt: updatedMatch.updated_at,
      },
      winners: (winners || []).map((winner) => ({
        id: winner.id,
        firstName: winner.first_name,
        lastName: winner.last_name,
        predictedHomeScore: Number(winner.predicted_home_score),
        predictedAwayScore: Number(winner.predicted_away_score),
        createdAt: winner.created_at,
      })),
    })
  } catch (error: any) {
    console.error("[v0] Error saving score exact result:", error)

    if (isScoreExactTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Coupe du monde Score Exact n'est pas encore activé en base. Lancez la migration scripts/021_add_world_cup_score_exact.sql puis scripts/022_add_world_cup_score_exact_slug.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to save match result" }, { status: 500 })
  }
}
