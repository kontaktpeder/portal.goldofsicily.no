-- Kjør i Lovable Cloud → SQL etter sql/28.
-- order_invoice_lines feiler så lenge transfer_status mangler på utkastet,
-- eller så lenge ut-kolonnen har samme navn som tabellkolonnen.
-- Spørringen kjøres som dynamisk SQL, så navnene ikke kolliderer.
-- Eksisterende leveranser og kunder endres ikke.
-- Also applied as supabase/migrations/20261020220000_invoice_lines_status.sql.

ALTER TABLE public.invoice_drafts
  ADD COLUMN IF NOT EXISTS transfer_status TEXT NOT NULL DEFAULT 'not_transferred',
  ADD COLUMN IF NOT EXISTS dnb_status TEXT,
  ADD COLUMN IF NOT EXISTS dnb_paid_on DATE,
  ADD COLUMN IF NOT EXISTS dnb_total_ore INTEGER,
  ADD COLUMN IF NOT EXISTS dnb_rest_ore INTEGER,
  ADD COLUMN IF NOT EXISTS dnb_vat_ore INTEGER;

ALTER TABLE public.invoice_drafts DROP CONSTRAINT IF EXISTS invoice_drafts_transfer_status_check;
ALTER TABLE public.invoice_drafts
  ADD CONSTRAINT invoice_drafts_transfer_status_check
  CHECK (transfer_status IN ('not_transferred', 'queued', 'transferred', 'failed', 'needs_review'));

ALTER TABLE public.invoice_drafts DROP CONSTRAINT IF EXISTS invoice_drafts_dnb_status_check;
ALTER TABLE public.invoice_drafts
  ADD CONSTRAINT invoice_drafts_dnb_status_check
  CHECK (dnb_status IS NULL OR dnb_status IN ('draft', 'issued', 'partly_paid', 'paid', 'credited'));

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

  RETURN QUERY EXECUTE $q$
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
    WHERE ol.order_id = $1
      AND l.order_line_fulfillment_id IS NOT NULL
    ORDER BY d.created_at DESC, l.id
  $q$ USING p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.order_invoice_lines(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_invoice_lines(UUID) TO authenticated, service_role;

SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_drafts'
      AND column_name = 'transfer_status'
  ) AS transfer_status_column;
