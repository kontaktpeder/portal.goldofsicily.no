-- Kjør i Lovable Cloud → SQL.
-- Ordrer på eksisterende kunder, leveranser og fakturagrunnlag.
-- Bestiller, leveringssted og fakturamottaker er tre roller.
-- Bekreftelse fryser mottaker, pris og dato. Levert antall faktureres.
-- Also applied as supabase/migrations/20261018120000_customer_orders.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_order_status') THEN
    CREATE TYPE public.customer_order_status AS ENUM (
      'draft',
      'pending_confirmation',
      'confirmed',
      'cancelled'
    );
  END IF;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS public.customer_order_number_seq;

CREATE TABLE IF NOT EXISTS public.customer_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE DEFAULT '',
  status public.customer_order_status NOT NULL DEFAULT 'draft',
  ordered_by_customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  ship_to_customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  contact_name TEXT,
  desired_delivery_on DATE,
  confirmed_delivery_on DATE,
  billing_legal_entity_id UUID REFERENCES public.legal_entities(id) ON DELETE RESTRICT,
  billing_legal_name_snapshot TEXT,
  billing_organization_number_snapshot TEXT,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_name_snapshot TEXT,
  due_on DATE,
  deviation_note TEXT,
  notes TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_orders_ordered_by ON public.customer_orders(ordered_by_customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_ship_to ON public.customer_orders(ship_to_customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON public.customer_orders(status);

CREATE TABLE IF NOT EXISTS public.customer_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.customer_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_ore INTEGER CHECK (unit_price_ore IS NULL OR unit_price_ore > 0),
  product_name_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_order_lines_order ON public.customer_order_lines(order_id);

CREATE TABLE IF NOT EXISTS public.order_line_fulfillments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_line_id UUID NOT NULL REFERENCES public.customer_order_lines(id) ON DELETE RESTRICT,
  delivery_line_id UUID NOT NULL REFERENCES public.delivery_lines(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_line_fulfillments_line ON public.order_line_fulfillments(order_line_id);
CREATE INDEX IF NOT EXISTS idx_order_line_fulfillments_delivery ON public.order_line_fulfillments(delivery_line_id);

ALTER TABLE public.invoice_draft_lines
  ADD COLUMN IF NOT EXISTS order_line_fulfillment_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_draft_lines_order_line_fulfillment_id_fkey'
  ) THEN
    ALTER TABLE public.invoice_draft_lines
      ADD CONSTRAINT invoice_draft_lines_order_line_fulfillment_id_fkey
      FOREIGN KEY (order_line_fulfillment_id) REFERENCES public.order_line_fulfillments(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.invoice_draft_lines_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_draft_lines_one_active_fulfillment
  ON public.invoice_draft_lines(order_line_fulfillment_id)
  WHERE active AND order_line_fulfillment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_draft_lines_one_active_legacy
  ON public.invoice_draft_lines(delivery_line_id)
  WHERE active AND order_line_fulfillment_id IS NULL;

CREATE OR REPLACE FUNCTION public.assign_customer_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
    NEW.order_number := 'O-' || lpad(nextval('public.customer_order_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_orders_number ON public.customer_orders;
CREATE TRIGGER trg_customer_orders_number
BEFORE INSERT ON public.customer_orders
FOR EACH ROW EXECUTE FUNCTION public.assign_customer_order_number();

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
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'a cancelled order stays cancelled';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' AND NEW.status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'a confirmed order stays confirmed until it is cancelled';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF EXISTS (
      SELECT 1
      FROM public.order_line_fulfillments f
      JOIN public.customer_order_lines l ON l.id = f.order_line_id
      WHERE l.order_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'a delivered order cannot be cancelled';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
    IF NEW.ordered_by_customer_id IS DISTINCT FROM OLD.ordered_by_customer_id
       OR NEW.ship_to_customer_id IS DISTINCT FROM OLD.ship_to_customer_id
       OR NEW.confirmed_delivery_on IS DISTINCT FROM OLD.confirmed_delivery_on
       OR NEW.billing_legal_entity_id IS DISTINCT FROM OLD.billing_legal_entity_id
       OR NEW.billing_legal_name_snapshot IS DISTINCT FROM OLD.billing_legal_name_snapshot
       OR NEW.billing_organization_number_snapshot IS DISTINCT FROM OLD.billing_organization_number_snapshot
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'a confirmed order keeps its recipient, price and date';
    END IF;
  END IF;

  IF NEW.owner_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
    SELECT COALESCE(NULLIF(btrim(full_name), ''), username)
      INTO owner_name
    FROM public.profiles
    WHERE id = NEW.owner_id;
    NEW.owner_name_snapshot := owner_name;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM 'confirmed'
     AND NEW.status = 'confirmed' THEN
    IF NEW.confirmed_delivery_on IS NULL THEN
      RAISE EXCEPTION 'confirmed delivery date is missing';
    END IF;
    IF NEW.owner_id IS NULL THEN
      RAISE EXCEPTION 'order owner is missing';
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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_orders_guard ON public.customer_orders;
CREATE TRIGGER trg_customer_orders_guard
BEFORE INSERT OR UPDATE ON public.customer_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_order();

DROP TRIGGER IF EXISTS trg_customer_orders_updated_at ON public.customer_orders;
CREATE TRIGGER trg_customer_orders_updated_at
BEFORE UPDATE ON public.customer_orders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.guard_customer_order_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  state public.customer_order_status;
  order_id UUID;
BEGIN
  order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT status INTO state FROM public.customer_orders WHERE id = order_id;
  IF state IN ('confirmed', 'cancelled') THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'a confirmed order line stays';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'a confirmed order line stays';
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.unit_price_ore IS DISTINCT FROM OLD.unit_price_ore
       OR NEW.product_name_snapshot IS DISTINCT FROM OLD.product_name_snapshot THEN
      RAISE EXCEPTION 'a confirmed order line stays';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_order_lines_guard ON public.customer_order_lines;
CREATE TRIGGER trg_customer_order_lines_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.customer_order_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_order_line();

CREATE OR REPLACE FUNCTION public.enforce_order_fulfillment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ordered_qty INTEGER;
  delivered_qty INTEGER;
  order_state public.customer_order_status;
  product_on_order UUID;
  product_on_delivery UUID;
  ship_to UUID;
  delivered_to UUID;
  used_on_order INTEGER;
  used_on_delivery INTEGER;
  legacy_invoiced INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_line_id IS DISTINCT FROM OLD.order_line_id
       OR NEW.delivery_line_id IS DISTINCT FROM OLD.delivery_line_id THEN
      RAISE EXCEPTION 'a fulfillment stays on its order line and delivery line';
    END IF;
    IF NEW.quantity IS DISTINCT FROM OLD.quantity AND EXISTS (
      SELECT 1 FROM public.invoice_draft_lines
      WHERE order_line_fulfillment_id = NEW.id AND active
    ) THEN
      RAISE EXCEPTION 'an invoiced fulfillment quantity stays fixed';
    END IF;
  END IF;

  SELECT dl.quantity, dl.product_id, d.customer_id
    INTO delivered_qty, product_on_delivery, delivered_to
  FROM public.delivery_lines dl
  JOIN public.deliveries d ON d.id = dl.delivery_id
  WHERE dl.id = NEW.delivery_line_id
  FOR UPDATE OF dl;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery line is missing';
  END IF;

  SELECT l.quantity, l.product_id, o.status, o.ship_to_customer_id
    INTO ordered_qty, product_on_order, order_state, ship_to
  FROM public.customer_order_lines l
  JOIN public.customer_orders o ON o.id = l.order_id
  WHERE l.id = NEW.order_line_id
  FOR UPDATE OF l, o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order line is missing';
  END IF;
  IF order_state <> 'confirmed' THEN
    RAISE EXCEPTION 'only a confirmed order can be delivered';
  END IF;
  IF product_on_order IS DISTINCT FROM product_on_delivery THEN
    RAISE EXCEPTION 'order line and delivery line must be the same product';
  END IF;
  IF ship_to IS DISTINCT FROM delivered_to THEN
    RAISE EXCEPTION 'delivery site does not match the order';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO used_on_order
  FROM public.order_line_fulfillments
  WHERE order_line_id = NEW.order_line_id
    AND id IS DISTINCT FROM NEW.id;

  SELECT COALESCE(SUM(quantity), 0) INTO used_on_delivery
  FROM public.order_line_fulfillments
  WHERE delivery_line_id = NEW.delivery_line_id
    AND id IS DISTINCT FROM NEW.id;

  IF used_on_order + NEW.quantity > ordered_qty THEN
    RAISE EXCEPTION 'fulfillment exceeds ordered quantity';
  END IF;
  IF used_on_delivery + NEW.quantity > delivered_qty THEN
    RAISE EXCEPTION 'fulfillment exceeds delivered quantity';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO legacy_invoiced
  FROM public.invoice_draft_lines
  WHERE delivery_line_id = NEW.delivery_line_id
    AND active
    AND order_line_fulfillment_id IS NULL;

  IF used_on_delivery + NEW.quantity + legacy_invoiced > delivered_qty THEN
    RAISE EXCEPTION 'fulfillment overlaps an invoice';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_line_fulfillments_bounds ON public.order_line_fulfillments;
CREATE TRIGGER trg_order_line_fulfillments_bounds
BEFORE INSERT OR UPDATE ON public.order_line_fulfillments
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_fulfillment();

CREATE OR REPLACE FUNCTION public.guard_fulfillment_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invoice_draft_lines
    WHERE order_line_fulfillment_id = OLD.id AND active
  ) THEN
    RAISE EXCEPTION 'an invoiced fulfillment stays';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_line_fulfillments_delete ON public.order_line_fulfillments;
CREATE TRIGGER trg_order_line_fulfillments_delete
BEFORE DELETE ON public.order_line_fulfillments
FOR EACH ROW EXECUTE FUNCTION public.guard_fulfillment_delete();

CREATE OR REPLACE FUNCTION public.guard_delivery_line_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allocated INTEGER;
  invoiced INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM public.order_line_fulfillments WHERE delivery_line_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'a delivered order line stays linked';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(quantity), 0) INTO allocated
    FROM public.order_line_fulfillments
    WHERE delivery_line_id = NEW.id;
    IF allocated > 0 AND (
      NEW.product_id IS DISTINCT FROM OLD.product_id
      OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
    ) THEN
      RAISE EXCEPTION 'a linked delivery line keeps its product';
    END IF;
    IF allocated > NEW.quantity THEN
      RAISE EXCEPTION 'delivered quantity is below the linked order quantity';
    END IF;
    SELECT COALESCE(SUM(quantity), 0) INTO invoiced
    FROM public.invoice_draft_lines
    WHERE delivery_line_id = NEW.id AND active;
    IF invoiced > NEW.quantity THEN
      RAISE EXCEPTION 'delivered quantity is below the invoiced quantity';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_lines_allocation ON public.delivery_lines;
CREATE TRIGGER trg_delivery_lines_allocation
BEFORE UPDATE OR DELETE ON public.delivery_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_line_allocation();

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
  fulfillment public.order_line_fulfillments%ROWTYPE;
  order_line public.customer_order_lines%ROWTYPE;
  sale public.customer_orders%ROWTYPE;
  recipient UUID;
  allocated INTEGER;
  already INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.invoice_draft_id := OLD.invoice_draft_id;
    NEW.delivery_line_id := OLD.delivery_line_id;
    NEW.order_line_fulfillment_id := OLD.order_line_fulfillment_id;
    NEW.venue_name_snapshot := OLD.venue_name_snapshot;
    NEW.product_name_snapshot := OLD.product_name_snapshot;
    NEW.quantity := OLD.quantity;
    NEW.unit_price_ore := OLD.unit_price_ore;
    IF OLD.active = false AND NEW.active THEN
      RAISE EXCEPTION 'an inactive invoice allocation stays inactive';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO line FROM public.delivery_lines WHERE id = NEW.delivery_line_id FOR UPDATE;
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

  IF NEW.order_line_fulfillment_id IS NOT NULL THEN
    SELECT * INTO fulfillment
    FROM public.order_line_fulfillments
    WHERE id = NEW.order_line_fulfillment_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'order fulfillment is missing';
    END IF;
    IF fulfillment.delivery_line_id IS DISTINCT FROM NEW.delivery_line_id THEN
      RAISE EXCEPTION 'invoice line does not match the fulfillment';
    END IF;
    SELECT * INTO order_line FROM public.customer_order_lines WHERE id = fulfillment.order_line_id;
    SELECT * INTO sale FROM public.customer_orders WHERE id = order_line.order_id;
    IF sale.status <> 'confirmed' OR sale.billing_legal_entity_id IS NULL OR order_line.unit_price_ore IS NULL THEN
      RAISE EXCEPTION 'confirmed order price is missing';
    END IF;
    IF sale.billing_legal_entity_id IS DISTINCT FROM draft.legal_entity_id THEN
      RAISE EXCEPTION 'billing recipient does not match';
    END IF;
    NEW.venue_name_snapshot := delivery.customer_name_snapshot;
    NEW.product_name_snapshot := order_line.product_name_snapshot;
    NEW.quantity := fulfillment.quantity;
    NEW.unit_price_ore := order_line.unit_price_ore;
    NEW.active := true;
  ELSE
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
    SELECT COALESCE(SUM(quantity), 0) INTO allocated
    FROM public.order_line_fulfillments
    WHERE delivery_line_id = line.id;
    IF line.quantity - allocated <= 0 THEN
      RAISE EXCEPTION 'delivery quantity is already on an order';
    END IF;
    NEW.venue_name_snapshot := delivery.customer_name_snapshot;
    NEW.product_name_snapshot := line.product_name_snapshot;
    NEW.quantity := line.quantity - allocated;
    NEW.unit_price_ore := line.unit_price_ore;
    NEW.active := true;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO already
  FROM public.invoice_draft_lines
  WHERE delivery_line_id = NEW.delivery_line_id
    AND active
    AND id IS DISTINCT FROM NEW.id;
  IF already + NEW.quantity > line.quantity THEN
    RAISE EXCEPTION 'invoice quantity exceeds delivered quantity';
  END IF;

  RETURN NEW;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_orders TO authenticated;
GRANT ALL ON public.customer_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_order_lines TO authenticated;
GRANT ALL ON public.customer_order_lines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_line_fulfillments TO authenticated;
GRANT ALL ON public.order_line_fulfillments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.customer_order_number_seq TO authenticated, service_role;

ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_line_fulfillments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_orders_select" ON public.customer_orders;
CREATE POLICY "customer_orders_select" ON public.customer_orders
  FOR SELECT TO authenticated
  USING (public.can_manage_operations());

DROP POLICY IF EXISTS "customer_orders_insert" ON public.customer_orders;
CREATE POLICY "customer_orders_insert" ON public.customer_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_orders_update" ON public.customer_orders;
CREATE POLICY "customer_orders_update" ON public.customer_orders
  FOR UPDATE TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_orders_delete" ON public.customer_orders;
CREATE POLICY "customer_orders_delete" ON public.customer_orders
  FOR DELETE TO authenticated
  USING (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_order_lines_select" ON public.customer_order_lines;
CREATE POLICY "customer_order_lines_select" ON public.customer_order_lines
  FOR SELECT TO authenticated
  USING (public.can_manage_operations());

DROP POLICY IF EXISTS "customer_order_lines_insert" ON public.customer_order_lines;
CREATE POLICY "customer_order_lines_insert" ON public.customer_order_lines
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_order_lines_update" ON public.customer_order_lines;
CREATE POLICY "customer_order_lines_update" ON public.customer_order_lines
  FOR UPDATE TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "customer_order_lines_delete" ON public.customer_order_lines;
CREATE POLICY "customer_order_lines_delete" ON public.customer_order_lines
  FOR DELETE TO authenticated
  USING (public.can_manage_commercial());

DROP POLICY IF EXISTS "order_line_fulfillments_select" ON public.order_line_fulfillments;
CREATE POLICY "order_line_fulfillments_select" ON public.order_line_fulfillments
  FOR SELECT TO authenticated
  USING (public.can_manage_operations());

DROP POLICY IF EXISTS "order_line_fulfillments_insert" ON public.order_line_fulfillments;
CREATE POLICY "order_line_fulfillments_insert" ON public.order_line_fulfillments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations());

DROP POLICY IF EXISTS "order_line_fulfillments_update" ON public.order_line_fulfillments;
CREATE POLICY "order_line_fulfillments_update" ON public.order_line_fulfillments
  FOR UPDATE TO authenticated
  USING (public.can_manage_operations())
  WITH CHECK (public.can_manage_operations());

DROP POLICY IF EXISTS "order_line_fulfillments_delete" ON public.order_line_fulfillments;
CREATE POLICY "order_line_fulfillments_delete" ON public.order_line_fulfillments
  FOR DELETE TO authenticated
  USING (public.can_manage_operations());
