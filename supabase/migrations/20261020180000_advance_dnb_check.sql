-- Kjør i Lovable Cloud → SQL etter sql/26_order_advance.sql.
-- Betaling som ikke er hentet fra DNB er ukjent, ikke null.
-- Avregnet i portalen er en plan. Bekreftet beløp kommer fra sluttoppgjøret i DNB.
-- Overskytende forskudd blir stående og kan ikke trekkes fra en gang til.
-- Ingen negativ varelinje og ingen fast 0 % MVA.
-- Also applied as supabase/migrations/20261020180000_advance_dnb_check.sql.

ALTER TABLE public.order_advance_claims
  ADD COLUMN IF NOT EXISTS payments_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS surplus_ore INTEGER;

ALTER TABLE public.order_advance_claims
  DROP CONSTRAINT IF EXISTS order_advance_claims_surplus_check;
ALTER TABLE public.order_advance_claims
  ADD CONSTRAINT order_advance_claims_surplus_check
  CHECK (surplus_ore IS NULL OR surplus_ore >= 0);

ALTER TABLE public.order_advance_offsets
  ADD COLUMN IF NOT EXISTS confirmed_ore INTEGER,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

ALTER TABLE public.order_advance_offsets
  DROP CONSTRAINT IF EXISTS order_advance_offsets_confirmed_check;
ALTER TABLE public.order_advance_offsets
  ADD CONSTRAINT order_advance_offsets_confirmed_check
  CHECK (confirmed_ore IS NULL OR confirmed_ore >= 0);

CREATE OR REPLACE FUNCTION public.guard_advance_offset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  received INTEGER;
  already INTEGER;
  surplus INTEGER;
BEGIN
  received := public.advance_received_ore(NEW.claim_id);
  SELECT COALESCE(SUM(amount_ore), 0)::integer
    INTO already
  FROM public.order_advance_offsets
  WHERE claim_id = NEW.claim_id
    AND id IS DISTINCT FROM NEW.id;
  SELECT COALESCE(surplus_ore, 0)
    INTO surplus
  FROM public.order_advance_claims
  WHERE id = NEW.claim_id;
  IF already + NEW.amount_ore + surplus > received THEN
    RAISE EXCEPTION 'advance offset exceeds amount received';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_advance_check(
  p_order_id UUID,
  p_payments JSONB,
  p_use_balance BOOLEAN,
  p_dnb_received_ore INTEGER,
  p_has_rest BOOLEAN,
  p_dnb_rest_ore INTEGER,
  p_has_total BOOLEAN,
  p_dnb_total_ore INTEGER,
  p_has_vat BOOLEAN,
  p_dnb_vat_ore INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claim public.order_advance_claims%ROWTYPE;
  payment JSONB;
BEGIN
  PERFORM set_config('gos.dnb_transfer', 'on', true);
  SELECT * INTO claim
  FROM public.order_advance_claims
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'advance claim is missing';
  END IF;

  IF jsonb_typeof(p_payments) = 'array' AND jsonb_array_length(p_payments) > 0 THEN
    DELETE FROM public.order_advance_payments WHERE claim_id = claim.id;
    FOR payment IN SELECT value FROM jsonb_array_elements(p_payments)
    LOOP
      INSERT INTO public.order_advance_payments (claim_id, amount_ore, paid_on, external_id)
      VALUES (
        claim.id,
        (payment->>'amount_ore')::integer,
        NULLIF(payment->>'paid_on', '')::date,
        NULLIF(payment->>'external_id', '')
      );
    END LOOP;
    UPDATE public.order_advance_claims
    SET dnb_received_ore = NULL
    WHERE id = claim.id;
  ELSIF p_use_balance AND NOT EXISTS (
    SELECT 1 FROM public.order_advance_payments WHERE claim_id = claim.id
  ) THEN
    UPDATE public.order_advance_claims
    SET dnb_received_ore = p_dnb_received_ore
    WHERE id = claim.id;
  END IF;

  UPDATE public.order_advance_claims
  SET payments_checked_at = now(),
      dnb_rest_ore = CASE WHEN p_has_rest THEN p_dnb_rest_ore ELSE dnb_rest_ore END,
      dnb_total_ore = CASE WHEN p_has_total THEN p_dnb_total_ore ELSE dnb_total_ore END,
      dnb_vat_ore = CASE WHEN p_has_vat THEN p_dnb_vat_ore ELSE dnb_vat_ore END
  WHERE id = claim.id;
END;
$$;

DROP FUNCTION IF EXISTS public.record_advance_offset(UUID, UUID);

CREATE OR REPLACE FUNCTION public.record_advance_offset(
  p_order_id UUID,
  p_invoice_draft_id UUID,
  p_ceiling_ore INTEGER,
  p_surplus_ore INTEGER
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
  room INTEGER;
  amount INTEGER;
BEGIN
  IF NOT public.can_manage_commercial() THEN
    RAISE EXCEPTION 'only commercial can prepare an advance';
  END IF;
  IF p_ceiling_ore IS NULL OR p_ceiling_ore < 0 THEN
    RAISE EXCEPTION 'advance ceiling is missing';
  END IF;

  SELECT * INTO claim
  FROM public.order_advance_claims
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  IF claim.payments_checked_at IS NULL THEN
    RAISE EXCEPTION 'advance payment is not checked';
  END IF;

  SELECT amount_ore INTO existing
  FROM public.order_advance_offsets
  WHERE claim_id = claim.id
    AND invoice_draft_id = p_invoice_draft_id;
  IF FOUND THEN
    RETURN existing;
  END IF;

  IF claim.surplus_ore IS NULL AND p_surplus_ore IS NOT NULL THEN
    UPDATE public.order_advance_claims
    SET surplus_ore = GREATEST(p_surplus_ore, 0)
    WHERE id = claim.id;
    claim.surplus_ore := GREATEST(p_surplus_ore, 0);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_advance_payments WHERE claim_id = claim.id
  ) THEN
    SELECT COALESCE(SUM(amount_ore), 0)::integer
      INTO received
    FROM public.order_advance_payments
    WHERE claim_id = claim.id;
  ELSIF claim.dnb_received_ore IS NOT NULL THEN
    received := claim.dnb_received_ore;
  ELSE
    RAISE EXCEPTION 'advance payment is not checked';
  END IF;
  SELECT COALESCE(SUM(amount_ore), 0)::integer
    INTO already
  FROM public.order_advance_offsets
  WHERE claim_id = claim.id;
  room := received - already - COALESCE(claim.surplus_ore, 0);
  amount := LEAST(room, p_ceiling_ore);
  IF amount <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.order_advance_offsets (claim_id, invoice_draft_id, amount_ore)
  VALUES (claim.id, p_invoice_draft_id, amount);
  RETURN amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_advance_confirmation(
  p_order_id UUID,
  p_invoice_draft_id UUID,
  p_confirmed_ore INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claim_id UUID;
  planned INTEGER;
  confirmed INTEGER;
BEGIN
  PERFORM set_config('gos.dnb_transfer', 'on', true);
  IF p_confirmed_ore IS NULL OR p_confirmed_ore < 0 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO claim_id
  FROM public.order_advance_claims
  WHERE order_id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'advance claim is missing';
  END IF;

  SELECT amount_ore INTO planned
  FROM public.order_advance_offsets
  WHERE claim_id = claim_id
    AND invoice_draft_id = p_invoice_draft_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  confirmed := LEAST(p_confirmed_ore, planned);
  UPDATE public.order_advance_offsets
  SET confirmed_ore = confirmed,
      confirmed_at = now()
  WHERE claim_id = claim_id
    AND invoice_draft_id = p_invoice_draft_id;
  RETURN confirmed;
END;
$$;

REVOKE ALL ON FUNCTION public.record_advance_check(UUID, JSONB, BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_advance_check(UUID, JSONB, BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.record_advance_offset(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_advance_offset(UUID, UUID, INTEGER, INTEGER) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_advance_confirmation(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_advance_confirmation(UUID, UUID, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
