-- Kjør i Lovable Cloud → SQL.
-- Kundelevering og overføring til Villa forblir to bevegelser.
-- source_handover_id er tom ved direkte levering fra Gold.
-- Satt peker den på gold_lot_handovers når varen går ut fra Villa.
-- Ikke legg tilbake delivery_lines_quantity_requires_gold_lot.
-- Also applied as supabase/migrations/20261007140000_villa_stock_source.sql.

ALTER TABLE public.delivery_lines
  ADD COLUMN IF NOT EXISTS source_handover_id UUID
    REFERENCES public.gold_lot_handovers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_delivery_lines_source_handover
  ON public.delivery_lines(source_handover_id)
  WHERE source_handover_id IS NOT NULL;

ALTER TABLE public.delivery_lines
  DROP CONSTRAINT IF EXISTS delivery_lines_quantity_requires_gold_lot;

CREATE OR REPLACE FUNCTION public.enforce_delivery_line_lot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  lot_product uuid;
  lot_status public.gold_lot_status;
  produced integer;
  approved integer;
  base_qty integer;
  villa_handed integer;
  used_elsewhere integer;
  handover_lot uuid;
  handover_qty integer;
  handover_owner public.handover_ownership;
BEGIN
  IF NEW.quantity <= 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.gold_lot_id IS NULL THEN
    RAISE EXCEPTION 'delivery_line with quantity > 0 requires gold_lot_id'
      USING ERRCODE = '23514';
  END IF;

  SELECT product_id, status, produced_qty, approved_qty
    INTO lot_product, lot_status, produced, approved
  FROM public.gold_lots
  WHERE id = NEW.gold_lot_id;

  IF lot_product IS NULL THEN
    RAISE EXCEPTION 'Gold-LOT % finnes ikke', NEW.gold_lot_id
      USING ERRCODE = '23503';
  END IF;

  IF lot_product IS DISTINCT FROM NEW.product_id THEN
    RAISE EXCEPTION 'Gold-LOT tilhører en annen smak enn leveringslinjen'
      USING ERRCODE = '23514';
  END IF;

  -- A first link on an old line may point at a lot that is already closed.
  -- New lines, and changes to a lot that was already set, still require an open lot.
  IF lot_status IN ('closed', 'recalled') AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Gold-LOT er ikke åpen for levering'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND lot_status IN ('closed', 'recalled') AND OLD.gold_lot_id IS NOT NULL THEN
    RAISE EXCEPTION 'Gold-LOT er ikke åpen for levering'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_handover_id IS NOT NULL THEN
    SELECT gold_lot_id, quantity, ownership_after_handover
      INTO handover_lot, handover_qty, handover_owner
    FROM public.gold_lot_handovers
    WHERE id = NEW.source_handover_id;

    IF handover_lot IS NULL THEN
      RAISE EXCEPTION 'villa handover is missing'
        USING ERRCODE = '23503';
    END IF;

    IF handover_owner IS DISTINCT FROM 'villa' THEN
      RAISE EXCEPTION 'handover is not Villa stock'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.gold_lot_id IS DISTINCT FROM handover_lot THEN
      RAISE EXCEPTION 'delivery lot does not match the Villa handover'
        USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO used_elsewhere
    FROM public.delivery_lines
    WHERE source_handover_id = NEW.source_handover_id
      AND id IS DISTINCT FROM NEW.id;

    IF used_elsewhere + NEW.quantity > handover_qty THEN
      RAISE EXCEPTION 'Villa stock is short'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  base_qty := COALESCE(approved, produced);
  SELECT COALESCE(SUM(quantity), 0) INTO villa_handed
  FROM public.gold_lot_handovers
  WHERE gold_lot_id = NEW.gold_lot_id
    AND ownership_after_handover = 'villa';

  SELECT COALESCE(SUM(quantity), 0) INTO used_elsewhere
  FROM public.delivery_lines
  WHERE gold_lot_id = NEW.gold_lot_id
    AND source_handover_id IS NULL
    AND id IS DISTINCT FROM NEW.id;

  IF used_elsewhere + NEW.quantity + villa_handed > base_qty THEN
    RAISE EXCEPTION 'Gold-LOT har ikke nok tilgjengelig beholdning'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_delivery_line_lot ON public.delivery_lines;
CREATE TRIGGER trg_enforce_delivery_line_lot
  BEFORE INSERT OR UPDATE OF quantity, gold_lot_id, product_id, source_handover_id
  ON public.delivery_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_delivery_line_lot();
