import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  buildParticipantKey,
  isScoreExactTableMissingError,
  normalizeMatchSlug,
  parseNonNegativeInteger,
} from "@/lib/world-cup-score-exact"

const cleanName = (value: unknown) => String(value || "").trim().replace(/\s+/g, " ")

export async function POST(request: Request, { params }: { params: Promise<{ publicCode: string }> }) {
  try {
    const { publicCode } = await params
    const rawIdentifier = decodeURIComponent(String(publicCode || "")).trim()
    const normalizedCode = rawIdentifier.toUpperCase()
    const normalizedSlug = normalizeMatchSlug(rawIdentifier)

    if (!rawIdentifier) {
      return NextResponse.json({ error: "Code public invalide" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))

    const firstName = cleanName(body?.firstName)
    const lastName = cleanName(body?.lastName)
    const predictedHomeScore = parseNonNegativeInteger(body?.predictedHomeScore)
    const predictedAwayScore = parseNonNegativeInteger(body?.predictedAwayScore)

    if (!firstName || !lastName) {
      return NextResponse.json({ error: "Nom et prénom sont obligatoires" }, { status: 400 })
    }

    if (firstName.length > 80 || lastName.length > 80) {
      return NextResponse.json({ error: "Nom ou prénom trop long" }, { status: 400 })
    }

    if (predictedHomeScore === null || predictedAwayScore === null) {
      return NextResponse.json({ error: "Le score saisi est invalide" }, { status: 400 })
    }

    const supabase = await createClient()

    let match: any = null
    let matchError: any = null

    if (normalizedSlug) {
      const bySlug = await supabase
        .from("world_cup_score_exact_matches")
        .select("id, status")
        .eq("public_slug", normalizedSlug)
        .maybeSingle()
      match = bySlug.data
      matchError = bySlug.error
    }

    if (!match && !matchError && normalizedCode) {
      const byCode = await supabase
        .from("world_cup_score_exact_matches")
        .select("id, status")
        .eq("public_code", normalizedCode)
        .maybeSingle()
      match = byCode.data
      matchError = byCode.error
    }

    if (matchError) throw matchError

    if (!match) {
      return NextResponse.json({ error: "Match introuvable" }, { status: 404 })
    }

    if (match.status !== "open") {
      return NextResponse.json({ error: "Les pronostics sont fermés pour ce match" }, { status: 400 })
    }

    const participantKey = buildParticipantKey(firstName, lastName)

    const { data, error } = await supabase
      .from("world_cup_score_exact_predictions")
      .insert({
        match_id: match.id,
        first_name: firstName,
        last_name: lastName,
        participant_key: participantKey,
        predicted_home_score: predictedHomeScore,
        predicted_away_score: predictedAwayScore,
      })
      .select("id, created_at")
      .single()

    if (error) {
      if (String(error.code || "") === "23505") {
        return NextResponse.json(
          { error: "Ce nom/prénom a déjà participé à ce match" },
          { status: 409 },
        )
      }
      throw error
    }

    return NextResponse.json({
      id: data.id,
      createdAt: data.created_at,
      success: true,
    })
  } catch (error: any) {
    console.error("[v0] Error creating score exact prediction:", error)

    if (isScoreExactTableMissingError(error)) {
      return NextResponse.json(
        {
          error:
            "Le module Coupe du monde Score Exact n'est pas encore activé en base. Lancez la migration scripts/021_add_world_cup_score_exact.sql puis scripts/022_add_world_cup_score_exact_slug.sql.",
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ error: "Failed to save prediction" }, { status: 500 })
  }
}
