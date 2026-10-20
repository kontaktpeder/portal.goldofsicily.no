-- Kjør i Lovable Cloud → SQL etter sql/27_advance_dnb_check.sql.
-- order_invoice_lines har ut-kolonner med samme navn som invoice_drafts
-- (transfer_status, quantity, unit_price_ore, active). Uten #variable_conflict
-- feiler d.transfer_status som tvetydig. use_column beholder tabellkolonnen.
-- Ordrelevering setter prisen fra den frosne ordrelinjen. Leveringsstedet
-- trenger ikke egen prisliste. Vanlige leveranser uten ordre slår fortsatt
-- opp pris og stopper med missing price snapshot når prisen mangler.
-- Eksisterende leveranser og kunder endres ikke.
-- Also applied as supabase/migrations/20261020200000_order_invoice_review.sql.

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
    IF current_setting('gos.order_delivery', true) = 'on' AND NEW.unit_price_ore IS NOT NULL THEN
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
  line_price INTEGER;
  route TEXT;
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

  SELECT d.commercial_route::text INTO route
  FROM public.deliveries d
  WHERE d.id = delivery_id;
  PERFORM set_config('gos.order_delivery', 'on', true);

  FOR item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    qty := COALESCE((item->>'quantity')::integer, 0);
    IF qty <= 0 THEN
      CONTINUE;
    END IF;
    product := (item->>'product_id')::uuid;
    lot := NULLIF(item->>'gold_lot_id', '')::uuid;
    handover := NULLIF(item->>'source_handover_id', '')::uuid;
    SELECT l.id, l.unit_price_ore
      INTO order_line, line_price
    FROM public.customer_order_lines l
    WHERE l.order_id = sale.id
      AND l.product_id = product;
    IF route = 'direct' AND line_price IS NULL THEN
      RAISE EXCEPTION 'confirmed order price is missing';
    END IF;

    INSERT INTO public.delivery_lines (
      delivery_id, product_id, quantity, gold_lot_id, source_handover_id, unit_price_ore
    ) VALUES (
      delivery_id,
      product,
      qty,
      lot,
      handover,
      CASE WHEN route = 'direct' THEN line_price ELSE NULL END
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
#variable_conflict use_column
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
