-- Rename customers → venues (serveringssted).
-- Gold Supply  = partners.kind = 'distributor'  (Villa Import)
-- Gold Partner = partners.kind = 'direct'       (Oslo Bar som partner + sted)
-- Serveringssted = venues                       (der gjestene spiser)
--
-- Kjør etter eksisterende skjema (customers-tabellen). Trygg nok til å kjøres én gang;
-- avbryter om venues allerede finnes.

DO $$
BEGIN
  IF to_regclass('public.venues') IS NOT NULL THEN
    RAISE NOTICE 'venues finnes allerede — hopper over rename.';
    RETURN;
  END IF;
  IF to_regclass('public.customers') IS NULL THEN
    RAISE EXCEPTION 'Fant ikke public.customers';
  END IF;

  ALTER TABLE public.customers RENAME TO venues;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN customer_id TO venue_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deliveries' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE public.deliveries RENAME COLUMN customer_id TO venue_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shift_reports' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE public.shift_reports RENAME COLUMN customer_id TO venue_id;
  END IF;
  IF to_regclass('public.venue_menu_items') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'venue_menu_items' AND column_name = 'customer_id'
     ) THEN
    ALTER TABLE public.venue_menu_items RENAME COLUMN customer_id TO venue_id;
  END IF;
END;
$$;

ALTER INDEX IF EXISTS idx_profiles_customer_id RENAME TO idx_profiles_venue_id;
ALTER INDEX IF EXISTS idx_deliveries_customer_id RENAME TO idx_deliveries_venue_id;
ALTER INDEX IF EXISTS idx_deliveries_delivered_at RENAME TO idx_deliveries_venue_delivered_at;
ALTER INDEX IF EXISTS idx_shift_reports_customer_id RENAME TO idx_shift_reports_venue_id;
ALTER INDEX IF EXISTS idx_venue_menu_items_customer RENAME TO idx_venue_menu_items_venue;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role')
     AND EXISTS (
       SELECT 1 FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'app_role' AND e.enumlabel = 'customer'
     ) THEN
    ALTER TYPE public.app_role RENAME VALUE 'customer' TO 'venue';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_customer_slug()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INT := 0;
BEGIN
  IF NEW.slug IS NOT NULL AND btrim(NEW.slug) <> '' THEN
    NEW.slug := public.slugify_name(NEW.slug);
    RETURN NEW;
  END IF;
  base := coalesce(public.slugify_name(NEW.name), 'sted');
  candidate := base;
  WHILE EXISTS (
    SELECT 1 FROM public.venues v WHERE v.slug = candidate AND v.id IS DISTINCT FROM NEW.id
  ) LOOP
    n := n + 1;
    candidate := base || '-' || n::TEXT;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_venue_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT venue_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_customer_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_venue_id();
$$;

REVOKE ALL ON FUNCTION public.current_venue_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_venue_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_customer_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_customer_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.flag_report_mismatch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  prev_stock INTEGER;
  prev_at TIMESTAMPTZ;
  delivered INTEGER;
  expected INTEGER;
BEGIN
  SELECT remaining_stock, created_at INTO prev_stock, prev_at
  FROM public.shift_reports
  WHERE venue_id = NEW.venue_id AND id <> NEW.id
  ORDER BY created_at DESC LIMIT 1;

  IF prev_stock IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(COALESCE(
    (SELECT actual_quantity_received FROM public.shift_reports r
     WHERE r.delivery_id = d.id AND r.delivery_correct = false LIMIT 1), d.quantity)), 0)
  INTO delivered
  FROM public.deliveries d
  WHERE d.venue_id = NEW.venue_id AND d.created_at > prev_at;

  expected := prev_stock + COALESCE(delivered, 0) - COALESCE(NEW.sold_this_shift, 0);

  IF ABS(expected - COALESCE(NEW.remaining_stock, 0)) > GREATEST(10, (expected * 0.1)::INTEGER) THEN
    NEW.needs_review := true;
    NEW.review_note := 'Expected approx. ' || expected || ' pcs left, reported ' || NEW.remaining_stock || ' pcs.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_username TEXT;
  meta_language TEXT;
  meta_venue_id UUID;
BEGIN
  meta_username := NULLIF(lower(trim(COALESCE(NEW.raw_user_meta_data->>'username', ''))), '');
  IF meta_username IS NULL OR meta_username = '' THEN
    meta_username := split_part(NEW.email, '@', 1);
  END IF;

  meta_language := COALESCE(NULLIF(NEW.raw_user_meta_data->>'language', ''), 'no');
  IF meta_language NOT IN ('no', 'en') THEN
    meta_language := 'no';
  END IF;

  BEGIN
    meta_venue_id := NULLIF(
      COALESCE(NEW.raw_user_meta_data->>'venue_id', NEW.raw_user_meta_data->>'customer_id'),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    meta_venue_id := NULL;
  END;

  INSERT INTO public.profiles (id, username, venue_id, preferred_language)
  VALUES (NEW.id, meta_username, meta_venue_id, meta_language)
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    venue_id = COALESCE(EXCLUDED.venue_id, public.profiles.venue_id),
    preferred_language = EXCLUDED.preferred_language;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "customers_select" ON public.venues;
DROP POLICY IF EXISTS "venues_select" ON public.venues;
CREATE POLICY "venues_select" ON public.venues FOR SELECT TO authenticated
  USING (public.is_admin() OR id = public.current_venue_id());
DROP POLICY IF EXISTS "customers_admin_insert" ON public.venues;
DROP POLICY IF EXISTS "venues_admin_insert" ON public.venues;
CREATE POLICY "venues_admin_insert" ON public.venues FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "customers_admin_update" ON public.venues;
DROP POLICY IF EXISTS "venues_admin_update" ON public.venues;
CREATE POLICY "venues_admin_update" ON public.venues FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "customers_admin_delete" ON public.venues;
DROP POLICY IF EXISTS "venues_admin_delete" ON public.venues;
CREATE POLICY "venues_admin_delete" ON public.venues FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND venue_id = public.current_venue_id());

DROP POLICY IF EXISTS "deliveries_select" ON public.deliveries;
CREATE POLICY "deliveries_select" ON public.deliveries FOR SELECT TO authenticated
  USING (public.is_admin() OR venue_id = public.current_venue_id());

DROP POLICY IF EXISTS "shift_reports_select" ON public.shift_reports;
CREATE POLICY "shift_reports_select" ON public.shift_reports FOR SELECT TO authenticated
  USING (public.is_admin() OR venue_id = public.current_venue_id());
DROP POLICY IF EXISTS "shift_reports_customer_insert" ON public.shift_reports;
DROP POLICY IF EXISTS "shift_reports_venue_insert" ON public.shift_reports;
CREATE POLICY "shift_reports_venue_insert" ON public.shift_reports FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid() AND (public.is_admin() OR venue_id = public.current_venue_id()));

DROP POLICY IF EXISTS "partners_admin_select" ON public.partners;
CREATE POLICY "partners_admin_select" ON public.partners FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR id = (SELECT partner_id FROM public.venues WHERE id = public.current_venue_id())
  );

DROP POLICY IF EXISTS "menu_select" ON public.venue_menu_items;
CREATE POLICY "menu_select" ON public.venue_menu_items FOR SELECT TO authenticated
  USING (public.is_admin() OR venue_id = public.current_venue_id());

DO $$
BEGIN
  IF to_regclass('public.shift_report_lines') IS NOT NULL THEN
    DROP POLICY IF EXISTS "shift_report_lines_select" ON public.shift_report_lines;
    CREATE POLICY "shift_report_lines_select" ON public.shift_report_lines FOR SELECT TO authenticated
      USING (
        public.is_admin()
        OR EXISTS (
          SELECT 1 FROM public.shift_reports r
          WHERE r.id = shift_report_id
            AND r.venue_id = public.current_venue_id()
        )
      );

    DROP POLICY IF EXISTS "shift_report_lines_insert" ON public.shift_report_lines;
    CREATE POLICY "shift_report_lines_insert" ON public.shift_report_lines FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.shift_reports r
          WHERE r.id = shift_report_id
            AND r.submitted_by = auth.uid()
            AND (public.is_admin() OR r.venue_id = public.current_venue_id())
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'submit_shift_report'
  ) THEN
    DROP FUNCTION public.submit_shift_report(
      UUID, UUID, BOOLEAN, INTEGER, public.feedback_rating, TEXT, BOOLEAN, TEXT, JSONB
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_shift_report(
  p_venue_id UUID,
  p_delivery_id UUID DEFAULT NULL,
  p_delivery_correct BOOLEAN DEFAULT NULL,
  p_actual_quantity_received INTEGER DEFAULT NULL,
  p_guest_feedback_rating public.feedback_rating DEFAULT NULL,
  p_guest_feedback_text TEXT DEFAULT NULL,
  p_preparation_issue BOOLEAN DEFAULT false,
  p_preparation_issue_text TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_sold INTEGER := 0;
  v_stock INTEGER := 0;
  v_next INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_admin() OR p_venue_id = public.current_venue_id()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array';
  END IF;

  SELECT
    COALESCE(SUM(GREATEST(COALESCE((elem->>'sold')::INTEGER, 0), 0)), 0),
    COALESCE(SUM(GREATEST(COALESCE((elem->>'remaining_stock')::INTEGER, 0), 0)), 0),
    COALESCE(SUM(GREATEST(COALESCE((elem->>'next_required_quantity')::INTEGER, 0), 0)), 0)
  INTO v_sold, v_stock, v_next
  FROM jsonb_array_elements(p_lines) AS elem;

  INSERT INTO public.shift_reports (
    venue_id,
    submitted_by,
    delivery_id,
    delivery_correct,
    actual_quantity_received,
    sold_this_shift,
    remaining_stock,
    guest_feedback_rating,
    guest_feedback_text,
    preparation_issue,
    preparation_issue_text,
    next_required_quantity
  ) VALUES (
    p_venue_id,
    auth.uid(),
    p_delivery_id,
    p_delivery_correct,
    p_actual_quantity_received,
    v_sold,
    v_stock,
    p_guest_feedback_rating,
    NULLIF(btrim(COALESCE(p_guest_feedback_text, '')), ''),
    COALESCE(p_preparation_issue, false),
    CASE
      WHEN COALESCE(p_preparation_issue, false)
        THEN NULLIF(btrim(COALESCE(p_preparation_issue_text, '')), '')
      ELSE NULL
    END,
    v_next
  )
  RETURNING id INTO v_id;

  IF to_regclass('public.shift_report_lines') IS NOT NULL THEN
    INSERT INTO public.shift_report_lines (
      shift_report_id, product_id, sold, remaining_stock, next_required_quantity
    )
    SELECT
      v_id,
      (elem->>'product_id')::UUID,
      GREATEST(COALESCE((elem->>'sold')::INTEGER, 0), 0),
      GREATEST(COALESCE((elem->>'remaining_stock')::INTEGER, 0), 0),
      GREATEST(COALESCE((elem->>'next_required_quantity')::INTEGER, 0), 0)
    FROM jsonb_array_elements(p_lines) AS elem
    WHERE NULLIF(elem->>'product_id', '') IS NOT NULL;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_shift_report(
  UUID, UUID, BOOLEAN, INTEGER, public.feedback_rating, TEXT, BOOLEAN, TEXT, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_shift_report(
  UUID, UUID, BOOLEAN, INTEGER, public.feedback_rating, TEXT, BOOLEAN, TEXT, JSONB
) TO service_role;
