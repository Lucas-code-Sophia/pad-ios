-- Wine inventory module (admin)
-- Tracks wine bottle stock separately from menu inventory
-- Applies automatic deductions from fired order_items via SQL trigger

-- 1) Core tables
CREATE TABLE IF NOT EXISTS public.wine_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bottle_menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  current_bottles NUMERIC(10,3) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id),
  updated_by UUID REFERENCES public.users(id),
  CONSTRAINT wine_inventory_items_bottle_unique UNIQUE (bottle_menu_item_id),
  CONSTRAINT wine_inventory_items_stock_non_negative CHECK (current_bottles >= 0)
);

CREATE TABLE IF NOT EXISTS public.wine_inventory_glass_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_inventory_item_id UUID NOT NULL REFERENCES public.wine_inventory_items(id) ON DELETE CASCADE,
  glass_menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  factor NUMERIC(10,4) NOT NULL DEFAULT 0.2,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id),
  updated_by UUID REFERENCES public.users(id),
  CONSTRAINT wine_inventory_glass_links_glass_unique UNIQUE (glass_menu_item_id),
  CONSTRAINT wine_inventory_glass_links_factor_positive CHECK (factor > 0)
);

CREATE TABLE IF NOT EXISTS public.wine_inventory_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  red_threshold NUMERIC(10,3) NOT NULL DEFAULT 3,
  yellow_threshold NUMERIC(10,3) NOT NULL DEFAULT 5,
  tracking_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id),
  updated_by UUID REFERENCES public.users(id),
  CONSTRAINT wine_inventory_settings_thresholds_non_negative CHECK (red_threshold >= 0 AND yellow_threshold >= 0)
);

CREATE TABLE IF NOT EXISTS public.wine_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_inventory_item_id UUID NOT NULL REFERENCES public.wine_inventory_items(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('sale_bottle', 'sale_glass', 'correction', 'recount')),
  delta NUMERIC(10,3) NOT NULL,
  source_order_item_id UUID REFERENCES public.order_items(id) ON DELETE SET NULL,
  source_menu_item_id UUID REFERENCES public.menu_items(id) ON DELETE SET NULL,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id)
);

INSERT INTO public.wine_inventory_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_wine_inventory_items_bottle_menu_item_id
  ON public.wine_inventory_items(bottle_menu_item_id);
CREATE INDEX IF NOT EXISTS idx_wine_inventory_items_current_bottles
  ON public.wine_inventory_items(current_bottles);
CREATE INDEX IF NOT EXISTS idx_wine_inventory_glass_links_wine_item
  ON public.wine_inventory_glass_links(wine_inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_wine_inventory_glass_links_glass_menu_item
  ON public.wine_inventory_glass_links(glass_menu_item_id);
CREATE INDEX IF NOT EXISTS idx_wine_inventory_movements_wine_item_created_at
  ON public.wine_inventory_movements(wine_inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wine_inventory_movements_source_order_item
  ON public.wine_inventory_movements(source_order_item_id);

-- 2) RLS + permissive policies (PIN auth model)
ALTER TABLE public.wine_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wine_inventory_glass_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wine_inventory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wine_inventory_movements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wine_inventory_items' AND policyname = 'Allow all operations on wine_inventory_items'
  ) THEN
    CREATE POLICY "Allow all operations on wine_inventory_items"
      ON public.wine_inventory_items
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wine_inventory_glass_links' AND policyname = 'Allow all operations on wine_inventory_glass_links'
  ) THEN
    CREATE POLICY "Allow all operations on wine_inventory_glass_links"
      ON public.wine_inventory_glass_links
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wine_inventory_settings' AND policyname = 'Allow all operations on wine_inventory_settings'
  ) THEN
    CREATE POLICY "Allow all operations on wine_inventory_settings"
      ON public.wine_inventory_settings
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wine_inventory_movements' AND policyname = 'Allow all operations on wine_inventory_movements'
  ) THEN
    CREATE POLICY "Allow all operations on wine_inventory_movements"
      ON public.wine_inventory_movements
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;

-- 3) Trigger helper: resolve the wine item and requested consumption from one order_item row
CREATE OR REPLACE FUNCTION public.resolve_wine_inventory_consumption(
  _menu_item_id UUID,
  _quantity NUMERIC,
  _status TEXT,
  _fired_at TIMESTAMPTZ,
  _created_at TIMESTAMPTZ
)
RETURNS TABLE(
  wine_inventory_item_id UUID,
  requested_amount NUMERIC,
  sale_kind TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  _tracking_started_at TIMESTAMPTZ;
  _event_time TIMESTAMPTZ;
  _qty NUMERIC;
BEGIN
  IF _menu_item_id IS NULL THEN
    RETURN;
  END IF;

  _qty := GREATEST(COALESCE(_quantity, 0), 0);
  IF _qty <= 0 THEN
    RETURN;
  END IF;

  IF COALESCE(_status, '') <> 'fired' THEN
    RETURN;
  END IF;

  SELECT tracking_started_at
  INTO _tracking_started_at
  FROM public.wine_inventory_settings
  WHERE id = 1;

  IF _tracking_started_at IS NULL THEN
    RETURN;
  END IF;

  _event_time := COALESCE(_fired_at, _created_at, NOW());
  IF _event_time < _tracking_started_at THEN
    RETURN;
  END IF;

  -- First, exact bottle item mapping
  RETURN QUERY
  SELECT wi.id, _qty::NUMERIC, 'sale_bottle'::TEXT
  FROM public.wine_inventory_items wi
  WHERE wi.bottle_menu_item_id = _menu_item_id
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Otherwise, try glass -> bottle link mapping
  RETURN QUERY
  SELECT wgl.wine_inventory_item_id,
         ROUND(_qty * COALESCE(wgl.factor, 0.2), 3)::NUMERIC,
         'sale_glass'::TEXT
  FROM public.wine_inventory_glass_links wgl
  WHERE wgl.glass_menu_item_id = _menu_item_id
    AND wgl.is_active = true
  LIMIT 1;
END;
$$;

-- 4) Apply signed consumption delta to stock and movement journal
-- _requested_consumption > 0 => deduct stock
-- _requested_consumption < 0 => restore stock (correction)
CREATE OR REPLACE FUNCTION public.apply_wine_inventory_delta(
  _wine_inventory_item_id UUID,
  _requested_consumption NUMERIC,
  _sale_kind TEXT,
  _source_order_item_id UUID,
  _source_menu_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  _current NUMERIC;
  _next NUMERIC;
  _applied_consumption NUMERIC;
  _stock_delta NUMERIC;
  _movement_type TEXT;
BEGIN
  IF _wine_inventory_item_id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(_requested_consumption, 0) = 0 THEN
    RETURN;
  END IF;

  SELECT current_bottles
  INTO _current
  FROM public.wine_inventory_items
  WHERE id = _wine_inventory_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  _current := GREATEST(COALESCE(_current, 0), 0);

  IF _requested_consumption > 0 THEN
    _applied_consumption := LEAST(_current, _requested_consumption);
    _next := GREATEST(_current - _applied_consumption, 0);
    _stock_delta := -_applied_consumption;
    _movement_type := CASE
      WHEN _sale_kind = 'sale_glass' THEN 'sale_glass'
      ELSE 'sale_bottle'
    END;
  ELSE
    _applied_consumption := ABS(_requested_consumption);
    _next := _current + _applied_consumption;
    _stock_delta := _applied_consumption;
    _movement_type := 'correction';
  END IF;

  _next := ROUND(_next, 3);
  _stock_delta := ROUND(_stock_delta, 3);

  IF _next <> _current THEN
    UPDATE public.wine_inventory_items
    SET current_bottles = _next,
        updated_at = NOW()
    WHERE id = _wine_inventory_item_id;
  END IF;

  IF _stock_delta <> 0 THEN
    INSERT INTO public.wine_inventory_movements (
      wine_inventory_item_id,
      movement_type,
      delta,
      source_order_item_id,
      source_menu_item_id,
      metadata,
      created_at
    )
    VALUES (
      _wine_inventory_item_id,
      _movement_type,
      _stock_delta,
      _source_order_item_id,
      _source_menu_item_id,
      jsonb_build_object(
        'requested_consumption', ROUND(_requested_consumption, 3),
        'previous_stock', ROUND(_current, 3),
        'next_stock', ROUND(_next, 3),
        'clamped', (_requested_consumption > 0 AND _applied_consumption < _requested_consumption)
      ),
      NOW()
    );
  END IF;
END;
$$;

-- 5) Trigger function: compute OLD vs NEW contribution and apply delta
CREATE OR REPLACE FUNCTION public.handle_wine_inventory_order_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  _old_wine_item_id UUID;
  _old_amount NUMERIC;
  _old_kind TEXT;

  _new_wine_item_id UUID;
  _new_amount NUMERIC;
  _new_kind TEXT;

  _delta NUMERIC;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT wine_inventory_item_id, requested_amount, sale_kind
    INTO _new_wine_item_id, _new_amount, _new_kind
    FROM public.resolve_wine_inventory_consumption(
      NEW.menu_item_id,
      NEW.quantity,
      NEW.status,
      NEW.fired_at,
      NEW.created_at
    );

    IF _new_wine_item_id IS NOT NULL AND COALESCE(_new_amount, 0) > 0 THEN
      PERFORM public.apply_wine_inventory_delta(
        _new_wine_item_id,
        _new_amount,
        _new_kind,
        NEW.id,
        NEW.menu_item_id
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT wine_inventory_item_id, requested_amount, sale_kind
    INTO _old_wine_item_id, _old_amount, _old_kind
    FROM public.resolve_wine_inventory_consumption(
      OLD.menu_item_id,
      OLD.quantity,
      OLD.status,
      OLD.fired_at,
      OLD.created_at
    );

    IF _old_wine_item_id IS NOT NULL AND COALESCE(_old_amount, 0) > 0 THEN
      PERFORM public.apply_wine_inventory_delta(
        _old_wine_item_id,
        -_old_amount,
        _old_kind,
        NULL,
        OLD.menu_item_id
      );
    END IF;

    RETURN OLD;
  END IF;

  -- UPDATE case
  SELECT wine_inventory_item_id, requested_amount, sale_kind
  INTO _old_wine_item_id, _old_amount, _old_kind
  FROM public.resolve_wine_inventory_consumption(
    OLD.menu_item_id,
    OLD.quantity,
    OLD.status,
    OLD.fired_at,
    OLD.created_at
  );

  SELECT wine_inventory_item_id, requested_amount, sale_kind
  INTO _new_wine_item_id, _new_amount, _new_kind
  FROM public.resolve_wine_inventory_consumption(
    NEW.menu_item_id,
    NEW.quantity,
    NEW.status,
    NEW.fired_at,
    NEW.created_at
  );

  _old_amount := COALESCE(_old_amount, 0);
  _new_amount := COALESCE(_new_amount, 0);

  IF _old_wine_item_id IS NOT NULL
     AND _new_wine_item_id IS NOT NULL
     AND _old_wine_item_id = _new_wine_item_id THEN
    _delta := _new_amount - _old_amount;
    IF _delta <> 0 THEN
      PERFORM public.apply_wine_inventory_delta(
        _new_wine_item_id,
        _delta,
        COALESCE(_new_kind, _old_kind),
        NEW.id,
        NEW.menu_item_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF _old_wine_item_id IS NOT NULL AND _old_amount > 0 THEN
    PERFORM public.apply_wine_inventory_delta(
      _old_wine_item_id,
      -_old_amount,
      _old_kind,
      OLD.id,
      OLD.menu_item_id
    );
  END IF;

  IF _new_wine_item_id IS NOT NULL AND _new_amount > 0 THEN
    PERFORM public.apply_wine_inventory_delta(
      _new_wine_item_id,
      _new_amount,
      _new_kind,
      NEW.id,
      NEW.menu_item_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wine_inventory_on_order_items_change ON public.order_items;

CREATE TRIGGER trg_wine_inventory_on_order_items_change
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.handle_wine_inventory_order_item_change();

-- 6) Atomic recount RPC: set absolute stocks + restart tracking baseline
CREATE OR REPLACE FUNCTION public.apply_wine_inventory_recount(
  _items JSONB,
  _updated_by UUID DEFAULT NULL
)
RETURNS TABLE(updated_count INTEGER, tracking_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  _row JSONB;
  _wine_item_id UUID;
  _next_stock NUMERIC;
  _current_stock NUMERIC;
  _tracking_now TIMESTAMPTZ := NOW();
  _count INTEGER := 0;
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid recount payload';
  END IF;

  UPDATE public.wine_inventory_settings
  SET tracking_started_at = _tracking_now,
      updated_at = _tracking_now,
      updated_by = _updated_by
  WHERE id = 1;

  FOR _row IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    _wine_item_id := (_row->>'wineInventoryItemId')::UUID;
    _next_stock := GREATEST(COALESCE((_row->>'currentBottles')::NUMERIC, 0), 0);

    IF _wine_item_id IS NULL THEN
      RAISE EXCEPTION 'Missing wineInventoryItemId in recount payload';
    END IF;

    SELECT current_bottles
    INTO _current_stock
    FROM public.wine_inventory_items
    WHERE id = _wine_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown wine inventory item: %', _wine_item_id;
    END IF;

    _current_stock := ROUND(GREATEST(COALESCE(_current_stock, 0), 0), 3);
    _next_stock := ROUND(_next_stock, 3);

    IF _next_stock <> _current_stock THEN
      UPDATE public.wine_inventory_items
      SET current_bottles = _next_stock,
          updated_at = _tracking_now,
          updated_by = _updated_by
      WHERE id = _wine_item_id;

      INSERT INTO public.wine_inventory_movements (
        wine_inventory_item_id,
        movement_type,
        delta,
        metadata,
        created_at,
        created_by
      )
      VALUES (
        _wine_item_id,
        'recount',
        ROUND(_next_stock - _current_stock, 3),
        jsonb_build_object(
          'previous_stock', _current_stock,
          'next_stock', _next_stock
        ),
        _tracking_now,
        _updated_by
      );
    END IF;

    _count := _count + 1;
  END LOOP;

  RETURN QUERY SELECT _count, _tracking_now;
END;
$$;
