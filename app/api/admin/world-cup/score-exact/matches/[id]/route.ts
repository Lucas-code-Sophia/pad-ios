import { type NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient, isScoreExactTableMissingError } from "@/lib/world-cup-score-exact"

type MatchRow = {
  id: string
  home_team: string
  away_team: string
  public_slug: string
  public_code: string
  status: "open" | "closed" | "resolved"
  final_home_score: number | null
  final_away_score: number | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type PredictionRow = {
  id: string
  match_id: string
  first_name: string
  last_name: string
  participant_key: string
  predicted_home_score: number
  predicted_away_score: number
  created_at: string
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminSupabaseClient()

    const { data: match, error: matchError } = await supabase
      .from("world_cup_score_exact_matches")
      .select("id, home_team, away_team, public_slug, public_code, status, final_home_score, final_away_score, created_by, created_at, updated_at")
      .eq("id", id)
      .maybeSingle()

    if (matchError) throw matchError
    if (!match) {
      return NextResponse.json({ error: "Match introuvable" }, { status: 404 })
    }

    const { data: predictions, error: predictionsError } = await supabase
      .from("world_cup_score_exact_predictions")
      .select("id, match_id, first_name, last_name, participant_key, predicted_home_score, predicted_away_score, created_at")
      .eq("match_id", id)
      .order("created_at", { ascending: true })

    if (predictionsError) throw predictionsError

    const matchRow = match as MatchRow
    const isResolved =
      matchRow.status === "resolved" && matchRow.final_home_score !== null && matchRow.final_away_score !== null

    const predictionRows = (predictions || []) as PredictionRow[]

    const predictionPayload = predictionRows.map((prediction) => {
      const isWinner =
        isResolved &&
        Number(prediction.predicted_home_score) === Number(matchRow.final_home_score) &&
        Number(prediction.predicted_away_score) === Number(matchRow.final_away_score)

      return {
        id: prediction.id,
        matchId: prediction.match_id,
        firstName: prediction.first_name,
        lastName: prediction.last_name,
        participantKey: prediction.participant_key,
        predictedHomeScore: Number(prediction.predicted_home_score),
        predictedAwayScore: Number(prediction.predicted_away_score),
        createdAt: prediction.created_at,
        isWinner,
      }
    })

    const winners = predictionPayload.filter((prediction) => prediction.isWinner)

    return NextResponse.json({
      match: {
        id: matchRow.id,
        homeTeam: matchRow.home_team,
        awayTeam: matchRow.away_team,
        matchSlug: matchRow.public_slug,
        publicCode: matchRow.public_code,
        status: matchRow.status,
        finalHomeScore: matchRow.final_home_score,
        finalAwayScore: matchRow.final_away_score,
        createdBy: matchRow.created_by,
        createdAt: matchRow.created_at,
        updatedAt: matchRow.updated_at,
      },
      predictions: predictionPayload,
      winners,
    })
  } catch (error: any) {
    console.error("[v0] Error fetching score exact match detail:", error)

    if (isScoreExactTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Coupe du monde Score Exact n'est pas encore activé en base. Lancez la migration scripts/021_add_world_cup_score_exact.sql puis scripts/022_add_world_cup_score_exact_slug.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to fetch match detail" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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

    const { error: deleteError } = await supabase.from("world_cup_score_exact_matches").delete().eq("id", id)
    if (deleteError) throw deleteError

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[v0] Error deleting score exact match:", error)

    if (isScoreExactTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Coupe du monde Score Exact n'est pas encore activé en base. Lancez la migration scripts/021_add_world_cup_score_exact.sql puis scripts/022_add_world_cup_score_exact_slug.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to delete match" }, { status: 500 })
  }
}
