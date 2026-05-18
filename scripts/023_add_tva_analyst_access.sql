-- Ajoute la permission "Analyste TVA" sur les utilisateurs
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS is_tva_analyst BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_tva_analyst IS
  'Autorise l''acces au module Rapports avances / Analyste TVA.';

-- Initialise la configuration du code d''acces des rapports avances
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'settings'
  ) THEN
    INSERT INTO public.settings (setting_key, setting_value, updated_at)
    VALUES ('advanced_reports_access', '{"access_code": ""}'::jsonb, NOW())
    ON CONFLICT (setting_key) DO NOTHING;
  END IF;
END
$$;
