-- Kjør i Lovable Cloud → SQL etter sql/38_ai_read_views.sql.
-- Skiller fire økonomiske sannheter:
--   1) levert stk (faktisk produktflyt, inkl. gratisvarer)
--   2) fakturert stk
--   3) netto fakturert eks. mva (regnskapsmessig omsetning)
--   4) utgående mva
-- Portalens quantity×pris på leveringslinjer er «prisa leveringsverdi», ikke omsetning.
-- Also applied as supabase/migrations/20261104230000_accounting_revenue_facts.sql.

-- ---------------------------------------------------------------------------
-- DNB-/regnskapsbekreftede periodetall
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_revenue_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  delivered_pcs INTEGER NOT NULL CHECK (delivered_pcs >= 0),
  invoiced_pcs INTEGER NOT NULL CHECK (invoiced_pcs >= 0),
  free_goods_pcs INTEGER NOT NULL DEFAULT 0 CHECK (free_goods_pcs >= 0),
  net_invoiced_ore INTEGER NOT NULL CHECK (net_invoiced_ore >= 0),
  outgoing_vat_ore INTEGER NOT NULL CHECK (outgoing_vat_ore >= 0),
  paid_incl_vat_ore INTEGER CHECK (paid_incl_vat_ore IS NULL OR paid_incl_vat_ore >= 0),
  source TEXT NOT NULL DEFAULT 'dnb_confirmed',
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounting_revenue_periods_range CHECK (period_end >= period_start),
  CONSTRAINT accounting_revenue_periods_delivered_vs_invoiced
    CHECK (delivered_pcs >= invoiced_pcs),
  CONSTRAINT accounting_revenue_periods_free_fit
    CHECK (free_goods_pcs = delivered_pcs - invoiced_pcs)
);

CREATE TABLE IF NOT EXISTS public.accounting_revenue_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.accounting_revenue_periods(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name_snapshot TEXT NOT NULL,
  delivered_pcs INTEGER NOT NULL CHECK (delivered_pcs >= 0),
  invoiced_pcs INTEGER NOT NULL CHECK (invoiced_pcs >= 0),
  free_goods_pcs INTEGER NOT NULL DEFAULT 0 CHECK (free_goods_pcs >= 0),
  net_invoiced_ore INTEGER NOT NULL CHECK (net_invoiced_ore >= 0),
  outgoing_vat_ore INTEGER NOT NULL CHECK (outgoing_vat_ore >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_id, customer_name_snapshot)
);

CREATE INDEX IF NOT EXISTS idx_accounting_revenue_periods_active
  ON public.accounting_revenue_periods (active, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_accounting_revenue_customers_period
  ON public.accounting_revenue_customers (period_id);

DROP TRIGGER IF EXISTS trg_accounting_revenue_periods_updated_at
  ON public.accounting_revenue_periods;
CREATE TRIGGER trg_accounting_revenue_periods_updated_at
BEFORE UPDATE ON public.accounting_revenue_periods
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounting_revenue_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_revenue_customers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.accounting_revenue_periods FROM PUBLIC, anon;
REVOKE ALL ON public.accounting_revenue_customers FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_revenue_periods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_revenue_customers TO authenticated;
GRANT ALL ON public.accounting_revenue_periods TO service_role;
GRANT ALL ON public.accounting_revenue_customers TO service_role;

DROP POLICY IF EXISTS "accounting_revenue_periods_select" ON public.accounting_revenue_periods;
CREATE POLICY "accounting_revenue_periods_select" ON public.accounting_revenue_periods
  FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR public.can_manage_commercial());

DROP POLICY IF EXISTS "accounting_revenue_periods_write" ON public.accounting_revenue_periods;
CREATE POLICY "accounting_revenue_periods_write" ON public.accounting_revenue_periods
  FOR ALL TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());

DROP POLICY IF EXISTS "accounting_revenue_customers_select" ON public.accounting_revenue_customers;
CREATE POLICY "accounting_revenue_customers_select" ON public.accounting_revenue_customers
  FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR public.can_manage_commercial());

DROP POLICY IF EXISTS "accounting_revenue_customers_write" ON public.accounting_revenue_customers;
CREATE POLICY "accounting_revenue_customers_write" ON public.accounting_revenue_customers
  FOR ALL TO authenticated
  USING (public.can_manage_commercial())
  WITH CHECK (public.can_manage_commercial());

-- ---------------------------------------------------------------------------
-- Seed: bekreftet DNB-periode (aug–okt 2026)
-- Villa-kommersielt: Import + Grossista = 6 180 stk / 154 500 kr eks. mva
-- Bowling: 480 levert, 400 fakturert, 80 gratis; 10 000 kr eks. mva
-- ---------------------------------------------------------------------------
INSERT INTO public.accounting_revenue_periods (
  label,
  period_start,
  period_end,
  delivered_pcs,
  invoiced_pcs,
  free_goods_pcs,
  net_invoiced_ore,
  outgoing_vat_ore,
  paid_incl_vat_ore,
  source,
  notes,
  active
)
VALUES (
  'oppstart-2026',
  DATE '2026-08-25',
  DATE '2026-10-31',
  6660,
  6580,
  80,
  16450000,
  1987500,
  18437500,
  'dnb_confirmed',
  $notes$DNB Regnskap er fasit for omsetning og mva.
Levert 6 660 inkl. 200 stk Bowling som mangler i portalens leveranseregister (portal sum = 6 460).
Bowling: 400 fakturert + 80 gratisvarer/overlevering.
Villa-kommersielt inkl. 180 stk via Grossista som er uten unit_price i portal.
Prisa leveringsverdi i portal = 6 000 × 25 = 150 000 kr (ikke omsetning).$notes$,
  true
)
ON CONFLICT (label) DO UPDATE SET
  period_start = EXCLUDED.period_start,
  period_end = EXCLUDED.period_end,
  delivered_pcs = EXCLUDED.delivered_pcs,
  invoiced_pcs = EXCLUDED.invoiced_pcs,
  free_goods_pcs = EXCLUDED.free_goods_pcs,
  net_invoiced_ore = EXCLUDED.net_invoiced_ore,
  outgoing_vat_ore = EXCLUDED.outgoing_vat_ore,
  paid_incl_vat_ore = EXCLUDED.paid_incl_vat_ore,
  source = EXCLUDED.source,
  notes = EXCLUDED.notes,
  active = EXCLUDED.active,
  updated_at = now();

WITH period AS (
  SELECT id FROM public.accounting_revenue_periods WHERE label = 'oppstart-2026'
),
ids AS (
  SELECT
    (SELECT id FROM public.customers WHERE name = 'Villa Import' LIMIT 1) AS villa_import_id,
    (SELECT id FROM public.customers WHERE name = 'Oslo Bar & Bowling' LIMIT 1) AS bowling_id
)
INSERT INTO public.accounting_revenue_customers (
  period_id,
  customer_id,
  customer_name_snapshot,
  delivered_pcs,
  invoiced_pcs,
  free_goods_pcs,
  net_invoiced_ore,
  outgoing_vat_ore,
  notes
)
SELECT period.id, ids.villa_import_id, 'Villa Import', 6180, 6180, 0, 15450000, 1942500,
  'Kommersielt Villa-volum: portal Villa Import 6 000 + Grossista 180. Fakturert i DNB som Villa Import.'
FROM period, ids
UNION ALL
SELECT period.id, ids.bowling_id, 'Oslo Bar & Bowling', 480, 400, 80, 1000000, 45000,
  'Portal har 280 stk. Mangler siste levering 200 stk. 80 stk er gratisvarer/overlevering utover fakturerte 400.'
FROM period, ids
ON CONFLICT (period_id, customer_name_snapshot) DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  delivered_pcs = EXCLUDED.delivered_pcs,
  invoiced_pcs = EXCLUDED.invoiced_pcs,
  free_goods_pcs = EXCLUDED.free_goods_pcs,
  net_invoiced_ore = EXCLUDED.net_invoiced_ore,
  outgoing_vat_ore = EXCLUDED.outgoing_vat_ore,
  notes = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- ai_read: guide, economics, pricing gap, updated kpis
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.guide AS
SELECT *
FROM (
  VALUES
    (
      'economics'::text,
      'Fire hovedtall: levert, fakturert, netto fakturert eks. mva, utgående mva'::text,
      true,
      'Regnskapsfasit fra accounting_revenue_periods (DNB-bekreftet).'::text
    ),
    (
      'accounting_by_customer',
      'Samme tall fordelt på kunde',
      true,
      NULL
    ),
    (
      'delivery_pricing',
      'Portal: prisa vs uprisa leveringslinjer',
      true,
      'Sum prisa_leveringsverdi er IKKE omsetning.'
    ),
    (
      'deliveries',
      'Leveranser i portal (linjer med smak, antall, pris, LOT)',
      true,
      'Produktflyt i appen. Kan mangle leveranser som finnes i regnskapet.'
    ),
    (
      'delivery_totals',
      'Summerte portal-leveranser per smak',
      true,
      'revenue_nok her = prisa leveringsverdi, ikke DNB-omsetning.'
    ),
    (
      'production_lots',
      'Gold-LOT: produsert, godkjent, levert fra LOT, status',
      true,
      'approved_qty er pakkestørrelse; mangler den brukes produced_qty.'
    ),
    (
      'customers',
      'Aktive kunder (uten kontaktperson-PII)',
      true,
      NULL
    ),
    (
      'customer_orders',
      'B2B-ordrer i portalen',
      true,
      'Kan være tom mens historikk ligger i leveranser.'
    ),
    (
      'shop_orders',
      'Nettbutikkordrer uten e-post/telefon/adresse',
      true,
      NULL
    ),
    (
      'data_quality',
      'Hull: leveringslinjer uten LOT, levert vs produsert',
      true,
      'Sjekk denne før du regner lager.'
    ),
    (
      'kpis',
      'Én rad: regnskapstall + portal prisa leveringsverdi',
      true,
      'Bruk net_invoiced_nok som omsetning. priced_delivery_value_nok er ikke omsetning.'
    ),
    (
      'inventory_total',
      'Total lagerbeholdning',
      false,
      'Ingen egen lagertabell. Ikke utled lager før data_quality.ok_for_inventory = true.'
    ),
    (
      'cogs',
      'Varekost',
      false,
      'Finnes ikke i portalen.'
    ),
    (
      'capacity',
      'Produksjonskapasitet / tid',
      false,
      'Finnes ikke i portalen.'
    )
) AS t(dataset, description, available, note);

COMMENT ON VIEW ai_read.guide IS
  'Katalog over AI-datasett. available=false betyr at tallet ikke skal oppfinnes.';

CREATE OR REPLACE VIEW ai_read.economics AS
SELECT
  p.label AS period_label,
  p.period_start,
  p.period_end,
  p.delivered_pcs,
  p.invoiced_pcs,
  p.free_goods_pcs,
  round(p.net_invoiced_ore / 100.0, 2) AS net_invoiced_nok,
  round(p.outgoing_vat_ore / 100.0, 2) AS outgoing_vat_nok,
  CASE
    WHEN p.paid_incl_vat_ore IS NULL THEN NULL
    ELSE round(p.paid_incl_vat_ore / 100.0, 2)
  END AS paid_incl_vat_nok,
  p.source,
  p.notes,
  (
    SELECT coalesce(sum(dl.quantity), 0)::integer
    FROM public.delivery_lines dl
  ) AS portal_delivery_pcs,
  (
    SELECT coalesce(sum(dl.quantity), 0)::integer
    FROM public.delivery_lines dl
    WHERE dl.unit_price_ore IS NOT NULL
  ) AS portal_priced_pcs,
  (
    SELECT coalesce(sum(dl.quantity), 0)::integer
    FROM public.delivery_lines dl
    WHERE dl.quantity > 0 AND dl.unit_price_ore IS NULL
  ) AS portal_unpriced_pcs,
  (
    SELECT round(
      sum(dl.quantity::numeric * dl.unit_price_ore)
        FILTER (WHERE dl.unit_price_ore IS NOT NULL) / 100.0,
      2
    )
    FROM public.delivery_lines dl
  ) AS priced_delivery_value_nok,
  (p.delivered_pcs - (
    SELECT coalesce(sum(dl.quantity), 0)::integer FROM public.delivery_lines dl
  )) AS portal_missing_delivered_pcs
FROM public.accounting_revenue_periods p
WHERE p.active
ORDER BY p.period_end DESC;

COMMENT ON VIEW ai_read.economics IS
  'Fire hovedtall (levert / fakturert / netto / mva) pluss portal-kryssjekk. net_invoiced_nok = omsetning.';

CREATE OR REPLACE VIEW ai_read.accounting_by_customer AS
SELECT
  p.label AS period_label,
  c.customer_name_snapshot AS customer_name,
  c.customer_id,
  c.delivered_pcs,
  c.invoiced_pcs,
  c.free_goods_pcs,
  round(c.net_invoiced_ore / 100.0, 2) AS net_invoiced_nok,
  round(c.outgoing_vat_ore / 100.0, 2) AS outgoing_vat_nok,
  c.notes
FROM public.accounting_revenue_customers c
JOIN public.accounting_revenue_periods p ON p.id = c.period_id
WHERE p.active;

COMMENT ON VIEW ai_read.accounting_by_customer IS
  'DNB-bekreftet levert/fakturert/mva per kunde i aktiv periode.';

CREATE OR REPLACE VIEW ai_read.delivery_pricing AS
SELECT
  coalesce(nullif(btrim(d.customer_name_snapshot), ''), cust.name) AS customer_name,
  d.commercial_route::text AS commercial_route,
  coalesce(sum(dl.quantity) FILTER (WHERE dl.unit_price_ore IS NOT NULL), 0)::integer AS priced_pcs,
  coalesce(sum(dl.quantity) FILTER (WHERE dl.quantity > 0 AND dl.unit_price_ore IS NULL), 0)::integer
    AS unpriced_pcs,
  coalesce(sum(dl.quantity), 0)::integer AS portal_delivery_pcs,
  round(
    avg(dl.unit_price_ore) FILTER (WHERE dl.unit_price_ore IS NOT NULL) / 100.0,
    2
  ) AS avg_unit_price_nok,
  round(
    sum(dl.quantity::numeric * dl.unit_price_ore)
      FILTER (WHERE dl.unit_price_ore IS NOT NULL) / 100.0,
    2
  ) AS priced_delivery_value_nok
FROM public.deliveries d
JOIN public.delivery_lines dl ON dl.delivery_id = d.id
LEFT JOIN public.customers cust ON cust.id = d.customer_id
GROUP BY 1, 2;

COMMENT ON VIEW ai_read.delivery_pricing IS
  'Forklarer gapet mellom portal prisa leveringsverdi og DNB-omsetning.';

DROP VIEW IF EXISTS ai_read.kpis;
CREATE VIEW ai_read.kpis AS
SELECT
  e.delivered_pcs,
  e.invoiced_pcs,
  e.free_goods_pcs,
  e.net_invoiced_nok,
  e.outgoing_vat_nok,
  e.paid_incl_vat_nok,
  e.priced_delivery_value_nok,
  e.portal_delivery_pcs,
  e.portal_priced_pcs,
  e.portal_unpriced_pcs,
  e.portal_missing_delivered_pcs,
  e.period_label,
  e.source AS accounting_source,
  (SELECT count(*)::integer FROM public.deliveries) AS delivery_count,
  (
    SELECT round(avg(unit_price_ore) FILTER (WHERE unit_price_ore IS NOT NULL) / 100.0, 2)
    FROM public.delivery_lines
  ) AS avg_unit_price_nok,
  (SELECT count(*)::integer FROM public.gold_lots) AS lot_count,
  (SELECT coalesce(sum(produced_qty), 0)::integer FROM public.gold_lots) AS produced_pcs,
  (SELECT coalesce(sum(coalesce(approved_qty, 0)), 0)::integer FROM public.gold_lots) AS approved_pcs_sum,
  (SELECT count(*)::integer FROM public.customers WHERE active) AS active_customers,
  (SELECT count(*)::integer FROM public.customer_orders) AS customer_order_count,
  (SELECT count(*)::integer FROM public.shop_orders) AS shop_order_count,
  (SELECT ok_for_inventory FROM ai_read.data_quality) AS ok_for_inventory,
  false AS has_cogs,
  false AS has_capacity_table,
  false AS has_inventory_table
FROM ai_read.economics e
ORDER BY e.period_end DESC
LIMIT 1;

COMMENT ON VIEW ai_read.kpis IS
  'Hovedtall. net_invoiced_nok = omsetning eks. mva. priced_delivery_value_nok er ikke omsetning.';

-- Rename portal "revenue" to priced delivery value (same grain as before).
DROP VIEW IF EXISTS ai_read.delivery_totals;
CREATE VIEW ai_read.delivery_totals AS
WITH lines AS (
  SELECT
    coalesce(nullif(btrim(dl.product_name_snapshot), ''), p.name_no) AS product_name,
    p.slug AS product_slug,
    dl.quantity,
    dl.unit_price_ore,
    (dl.quantity > 0 AND dl.gold_lot_id IS NULL) AS missing_lot_link
  FROM public.delivery_lines dl
  LEFT JOIN public.products p ON p.id = dl.product_id
)
SELECT
  product_name,
  product_slug,
  sum(quantity)::integer AS pieces,
  count(*) FILTER (WHERE missing_lot_link)::integer AS lines_missing_lot,
  round(avg(unit_price_ore) FILTER (WHERE unit_price_ore IS NOT NULL) / 100.0, 2) AS avg_unit_price_nok,
  round(
    sum(quantity::numeric * unit_price_ore) FILTER (WHERE unit_price_ore IS NOT NULL) / 100.0,
    2
  ) AS priced_delivery_value_nok
FROM lines
GROUP BY product_name, product_slug;

COMMENT ON VIEW ai_read.delivery_totals IS
  'Levert volum og prisa leveringsverdi per smak i portalen. Ikke DNB-omsetning.';

GRANT USAGE ON SCHEMA ai_read TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA ai_read TO authenticated, service_role;

DO $$
BEGIN
  GRANT SELECT ON ALL TABLES IN SCHEMA ai_read TO ai_readonly;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'Role ai_readonly finnes ikke — hoppet over grants.';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Mangler rettighet til å grant ai_readonly — hoppet over.';
END;
$$;
