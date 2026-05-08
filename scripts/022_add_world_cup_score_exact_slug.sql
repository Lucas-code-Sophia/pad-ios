-- Add public slug for human-friendly URLs on score exact matches

ALTER TABLE public.world_cup_score_exact_matches
  ADD COLUMN IF NOT EXISTS public_slug TEXT;

WITH normalized AS (
  SELECT
    id,
    COALESCE(
      NULLIF(
        TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(COALESCE(home_team, '') || '-' || COALESCE(away_team, '')), '[^a-z0-9]+', '-', 'g')),
        ''
      ),
      'match'
    ) AS base_slug,
    created_at
  FROM public.world_cup_score_exact_matches
), ranked AS (
  SELECT
    id,
    base_slug,
    ROW_NUMBER() OVER (PARTITION BY base_slug ORDER BY created_at, id) AS slug_rank
  FROM normalized
)
UPDATE public.world_cup_score_exact_matches m
SET public_slug = CASE
  WHEN ranked.slug_rank = 1 THEN ranked.base_slug
  ELSE ranked.base_slug || '-' || ranked.slug_rank
END
FROM ranked
WHERE m.id = ranked.id
  AND (m.public_slug IS NULL OR TRIM(m.public_slug) = '');

ALTER TABLE public.world_cup_score_exact_matches
  ALTER COLUMN public_slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_cup_score_exact_matches_public_slug_unique
  ON public.world_cup_score_exact_matches(public_slug);
