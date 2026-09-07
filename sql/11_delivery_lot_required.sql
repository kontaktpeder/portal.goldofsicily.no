-- Gold of Sicily: delivery lines require a Gold-LOT with remaining stock.
-- Run in Lovable Cloud / Supabase SQL Editor AFTER sql/10_gold_lots.sql.
-- Also applied as supabase/migrations/20260907180000_delivery_lot_required.sql.

ALTER TABLE public.delivery_lines
  DROP CONSTRAINT IF EXISTS delivery_lines_quantity_requires_gold_lot;

ALTER TABLE public.delivery_lines
  ADD CONSTRAINT delivery_lines_quantity_requires_gold_lot
  CHECK (quantity = 0 OR gold_lot_id IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION public.enforce_delivery_line_lot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  lot_product uuid;
  lot_status public.gold_lot_status;
  produced integer;
  used_elsewhere integer;
BEGIN
  IF NEW.quantity <= 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.gold_lot_id IS NULL THEN
    RAISE EXCEPTION 'delivery_line with quantity > 0 requires gold_lot_id'
      USING ERRCODE = '23514';
  END IF;

  SELECT product_id, status, produced_qty
    INTO lot_product, lot_status, produced
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

  IF lot_status IN ('closed', 'recalled') THEN
    RAISE EXCEPTION 'Gold-LOT er ikke åpen for levering'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO used_elsewhere
  FROM public.delivery_lines
  WHERE gold_lot_id = NEW.gold_lot_id
    AND id IS DISTINCT FROM NEW.id;

  IF used_elsewhere + NEW.quantity > produced THEN
    RAISE EXCEPTION 'Gold-LOT har ikke nok tilgjengelig beholdning'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_delivery_line_lot ON public.delivery_lines;
DROP TRIGGER IF EXISTS trg_delivery_lines_require_lot ON public.delivery_lines;
CREATE TRIGGER trg_enforce_delivery_line_lot
  BEFORE INSERT OR UPDATE OF quantity, gold_lot_id, product_id
  ON public.delivery_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_delivery_line_lot();
