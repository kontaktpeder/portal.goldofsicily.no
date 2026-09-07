-- Gold of Sicily: mark the three oldest deliveries as pre-system legacy records.
-- Run in Lovable Cloud / Supabase SQL Editor AFTER sql/14_lot_producers.sql.
-- Also applied as supabase/migrations/20260907233000_legacy_deliveries.sql.
--
-- Documents what is already on the delivery: venue, date, flavor, quantity, Gold-LOT if linked.
-- Does NOT invent packages (P001), cartons (C001), pack timestamps, or supplier lots.

UPDATE public.deliveries d
SET note = CASE
  WHEN d.note IS NULL OR btrim(d.note) = '' THEN 'Legacy levering før nytt LOT-/pakkesystem'
  WHEN position('Legacy levering før nytt LOT-/pakkesystem' in d.note) > 0 THEN d.note
  ELSE btrim(d.note) || E'\n' || 'Legacy levering før nytt LOT-/pakkesystem'
END
FROM (
  SELECT id
  FROM public.deliveries
  ORDER BY delivered_at ASC, created_at ASC
  LIMIT 3
) oldest
WHERE d.id = oldest.id;
