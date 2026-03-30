-- Multi-table support for reservations
CREATE TABLE IF NOT EXISTS public.reservation_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reservation_id, table_id)
);

ALTER TABLE public.reservation_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on reservation_tables" ON public.reservation_tables;
CREATE POLICY "Allow all operations on reservation_tables"
  ON public.reservation_tables
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_reservation_tables_reservation_id
  ON public.reservation_tables(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_tables_table_id
  ON public.reservation_tables(table_id);

-- Backfill legacy reservations.table_id into the linking table
INSERT INTO public.reservation_tables (reservation_id, table_id)
SELECT r.id, r.table_id
FROM public.reservations r
WHERE r.table_id IS NOT NULL
ON CONFLICT (reservation_id, table_id) DO NOTHING;
