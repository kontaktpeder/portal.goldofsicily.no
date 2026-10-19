-- Levering fra ordren lagres i én transaksjon. Kunden hentes fra ordren.
-- Godkjenning er fortsatt intern: ingen melding går til kunden.
-- Source copy: sql/24_order_delivery.sql.

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_name_snapshot TEXT;

CREATE TABLE IF NOT EXISTS public.order_delivery_requests (
  idempotency_key UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.customer_orders(id) ON DELETE RESTRICT,
  delivery_id UUID REFERENCES public.deliveries(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.order_delivery_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.order_delivery_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.order_delivery_requests TO service_role;

CREATE OR REPLACE FUNCTION public.guard_customer_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient UUID;
  entity public.legal_entities%ROWTYPE;
  owner_name TEXT;
  confirming BOOLEAN;
  submitting BOOLEAN;
BEGIN
  confirming := NEW.status::text = 'confirmed'
    AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'confirmed');
  submitting := NEW.status::text = 'pending_confirmation'
    AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'pending_confirmation');

  IF TG_OP = 'UPDATE' AND OLD.status::text = 'cancelled' AND NEW.status::text IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'a cancelled order stays cancelled';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status::text = 'confirmed' AND NEW.status::text NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'a confirmed order stays confirmed until it is cancelled';
  END IF;

  -- The UPDATE locks this row. A second approval waits, then sees the first commit.
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'confirmed' AND OLD.approved_at IS NOT NULL THEN
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_name_snapshot IS DISTINCT FROM OLD.approved_name_snapshot THEN
      RAISE EXCEPTION 'this order is already approved';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status::text = 'cancelled' AND OLD.status::text IS DISTINCT FROM 'cancelled' THEN
    IF OLD.status::text IN ('confirmed', 'pending_confirmation') AND NOT public.can_approve_orders() THEN
      RAISE EXCEPTION 'only a production lead or admin can cancel this order';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.order_line_fulfillments f
      JOIN public.customer_order_lines l ON l.id = f.order_line_id
      WHERE l.order_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'a delivered order cannot be cancelled';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status::text = 'confirmed' THEN
    IF NEW.ordered_by_customer_id IS DISTINCT FROM OLD.ordered_by_customer_id
       OR NEW.ship_to_customer_id IS DISTINCT FROM OLD.ship_to_customer_id
       OR NEW.confirmed_delivery_on IS DISTINCT FROM OLD.confirmed_delivery_on
       OR NEW.billing_legal_entity_id IS DISTINCT FROM OLD.billing_legal_entity_id
       OR NEW.billing_legal_name_snapshot IS DISTINCT FROM OLD.billing_legal_name_snapshot
       OR NEW.billing_organization_number_snapshot IS DISTINCT FROM OLD.billing_organization_number_snapshot
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_name_snapshot IS DISTINCT FROM OLD.approved_name_snapshot THEN
      RAISE EXCEPTION 'a confirmed order keeps its recipient, price and date';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status::text = 'changes_requested'
     AND OLD.status::text IS DISTINCT FROM 'changes_requested' THEN
    IF OLD.status::text IS DISTINCT FROM 'pending_confirmation' THEN
      RAISE EXCEPTION 'only a submitted order can be sent back';
    END IF;
    IF NOT public.can_approve_orders() THEN
      RAISE EXCEPTION 'only a production lead or admin can send an order back';
    END IF;
    IF NEW.return_note IS NULL OR btrim(NEW.return_note) = '' THEN
      RAISE EXCEPTION 'return note is missing';
    END IF;
  END IF;

  IF submitting THEN
    IF TG_OP = 'UPDATE' AND OLD.status::text NOT IN ('draft', 'changes_requested') THEN
      RAISE EXCEPTION 'this order cannot be submitted';
    END IF;
    NEW.return_note := NULL;
    NEW.submitted_by := auth.uid();
    NEW.submitted_at := now();
    SELECT COALESCE(NULLIF(btrim(full_name), ''), username)
      INTO owner_name
    FROM public.profiles
    WHERE id = auth.uid();
    NEW.submitted_name_snapshot := owner_name;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.submitted_by := OLD.submitted_by;
    NEW.submitted_at := OLD.submitted_at;
    NEW.submitted_name_snapshot := OLD.submitted_name_snapshot;
  ELSE
    NEW.submitted_by := NULL;
    NEW.submitted_at := NULL;
    NEW.submitted_name_snapshot := NULL;
  END IF;

  IF NEW.status::text IS DISTINCT FROM 'confirmed' THEN
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.approved_name_snapshot := NULL;
  END IF;

  IF confirming THEN
    IF NOT public.can_approve_orders() THEN
      RAISE EXCEPTION 'only a production lead or admin can approve an order';
    END IF;
    IF NEW.confirmed_delivery_on IS NULL THEN
      RAISE EXCEPTION 'confirmed delivery date is missing';
    END IF;
    IF NEW.owner_id IS NULL THEN
      NEW.owner_id := auth.uid();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.customer_order_lines WHERE order_id = NEW.id) THEN
      RAISE EXCEPTION 'order has no lines';
    END IF;

    UPDATE public.customer_order_lines l
    SET unit_price_ore = public.price_ore_at(NEW.ordered_by_customer_id, l.product_id, NEW.confirmed_delivery_on),
        product_name_snapshot = p.name_no
    FROM public.products p
    WHERE l.order_id = NEW.id
      AND p.id = l.product_id;

    IF EXISTS (
      SELECT 1 FROM public.customer_order_lines
      WHERE order_id = NEW.id AND (unit_price_ore IS NULL OR product_name_snapshot IS NULL)
    ) THEN
      RAISE EXCEPTION 'missing price';
    END IF;

    recipient := public.resolve_billing_legal_entity(NEW.ordered_by_customer_id);
    IF recipient IS NULL THEN
      RAISE EXCEPTION 'invoice recipient is missing';
    END IF;
    SELECT * INTO entity FROM public.legal_entities WHERE id = recipient;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invoice recipient is missing';
    END IF;
    NEW.billing_legal_entity_id := entity.id;
    NEW.billing_legal_name_snapshot := entity.legal_name;
    NEW.billing_organization_number_snapshot := entity.organization_number;
    NEW.confirmed_at := now();
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
    SELECT COALESCE(NULLIF(btrim(full_name), ''), username)
      INTO owner_name
    FROM public.profiles
    WHERE id = auth.uid();
    NEW.approved_name_snapshot := owner_name;
  END IF;

  IF NEW.owner_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
    SELECT COALESCE(NULLIF(btrim(full_name), ''), username)
      INTO owner_name
    FROM public.profiles
    WHERE id = NEW.owner_id;
    NEW.owner_name_snapshot := owner_name;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_order_delivery(
  p_order_id UUID,
  p_delivered_on DATE,
  p_idempotency_key UUID,
  p_lines JSONB
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

  INSERT INTO public.deliveries (customer_id, quantity, delivered_at, note)
  VALUES (sale.ship_to_customer_id, total, p_delivered_on, sale.order_number)
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

REVOKE ALL ON FUNCTION public.register_order_delivery(UUID, DATE, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_order_delivery(UUID, DATE, UUID, JSONB) TO authenticated, service_role;

-- The venue page names this constraint. Add it only when every value already
-- points at a wholesaler. Do not rewrite customer rows.
DO $$
DECLARE
  bad_rows INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_supplied_by_customer_id_fkey'
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO bad_rows
  FROM public.customers c
  WHERE c.supplied_by_customer_id IS NOT NULL
    AND (
      c.supplied_by_customer_id = c.id
      OR NOT EXISTS (
        SELECT 1
        FROM public.customers s
        WHERE s.id = c.supplied_by_customer_id
          AND s.type = 'wholesaler'
      )
    );

  IF bad_rows > 0 THEN
    RAISE NOTICE 'customers_supplied_by_customer_id_fkey not added: % rows do not point at a wholesaler', bad_rows;
    RETURN;
  END IF;

  ALTER TABLE public.customers
    ADD CONSTRAINT customers_supplied_by_customer_id_fkey
    FOREIGN KEY (supplied_by_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
