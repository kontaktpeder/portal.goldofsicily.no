-- Kjør én gang i Lovable Cloud → SQL Editor.
-- Sletter kun Gold-LOT L-20260908-N-01 ('Nduja & mozzarella, 8. sep 2026).
-- Ikke skjema. Trygg å kjøre igjen hvis LOT-et allerede er borte.

-- Forhåndsvisning
SELECT
  g.id,
  g.lot_code,
  g.production_date,
  g.status,
  g.produced_qty,
  p.name_no,
  pv.version_number
FROM public.gold_lots g
JOIN public.products p ON p.id = g.product_id
LEFT JOIN public.product_versions pv ON pv.id = g.product_version_id
WHERE g.lot_code = 'L-20260908-N-01'
  AND g.production_date = DATE '2026-09-08';

DO $$
DECLARE
  lot uuid;
  delivery_ids uuid[];
BEGIN
  SELECT g.id
    INTO lot
  FROM public.gold_lots g
  JOIN public.products p ON p.id = g.product_id
  WHERE g.lot_code = 'L-20260908-N-01'
    AND g.production_date = DATE '2026-09-08'
    AND p.lot_letter = 'N';

  IF lot IS NULL THEN
    RAISE NOTICE 'LOT L-20260908-N-01 finnes ikke. Ingenting slettet.';
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT dl.delivery_id), ARRAY[]::uuid[])
    INTO delivery_ids
  FROM public.delivery_lines dl
  WHERE dl.gold_lot_id = lot;

  -- delivery_lines.gold_lot_id er ON DELETE SET NULL, men quantity > 0 krever LOT.
  DELETE FROM public.delivery_lines
  WHERE gold_lot_id = lot;

  IF cardinality(delivery_ids) > 0 THEN
    DELETE FROM public.deliveries d
    WHERE d.id = ANY (delivery_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM public.delivery_lines dl
        WHERE dl.delivery_id = d.id
      );
  END IF;

  -- Kartong-trigger oppdaterer gold_lots. Slett pakker/kartonger først.
  DELETE FROM public.gold_lot_packages WHERE gold_lot_id = lot;
  DELETE FROM public.gold_lot_cartons WHERE gold_lot_id = lot;

  DELETE FROM public.gold_lots WHERE id = lot;

  RAISE NOTICE 'Slettet L-20260908-N-01 og tilhørende rader under LOT-et.';
END
$$;
