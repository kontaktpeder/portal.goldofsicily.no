-- Domenegrunnlag: kunde er identiteten.
-- type = hva virksomheten er (venue | wholesaler)
-- partnership_level = avtalen (gold_partner | gold_supply | null), aldri utledet fra type
-- supplied_by_customer_id = venue → wholesaler, aldri selvreferanse
-- public_visible og public_profile settes eksplisitt, aldri fra partnership_level
-- levering og LOT-overlevering peker på customer_id
-- recipient_company på gold_lot_handovers beholdes som navnesnapshot
--
-- Fjerner partners, partners.kind, venues.partner_id, recipient_partner_id og recipient_venue_id.
-- Også: sql/16_customer_domain.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_type') THEN
    CREATE TYPE public.customer_type AS ENUM ('venue', 'wholesaler');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'partnership_level') THEN
    CREATE TYPE public.partnership_level AS ENUM ('gold_partner', 'gold_supply');
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.venues') IS NOT NULL AND to_regclass('public.customers') IS NOT NULL THEN
    RAISE EXCEPTION 'both venues and customers exist';
  END IF;
  IF to_regclass('public.venues') IS NOT NULL THEN
    ALTER TABLE public.venues RENAME TO customers;
  END IF;
  IF to_regclass('public.customers') IS NULL THEN
    RAISE EXCEPTION 'Fant ikke public.customers';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'venue_id'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN venue_id TO customer_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deliveries' AND column_name = 'venue_id'
  ) THEN
    ALTER TABLE public.deliveries RENAME COLUMN venue_id TO customer_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shift_reports' AND column_name = 'venue_id'
  ) THEN
    ALTER TABLE public.shift_reports RENAME COLUMN venue_id TO customer_id;
  END IF;
  IF to_regclass('public.venue_menu_items') IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venue_menu_items' AND column_name = 'venue_id'
  ) THEN
    ALTER TABLE public.venue_menu_items RENAME COLUMN venue_id TO customer_id;
  END IF;
END;
$$;

ALTER INDEX IF EXISTS idx_profiles_venue_id RENAME TO idx_profiles_customer_id;
ALTER INDEX IF EXISTS idx_deliveries_venue_id RENAME TO idx_deliveries_customer_id;
ALTER INDEX IF EXISTS idx_deliveries_venue_delivered_at RENAME TO idx_deliveries_customer_delivered_at;
ALTER INDEX IF EXISTS idx_shift_reports_venue_id RENAME TO idx_shift_reports_customer_id;
ALTER INDEX IF EXISTS idx_venue_menu_items_venue RENAME TO idx_venue_menu_items_customer;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS type public.customer_type NOT NULL DEFAULT 'venue',
  ADD COLUMN IF NOT EXISTS partnership_level public.partnership_level,
  ADD COLUMN IF NOT EXISTS supplied_by_customer_id UUID,
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.customers ALTER COLUMN public_profile DROP NOT NULL;
ALTER TABLE public.customers ALTER COLUMN public_profile DROP DEFAULT;
ALTER TABLE public.customers ALTER COLUMN public_profile SET DEFAULT NULL;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS venues_public_profile_check;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_public_profile_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_public_profile_check
  CHECK (public_profile IS NULL OR public_profile IN ('listing', 'partner'));

-- Slug-triggeren må kjenne customers før grossister settes inn.
CREATE OR REPLACE FUNCTION public.ensure_customer_slug()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INT := 0;
BEGIN
  IF NEW.type = 'wholesaler' THEN
    NEW.slug := NULL;
    RETURN NEW;
  END IF;
  IF NEW.slug IS NOT NULL AND btrim(NEW.slug) <> '' THEN
    NEW.slug := public.slugify_name(NEW.slug);
    RETURN NEW;
  END IF;
  base := coalesce(public.slugify_name(NEW.name), 'sted');
  candidate := base;
  WHILE EXISTS (
    SELECT 1 FROM public.customers c WHERE c.slug = candidate AND c.id IS DISTINCT FROM NEW.id
  ) LOOP
    n := n + 1;
    candidate := base || '-' || n::TEXT;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_customer_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT customer_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_venue_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_customer_id();
$$;

DO $$
DECLARE
  partner RECORD;
  target_id UUID;
  linked_count INT;
  name_match UUID;
BEGIN
  IF to_regclass('public.partners') IS NULL THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE partner_customer_map (
    partner_id UUID PRIMARY KEY,
    customer_id UUID NOT NULL
  ) ON COMMIT DROP;

  FOR partner IN SELECT * FROM public.partners LOOP
    IF partner.kind::text = 'distributor' THEN
      INSERT INTO public.customers (
        name, type, partnership_level, active, contact_name, email, phone, notes,
        public_visible, public_profile, default_language
      ) VALUES (
        partner.name, 'wholesaler', 'gold_supply', partner.active,
        partner.contact_name, partner.email, partner.phone, partner.notes,
        false, NULL, 'no'
      )
      RETURNING id INTO target_id;

      INSERT INTO partner_customer_map (partner_id, customer_id) VALUES (partner.id, target_id);

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'partner_id'
      ) THEN
        UPDATE public.customers
        SET supplied_by_customer_id = target_id
        WHERE partner_id = partner.id
          AND type = 'venue';
      END IF;
    ELSE
      name_match := NULL;
      linked_count := 0;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'partner_id'
      ) THEN
        SELECT count(*) INTO linked_count
        FROM public.customers
        WHERE partner_id = partner.id AND type = 'venue';

        SELECT id INTO name_match
        FROM public.customers
        WHERE partner_id = partner.id
          AND type = 'venue'
          AND lower(btrim(name)) = lower(btrim(partner.name))
        ORDER BY created_at
        LIMIT 1;
      END IF;

      IF name_match IS NOT NULL THEN
        target_id := name_match;
      ELSIF linked_count = 1 THEN
        SELECT id INTO target_id
        FROM public.customers
        WHERE partner_id = partner.id AND type = 'venue'
        LIMIT 1;
      ELSE
        target_id := NULL;
      END IF;

      IF target_id IS NULL THEN
        INSERT INTO public.customers (
          name, type, partnership_level, active, contact_name, email, phone, notes,
          public_visible, public_profile, default_language
        ) VALUES (
          partner.name, 'venue', 'gold_partner', partner.active,
          partner.contact_name, partner.email, partner.phone, partner.notes,
          false, NULL, 'no'
        )
        RETURNING id INTO target_id;
      ELSE
        UPDATE public.customers
        SET
          partnership_level = 'gold_partner',
          contact_name = COALESCE(contact_name, partner.contact_name),
          email = COALESCE(email, partner.email),
          phone = COALESCE(phone, partner.phone),
          notes = COALESCE(notes, partner.notes)
        WHERE id = target_id;
      END IF;

      INSERT INTO partner_customer_map (partner_id, customer_id) VALUES (partner.id, target_id);
    END IF;
  END LOOP;

  IF to_regclass('public.gold_lot_handovers') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'gold_lot_handovers' AND column_name = 'recipient_partner_id'
     ) THEN
    ALTER TABLE public.gold_lot_handovers
      ADD COLUMN IF NOT EXISTS customer_id UUID;

    UPDATE public.gold_lot_handovers h
    SET customer_id = COALESCE(
      h.recipient_venue_id,
      (SELECT m.customer_id FROM partner_customer_map m WHERE m.partner_id = h.recipient_partner_id)
    )
    WHERE h.customer_id IS NULL;
  END IF;
END;
$$;

ALTER TABLE public.gold_lot_handovers
  ADD COLUMN IF NOT EXISTS customer_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gold_lot_handovers_customer_id_fkey'
  ) THEN
    ALTER TABLE public.gold_lot_handovers
      ADD CONSTRAINT gold_lot_handovers_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_supplied_by_customer_id_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_supplied_by_customer_id_fkey
      FOREIGN KEY (supplied_by_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_customers_type ON public.customers(type);
CREATE INDEX IF NOT EXISTS idx_customers_supplied_by ON public.customers(supplied_by_customer_id);
CREATE INDEX IF NOT EXISTS idx_gold_lot_handovers_customer ON public.gold_lot_handovers(customer_id);

ALTER TABLE public.gold_lot_handovers DROP CONSTRAINT IF EXISTS gold_lot_handovers_recipient_partner_id_fkey;
ALTER TABLE public.gold_lot_handovers DROP CONSTRAINT IF EXISTS gold_lot_handovers_recipient_venue_id_fkey;
ALTER TABLE public.gold_lot_handovers DROP COLUMN IF EXISTS recipient_partner_id;
ALTER TABLE public.gold_lot_handovers DROP COLUMN IF EXISTS recipient_venue_id;

DO $$
BEGIN
  IF to_regclass('public.partners') IS NOT NULL THEN
    DROP POLICY IF EXISTS "partners_admin_select" ON public.partners;
    DROP POLICY IF EXISTS "partners_admin_insert" ON public.partners;
    DROP POLICY IF EXISTS "partners_admin_update" ON public.partners;
    DROP POLICY IF EXISTS "partners_admin_delete" ON public.partners;
  END IF;
END;
$$;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_partner_id_fkey;
ALTER TABLE public.customers DROP COLUMN IF EXISTS partner_id;

DROP TABLE IF EXISTS public.partners;
DROP TYPE IF EXISTS public.partner_kind;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_shape_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_shape_check
  CHECK (
    supplied_by_customer_id IS DISTINCT FROM id
    AND (
      type = 'venue'
      OR (
        type = 'wholesaler'
        AND public_profile IS NULL
        AND public_visible = false
        AND supplied_by_customer_id IS NULL
        AND slug IS NULL
      )
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_customer_invariants()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  supplier_type public.customer_type;
BEGIN
  IF NEW.supplied_by_customer_id IS NOT NULL THEN
    IF NEW.type <> 'venue' THEN
      RAISE EXCEPTION 'supplied_by_customer_id is only for venues';
    END IF;
    SELECT c.type INTO supplier_type
    FROM public.customers c
    WHERE c.id = NEW.supplied_by_customer_id;
    IF supplier_type IS DISTINCT FROM 'wholesaler' THEN
      RAISE EXCEPTION 'supplied_by_customer_id must reference a wholesaler';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_invariants ON public.customers;
CREATE TRIGGER trg_customers_invariants
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_invariants();

CREATE OR REPLACE FUNCTION public.enforce_venue_customer()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  ctype public.customer_type;
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.type INTO ctype FROM public.customers c WHERE c.id = NEW.customer_id;
  IF ctype IS DISTINCT FROM 'venue' THEN
    RAISE EXCEPTION 'only a venue can own this record';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shift_reports_venue_customer ON public.shift_reports;
CREATE TRIGGER trg_shift_reports_venue_customer
BEFORE INSERT OR UPDATE OF customer_id ON public.shift_reports
FOR EACH ROW EXECUTE FUNCTION public.enforce_venue_customer();

DROP TRIGGER IF EXISTS trg_venue_menu_items_venue_customer ON public.venue_menu_items;
CREATE TRIGGER trg_venue_menu_items_venue_customer
BEFORE INSERT OR UPDATE OF customer_id ON public.venue_menu_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_venue_customer();

DROP TRIGGER IF EXISTS trg_profiles_venue_customer ON public.profiles;
CREATE TRIGGER trg_profiles_venue_customer
BEFORE INSERT OR UPDATE OF customer_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_venue_customer();

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
  WHERE customer_id = NEW.customer_id AND id <> NEW.id
  ORDER BY created_at DESC LIMIT 1;

  IF prev_stock IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(COALESCE(
    (SELECT actual_quantity_received FROM public.shift_reports r
     WHERE r.delivery_id = d.id AND r.delivery_correct = false LIMIT 1), d.quantity)), 0)
  INTO delivered
  FROM public.deliveries d
  WHERE d.customer_id = NEW.customer_id AND d.created_at > prev_at;

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
  meta_customer_id UUID;
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
    meta_customer_id := NULLIF(NEW.raw_user_meta_data->>'customer_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    meta_customer_id := NULL;
  END;

  INSERT INTO public.profiles (id, username, customer_id, preferred_language)
  VALUES (NEW.id, meta_username, meta_customer_id, meta_language)
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    customer_id = COALESCE(EXCLUDED.customer_id, public.profiles.customer_id),
    preferred_language = EXCLUDED.preferred_language;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.submit_shift_report(
  UUID, UUID, BOOLEAN, INTEGER, public.feedback_rating, TEXT, BOOLEAN, TEXT, JSONB
);

CREATE OR REPLACE FUNCTION public.submit_shift_report(
  p_customer_id UUID,
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
  v_type public.customer_type;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_admin() OR p_customer_id = public.current_customer_id()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT c.type INTO v_type FROM public.customers c WHERE c.id = p_customer_id;
  IF v_type IS DISTINCT FROM 'venue' THEN
    RAISE EXCEPTION 'shift reports are only for venues';
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
    customer_id,
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
    p_customer_id,
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

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_shift_report(
  UUID, UUID, BOOLEAN, INTEGER, public.feedback_rating, TEXT, BOOLEAN, TEXT, JSONB
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.current_customer_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_customer_id() TO authenticated, service_role;

DROP POLICY IF EXISTS "venues_select" ON public.customers;
DROP POLICY IF EXISTS "customers_select" ON public.customers;
CREATE POLICY "customers_select" ON public.customers FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR id = public.current_customer_id());

DROP POLICY IF EXISTS "venues_admin_insert" ON public.customers;
DROP POLICY IF EXISTS "customers_admin_insert" ON public.customers;
CREATE POLICY "customers_admin_insert" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "venues_admin_update" ON public.customers;
DROP POLICY IF EXISTS "customers_admin_update" ON public.customers;
CREATE POLICY "customers_admin_update" ON public.customers FOR UPDATE TO authenticated
  USING (public.can_manage_commercial()) WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "venues_admin_delete" ON public.customers;
DROP POLICY IF EXISTS "customers_admin_delete" ON public.customers;
CREATE POLICY "customers_admin_delete" ON public.customers FOR DELETE TO authenticated
  USING (public.can_manage_commercial());

DROP POLICY IF EXISTS "venues_public_read" ON public.customers;
DROP POLICY IF EXISTS "customers_public_read" ON public.customers;
CREATE POLICY "customers_public_read" ON public.customers
  FOR SELECT TO anon, authenticated
  USING (
    type = 'venue'
    AND active = true
    AND public_visible = true
    AND slug IS NOT NULL
  );

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND customer_id IS NOT DISTINCT FROM public.current_customer_id());

DROP POLICY IF EXISTS "deliveries_select" ON public.deliveries;
CREATE POLICY "deliveries_select" ON public.deliveries FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR customer_id = public.current_customer_id());

DROP POLICY IF EXISTS "shift_reports_select" ON public.shift_reports;
CREATE POLICY "shift_reports_select" ON public.shift_reports FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR customer_id = public.current_customer_id());

DROP POLICY IF EXISTS "shift_reports_customer_insert" ON public.shift_reports;
DROP POLICY IF EXISTS "shift_reports_venue_insert" ON public.shift_reports;
CREATE POLICY "shift_reports_customer_insert" ON public.shift_reports FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    AND (public.is_admin() OR customer_id = public.current_customer_id())
  );

DROP POLICY IF EXISTS "menu_select" ON public.venue_menu_items;
CREATE POLICY "menu_select" ON public.venue_menu_items FOR SELECT TO authenticated
  USING (public.is_admin() OR customer_id = public.current_customer_id());

DROP POLICY IF EXISTS "menu_public_read" ON public.venue_menu_items;
CREATE POLICY "menu_public_read" ON public.venue_menu_items
  FOR SELECT TO anon, authenticated
  USING (
    available = true
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_id
        AND c.type = 'venue'
        AND c.active = true
        AND c.public_visible = true
        AND c.slug IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "shift_report_lines_select" ON public.shift_report_lines;
CREATE POLICY "shift_report_lines_select" ON public.shift_report_lines FOR SELECT TO authenticated
  USING (
    public.can_manage_operations()
    OR EXISTS (
      SELECT 1 FROM public.shift_reports r
      WHERE r.id = shift_report_id
        AND r.customer_id = public.current_customer_id()
    )
  );

DROP POLICY IF EXISTS "shift_report_lines_insert" ON public.shift_report_lines;
CREATE POLICY "shift_report_lines_insert" ON public.shift_report_lines FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shift_reports r
      WHERE r.id = shift_report_id
        AND r.submitted_by = auth.uid()
        AND (public.is_admin() OR r.customer_id = public.current_customer_id())
    )
  );

DROP POLICY IF EXISTS "delivery_lines_select" ON public.delivery_lines;
CREATE POLICY "delivery_lines_select" ON public.delivery_lines FOR SELECT TO authenticated
  USING (
    public.can_manage_operations()
    OR EXISTS (
      SELECT 1 FROM public.deliveries d
      WHERE d.id = delivery_id
        AND d.customer_id = public.current_customer_id()
    )
  );

DROP POLICY IF EXISTS "gold_lots_select" ON public.gold_lots;
CREATE POLICY "gold_lots_select" ON public.gold_lots FOR SELECT TO authenticated
  USING (
    public.can_manage_operations()
    OR EXISTS (
      SELECT 1 FROM public.delivery_lines dl
      JOIN public.deliveries d ON d.id = dl.delivery_id
      WHERE dl.gold_lot_id = gold_lots.id
        AND d.customer_id = public.current_customer_id()
    )
  );

DROP POLICY IF EXISTS "venue_menus_insert_managers" ON storage.objects;
CREATE POLICY "venue_menus_insert_managers"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'venue-menus'
  AND (
    public.is_admin()
    OR split_part(name, '/', 1) = public.current_customer_id()::text
  )
);

DROP POLICY IF EXISTS "venue_menus_update_managers" ON storage.objects;
CREATE POLICY "venue_menus_update_managers"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'venue-menus'
  AND (
    public.is_admin()
    OR split_part(name, '/', 1) = public.current_customer_id()::text
  )
)
WITH CHECK (
  bucket_id = 'venue-menus'
  AND (
    public.is_admin()
    OR split_part(name, '/', 1) = public.current_customer_id()::text
  )
);

DROP POLICY IF EXISTS "venue_menus_delete_managers" ON storage.objects;
CREATE POLICY "venue_menus_delete_managers"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'venue-menus'
  AND (
    public.is_admin()
    OR split_part(name, '/', 1) = public.current_customer_id()::text
  )
);

DROP FUNCTION IF EXISTS public.current_venue_id();
