import { NextResponse } from "next/server"
import {
  buildMatchBaseSlug,
  createAdminSupabaseClient,
  generatePublicCode,
  isScoreExactTableMissingError,
} from "@/lib/world-cup-score-exact"

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

const mapMatch = (row: MatchRow, predictionCount = 0, winnerCount = 0) => ({
  id: row.id,
  homeTeam: row.home_team,
  awayTeam: row.away_team,
  matchSlug: row.public_slug,
  publicCode: row.public_code,
  status: row.status,
  finalHomeScore: row.final_home_score,
  finalAwayScore: row.final_away_score,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  predictionCount,
  winnerCount,
})

export async function GET() {
  try {
    const supabase = createAdminSupabaseClient()

    const { data: matches, error: matchesError } = await supabase
      .from("world_cup_score_exact_matches")
      .select("id, home_team, away_team, public_slug, public_code, status, final_home_score, final_away_score, created_by, created_at, updated_at")
      .order("created_at", { ascending: false })

    if (matchesError) throw matchesError

    const matchRows = (matches || []) as MatchRow[]
    if (matchRows.length === 0) return NextResponse.json([])

    const matchIds = matchRows.map((match) => match.id)

    const { data: predictions, error: predictionsError } = await supabase
      .from("world_cup_score_exact_predictions")
      .select("match_id, predicted_home_score, predicted_away_score")
      .in("match_id", matchIds)

    if (predictionsError) throw predictionsError

    const predictionsByMatchId = new Map<string, Array<{ predicted_home_score: number; predicted_away_score: number }>>()

    for (const prediction of predictions || []) {
      const existing = predictionsByMatchId.get(prediction.match_id) || []
      existing.push({
        predicted_home_score: Number(prediction.predicted_home_score),
        predicted_away_score: Number(prediction.predicted_away_score),
      })
      predictionsByMatchId.set(prediction.match_id, existing)
    }

    const payload = matchRows.map((match) => {
      const entries = predictionsByMatchId.get(match.id) || []
      const predictionCount = entries.length

      let winnerCount = 0
      if (match.status === "resolved" && match.final_home_score !== null && match.final_away_score !== null) {
        winnerCount = entries.filter(
          (entry) =>
            entry.predicted_home_score === Number(match.final_home_score) &&
            entry.predicted_away_score === Number(match.final_away_score),
        ).length
      }

      return mapMatch(match, predictionCount, winnerCount)
    })

    return NextResponse.json(payload)
  } catch (error: any) {
    console.error("[v0] Error fetching score exact matches:", error)

    if (isScoreExactTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Coupe du monde Score Exact n'est pas encore activé en base. Lancez la migration scripts/021_add_world_cup_score_exact.sql puis scripts/022_add_world_cup_score_exact_slug.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to fetch score exact matches" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const homeTeam = String(body?.homeTeam || "").trim()
    const awayTeam = String(body?.awayTeam || "").trim()
    const createdBy = typeof body?.createdBy === "string" ? body.createdBy : null

    if (!homeTeam || !awayTeam) {
      return NextResponse.json({ error: "Les équipes domicile et extérieur sont obligatoires" }, { status: 400 })
    }

    if (homeTeam.length > 80 || awayTeam.length > 80) {
      return NextResponse.json({ error: "Le nom des équipes est trop long" }, { status: 400 })
    }

    const supabase = createAdminSupabaseClient()
    const now = new Date().toISOString()
    const baseSlug = buildMatchBaseSlug(homeTeam, awayTeam)

    let createdMatch: MatchRow | null = null

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const publicCode = generatePublicCode(8)
      const publicSlug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`

      const { data, error } = await supabase
        .from("world_cup_score_exact_matches")
        .insert({
          home_team: homeTeam,
          away_team: awayTeam,
          public_slug: publicSlug,
          public_code: publicCode,
          status: "open",
          created_by: createdBy,
          created_at: now,
          updated_at: now,
        })
        .select("id, home_team, away_team, public_slug, public_code, status, final_home_score, final_away_score, created_by, created_at, updated_at")
        .single()

      if (!error && data) {
        createdMatch = data as MatchRow
        break
      }

      if (String(error?.code || "") === "23505") {
        continue
      }

      throw error
    }

    if (!createdMatch) {
      return NextResponse.json({ error: "Impossible de générer un code public unique" }, { status: 500 })
    }

    return NextResponse.json(mapMatch(createdMatch, 0, 0), { status: 201 })
  } catch (error: any) {
    console.error("[v0] Error creating score exact match:", error)

    if (isScoreExactTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Coupe du monde Score Exact n'est pas encore activé en base. Lancez la migration scripts/021_add_world_cup_score_exact.sql puis scripts/022_add_world_cup_score_exact_slug.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to create score exact match" }, { status: 500 })
  }
}
