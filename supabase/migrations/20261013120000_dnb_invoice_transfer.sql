-- DNB Regnskap (Unimicro) receives one draft per basis.
-- The portal never calls the invoice action that issues and sends it.
-- A later customer or price change cannot move a basis that has left the local desk.

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

UPDATE public.invoice_drafts
SET transfer_reference = 'gos-' || id::text
WHERE transfer_reference IS NULL;

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

CREATE OR REPLACE FUNCTION public.record_dnb_transfer(
  p_id UUID,
  p_transfer_status TEXT,
  p_dnb_status TEXT,
  p_accounting_invoice_id TEXT,
  p_accounting_invoice_number TEXT,
  p_transfer_error TEXT,
  p_outcome TEXT,
  p_detail TEXT
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
      status = CASE
        WHEN p_dnb_status = 'credited' THEN 'credited'::public.invoice_draft_status
        ELSE status
      END
  WHERE id = p_id;

  INSERT INTO public.invoice_transfer_events (invoice_draft_id, outcome, external_invoice_id, detail)
  VALUES (p_id, p_outcome, p_accounting_invoice_id, coalesce(p_detail, p_transfer_error));
END;
$$;

REVOKE ALL ON FUNCTION public.claim_dnb_transfer(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dnb_transfer(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.record_dnb_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_dnb_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

GRANT SELECT ON public.invoice_transfer_events TO authenticated;
GRANT ALL ON public.invoice_transfer_events TO service_role;

ALTER TABLE public.invoice_transfer_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_transfer_events_select" ON public.invoice_transfer_events;
CREATE POLICY "invoice_transfer_events_select" ON public.invoice_transfer_events
  FOR SELECT TO authenticated
  USING (public.can_manage_commercial());
