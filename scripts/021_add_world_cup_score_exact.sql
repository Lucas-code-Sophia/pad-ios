-- World Cup module - Score Exact game
-- Creates match + prediction tables used by admin and public QR flow

CREATE TABLE IF NOT EXISTS public.world_cup_score_exact_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  public_slug TEXT NOT NULL UNIQUE,
  public_code VARCHAR(16) NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'resolved')),
  final_home_score INTEGER CHECK (final_home_score >= 0),
  final_away_score INTEGER CHECK (final_away_score >= 0),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT world_cup_score_exact_resolved_needs_final_score
    CHECK (status <> 'resolved' OR (final_home_score IS NOT NULL AND final_away_score IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.world_cup_score_exact_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.world_cup_score_exact_matches(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  participant_key TEXT NOT NULL,
  predicted_home_score INTEGER NOT NULL CHECK (predicted_home_score >= 0),
  predicted_away_score INTEGER NOT NULL CHECK (predicted_away_score >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT world_cup_score_exact_predictions_unique_participant UNIQUE (match_id, participant_key)
);

CREATE INDEX IF NOT EXISTS idx_world_cup_score_exact_matches_status
  ON public.world_cup_score_exact_matches(status);

CREATE INDEX IF NOT EXISTS idx_world_cup_score_exact_matches_created_at
  ON public.world_cup_score_exact_matches(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_world_cup_score_exact_matches_public_code
  ON public.world_cup_score_exact_matches(public_code);

CREATE INDEX IF NOT EXISTS idx_world_cup_score_exact_matches_public_slug
  ON public.world_cup_score_exact_matches(public_slug);

CREATE INDEX IF NOT EXISTS idx_world_cup_score_exact_predictions_match_id
  ON public.world_cup_score_exact_predictions(match_id);

CREATE INDEX IF NOT EXISTS idx_world_cup_score_exact_predictions_created_at
  ON public.world_cup_score_exact_predictions(created_at ASC);

ALTER TABLE public.world_cup_score_exact_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_cup_score_exact_predictions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'world_cup_score_exact_matches' AND policyname = 'Allow all operations on world_cup_score_exact_matches'
  ) THEN
    CREATE POLICY "Allow all operations on world_cup_score_exact_matches"
      ON public.world_cup_score_exact_matches
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'world_cup_score_exact_predictions' AND policyname = 'Allow all operations on world_cup_score_exact_predictions'
  ) THEN
    CREATE POLICY "Allow all operations on world_cup_score_exact_predictions"
      ON public.world_cup_score_exact_predictions
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;
