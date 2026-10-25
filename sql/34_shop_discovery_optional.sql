-- Kjør i Lovable Cloud → SQL etter sql/33_confirmed_product_facts.sql.
-- Påmelding på kjøpssiden kan lagres med bare e-post.
-- Spørsmålet om hvor kunden fant Gold er valgfritt.

ALTER TABLE public.shop_waitlist
  ALTER COLUMN discovery_source DROP NOT NULL;

ALTER TABLE public.shop_launch_notices
  ALTER COLUMN discovery_source DROP NOT NULL;
