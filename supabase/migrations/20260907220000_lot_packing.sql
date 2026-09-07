-- Kjør i Lovable Cloud → SQL etter sql/12_staff_roles.sql.
-- LOT remains the master object. Packages and cartons are physical units under the LOT.
-- Also applied as supabase/migrations/20260907220000_lot_packing.sql.

ALTER TYPE public.gold_lot_status ADD VALUE IF NOT EXISTS 'packed';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS units_per_package INTEGER,
  ADD COLUMN IF NOT EXISTS packages_per_carton INTEGER,
  ADD COLUMN IF NOT EXISTS unit_weight_g INTEGER,
  ADD COLUMN IF NOT EXISTS legal_designation_no TEXT,
  ADD COLUMN IF NOT EXISTS ingredients_no TEXT,
  ADD COLUMN IF NOT EXISTS allergens_no TEXT,
  ADD COLUMN IF NOT EXISTS nutrition_no TEXT,
  ADD COLUMN IF NOT EXISTS prep_no TEXT,
  ADD COLUMN IF NOT EXISTS storage_no TEXT,
  ADD COLUMN IF NOT EXISTS do_not_refreeze_no TEXT,
  ADD COLUMN IF NOT EXISTS producer_name TEXT,
  ADD COLUMN IF NOT EXISTS producer_address TEXT,
  ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_units_per_package_positive;
ALTER TABLE public.products
  ADD CONSTRAINT products_units_per_package_positive
  CHECK (units_per_package IS NULL OR units_per_package >= 1);

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_packages_per_carton_positive;
ALTER TABLE public.products
  ADD CONSTRAINT products_packages_per_carton_positive
  CHECK (packages_per_carton IS NULL OR packages_per_carton >= 1);

CREATE TABLE IF NOT EXISTS public.product_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  fingerprint TEXT NOT NULL,
  name_no TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sku TEXT NOT NULL,
  legal_designation_no TEXT NOT NULL,
  ingredients_no TEXT,
  allergens_no TEXT,
  nutrition_no TEXT,
  prep_no TEXT,
  storage_no TEXT NOT NULL,
  do_not_refreeze_no TEXT NOT NULL,
  producer_name TEXT NOT NULL,
  producer_address TEXT,
  shelf_life_days INTEGER NOT NULL DEFAULT 180 CHECK (shelf_life_days >= 1),
  unit_weight_g INTEGER,
  units_per_package INTEGER,
  packages_per_carton INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_product_versions_product
  ON public.product_versions(product_id, version_number DESC);

ALTER TABLE public.gold_lots
  ADD COLUMN IF NOT EXISTS approved_qty INTEGER,
  ADD COLUMN IF NOT EXISTS product_version_id UUID REFERENCES public.product_versions(id) ON DELETE RESTRICT;

ALTER TABLE public.gold_lots DROP CONSTRAINT IF EXISTS gold_lots_approved_qty_range;
ALTER TABLE public.gold_lots
  ADD CONSTRAINT gold_lots_approved_qty_range
  CHECK (
    approved_qty IS NULL
    OR (approved_qty >= 0 AND approved_qty <= produced_qty)
  );

CREATE TABLE IF NOT EXISTS public.gold_lot_cartons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gold_lot_id UUID NOT NULL REFERENCES public.gold_lots(id) ON DELETE CASCADE,
  carton_seq INTEGER NOT NULL CHECK (carton_seq >= 1),
  carton_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gold_lot_id, carton_seq),
  UNIQUE (gold_lot_id, carton_code)
);

CREATE INDEX IF NOT EXISTS idx_gold_lot_cartons_lot
  ON public.gold_lot_cartons(gold_lot_id, carton_seq);

CREATE TABLE IF NOT EXISTS public.gold_lot_packages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gold_lot_id UUID NOT NULL REFERENCES public.gold_lots(id) ON DELETE CASCADE,
  carton_id UUID REFERENCES public.gold_lot_cartons(id) ON DELETE SET NULL,
  package_seq INTEGER NOT NULL CHECK (package_seq >= 1),
  package_code TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gold_lot_id, package_seq),
  UNIQUE (gold_lot_id, package_code)
);

CREATE INDEX IF NOT EXISTS idx_gold_lot_packages_lot
  ON public.gold_lot_packages(gold_lot_id, package_seq);
CREATE INDEX IF NOT EXISTS idx_gold_lot_packages_carton
  ON public.gold_lot_packages(carton_id);

CREATE OR REPLACE FUNCTION public.sync_gold_lot_carton_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  lot uuid;
BEGIN
  lot := COALESCE(NEW.gold_lot_id, OLD.gold_lot_id);
  UPDATE public.gold_lots
    SET carton_count = (SELECT COUNT(*)::INTEGER FROM public.gold_lot_cartons WHERE gold_lot_id = lot)
    WHERE id = lot;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_gold_lot_cartons_count ON public.gold_lot_cartons;
CREATE TRIGGER trg_gold_lot_cartons_count
AFTER INSERT OR UPDATE OR DELETE ON public.gold_lot_cartons
FOR EACH ROW EXECUTE FUNCTION public.sync_gold_lot_carton_count();

GRANT SELECT, INSERT ON public.product_versions TO authenticated;
GRANT ALL ON public.product_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gold_lot_cartons TO authenticated;
GRANT ALL ON public.gold_lot_cartons TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gold_lot_packages TO authenticated;
GRANT ALL ON public.gold_lot_packages TO service_role;

ALTER TABLE public.product_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gold_lot_cartons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gold_lot_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_versions_ops_select" ON public.product_versions;
CREATE POLICY "product_versions_ops_select" ON public.product_versions FOR SELECT TO authenticated
  USING (public.can_manage_operations());
DROP POLICY IF EXISTS "product_versions_ops_insert" ON public.product_versions;
CREATE POLICY "product_versions_ops_insert" ON public.product_versions FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations());

DROP POLICY IF EXISTS "gold_lot_cartons_ops_select" ON public.gold_lot_cartons;
CREATE POLICY "gold_lot_cartons_ops_select" ON public.gold_lot_cartons FOR SELECT TO authenticated
  USING (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_cartons_ops_insert" ON public.gold_lot_cartons;
CREATE POLICY "gold_lot_cartons_ops_insert" ON public.gold_lot_cartons FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_cartons_ops_update" ON public.gold_lot_cartons;
CREATE POLICY "gold_lot_cartons_ops_update" ON public.gold_lot_cartons FOR UPDATE TO authenticated
  USING (public.can_manage_operations()) WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_cartons_ops_delete" ON public.gold_lot_cartons;
CREATE POLICY "gold_lot_cartons_ops_delete" ON public.gold_lot_cartons FOR DELETE TO authenticated
  USING (public.can_manage_operations());

DROP POLICY IF EXISTS "gold_lot_packages_ops_select" ON public.gold_lot_packages;
CREATE POLICY "gold_lot_packages_ops_select" ON public.gold_lot_packages FOR SELECT TO authenticated
  USING (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_packages_ops_insert" ON public.gold_lot_packages;
CREATE POLICY "gold_lot_packages_ops_insert" ON public.gold_lot_packages FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_packages_ops_update" ON public.gold_lot_packages;
CREATE POLICY "gold_lot_packages_ops_update" ON public.gold_lot_packages FOR UPDATE TO authenticated
  USING (public.can_manage_operations()) WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_packages_ops_delete" ON public.gold_lot_packages;
CREATE POLICY "gold_lot_packages_ops_delete" ON public.gold_lot_packages FOR DELETE TO authenticated
  USING (public.can_manage_operations());
