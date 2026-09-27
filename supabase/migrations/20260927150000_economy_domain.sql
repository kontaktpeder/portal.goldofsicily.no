-- Økonomidomene.
-- legal_entities er den juridiske identiteten, ikke en ny variant av customers.
-- Kommersiell kanal og pris fryses når leveransen settes inn.
-- Fakturagrunnlag stopper i portalen. DNB-feltene er bare plassholdere.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commercial_route') THEN
    CREATE TYPE public.commercial_route AS ENUM ('direct', 'via_wholesaler');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_draft_status') THEN
    CREATE TYPE public.invoice_draft_status AS ENUM ('draft', 'sent', 'credited', 'cancelled');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.legal_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_number TEXT NOT NULL UNIQUE,
  parent_legal_entity_id UUID,
  legal_name TEXT NOT NULL,
  organization_form TEXT,
  business_address TEXT,
  postal_address TEXT,
  vat_registered BOOLEAN NOT NULL DEFAULT false,
  brreg_data JSONB,
  brreg_synced_at TIMESTAMPTZ,
  accounting_customer_id TEXT,
  accounting_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT legal_entities_orgnr_check CHECK (organization_number ~ '^[0-9]{9}$'),
  CONSTRAINT legal_entities_not_self CHECK (parent_legal_entity_id IS DISTINCT FROM id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'legal_entities_parent_legal_entity_id_fkey'
  ) THEN
    ALTER TABLE public.legal_entities
      ADD CONSTRAINT legal_entities_parent_legal_entity_id_fkey
      FOREIGN KEY (parent_legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_legal_entities_parent ON public.legal_entities(parent_legal_entity_id);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS legal_entity_id UUID,
  ADD COLUMN IF NOT EXISTS billing_legal_entity_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_legal_entity_id_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_legal_entity_id_fkey
      FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_billing_legal_entity_id_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_billing_legal_entity_id_fkey
      FOREIGN KEY (billing_legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_customers_legal_entity ON public.customers(legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_customers_billing_legal_entity ON public.customers(billing_legal_entity_id);

-- Engangs-snapshot av kanalen slik den er nå. Senere endringer på kunden rører ikke raden.
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS commercial_route public.commercial_route,
  ADD COLUMN IF NOT EXISTS wholesaler_customer_id UUID,
  ADD COLUMN IF NOT EXISTS customer_name_snapshot TEXT;

UPDATE public.deliveries d
SET
  customer_name_snapshot = c.name,
  commercial_route = CASE
    WHEN c.type = 'wholesaler' OR c.supplied_by_customer_id IS NULL THEN 'direct'::public.commercial_route
    ELSE 'via_wholesaler'::public.commercial_route
  END,
  wholesaler_customer_id = CASE
    WHEN c.type = 'venue' AND c.supplied_by_customer_id IS NOT NULL THEN c.supplied_by_customer_id
    ELSE NULL
  END
FROM public.customers c
WHERE c.id = d.customer_id
  AND d.commercial_route IS NULL;

ALTER TABLE public.deliveries
  ALTER COLUMN commercial_route SET NOT NULL,
  ALTER COLUMN customer_name_snapshot SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deliveries_wholesaler_customer_id_fkey'
  ) THEN
    ALTER TABLE public.deliveries
      ADD CONSTRAINT deliveries_wholesaler_customer_id_fkey
      FOREIGN KEY (wholesaler_customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

ALTER TABLE public.deliveries DROP CONSTRAINT IF EXISTS deliveries_commercial_route_check;
ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_commercial_route_check
  CHECK (
    (commercial_route = 'direct' AND wholesaler_customer_id IS NULL)
    OR (commercial_route = 'via_wholesaler' AND wholesaler_customer_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_deliveries_commercial_route ON public.deliveries(commercial_route);
CREATE INDEX IF NOT EXISTS idx_deliveries_wholesaler ON public.deliveries(wholesaler_customer_id);

ALTER TABLE public.delivery_lines
  ADD COLUMN IF NOT EXISTS unit_price_ore INTEGER,
  ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT;

-- Historiske linjer kan ha quantity > 0 og gold_lot_id NULL.
-- CHECK-en er NOT VALID, men Postgres validerer den likevel når raden oppdateres,
-- også når bare product_name_snapshot eller unit_price_ore endres.
-- Triggeren trg_enforce_delivery_line_lot håndhever fortsatt kravet ved INSERT
-- og ved endring av quantity, gold_lot_id eller product_id.
-- Prisfrys senere er også en UPDATE, så CHECK-en skal ikke legges tilbake.
ALTER TABLE public.delivery_lines
  DROP CONSTRAINT IF EXISTS delivery_lines_quantity_requires_gold_lot;

DROP TRIGGER IF EXISTS trg_delivery_lines_snapshot_price ON public.delivery_lines;

UPDATE public.delivery_lines dl
SET product_name_snapshot = p.name_no
FROM public.products p
WHERE p.id = dl.product_id
  AND dl.product_name_snapshot IS NULL;

UPDATE public.delivery_lines
SET product_name_snapshot = 'Ukjent produkt'
WHERE product_name_snapshot IS NULL;

ALTER TABLE public.delivery_lines
  ALTER COLUMN product_name_snapshot SET NOT NULL;

ALTER TABLE public.delivery_lines DROP CONSTRAINT IF EXISTS delivery_lines_unit_price_ore_check;
ALTER TABLE public.delivery_lines
  ADD CONSTRAINT delivery_lines_unit_price_ore_check
  CHECK (unit_price_ore IS NULL OR unit_price_ore > 0);

CREATE TABLE IF NOT EXISTS public.customer_product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  price_ore INTEGER NOT NULL CHECK (price_ore > 0),
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_product_prices_range_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_customer_product_prices_lookup
  ON public.customer_product_prices(customer_id, product_id, valid_from);

CREATE TABLE IF NOT EXISTS public.invoice_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id UUID NOT NULL REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  legal_name_snapshot TEXT NOT NULL,
  organization_number_snapshot TEXT NOT NULL,
  status public.invoice_draft_status NOT NULL DEFAULT 'draft',
  accounting_invoice_id TEXT,
  accounting_invoice_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_drafts_legal_entity ON public.invoice_drafts(legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_invoice_drafts_status ON public.invoice_drafts(status);

CREATE TABLE IF NOT EXISTS public.invoice_draft_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_draft_id UUID NOT NULL REFERENCES public.invoice_drafts(id) ON DELETE CASCADE,
  delivery_line_id UUID NOT NULL REFERENCES public.delivery_lines(id) ON DELETE RESTRICT,
  venue_name_snapshot TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_ore INTEGER NOT NULL CHECK (unit_price_ore > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_draft_lines_one_active
  ON public.invoice_draft_lines(delivery_line_id)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_invoice_draft_lines_draft ON public.invoice_draft_lines(invoice_draft_id);

CREATE OR REPLACE FUNCTION public.enforce_legal_entity_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_parent UUID;
  child_count INT;
BEGIN
  IF NEW.parent_legal_entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parent_legal_entity_id INTO parent_parent
  FROM public.legal_entities
  WHERE id = NEW.parent_legal_entity_id;

  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'a subunit must point at a hovedenhet';
  END IF;

  SELECT count(*) INTO child_count
  FROM public.legal_entities
  WHERE parent_legal_entity_id = NEW.id;

  IF child_count > 0 THEN
    RAISE EXCEPTION 'a hovedenhet with subunits cannot become a subunit';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_entities_parent ON public.legal_entities;
CREATE TRIGGER trg_legal_entities_parent
BEFORE INSERT OR UPDATE OF parent_legal_entity_id ON public.legal_entities
FOR EACH ROW EXECUTE FUNCTION public.enforce_legal_entity_parent();

DROP TRIGGER IF EXISTS trg_legal_entities_updated_at ON public.legal_entities;
CREATE TRIGGER trg_legal_entities_updated_at
BEFORE UPDATE ON public.legal_entities
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.resolve_billing_legal_entity(p_customer_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN c.billing_legal_entity_id IS NOT NULL THEN c.billing_legal_entity_id
    WHEN e.parent_legal_entity_id IS NOT NULL THEN e.parent_legal_entity_id
    ELSE c.legal_entity_id
  END
  FROM public.customers c
  LEFT JOIN public.legal_entities e ON e.id = c.legal_entity_id
  WHERE c.id = p_customer_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_billing_legal_entity(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_billing_legal_entity(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.price_ore_at(p_customer_id UUID, p_product_id UUID, p_on DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT price_ore
  FROM public.customer_product_prices
  WHERE customer_id = p_customer_id
    AND product_id = p_product_id
    AND valid_from <= p_on
    AND (valid_to IS NULL OR valid_to >= p_on)
  ORDER BY valid_from DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.price_ore_at(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.price_ore_at(UUID, UUID, DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.snapshot_delivery_commerce()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cust public.customers%ROWTYPE;
BEGIN
  SELECT * INTO cust FROM public.customers WHERE id = NEW.customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery customer is missing';
  END IF;

  NEW.customer_name_snapshot := cust.name;
  IF cust.type = 'wholesaler' OR cust.supplied_by_customer_id IS NULL THEN
    NEW.commercial_route := 'direct';
    NEW.wholesaler_customer_id := NULL;
  ELSE
    NEW.commercial_route := 'via_wholesaler';
    NEW.wholesaler_customer_id := cust.supplied_by_customer_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.freeze_delivery_commerce()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.commercial_route := OLD.commercial_route;
  NEW.wholesaler_customer_id := OLD.wholesaler_customer_id;
  NEW.customer_name_snapshot := OLD.customer_name_snapshot;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deliveries_snapshot_commerce ON public.deliveries;
CREATE TRIGGER trg_deliveries_snapshot_commerce
BEFORE INSERT ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.snapshot_delivery_commerce();

DROP TRIGGER IF EXISTS trg_deliveries_freeze_commerce ON public.deliveries;
CREATE TRIGGER trg_deliveries_freeze_commerce
BEFORE UPDATE ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.freeze_delivery_commerce();

CREATE OR REPLACE FUNCTION public.snapshot_delivery_line_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery public.deliveries%ROWTYPE;
  looked_up INTEGER;
  product_name TEXT;
BEGIN
  SELECT * INTO delivery FROM public.deliveries WHERE id = NEW.delivery_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery is missing';
  END IF;

  SELECT name_no INTO product_name FROM public.products WHERE id = NEW.product_id;
  IF product_name IS NULL THEN
    RAISE EXCEPTION 'product is missing';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.product_name_snapshot := product_name;
    IF delivery.commercial_route = 'via_wholesaler' THEN
      NEW.unit_price_ore := NULL;
      RETURN NEW;
    END IF;
    looked_up := public.price_ore_at(delivery.customer_id, NEW.product_id, delivery.delivered_at);
    IF looked_up IS NULL THEN
      RAISE EXCEPTION 'missing price snapshot';
    END IF;
    NEW.unit_price_ore := looked_up;
    RETURN NEW;
  END IF;

  IF OLD.product_name_snapshot IS NOT NULL THEN
    NEW.product_name_snapshot := OLD.product_name_snapshot;
  ELSE
    NEW.product_name_snapshot := product_name;
  END IF;

  IF OLD.unit_price_ore IS NOT NULL THEN
    NEW.unit_price_ore := OLD.unit_price_ore;
    RETURN NEW;
  END IF;

  IF delivery.commercial_route = 'via_wholesaler' OR NEW.unit_price_ore IS NULL THEN
    NEW.unit_price_ore := NULL;
    RETURN NEW;
  END IF;

  looked_up := public.price_ore_at(delivery.customer_id, NEW.product_id, delivery.delivered_at);
  IF looked_up IS NULL THEN
    RAISE EXCEPTION 'missing price snapshot';
  END IF;
  NEW.unit_price_ore := looked_up;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_lines_snapshot_price ON public.delivery_lines;
CREATE TRIGGER trg_delivery_lines_snapshot_price
BEFORE INSERT OR UPDATE ON public.delivery_lines
FOR EACH ROW EXECUTE FUNCTION public.snapshot_delivery_line_price();

CREATE OR REPLACE FUNCTION public.reject_overlapping_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customer_product_prices p
    WHERE p.customer_id = NEW.customer_id
      AND p.product_id = NEW.product_id
      AND p.id IS DISTINCT FROM NEW.id
      AND daterange(p.valid_from, COALESCE(p.valid_to, 'infinity'::date), '[]')
          && daterange(NEW.valid_from, COALESCE(NEW.valid_to, 'infinity'::date), '[]')
  ) THEN
    RAISE EXCEPTION 'overlapping customer price';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_product_prices_overlap ON public.customer_product_prices;
CREATE TRIGGER trg_customer_product_prices_overlap
BEFORE INSERT OR UPDATE ON public.customer_product_prices
FOR EACH ROW EXECUTE FUNCTION public.reject_overlapping_prices();

CREATE OR REPLACE FUNCTION public.snapshot_invoice_draft()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entity public.legal_entities%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.legal_entity_id := OLD.legal_entity_id;
    NEW.legal_name_snapshot := OLD.legal_name_snapshot;
    NEW.organization_number_snapshot := OLD.organization_number_snapshot;
    IF OLD.status IN ('credited', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'a closed invoice draft stays closed';
    END IF;
    IF OLD.status = 'sent' AND NEW.status NOT IN ('sent', 'credited', 'cancelled') THEN
      RAISE EXCEPTION 'a sent invoice draft can only be credited or cancelled';
    END IF;
    IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'sent', 'cancelled') THEN
      RAISE EXCEPTION 'a draft can be sent or cancelled';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO entity FROM public.legal_entities WHERE id = NEW.legal_entity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice recipient is missing';
  END IF;
  NEW.legal_name_snapshot := entity.legal_name;
  NEW.organization_number_snapshot := entity.organization_number;
  NEW.status := 'draft';
  NEW.accounting_invoice_id := NULL;
  NEW.accounting_invoice_number := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_drafts_snapshot ON public.invoice_drafts;
CREATE TRIGGER trg_invoice_drafts_snapshot
BEFORE INSERT OR UPDATE ON public.invoice_drafts
FOR EACH ROW EXECUTE FUNCTION public.snapshot_invoice_draft();

DROP TRIGGER IF EXISTS trg_invoice_drafts_updated_at ON public.invoice_drafts;
CREATE TRIGGER trg_invoice_drafts_updated_at
BEFORE UPDATE ON public.invoice_drafts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.snapshot_invoice_draft_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery public.deliveries%ROWTYPE;
  line public.delivery_lines%ROWTYPE;
  draft public.invoice_drafts%ROWTYPE;
  recipient UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.invoice_draft_id := OLD.invoice_draft_id;
    NEW.delivery_line_id := OLD.delivery_line_id;
    NEW.venue_name_snapshot := OLD.venue_name_snapshot;
    NEW.product_name_snapshot := OLD.product_name_snapshot;
    NEW.quantity := OLD.quantity;
    NEW.unit_price_ore := OLD.unit_price_ore;
    IF OLD.active = false AND NEW.active THEN
      RAISE EXCEPTION 'an inactive invoice allocation stays inactive';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO line FROM public.delivery_lines WHERE id = NEW.delivery_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery line is missing';
  END IF;
  SELECT * INTO delivery FROM public.deliveries WHERE id = line.delivery_id;
  SELECT * INTO draft FROM public.invoice_drafts WHERE id = NEW.invoice_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice draft is missing';
  END IF;
  IF draft.status <> 'draft' THEN
    RAISE EXCEPTION 'lines can only be added to a draft';
  END IF;
  IF delivery.commercial_route <> 'direct' THEN
    RAISE EXCEPTION 'not a Gold sale';
  END IF;
  IF line.unit_price_ore IS NULL THEN
    RAISE EXCEPTION 'missing price snapshot';
  END IF;

  recipient := public.resolve_billing_legal_entity(delivery.customer_id);
  IF recipient IS DISTINCT FROM draft.legal_entity_id THEN
    RAISE EXCEPTION 'billing recipient does not match';
  END IF;

  NEW.venue_name_snapshot := delivery.customer_name_snapshot;
  NEW.product_name_snapshot := line.product_name_snapshot;
  NEW.quantity := line.quantity;
  NEW.unit_price_ore := line.unit_price_ore;
  NEW.active := true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_draft_lines_snapshot ON public.invoice_draft_lines;
CREATE TRIGGER trg_invoice_draft_lines_snapshot
BEFORE INSERT OR UPDATE ON public.invoice_draft_lines
FOR EACH ROW EXECUTE FUNCTION public.snapshot_invoice_draft_line();

CREATE OR REPLACE FUNCTION public.release_invoice_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('credited', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.invoice_draft_lines
    SET active = false
    WHERE invoice_draft_id = NEW.id
      AND active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_drafts_release ON public.invoice_drafts;
CREATE TRIGGER trg_invoice_drafts_release
AFTER UPDATE OF status ON public.invoice_drafts
FOR EACH ROW EXECUTE FUNCTION public.release_invoice_allocations();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_entities TO authenticated;
GRANT ALL ON public.legal_entities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_product_prices TO authenticated;
GRANT ALL ON public.customer_product_prices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_drafts TO authenticated;
GRANT ALL ON public.invoice_drafts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_draft_lines TO authenticated;
GRANT ALL ON public.invoice_draft_lines TO service_role;

ALTER TABLE public.legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_draft_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legal_entities_select" ON public.legal_entities;
CREATE POLICY "legal_entities_select" ON public.legal_entities
  FOR SELECT TO authenticated
  USING (public.can_manage_operations());

DROP POLICY IF EXISTS "legal_entities_insert" ON public.legal_entities;
CREATE POLICY "legal_entities_insert" ON public.legal_entities
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "legal_entities_update" ON public.legal_entities;
CREATE POLICY "legal_entities_update" ON public.legal_entities
  FOR UPDATE TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "legal_entities_delete" ON public.legal_entities;
CREATE POLICY "legal_entities_delete" ON public.legal_entities
  FOR DELETE TO authenticated
  USING (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_product_prices_select" ON public.customer_product_prices;
CREATE POLICY "customer_product_prices_select" ON public.customer_product_prices
  FOR SELECT TO authenticated
  USING (public.can_manage_operations());

DROP POLICY IF EXISTS "customer_product_prices_insert" ON public.customer_product_prices;
CREATE POLICY "customer_product_prices_insert" ON public.customer_product_prices
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_product_prices_update" ON public.customer_product_prices;
CREATE POLICY "customer_product_prices_update" ON public.customer_product_prices
  FOR UPDATE TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_product_prices_delete" ON public.customer_product_prices;
CREATE POLICY "customer_product_prices_delete" ON public.customer_product_prices
  FOR DELETE TO authenticated
  USING (public.can_manage_commercial());

DROP POLICY IF EXISTS "invoice_drafts_all" ON public.invoice_drafts;
CREATE POLICY "invoice_drafts_all" ON public.invoice_drafts
  FOR ALL TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "invoice_draft_lines_all" ON public.invoice_draft_lines;
CREATE POLICY "invoice_draft_lines_all" ON public.invoice_draft_lines
  FOR ALL TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());
