-- Kjør i Lovable Cloud → SQL etter sql/24_order_delivery.sql.
-- Levert av er påkrevd på en ny ordrelevering. Hvem som registrerte fryses separat.
-- Eksisterende rader uten person blir ikke gjettet. En gammel frist blir ikke en oppfølging.
-- Also applied as supabase/migrations/20261020120000_order_next.sql.

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS registered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registered_name_snapshot TEXT;

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS follow_up_on DATE,
  ADD COLUMN IF NOT EXISTS follow_up_note TEXT;

ALTER TABLE public.invoice_drafts
  ADD COLUMN IF NOT EXISTS dnb_paid_on DATE;

CREATE OR REPLACE FUNCTION public.snapshot_delivery_registrar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  person_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.registered_by := OLD.registered_by;
    NEW.registered_at := OLD.registered_at;
    NEW.registered_name_snapshot := OLD.registered_name_snapshot;
    RETURN NEW;
  END IF;

  NEW.registered_by := auth.uid();
  NEW.registered_at := now();
  person_name := NULL;
  IF NEW.registered_by IS NOT NULL THEN
    SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(username), ''))
      INTO person_name
    FROM public.profiles
    WHERE id = NEW.registered_by;
  END IF;
  NEW.registered_name_snapshot := person_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deliveries_snapshot_registrar ON public.deliveries;
CREATE TRIGGER trg_deliveries_snapshot_registrar
BEFORE INSERT OR UPDATE ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.snapshot_delivery_registrar();

DROP FUNCTION IF EXISTS public.register_order_delivery(UUID, DATE, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.register_order_delivery(
  p_order_id UUID,
  p_delivered_on DATE,
  p_idempotency_key UUID,
  p_lines JSONB,
  p_delivered_by UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sale public.customer_orders%ROWTYPE;
  existing UUID;
  existing_order UUID;
  item JSONB;
  product UUID;
  qty INTEGER;
  lot UUID;
  handover UUID;
  order_line UUID;
  ordered INTEGER;
  already INTEGER;
  delivery_id UUID;
  delivery_line_id UUID;
  total INTEGER := 0;
BEGIN
  IF NOT public.can_manage_operations() THEN
    RAISE EXCEPTION 'only operations can register a delivery';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'delivery request is missing';
  END IF;
  IF p_delivered_on IS NULL THEN
    RAISE EXCEPTION 'delivery date is missing';
  END IF;

  SELECT * INTO sale FROM public.customer_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order is missing';
  END IF;
  IF sale.status::text <> 'confirmed' THEN
    RAISE EXCEPTION 'only a confirmed order can be delivered';
  END IF;

  SELECT r.delivery_id, r.order_id
    INTO existing, existing_order
  FROM public.order_delivery_requests r
  WHERE r.idempotency_key = p_idempotency_key;
  IF existing IS NOT NULL THEN
    IF existing_order IS DISTINCT FROM p_order_id THEN
      RAISE EXCEPTION 'delivery request belongs to another order';
    END IF;
    RETURN existing;
  END IF;

  IF p_delivered_by IS NULL THEN
    RAISE EXCEPTION 'delivery driver is missing';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'delivery quantity is missing';
  END IF;

  PERFORM 1
  FROM public.gold_lots g
  WHERE g.id IN (
    SELECT NULLIF(entry->>'gold_lot_id', '')::uuid
    FROM jsonb_array_elements(p_lines) entry
    WHERE COALESCE((entry->>'quantity')::integer, 0) > 0
  )
  ORDER BY g.id
  FOR UPDATE;

  FOR item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    qty := COALESCE((item->>'quantity')::integer, 0);
    IF qty <= 0 THEN
      CONTINUE;
    END IF;
    product := (item->>'product_id')::uuid;
    lot := NULLIF(item->>'gold_lot_id', '')::uuid;
    IF lot IS NULL THEN
      RAISE EXCEPTION 'delivery_line with quantity > 0 requires gold_lot_id';
    END IF;
    SELECT l.id, l.quantity
      INTO order_line, ordered
    FROM public.customer_order_lines l
    WHERE l.order_id = sale.id
      AND l.product_id = product
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'order line and delivery line must be the same product';
    END IF;
    SELECT COALESCE(SUM(f.quantity), 0)
      INTO already
    FROM public.order_line_fulfillments f
    WHERE f.order_line_id = order_line;
    IF already + qty > ordered THEN
      RAISE EXCEPTION 'fulfillment exceeds ordered quantity';
    END IF;
    total := total + qty;
  END LOOP;

  IF total <= 0 THEN
    RAISE EXCEPTION 'delivery quantity is missing';
  END IF;

  INSERT INTO public.deliveries (customer_id, quantity, delivered_at, note, delivered_by)
  VALUES (sale.ship_to_customer_id, total, p_delivered_on, sale.order_number, p_delivered_by)
  RETURNING id INTO delivery_id;

  FOR item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    qty := COALESCE((item->>'quantity')::integer, 0);
    IF qty <= 0 THEN
      CONTINUE;
    END IF;
    product := (item->>'product_id')::uuid;
    lot := NULLIF(item->>'gold_lot_id', '')::uuid;
    handover := NULLIF(item->>'source_handover_id', '')::uuid;
    SELECT l.id INTO order_line
    FROM public.customer_order_lines l
    WHERE l.order_id = sale.id
      AND l.product_id = product;

    INSERT INTO public.delivery_lines (
      delivery_id, product_id, quantity, gold_lot_id, source_handover_id
    ) VALUES (
      delivery_id, product, qty, lot, handover
    ) RETURNING id INTO delivery_line_id;

    INSERT INTO public.order_line_fulfillments (order_line_id, delivery_line_id, quantity)
    VALUES (order_line, delivery_line_id, qty);
  END LOOP;

  INSERT INTO public.order_delivery_requests (idempotency_key, order_id, delivery_id)
  VALUES (p_idempotency_key, sale.id, delivery_id);

  RETURN delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_order_delivery(UUID, DATE, UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_order_delivery(UUID, DATE, UUID, JSONB, UUID) TO authenticated, service_role;

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

DROP FUNCTION IF EXISTS public.record_dnb_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_dnb_transfer(
  p_id UUID,
  p_transfer_status TEXT,
  p_dnb_status TEXT,
  p_accounting_invoice_id TEXT,
  p_accounting_invoice_number TEXT,
  p_transfer_error TEXT,
  p_outcome TEXT,
  p_detail TEXT,
  p_dnb_paid_on DATE
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
      status = CASE
        WHEN p_dnb_status = 'credited' THEN 'credited'::public.invoice_draft_status
        ELSE status
      END
  WHERE id = p_id;

  INSERT INTO public.invoice_transfer_events (invoice_draft_id, outcome, external_invoice_id, detail)
  VALUES (p_id, p_outcome, p_accounting_invoice_id, coalesce(p_detail, p_transfer_error));
END;
$$;

REVOKE ALL ON FUNCTION public.record_dnb_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_dnb_transfer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE) TO service_role;

NOTIFY pgrst, 'reload schema';
