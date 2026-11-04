ALTER TABLE public.invoice_drafts
  ADD COLUMN IF NOT EXISTS transfer_status TEXT NOT NULL DEFAULT 'not_transferred',
  ADD COLUMN IF NOT EXISTS transfer_reference TEXT,
  ADD COLUMN IF NOT EXISTS dnb_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_due_on DATE,
  ADD COLUMN IF NOT EXISTS vat_percent INTEGER,
  ADD COLUMN IF NOT EXISTS transfer_error TEXT,
  ADD COLUMN IF NOT EXISTS transfer_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ;

ALTER TABLE public.invoice_drafts DROP CONSTRAINT IF EXISTS invoice_drafts_transfer_status_check;
ALTER TABLE public.invoice_drafts
  ADD CONSTRAINT invoice_drafts_transfer_status_check
  CHECK (transfer_status IN ('not_transferred', 'queued', 'transferred', 'failed', 'needs_review'));

ALTER TABLE public.invoice_drafts DROP CONSTRAINT IF EXISTS invoice_drafts_dnb_status_check;
ALTER TABLE public.invoice_drafts
  ADD CONSTRAINT invoice_drafts_dnb_status_check
  CHECK (dnb_status IS NULL OR dnb_status IN ('draft', 'issued', 'partly_paid', 'paid', 'credited'));

ALTER TABLE public.invoice_drafts DROP CONSTRAINT IF EXISTS invoice_drafts_vat_percent_check;
ALTER TABLE public.invoice_drafts
  ADD CONSTRAINT invoice_drafts_vat_percent_check
  CHECK (vat_percent IS NULL OR vat_percent IN (15, 25));

CREATE UNIQUE INDEX IF NOT EXISTS invoice_drafts_transfer_reference
  ON public.invoice_drafts(transfer_reference)
  WHERE transfer_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_transfer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_draft_id UUID NOT NULL REFERENCES public.invoice_drafts(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  external_invoice_id TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_transfer_events_draft
  ON public.invoice_transfer_events(invoice_draft_id, created_at);

CREATE OR REPLACE FUNCTION public.snapshot_invoice_draft()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entity public.legal_entities%ROWTYPE;
  transfer_job BOOLEAN := current_setting('gos.dnb_transfer', true) = 'on';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.legal_entity_id := OLD.legal_entity_id;
    NEW.legal_name_snapshot := OLD.legal_name_snapshot;
    NEW.organization_number_snapshot := OLD.organization_number_snapshot;
    NEW.transfer_reference := coalesce(OLD.transfer_reference, NEW.transfer_reference);
    IF NOT (transfer_job AND NEW.status = 'credited' AND NEW.dnb_status = 'credited') THEN
      IF OLD.status IN ('credited', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'a closed invoice draft stays closed';
      END IF;
      IF OLD.status = 'sent' AND NEW.status NOT IN ('sent', 'credited', 'cancelled') THEN
        RAISE EXCEPTION 'a sent invoice draft can only be credited or cancelled';
      END IF;
      IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'sent', 'cancelled') THEN
        RAISE EXCEPTION 'a draft can be sent or cancelled';
      END IF;
    END IF;
    IF NOT transfer_job THEN
      IF NEW.transfer_status IS DISTINCT FROM OLD.transfer_status
         OR NEW.accounting_invoice_id IS DISTINCT FROM OLD.accounting_invoice_id
         OR NEW.accounting_invoice_number IS DISTINCT FROM OLD.accounting_invoice_number
         OR NEW.dnb_status IS DISTINCT FROM OLD.dnb_status
         OR NEW.transfer_error IS DISTINCT FROM OLD.transfer_error
         OR NEW.transferred_at IS DISTINCT FROM OLD.transferred_at
         OR NEW.transfer_attempted_at IS DISTINCT FROM OLD.transfer_attempted_at THEN
        RAISE EXCEPTION 'only the DNB transfer can record an accounting result';
      END IF;
      IF OLD.transfer_status NOT IN ('not_transferred', 'failed') THEN
        NEW.vat_percent := OLD.vat_percent;
        NEW.payment_due_on := OLD.payment_due_on;
      END IF;
      IF OLD.transfer_status = 'transferred' AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'a transferred basis stays locked in the portal';
      END IF;
      IF NEW.status = 'cancelled'
         AND OLD.transfer_status IN ('queued', 'transferred', 'needs_review') THEN
        RAISE EXCEPTION 'this basis may already exist in DNB';
      END IF;
    END IF;
    IF NEW.vat_percent IS NOT NULL AND NEW.vat_percent NOT IN (15, 25) THEN
      RAISE EXCEPTION 'vat percent must be 15 or 25';
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
  NEW.transfer_status := 'not_transferred';
  NEW.dnb_status := NULL;
  NEW.transfer_error := NULL;
  NEW.transferred_at := NULL;
  NEW.transfer_attempted_at := NULL;
  NEW.transfer_reference := 'gos-' || NEW.id::text;
  IF NEW.vat_percent IS NULL THEN
    NEW.vat_percent := 15;
  END IF;
  IF NEW.vat_percent NOT IN (15, 25) THEN
    RAISE EXCEPTION 'vat percent must be 15 or 25';
  END IF;
  IF NEW.payment_due_on IS NULL THEN
    NEW.payment_due_on := (CURRENT_DATE + 14);
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill transfer references (runs with the transfer flag so the trigger allows it)
SELECT set_config('gos.dnb_transfer', 'on', true);
UPDATE public.invoice_drafts
SET transfer_reference = 'gos-' || id::text
WHERE transfer_reference IS NULL;
SELECT set_config('gos.dnb_transfer', 'off', true);

CREATE OR REPLACE FUNCTION public.reject_invoice_line_after_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  draft public.invoice_drafts%ROWTYPE;
BEGIN
  SELECT * INTO draft FROM public.invoice_drafts WHERE id = NEW.invoice_draft_id;
  IF draft.transfer_status IS DISTINCT FROM 'not_transferred' THEN
    RAISE EXCEPTION 'a transferred invoice basis is locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_lines_lock_after_transfer ON public.invoice_draft_lines;
CREATE TRIGGER trg_invoice_lines_lock_after_transfer
BEFORE INSERT ON public.invoice_draft_lines
FOR EACH ROW EXECUTE FUNCTION public.reject_invoice_line_after_transfer();

CREATE OR REPLACE FUNCTION public.claim_dnb_transfer(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed INTEGER;
BEGIN
  PERFORM set_config('gos.dnb_transfer', 'on', true);
  UPDATE public.invoice_drafts
  SET transfer_status = 'queued',
      transfer_attempted_at = now(),
      transfer_error = NULL
  WHERE id = p_id
    AND transfer_status IN ('not_transferred', 'failed', 'needs_review');
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed = 1 THEN
    RETURN true;
  END IF;
  UPDATE public.invoice_drafts
  SET transfer_attempted_at = now()
  WHERE id = p_id
    AND transfer_status = 'queued'
    AND transfer_attempted_at < now() - interval '2 minutes';
  GET DIAGNOSTICS claimed = ROW_COUNT;
  RETURN claimed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_dnb_transfer(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dnb_transfer(UUID) TO service_role;

GRANT SELECT ON public.invoice_transfer_events TO authenticated;
GRANT ALL ON public.invoice_transfer_events TO service_role;

ALTER TABLE public.invoice_transfer_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_transfer_events_select" ON public.invoice_transfer_events;
CREATE POLICY "invoice_transfer_events_select" ON public.invoice_transfer_events
  FOR SELECT TO authenticated
  USING (public.can_manage_commercial());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_status') THEN
    CREATE TYPE public.sales_status AS ENUM (
      'prospect','contacted','interested','tasting','pilot_order','active_customer','waiting','not_relevant'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_segment') THEN
    CREATE TYPE public.customer_segment AS ENUM ('restaurant', 'hotel', 'event', 'bar');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_activity_kind') THEN
    CREATE TYPE public.crm_activity_kind AS ENUM ('call', 'email', 'meeting', 'tasting', 'note');
  END IF;
END;
$$;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS segment public.customer_segment,
  ADD COLUMN IF NOT EXISTS sales_status public.sales_status,
  ADD COLUMN IF NOT EXISTS sales_owner_id UUID,
  ADD COLUMN IF NOT EXISTS next_follow_up_on DATE,
  ADD COLUMN IF NOT EXISTS sales_status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commercial_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_sales_owner_id_fkey') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_sales_owner_id_fkey
      FOREIGN KEY (sales_owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_customers_sales_status
  ON public.customers(sales_status) WHERE sales_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_next_follow_up
  ON public.customers(next_follow_up_on) WHERE next_follow_up_on IS NOT NULL;

CREATE OR REPLACE FUNCTION public.isolate_sales_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sales_status IS NOT NULL AND NEW.sales_status_changed_at IS NULL THEN
      NEW.sales_status_changed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.sales_status IS DISTINCT FROM OLD.sales_status THEN
    IF NEW.active IS DISTINCT FROM OLD.active
       OR NEW.partnership_level IS DISTINCT FROM OLD.partnership_level
       OR NEW.supplied_by_customer_id IS DISTINCT FROM OLD.supplied_by_customer_id
       OR NEW.commercial_ready_at IS DISTINCT FROM OLD.commercial_ready_at THEN
      RAISE EXCEPTION 'sales_status cannot change together with active, partnership, supply channel or commercial readiness'
        USING ERRCODE = '23514';
    END IF;
    NEW.sales_status_changed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_isolate_sales_status ON public.customers;
CREATE TRIGGER trg_customers_isolate_sales_status
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.isolate_sales_status();

CREATE TABLE IF NOT EXISTS public.customer_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  legal_entity_id UUID REFERENCES public.legal_entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_contacts_one_owner CHECK (
    (customer_id IS NOT NULL AND legal_entity_id IS NULL)
    OR (customer_id IS NULL AND legal_entity_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer
  ON public.customer_contacts(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_contacts_legal_entity
  ON public.customer_contacts(legal_entity_id) WHERE legal_entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  kind public.crm_activity_kind NOT NULL,
  body TEXT NOT NULL,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_customer
  ON public.crm_activities(customer_id, happened_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_contacts TO authenticated;
GRANT ALL ON public.customer_contacts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_activities TO authenticated;
GRANT ALL ON public.crm_activities TO service_role;

ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_contacts_select" ON public.customer_contacts;
CREATE POLICY "customer_contacts_select" ON public.customer_contacts
  FOR SELECT TO authenticated USING (public.can_manage_commercial());
DROP POLICY IF EXISTS "customer_contacts_insert" ON public.customer_contacts;
CREATE POLICY "customer_contacts_insert" ON public.customer_contacts
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_commercial());
DROP POLICY IF EXISTS "customer_contacts_update" ON public.customer_contacts;
CREATE POLICY "customer_contacts_update" ON public.customer_contacts
  FOR UPDATE TO authenticated USING (public.can_manage_commercial()) WITH CHECK (public.can_manage_commercial());
DROP POLICY IF EXISTS "customer_contacts_delete" ON public.customer_contacts;
CREATE POLICY "customer_contacts_delete" ON public.customer_contacts
  FOR DELETE TO authenticated USING (public.can_manage_commercial());

DROP POLICY IF EXISTS "crm_activities_select" ON public.crm_activities;
CREATE POLICY "crm_activities_select" ON public.crm_activities
  FOR SELECT TO authenticated USING (public.can_manage_commercial());
DROP POLICY IF EXISTS "crm_activities_insert" ON public.crm_activities;
CREATE POLICY "crm_activities_insert" ON public.crm_activities
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_commercial());
DROP POLICY IF EXISTS "crm_activities_update" ON public.crm_activities;
CREATE POLICY "crm_activities_update" ON public.crm_activities
  FOR UPDATE TO authenticated USING (public.can_manage_commercial()) WITH CHECK (public.can_manage_commercial());
DROP POLICY IF EXISTS "crm_activities_delete" ON public.crm_activities;
CREATE POLICY "crm_activities_delete" ON public.crm_activities
  FOR DELETE TO authenticated USING (public.can_manage_commercial());

ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS freight_ore INTEGER,
  ADD COLUMN IF NOT EXISTS distance_m INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_zone TEXT,
  ADD COLUMN IF NOT EXISTS delivery_note TEXT,
  ADD COLUMN IF NOT EXISTS offer_freight_ore INTEGER,
  ADD COLUMN IF NOT EXISTS offer_fulfillment TEXT,
  ADD COLUMN IF NOT EXISTS offer_delivery_note TEXT;

ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_freight_ore_check;
ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_freight_ore_check CHECK (freight_ore IS NULL OR freight_ore >= 0);
ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_delivery_zone_check;
ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_delivery_zone_check CHECK (
    delivery_zone IS NULL OR delivery_zone IN ('pickup', 'km5', 'km10', 'km15', 'outside', 'agreed')
  );
ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_offer_fulfillment_check;
ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_offer_fulfillment_check
  CHECK (offer_fulfillment IS NULL OR offer_fulfillment IN ('pickup', 'delivery_request'));