-- Kjør i Lovable Cloud → SQL.
-- Salg på eksisterende kundemodell.
-- customers er leveringsstedet. legal_entities er den juridiske enheten.
-- sales_status, commercial_ready_at og innlogging (profiles) er tre separate ting.
-- En UPDATE som endrer sales_status kan ikke samtidig endre active, avtale,
-- leveringskanal eller klarsignal.
-- Also applied as supabase/migrations/20261013130000_sales_crm.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_status') THEN
    CREATE TYPE public.sales_status AS ENUM (
      'prospect',
      'contacted',
      'interested',
      'tasting',
      'pilot_order',
      'active_customer',
      'waiting',
      'not_relevant'
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_sales_owner_id_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_sales_owner_id_fkey
      FOREIGN KEY (sales_owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_customers_sales_status
  ON public.customers(sales_status)
  WHERE sales_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_next_follow_up
  ON public.customers(next_follow_up_on)
  WHERE next_follow_up_on IS NOT NULL;

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
  ON public.customer_contacts(customer_id)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_contacts_legal_entity
  ON public.customer_contacts(legal_entity_id)
  WHERE legal_entity_id IS NOT NULL;

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
  FOR SELECT TO authenticated
  USING (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_contacts_insert" ON public.customer_contacts;
CREATE POLICY "customer_contacts_insert" ON public.customer_contacts
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_contacts_update" ON public.customer_contacts;
CREATE POLICY "customer_contacts_update" ON public.customer_contacts
  FOR UPDATE TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_contacts_delete" ON public.customer_contacts;
CREATE POLICY "customer_contacts_delete" ON public.customer_contacts
  FOR DELETE TO authenticated
  USING (public.can_manage_commercial());

DROP POLICY IF EXISTS "crm_activities_select" ON public.crm_activities;
CREATE POLICY "crm_activities_select" ON public.crm_activities
  FOR SELECT TO authenticated
  USING (public.can_manage_commercial());

DROP POLICY IF EXISTS "crm_activities_insert" ON public.crm_activities;
CREATE POLICY "crm_activities_insert" ON public.crm_activities
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "crm_activities_update" ON public.crm_activities;
CREATE POLICY "crm_activities_update" ON public.crm_activities
  FOR UPDATE TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "crm_activities_delete" ON public.crm_activities;
CREATE POLICY "crm_activities_delete" ON public.crm_activities
  FOR DELETE TO authenticated
  USING (public.can_manage_commercial());
