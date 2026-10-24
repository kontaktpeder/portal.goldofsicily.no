-- Kjør i Lovable Cloud → SQL etter sql/30.
-- Kjøpssiden leser lager fra gold_lots. Venteliste og reservasjoner
-- ligger her, ved siden av lageret, så nettsiden ikke får et eget system.
-- Anon og innloggede kunder har ingen tilgang. Service role leser og skriver.
--
-- Reservasjon: reserve_shop_pieces låser per produkt. To kjøp av de siste
-- 50 stykkene: det andre kallet får NULL. Utløpte hold slippes i samme kall.
-- payment_kind = stripe er allerede betalt og skal ikke faktureres.
-- payment_kind = invoice følger eksisterende fakturaflyt etter levering.
--
-- Varsel ved nytt parti krever RESEND_API_KEY og SHOP_MAIL_FROM på portalen.
-- Uten de to blir raden liggende med notified_at tom, og neste LOT-registrering prøver igjen.
-- Nyhetsbrev-samtykke lagres på raden. Det er ikke en nyhetsbrevpåmelding.

CREATE TABLE IF NOT EXISTS public.shop_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 255),
  flavor_slug TEXT NOT NULL CHECK (flavor_slug IN ('nduja', 'truffle')),
  lang TEXT NOT NULL CHECK (lang IN ('no', 'en')),
  discovery_source TEXT NOT NULL CHECK (discovery_source IN ('friends', 'instagram', 'venue', 'search', 'other')),
  newsletter_consent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_waitlist_email_flavor
  ON public.shop_waitlist (lower(email), flavor_slug);

CREATE TABLE IF NOT EXISTS public.shop_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  pieces INTEGER NOT NULL CHECK (pieces > 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'paid')),
  payment_kind TEXT CHECK (payment_kind IS NULL OR payment_kind IN ('stripe', 'invoice')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.shop_reservations.payment_kind IS
  'stripe is already paid and must not be invoiced. invoice follows the existing invoice flow after delivery.';

CREATE INDEX IF NOT EXISTS shop_reservations_active
  ON public.shop_reservations (product_id)
  WHERE status = 'held';

ALTER TABLE public.shop_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shop_waitlist FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shop_reservations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_shop_pieces(
  p_product_id UUID,
  p_pieces INTEGER,
  p_physical_pieces INTEGER,
  p_expires_at TIMESTAMPTZ,
  p_payment_kind TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  held INTEGER;
  new_id UUID;
BEGIN
  IF p_pieces IS NULL OR p_pieces <= 0 THEN
    RAISE EXCEPTION 'pieces must be positive';
  END IF;
  IF p_physical_pieces IS NULL OR p_physical_pieces < 0 THEN
    RAISE EXCEPTION 'physical pieces must be zero or more';
  END IF;
  IF p_payment_kind IS NOT NULL AND p_payment_kind NOT IN ('stripe', 'invoice') THEN
    RAISE EXCEPTION 'unknown payment kind';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_product_id::text)::bigint);

  UPDATE public.shop_reservations
    SET status = 'released'
    WHERE product_id = p_product_id
      AND status = 'held'
      AND expires_at <= now();

  SELECT coalesce(sum(pieces), 0) INTO held
    FROM public.shop_reservations
    WHERE product_id = p_product_id
      AND status = 'held'
      AND expires_at > now();

  IF held + p_pieces > p_physical_pieces THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.shop_reservations (product_id, pieces, status, payment_kind, expires_at)
  VALUES (p_product_id, p_pieces, 'held', p_payment_kind, p_expires_at)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_shop_pieces(UUID, INTEGER, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_shop_pieces(UUID, INTEGER, INTEGER, TIMESTAMPTZ, TEXT) TO service_role;
