-- Hotfix: wine inventory movements must not reference an order_item row that is being deleted.
-- Without this, deleting fired order_items can fail on FK source_order_item_id -> order_items(id).

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
