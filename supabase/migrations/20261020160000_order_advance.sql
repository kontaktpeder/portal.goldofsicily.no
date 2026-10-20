-- Kjør i Lovable Cloud → SQL etter sql/25_order_next.sql.
-- Forskudd tilhører ordren. Leveransene dokumenterer varene.
-- Krevd er ikke betalt. Avregning kan ikke overstige det som er mottatt,
-- og kan ikke trekkes fra to ganger. Ingen negativ varelinje og ingen fast 0 % MVA.
-- Also applied as supabase/migrations/20261020160000_order_advance.sql.

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS advance_percent NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS advance_basis_ore INTEGER,
  ADD COLUMN IF NOT EXISTS advance_agreed_ore INTEGER;

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_advance_percent_check;
ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_advance_percent_check
  CHECK (advance_percent IS NULL OR (advance_percent > 0 AND advance_percent <= 100));

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_advance_basis_check;
ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_advance_basis_check
  CHECK (advance_basis_ore IS NULL OR advance_basis_ore > 0);

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_advance_agreed_check;
ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_advance_agreed_check
  CHECK (advance_agreed_ore IS NULL OR advance_agreed_ore > 0);

ALTER TABLE public.invoice_drafts
  ADD COLUMN IF NOT EXISTS dnb_total_ore INTEGER,
  ADD COLUMN IF NOT EXISTS dnb_rest_ore INTEGER,
  ADD COLUMN IF NOT EXISTS dnb_vat_ore INTEGER;

CREATE TABLE IF NOT EXISTS public.order_advance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.customer_orders(id) ON DELETE RESTRICT,
  amount_ore INTEGER NOT NULL CHECK (amount_ore > 0),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accounting_invoice_id TEXT,
  accounting_invoice_number TEXT,
  dnb_status TEXT,
  dnb_total_ore INTEGER,
  dnb_rest_ore INTEGER,
  dnb_vat_ore INTEGER,
  dnb_received_ore INTEGER
);

CREATE TABLE IF NOT EXISTS public.order_advance_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.order_advance_claims(id) ON DELETE RESTRICT,
  amount_ore INTEGER NOT NULL CHECK (amount_ore > 0),
  paid_on DATE,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS order_advance_payments_external
  ON public.order_advance_payments(claim_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.order_advance_offsets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES public.order_advance_claims(id) ON DELETE RESTRICT,
  invoice_draft_id UUID NOT NULL REFERENCES public.invoice_drafts(id) ON DELETE RESTRICT,
  amount_ore INTEGER NOT NULL CHECK (amount_ore > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (claim_id, invoice_draft_id)
);

ALTER TABLE public.order_advance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_advance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_advance_offsets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_advance_claims FROM PUBLIC, anon;
REVOKE ALL ON public.order_advance_payments FROM PUBLIC, anon;
REVOKE ALL ON public.order_advance_offsets FROM PUBLIC, anon;
GRANT SELECT ON public.order_advance_claims TO authenticated;
GRANT SELECT ON public.order_advance_payments TO authenticated;
GRANT SELECT ON public.order_advance_offsets TO authenticated;
GRANT ALL ON public.order_advance_claims TO service_role;
GRANT ALL ON public.order_advance_payments TO service_role;
GRANT ALL ON public.order_advance_offsets TO service_role;

DROP POLICY IF EXISTS "order_advance_claims_select" ON public.order_advance_claims;
CREATE POLICY "order_advance_claims_select" ON public.order_advance_claims
  FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR public.can_manage_commercial());

DROP POLICY IF EXISTS "order_advance_payments_select" ON public.order_advance_payments;
CREATE POLICY "order_advance_payments_select" ON public.order_advance_payments
  FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR public.can_manage_commercial());

DROP POLICY IF EXISTS "order_advance_offsets_select" ON public.order_advance_offsets;
CREATE POLICY "order_advance_offsets_select" ON public.order_advance_offsets
  FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR public.can_manage_commercial());

CREATE OR REPLACE FUNCTION public.advance_received_ore(p_claim_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.order_advance_payments WHERE claim_id = p_claim_id
    ) THEN (
      SELECT COALESCE(SUM(amount_ore), 0)::integer
      FROM public.order_advance_payments
      WHERE claim_id = p_claim_id
    )
    ELSE COALESCE(
      (SELECT dnb_received_ore FROM public.order_advance_claims WHERE id = p_claim_id),
      0
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.guard_advance_offset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  received INTEGER;
  already INTEGER;
BEGIN
  received := public.advance_received_ore(NEW.claim_id);
  SELECT COALESCE(SUM(amount_ore), 0)::integer
    INTO already
  FROM public.order_advance_offsets
  WHERE claim_id = NEW.claim_id
    AND id IS DISTINCT FROM NEW.id;
  IF already + NEW.amount_ore > received THEN
    RAISE EXCEPTION 'advance offset exceeds amount received';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_advance_offsets_guard ON public.order_advance_offsets;
CREATE TRIGGER trg_order_advance_offsets_guard
BEFORE INSERT OR UPDATE ON public.order_advance_offsets
FOR EACH ROW EXECUTE FUNCTION public.guard_advance_offset();

CREATE OR REPLACE FUNCTION public.prepare_order_advance(
  p_order_id UUID,
  p_percent NUMERIC,
  p_basis_ore INTEGER
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sale public.customer_orders%ROWTYPE;
  agreed INTEGER;
  claim_id UUID;
BEGIN
  IF NOT public.can_manage_commercial() THEN
    RAISE EXCEPTION 'only commercial can prepare an advance';
  END IF;
  IF p_percent IS NULL OR p_percent <= 0 OR p_percent > 100 THEN
    RAISE EXCEPTION 'advance percent is missing';
  END IF;
  IF p_basis_ore IS NULL OR p_basis_ore <= 0 THEN
    RAISE EXCEPTION 'advance basis is missing';
  END IF;

  SELECT * INTO sale FROM public.customer_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order is missing';
  END IF;
  IF sale.status::text <> 'confirmed' THEN
    RAISE EXCEPTION 'only a confirmed order can take an advance';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_advance_claims WHERE order_id = sale.id) THEN
    RAISE EXCEPTION 'this order already has an advance';
  END IF;

  agreed := ROUND(p_basis_ore * p_percent / 100.0)::integer;
  IF agreed <= 0 THEN
    RAISE EXCEPTION 'advance amount is missing';
  END IF;

  UPDATE public.customer_orders
  SET advance_percent = p_percent,
      advance_basis_ore = p_basis_ore,
      advance_agreed_ore = agreed
  WHERE id = sale.id;

  INSERT INTO public.order_advance_claims (order_id, amount_ore)
  VALUES (sale.id, agreed)
  RETURNING id INTO claim_id;

  RETURN claim_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_advance_document(
  p_order_id UUID,
  p_accounting_invoice_id TEXT,
  p_accounting_invoice_number TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_commercial() THEN
    RAISE EXCEPTION 'only commercial can prepare an advance';
  END IF;
  UPDATE public.order_advance_claims
  SET accounting_invoice_id = NULLIF(trim(p_accounting_invoice_id), ''),
      accounting_invoice_number = NULLIF(trim(p_accounting_invoice_number), '')
  WHERE order_id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'advance claim is missing';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_advance_offset(
  p_order_id UUID,
  p_invoice_draft_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claim public.order_advance_claims%ROWTYPE;
  existing INTEGER;
  received INTEGER;
  already INTEGER;
  amount INTEGER;
BEGIN
  IF NOT public.can_manage_commercial() THEN
    RAISE EXCEPTION 'only commercial can prepare an advance';
  END IF;

  SELECT * INTO claim
  FROM public.order_advance_claims
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT amount_ore INTO existing
  FROM public.order_advance_offsets
  WHERE claim_id = claim.id
    AND invoice_draft_id = p_invoice_draft_id;
  IF FOUND THEN
    RETURN existing;
  END IF;

  received := public.advance_received_ore(claim.id);
  SELECT COALESCE(SUM(amount_ore), 0)::integer
    INTO already
  FROM public.order_advance_offsets
  WHERE claim_id = claim.id;
  amount := received - already;
  IF amount <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.order_advance_offsets (claim_id, invoice_draft_id, amount_ore)
  VALUES (claim.id, p_invoice_draft_id, amount);
  RETURN amount;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_order_advance(UUID, NUMERIC, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_order_advance(UUID, NUMERIC, INTEGER) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.attach_advance_document(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_advance_document(UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_advance_offset(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_advance_offset(UUID, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.order_invoice_lines(UUID);

CREATE OR REPLACE FUNCTION public.order_invoice_lines(p_order_id UUID)
RETURNS TABLE (
  draft_id UUID,
  draft_status TEXT,
  transfer_status TEXT,
  dnb_status TEXT,
  accounting_invoice_id TEXT,
  accounting_invoice_number TEXT,
  payment_due_on DATE,
  dnb_paid_on DATE,
  dnb_total_ore INTEGER,
  dnb_rest_ore INTEGER,
  dnb_vat_ore INTEGER,
  fulfillment_id UUID,
  quantity INTEGER,
  unit_price_ore INTEGER,
  active BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.can_manage_operations() OR public.can_manage_commercial()) THEN
    RAISE EXCEPTION 'only staff can read an order invoice';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.status::text,
    d.transfer_status,
    d.dnb_status,
    d.accounting_invoice_id,
    d.accounting_invoice_number,
    d.payment_due_on,
    d.dnb_paid_on,
    d.dnb_total_ore,
    d.dnb_rest_ore,
    d.dnb_vat_ore,
    l.order_line_fulfillment_id,
    l.quantity,
    l.unit_price_ore,
    l.active
  FROM public.invoice_draft_lines l
  JOIN public.invoice_drafts d ON d.id = l.invoice_draft_id
  JOIN public.order_line_fulfillments f ON f.id = l.order_line_fulfillment_id
  JOIN public.customer_order_lines ol ON ol.id = f.order_line_id
  WHERE ol.order_id = p_order_id
    AND l.order_line_fulfillment_id IS NOT NULL
  ORDER BY d.created_at DESC, l.id;
END;
$$;

REVOKE ALL ON FUNCTION public.order_invoice_lines(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_invoice_lines(UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.record_dnb_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE);

CREATE OR REPLACE FUNCTION public.record_dnb_transfer(
  p_id UUID,
  p_transfer_status TEXT,
  p_dnb_status TEXT,
  p_accounting_invoice_id TEXT,
  p_accounting_invoice_number TEXT,
  p_transfer_error TEXT,
  p_outcome TEXT,
  p_detail TEXT,
  p_dnb_paid_on DATE,
  p_dnb_total_ore INTEGER,
  p_dnb_rest_ore INTEGER,
  p_dnb_vat_ore INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('gos.dnb_transfer', 'on', true);
  UPDATE public.invoice_drafts
  SET transfer_status = p_transfer_status,
      dnb_status = p_dnb_status,
      accounting_invoice_id = p_accounting_invoice_id,
      accounting_invoice_number = CASE
        WHEN p_dnb_status = 'draft' THEN NULL
        ELSE p_accounting_invoice_number
      END,
      transfer_error = p_transfer_error,
      transferred_at = CASE
        WHEN p_transfer_status = 'transferred' THEN coalesce(transferred_at, now())
        ELSE transferred_at
      END,
      dnb_paid_on = CASE
        WHEN p_dnb_status = 'paid' AND p_dnb_paid_on IS NOT NULL THEN p_dnb_paid_on
        WHEN p_dnb_status = 'paid' THEN dnb_paid_on
        ELSE NULL
      END,
      dnb_total_ore = COALESCE(p_dnb_total_ore, dnb_total_ore),
      dnb_rest_ore = COALESCE(p_dnb_rest_ore, dnb_rest_ore),
      dnb_vat_ore = COALESCE(p_dnb_vat_ore, dnb_vat_ore),
      status = CASE
        WHEN p_dnb_status = 'credited' THEN 'credited'::public.invoice_draft_status
        ELSE status
      END
  WHERE id = p_id;

  INSERT INTO public.invoice_transfer_events (invoice_draft_id, outcome, external_invoice_id, detail)
  VALUES (p_id, p_outcome, p_accounting_invoice_id, coalesce(p_detail, p_transfer_error));
END;
$$;

REVOKE ALL ON FUNCTION public.record_dnb_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_dnb_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, INTEGER, INTEGER, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
