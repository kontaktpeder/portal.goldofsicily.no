-- Kjør i Lovable Cloud → SQL etter sql/31_shop.sql.
-- Egen liste for varsel om salgsstart. Den er ikke shop_waitlist:
-- ventelisten er per smak og brukes når en smak er tilbake på lager.
-- Ingen e-post sendes herfra. Radene ligger til bestilling faktisk åpner.
-- Anon og innloggede kunder har ingen tilgang. Service role leser og skriver.

CREATE TABLE IF NOT EXISTS public.shop_launch_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 255),
  lang TEXT NOT NULL CHECK (lang IN ('no', 'en')),
  discovery_source TEXT NOT NULL CHECK (discovery_source IN ('friends', 'instagram', 'venue', 'search', 'other')),
  newsletter_consent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_launch_notices_email
  ON public.shop_launch_notices (lower(email));

ALTER TABLE public.shop_launch_notices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.shop_launch_notices FROM PUBLIC, anon, authenticated;
