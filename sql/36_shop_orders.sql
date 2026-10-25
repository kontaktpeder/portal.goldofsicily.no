-- Kjør i Lovable Cloud → SQL etter sql/35_reopen_lot.sql.
-- Nettbestillinger ligger her. Pakking, LOT, levering og faktura
-- fortsetter i customer_orders etter godkjenning.
-- binding_orders_open står av. Publikum kan sende forespørsel.
-- Henting kan bli bindende først når raden settes til true.

CREATE TABLE IF NOT EXISTS public.shop_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  binding_orders_open BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO public.shop_settings (id, binding_orders_open)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS public.shop_order_number_seq;

CREATE TABLE IF NOT EXISTS public.shop_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('received', 'quote', 'offer', 'confirming', 'confirmed', 'declined', 'expired')
  ),
  payment_kind TEXT NOT NULL DEFAULT 'invoice' CHECK (payment_kind IN ('invoice', 'stripe')),
  flavor_slug TEXT NOT NULL CHECK (flavor_slug IN ('nduja', 'truffle')),
  product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  boxes INTEGER NOT NULL CHECK (boxes > 0),
  pieces INTEGER NOT NULL CHECK (pieces > 0),
  unit_price_ore INTEGER NOT NULL CHECK (unit_price_ore > 0),
  total_ore INTEGER NOT NULL CHECK (total_ore > 0),
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address_line TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  org_number TEXT,
  fulfillment TEXT NOT NULL CHECK (fulfillment IN ('pickup', 'delivery_request')),
  binding BOOLEAN NOT NULL DEFAULT false,
  reservation_id UUID REFERENCES public.shop_reservations(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_order_id UUID REFERENCES public.customer_orders(id) ON DELETE SET NULL,
  offer_boxes INTEGER,
  offer_total_ore INTEGER,
  offer_token TEXT UNIQUE,
  lang TEXT NOT NULL DEFAULT 'no' CHECK (lang IN ('no', 'en')),
  received_mail_at TIMESTAMPTZ,
  confirmed_mail_at TIMESTAMPTZ,
  mail_error TEXT,
  approval_token TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.assign_shop_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
    NEW.order_number := 'N-' || lpad(nextval('public.shop_order_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_orders_number ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_number
BEFORE INSERT ON public.shop_orders
FOR EACH ROW EXECUTE FUNCTION public.assign_shop_order_number();

CREATE INDEX IF NOT EXISTS shop_orders_open
  ON public.shop_orders (created_at DESC)
  WHERE status IN ('received', 'quote', 'offer', 'confirming');

ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shop_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shop_orders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shop_settings TO service_role;
GRANT ALL ON public.shop_orders TO service_role;
GRANT SELECT, UPDATE ON public.shop_orders TO authenticated;

DROP POLICY IF EXISTS "shop_orders_ops" ON public.shop_orders;
CREATE POLICY "shop_orders_ops" ON public.shop_orders
  FOR SELECT TO authenticated
  USING (public.can_manage_operations());

DROP POLICY IF EXISTS "shop_orders_ops_update" ON public.shop_orders;
CREATE POLICY "shop_orders_ops_update" ON public.shop_orders
  FOR UPDATE TO authenticated
  USING (public.can_manage_operations())
  WITH CHECK (public.can_manage_operations());

-- Slipper utløpte hold selv om ingen ny bestilling kommer inn.
-- En godkjent nettbestilling beholder reservasjonen til den ordinære
-- leveringen har dekket antallet.
CREATE OR REPLACE FUNCTION public.sweep_shop_orders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  released INTEGER := 0;
BEGIN
  UPDATE public.shop_reservations r
  SET status = 'released'
  WHERE r.status = 'held'
    AND r.expires_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.shop_orders o
      WHERE o.reservation_id = r.id
        AND o.status IN ('confirmed', 'confirming')
    );
  GET DIAGNOSTICS released = ROW_COUNT;

  UPDATE public.shop_orders o
  SET status = 'expired', updated_at = now()
  WHERE o.status = 'received'
    AND o.binding
    AND (
      o.expires_at <= now()
      OR NOT EXISTS (
        SELECT 1 FROM public.shop_reservations r
        WHERE r.id = o.reservation_id
          AND r.status = 'held'
          AND r.expires_at > now()
      )
    );

  RETURN released;
END;
$$;

-- Når den ordinære ordren er levert, slippes nettreservasjonen.
-- Lageret er da allerede trukket i LOT, så holdet skal ikke ligge igjen.
CREATE OR REPLACE FUNCTION public.release_shop_hold_when_fulfilled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sale_id UUID;
  needed INTEGER;
  done INTEGER;
  hold UUID;
BEGIN
  SELECT l.order_id INTO sale_id
  FROM public.customer_order_lines l
  WHERE l.id = NEW.order_line_id;
  IF sale_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.pieces, o.reservation_id
    INTO needed, hold
  FROM public.shop_orders o
  WHERE o.customer_order_id = sale_id
    AND o.reservation_id IS NOT NULL
  LIMIT 1;
  IF hold IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(f.quantity), 0) INTO done
  FROM public.order_line_fulfillments f
  JOIN public.customer_order_lines l ON l.id = f.order_line_id
  WHERE l.order_id = sale_id;

  IF done >= needed THEN
    UPDATE public.shop_reservations
    SET status = 'released'
    WHERE id = hold AND status = 'held';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_shop_hold ON public.order_line_fulfillments;
CREATE TRIGGER trg_release_shop_hold
AFTER INSERT ON public.order_line_fulfillments
FOR EACH ROW EXECUTE FUNCTION public.release_shop_hold_when_fulfilled();

REVOKE ALL ON FUNCTION public.release_shop_hold_when_fulfilled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_shop_hold_when_fulfilled() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sweep_shop_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_shop_orders() TO service_role;
