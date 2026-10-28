-- Kjør i Lovable Cloud → SQL etter sql/36_shop_orders.sql.
-- Fast leveringspris i luftlinje fra Smalgangen 31.
-- 0–5 km 60 kr, 5–10 km 179 kr, 10–15 km 349 kr. Utenfor 15 km er frakt tom
-- til et tilbud er godtatt. binding_orders_open skal fortsatt stå av.

ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS freight_ore INTEGER,
  ADD COLUMN IF NOT EXISTS distance_m INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_zone TEXT,
  ADD COLUMN IF NOT EXISTS delivery_note TEXT,
  ADD COLUMN IF NOT EXISTS offer_freight_ore INTEGER,
  ADD COLUMN IF NOT EXISTS offer_fulfillment TEXT,
  ADD COLUMN IF NOT EXISTS offer_delivery_note TEXT;

ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_freight_ore_check;
ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_freight_ore_check
  CHECK (freight_ore IS NULL OR freight_ore >= 0);

ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_delivery_zone_check;
ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_delivery_zone_check
  CHECK (
    delivery_zone IS NULL
    OR delivery_zone IN ('pickup', 'km5', 'km10', 'km15', 'outside', 'agreed')
  );

ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_offer_fulfillment_check;
ALTER TABLE public.shop_orders
  ADD CONSTRAINT shop_orders_offer_fulfillment_check
  CHECK (offer_fulfillment IS NULL OR offer_fulfillment IN ('pickup', 'delivery_request'));
