import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isScoreExactTableMissingError, normalizeMatchSlug } from "@/lib/world-cup-score-exact"

export async function GET(_request: Request, { params }: { params: Promise<{ publicCode: string }> }) {
  try {
    const { publicCode } = await params
    const rawIdentifier = decodeURIComponent(String(publicCode || "")).trim()
    const normalizedCode = rawIdentifier.toUpperCase()
    const normalizedSlug = normalizeMatchSlug(rawIdentifier)

    if (!rawIdentifier) {
      return NextResponse.json({ error: "Code public invalide" }, { status: 400 })
    }

    const supabase = await createClient()

    let match: any = null
    let error: any = null

    if (normalizedSlug) {
      const bySlug = await supabase
        .from("world_cup_score_exact_matches")
        .select("id, home_team, away_team, public_slug, public_code, status, final_home_score, final_away_score, created_at")
        .eq("public_slug", normalizedSlug)
        .maybeSingle()

      match = bySlug.data
      error = bySlug.error
    }

    if (!match && !error && normalizedCode) {
      const byCode = await supabase
        .from("world_cup_score_exact_matches")
        .select("id, home_team, away_team, public_slug, public_code, status, final_home_score, final_away_score, created_at")
        .eq("public_code", normalizedCode)
        .maybeSingle()

      match = byCode.data
      error = byCode.error
    }

    if (error) throw error

    if (!match) {
      return NextResponse.json({ error: "Match introuvable" }, { status: 404 })
    }

    return NextResponse.json({
      id: match.id,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      matchSlug: match.public_slug,
      publicCode: match.public_code,
      status: match.status,
      finalHomeScore: match.final_home_score,
      finalAwayScore: match.final_away_score,
      createdAt: match.created_at,
      canPredict: match.status === "open",
    })
  } catch (error: any) {
    console.error("[v0] Error fetching public score exact match:", error)

    if (isScoreExactTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Coupe du monde Score Exact n'est pas encore activé en base. Lancez la migration scripts/021_add_world_cup_score_exact.sql puis scripts/022_add_world_cup_score_exact_slug.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to fetch match" }, { status: 500 })
  }
}
