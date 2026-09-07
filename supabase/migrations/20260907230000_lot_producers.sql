-- Kjør i Lovable Cloud → SQL etter sql/13_lot_packing.sql.
-- LOT producers are Gold staff (admin/ops) referenced by user id, with a name snapshot.
-- produced_by TEXT stays as a deprecated joined-name field for old screens.
-- Also applied as supabase/migrations/20260907230000_lot_producers.sql.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS employee_number TEXT;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employee_number_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_employee_number_format
  CHECK (employee_number IS NULL OR length(trim(employee_number)) >= 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_employee_number
  ON public.profiles (lower(employee_number))
  WHERE employee_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.gold_lot_producers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gold_lot_id UUID NOT NULL REFERENCES public.gold_lots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  full_name_snapshot TEXT NOT NULL,
  employee_number_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gold_lot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_gold_lot_producers_lot
  ON public.gold_lot_producers(gold_lot_id);
CREATE INDEX IF NOT EXISTS idx_gold_lot_producers_user
  ON public.gold_lot_producers(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gold_lot_producers TO authenticated;
GRANT ALL ON public.gold_lot_producers TO service_role;

ALTER TABLE public.gold_lot_producers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gold_lot_producers_ops_select" ON public.gold_lot_producers;
CREATE POLICY "gold_lot_producers_ops_select" ON public.gold_lot_producers FOR SELECT TO authenticated
  USING (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_producers_ops_insert" ON public.gold_lot_producers;
CREATE POLICY "gold_lot_producers_ops_insert" ON public.gold_lot_producers FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_producers_ops_update" ON public.gold_lot_producers;
CREATE POLICY "gold_lot_producers_ops_update" ON public.gold_lot_producers FOR UPDATE TO authenticated
  USING (public.can_manage_operations()) WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_producers_ops_delete" ON public.gold_lot_producers;
CREATE POLICY "gold_lot_producers_ops_delete" ON public.gold_lot_producers FOR DELETE TO authenticated
  USING (public.can_manage_operations());
