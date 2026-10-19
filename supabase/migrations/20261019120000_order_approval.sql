-- Ansatt sender til godkjenning. Drift og eier godkjenner.
-- Godkjenning er intern: ingen ordrebekreftelse går til kunden.
-- Source copy: sql/23_order_approval.sql.
--
-- New enum labels are compared as text so this file can run in one paste.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'employee';
ALTER TYPE public.customer_order_status ADD VALUE IF NOT EXISTS 'changes_requested';

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS return_note TEXT;

CREATE OR REPLACE FUNCTION public.can_approve_orders()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text IN ('admin', 'ops')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_register_orders()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text IN ('admin', 'ops', 'employee')
  );
$$;

REVOKE ALL ON FUNCTION public.can_approve_orders() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_register_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_approve_orders() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_register_orders() TO authenticated, service_role;

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
BEGIN
  confirming := NEW.status::text = 'confirmed'
    AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'confirmed');

  IF TG_OP = 'UPDATE' AND OLD.status::text = 'cancelled' AND NEW.status::text IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'a cancelled order stays cancelled';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status::text = 'confirmed' AND NEW.status::text NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'a confirmed order stays confirmed until it is cancelled';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status::text = 'cancelled' AND OLD.status::text IS DISTINCT FROM 'cancelled' THEN
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

  IF TG_OP = 'UPDATE'
     AND NEW.status::text = 'pending_confirmation'
     AND OLD.status::text IS DISTINCT FROM 'pending_confirmation' THEN
    IF OLD.status::text NOT IN ('draft', 'changes_requested') THEN
      RAISE EXCEPTION 'this order cannot be submitted';
    END IF;
    NEW.return_note := NULL;
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

CREATE OR REPLACE FUNCTION public.guard_customer_order_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  state TEXT;
  order_id UUID;
BEGIN
  order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT status::text INTO state FROM public.customer_orders WHERE id = order_id;

  IF state = 'pending_confirmation' THEN
    IF TG_OP = 'INSERT' OR TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'an order waiting for approval keeps its lines';
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      RAISE EXCEPTION 'an order waiting for approval keeps its lines';
    END IF;
  END IF;

  IF state IN ('confirmed', 'cancelled') THEN
    IF TG_OP = 'INSERT' OR TG_OP = 'DELETE' THEN
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

DROP POLICY IF EXISTS "customers_select" ON public.customers;
CREATE POLICY "customers_select" ON public.customers FOR SELECT TO authenticated
  USING (
    public.can_manage_operations()
    OR public.can_register_orders()
    OR id = public.current_customer_id()
  );

DROP POLICY IF EXISTS "customer_orders_select" ON public.customer_orders;
CREATE POLICY "customer_orders_select" ON public.customer_orders
  FOR SELECT TO authenticated
  USING (public.can_register_orders());

DROP POLICY IF EXISTS "customer_order_lines_select" ON public.customer_order_lines;
CREATE POLICY "customer_order_lines_select" ON public.customer_order_lines
  FOR SELECT TO authenticated
  USING (public.can_register_orders());

DROP POLICY IF EXISTS "order_line_fulfillments_select" ON public.order_line_fulfillments;
CREATE POLICY "order_line_fulfillments_select" ON public.order_line_fulfillments
  FOR SELECT TO authenticated
  USING (public.can_register_orders());

DROP POLICY IF EXISTS "customer_orders_insert" ON public.customer_orders;
CREATE POLICY "customer_orders_insert" ON public.customer_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.can_register_orders());

DROP POLICY IF EXISTS "customer_orders_update" ON public.customer_orders;
CREATE POLICY "customer_orders_update" ON public.customer_orders
  FOR UPDATE TO authenticated
  USING (public.can_register_orders())
  WITH CHECK (public.can_register_orders());

DROP POLICY IF EXISTS "customer_orders_delete" ON public.customer_orders;
CREATE POLICY "customer_orders_delete" ON public.customer_orders
  FOR DELETE TO authenticated
  USING (
    public.can_register_orders()
    AND status::text IN ('draft', 'changes_requested')
  );

DROP POLICY IF EXISTS "customer_order_lines_insert" ON public.customer_order_lines;
CREATE POLICY "customer_order_lines_insert" ON public.customer_order_lines
  FOR INSERT TO authenticated
  WITH CHECK (public.can_register_orders());

DROP POLICY IF EXISTS "customer_order_lines_update" ON public.customer_order_lines;
CREATE POLICY "customer_order_lines_update" ON public.customer_order_lines
  FOR UPDATE TO authenticated
  USING (public.can_register_orders())
  WITH CHECK (public.can_register_orders());

DROP POLICY IF EXISTS "customer_order_lines_delete" ON public.customer_order_lines;
CREATE POLICY "customer_order_lines_delete" ON public.customer_order_lines
  FOR DELETE TO authenticated
  USING (public.can_register_orders());
