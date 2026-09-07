-- Kjør i Lovable Cloud → SQL etter sql/11_delivery_lot_required.sql.
-- Adds Drift (ops) beside Eier (admin). Operational tables follow can_manage_operations().
-- Commercial writes (partners, venues, products, tilgang) stay admin-only.
-- Also applied as supabase/migrations/20260907200000_staff_roles.sql.
--
-- ADD VALUE cannot be used as an enum literal in the same transaction, so helpers
-- compare role::text. That lets this file run in one paste.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'ops';

CREATE OR REPLACE FUNCTION public.can_manage_operations()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text IN ('admin', 'ops')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_commercial()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_operations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_commercial() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_operations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_commercial() TO authenticated, service_role;

-- Venues: Drift can see existing steder (for levering). Create/edit stays Eier.
DROP POLICY IF EXISTS "venues_select" ON public.venues;
CREATE POLICY "venues_select" ON public.venues FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR id = public.current_venue_id());

-- Partners: Drift can read names on steder. Writes stay Eier.
DROP POLICY IF EXISTS "partners_admin_select" ON public.partners;
CREATE POLICY "partners_admin_select" ON public.partners FOR SELECT TO authenticated
  USING (
    public.can_manage_operations()
    OR id = (SELECT partner_id FROM public.venues WHERE id = public.current_venue_id())
  );

DROP POLICY IF EXISTS "deliveries_select" ON public.deliveries;
CREATE POLICY "deliveries_select" ON public.deliveries FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR venue_id = public.current_venue_id());
DROP POLICY IF EXISTS "deliveries_admin_insert" ON public.deliveries;
CREATE POLICY "deliveries_admin_insert" ON public.deliveries FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "deliveries_admin_update" ON public.deliveries;
CREATE POLICY "deliveries_admin_update" ON public.deliveries FOR UPDATE TO authenticated
  USING (public.can_manage_operations()) WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "deliveries_admin_delete" ON public.deliveries;
CREATE POLICY "deliveries_admin_delete" ON public.deliveries FOR DELETE TO authenticated
  USING (public.can_manage_operations());

DROP POLICY IF EXISTS "shift_reports_select" ON public.shift_reports;
CREATE POLICY "shift_reports_select" ON public.shift_reports FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR venue_id = public.current_venue_id());

DROP POLICY IF EXISTS "shift_report_lines_select" ON public.shift_report_lines;
CREATE POLICY "shift_report_lines_select" ON public.shift_report_lines FOR SELECT TO authenticated
  USING (
    public.can_manage_operations()
    OR EXISTS (
      SELECT 1 FROM public.shift_reports r
      WHERE r.id = shift_report_id
        AND r.venue_id = public.current_venue_id()
    )
  );

DROP POLICY IF EXISTS "delivery_lines_select" ON public.delivery_lines;
CREATE POLICY "delivery_lines_select" ON public.delivery_lines FOR SELECT TO authenticated
  USING (
    public.can_manage_operations()
    OR EXISTS (
      SELECT 1 FROM public.deliveries d
      WHERE d.id = delivery_id
        AND d.venue_id = public.current_venue_id()
    )
  );
DROP POLICY IF EXISTS "delivery_lines_admin_insert" ON public.delivery_lines;
CREATE POLICY "delivery_lines_admin_insert" ON public.delivery_lines FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "delivery_lines_admin_update" ON public.delivery_lines;
CREATE POLICY "delivery_lines_admin_update" ON public.delivery_lines FOR UPDATE TO authenticated
  USING (public.can_manage_operations()) WITH CHECK (public.can_manage_operations());
DROP POLICY IF EXISTS "delivery_lines_admin_delete" ON public.delivery_lines;
CREATE POLICY "delivery_lines_admin_delete" ON public.delivery_lines FOR DELETE TO authenticated
  USING (public.can_manage_operations());

DO $$
BEGIN
  IF to_regclass('public.ingredient_suppliers') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "ingredient_suppliers_admin_select" ON public.ingredient_suppliers;
  CREATE POLICY "ingredient_suppliers_admin_select" ON public.ingredient_suppliers FOR SELECT TO authenticated
    USING (public.can_manage_operations());
  DROP POLICY IF EXISTS "ingredient_suppliers_admin_insert" ON public.ingredient_suppliers;
  CREATE POLICY "ingredient_suppliers_admin_insert" ON public.ingredient_suppliers FOR INSERT TO authenticated
    WITH CHECK (public.can_manage_operations());
  DROP POLICY IF EXISTS "ingredient_suppliers_admin_update" ON public.ingredient_suppliers;
  CREATE POLICY "ingredient_suppliers_admin_update" ON public.ingredient_suppliers FOR UPDATE TO authenticated
    USING (public.can_manage_operations()) WITH CHECK (public.can_manage_operations());
  DROP POLICY IF EXISTS "ingredient_suppliers_admin_delete" ON public.ingredient_suppliers;
  CREATE POLICY "ingredient_suppliers_admin_delete" ON public.ingredient_suppliers FOR DELETE TO authenticated
    USING (public.can_manage_operations());

  DROP POLICY IF EXISTS "gold_lots_select" ON public.gold_lots;
  CREATE POLICY "gold_lots_select" ON public.gold_lots FOR SELECT TO authenticated
    USING (
      public.can_manage_operations()
      OR EXISTS (
        SELECT 1 FROM public.delivery_lines dl
        JOIN public.deliveries d ON d.id = dl.delivery_id
        WHERE dl.gold_lot_id = gold_lots.id
          AND d.venue_id = public.current_venue_id()
      )
    );
  DROP POLICY IF EXISTS "gold_lots_admin_insert" ON public.gold_lots;
  CREATE POLICY "gold_lots_admin_insert" ON public.gold_lots FOR INSERT TO authenticated
    WITH CHECK (public.can_manage_operations());
  DROP POLICY IF EXISTS "gold_lots_admin_update" ON public.gold_lots;
  CREATE POLICY "gold_lots_admin_update" ON public.gold_lots FOR UPDATE TO authenticated
    USING (public.can_manage_operations()) WITH CHECK (public.can_manage_operations());
  DROP POLICY IF EXISTS "gold_lots_admin_delete" ON public.gold_lots;
  CREATE POLICY "gold_lots_admin_delete" ON public.gold_lots FOR DELETE TO authenticated
    USING (public.can_manage_operations());

  DROP POLICY IF EXISTS "gold_lot_ingredients_admin_select" ON public.gold_lot_ingredients;
  CREATE POLICY "gold_lot_ingredients_admin_select" ON public.gold_lot_ingredients FOR SELECT TO authenticated
    USING (public.can_manage_operations());
  DROP POLICY IF EXISTS "gold_lot_ingredients_admin_insert" ON public.gold_lot_ingredients;
  CREATE POLICY "gold_lot_ingredients_admin_insert" ON public.gold_lot_ingredients FOR INSERT TO authenticated
    WITH CHECK (public.can_manage_operations());
  DROP POLICY IF EXISTS "gold_lot_ingredients_admin_update" ON public.gold_lot_ingredients;
  CREATE POLICY "gold_lot_ingredients_admin_update" ON public.gold_lot_ingredients FOR UPDATE TO authenticated
    USING (public.can_manage_operations()) WITH CHECK (public.can_manage_operations());
  DROP POLICY IF EXISTS "gold_lot_ingredients_admin_delete" ON public.gold_lot_ingredients;
  CREATE POLICY "gold_lot_ingredients_admin_delete" ON public.gold_lot_ingredients FOR DELETE TO authenticated
    USING (public.can_manage_operations());

  DROP POLICY IF EXISTS "gold_lot_handovers_admin_select" ON public.gold_lot_handovers;
  CREATE POLICY "gold_lot_handovers_admin_select" ON public.gold_lot_handovers FOR SELECT TO authenticated
    USING (public.can_manage_operations());
  DROP POLICY IF EXISTS "gold_lot_handovers_admin_insert" ON public.gold_lot_handovers;
  CREATE POLICY "gold_lot_handovers_admin_insert" ON public.gold_lot_handovers FOR INSERT TO authenticated
    WITH CHECK (public.can_manage_operations());
  DROP POLICY IF EXISTS "gold_lot_handovers_admin_update" ON public.gold_lot_handovers;
  CREATE POLICY "gold_lot_handovers_admin_update" ON public.gold_lot_handovers FOR UPDATE TO authenticated
    USING (public.can_manage_operations()) WITH CHECK (public.can_manage_operations());
  DROP POLICY IF EXISTS "gold_lot_handovers_admin_delete" ON public.gold_lot_handovers;
  CREATE POLICY "gold_lot_handovers_admin_delete" ON public.gold_lot_handovers FOR DELETE TO authenticated
    USING (public.can_manage_operations());
END;
$$;
