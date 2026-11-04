-- Kjør i Lovable Cloud → SQL etter sql/37_shop_delivery_zones.sql.
-- Read-only nøkkeltall for ekstern AI/MCP (f.eks. Grok).
-- Eksponer kun aggregater og driftsfakta. Ingen e-post, telefon eller adresse.
-- Varekost, kapasitet og pålitelig total-lager finnes ikke — se ai_read.guide.
-- Also applied as supabase/migrations/20261104220000_ai_read_views.sql.

CREATE SCHEMA IF NOT EXISTS ai_read;

COMMENT ON SCHEMA ai_read IS
  'Read-only nøkkeltall for AI/MCP. Bruk SELECT her. Ikke skriv til underliggende tabeller via denne tilkoblingen.';

-- ---------------------------------------------------------------------------
-- Guide: hva som finnes / ikke finnes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.guide AS
SELECT *
FROM (
  VALUES
    (
      'deliveries'::text,
      'Leveranser til kunder (linjer med smak, antall, pris, LOT-kobling)'::text,
      true,
      'Primær sannhetskilde for volum og omsetning.'::text
    ),
    (
      'delivery_totals',
      'Summerte leveranser per smak og totalt',
      true,
      NULL
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
      'Én rad med hovedtall',
      true,
      NULL
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

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.customers AS
SELECT
  c.id,
  c.name,
  c.type::text AS customer_type,
  c.partnership_level::text AS partnership_level,
  c.location,
  c.city,
  c.active,
  c.default_language,
  c.created_at
FROM public.customers c
WHERE c.active = true;

COMMENT ON VIEW ai_read.customers IS
  'Aktive kunder. Uten e-post, telefon og notater.';

-- ---------------------------------------------------------------------------
-- Deliveries (line grain)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.deliveries AS
SELECT
  d.id AS delivery_id,
  d.delivered_at,
  d.customer_id,
  coalesce(nullif(btrim(d.customer_name_snapshot), ''), c.name) AS customer_name,
  c.type::text AS customer_type,
  d.commercial_route::text AS commercial_route,
  d.quantity AS delivery_total_qty,
  dl.id AS delivery_line_id,
  dl.product_id,
  coalesce(nullif(btrim(dl.product_name_snapshot), ''), p.name_no) AS product_name,
  p.slug AS product_slug,
  dl.quantity AS line_qty,
  dl.unit_price_ore,
  CASE
    WHEN dl.unit_price_ore IS NULL THEN NULL
    ELSE round(dl.unit_price_ore / 100.0, 2)
  END AS unit_price_nok,
  CASE
    WHEN dl.unit_price_ore IS NULL THEN NULL
    ELSE round((dl.quantity::numeric * dl.unit_price_ore) / 100.0, 2)
  END AS line_revenue_nok,
  dl.gold_lot_id,
  gl.lot_code,
  (dl.quantity > 0 AND dl.gold_lot_id IS NULL) AS missing_lot_link,
  dl.source_handover_id IS NOT NULL AS from_villa_stock,
  d.note AS delivery_note
FROM public.deliveries d
JOIN public.delivery_lines dl ON dl.delivery_id = d.id
LEFT JOIN public.customers c ON c.id = d.customer_id
LEFT JOIN public.products p ON p.id = dl.product_id
LEFT JOIN public.gold_lots gl ON gl.id = dl.gold_lot_id;

COMMENT ON VIEW ai_read.deliveries IS
  'Leveringslinjer med kunde, smak, pris og LOT-status. missing_lot_link=true mangler parti.';

-- ---------------------------------------------------------------------------
-- Delivery totals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.delivery_totals AS
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
  ) AS revenue_nok
FROM lines
GROUP BY product_name, product_slug;

COMMENT ON VIEW ai_read.delivery_totals IS
  'Levert volum og omsetning per smak.';

-- ---------------------------------------------------------------------------
-- Production lots
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.production_lots AS
SELECT
  gl.id AS lot_id,
  gl.lot_code,
  gl.production_date,
  gl.product_id,
  p.name_no AS product_name,
  p.slug AS product_slug,
  gl.produced_qty,
  gl.approved_qty,
  coalesce(gl.approved_qty, gl.produced_qty) AS stock_base_qty,
  gl.status::text AS status,
  gl.produced_by,
  coalesce(del.delivered_qty, 0)::integer AS delivered_from_lot_qty,
  coalesce(h.handover_qty, 0)::integer AS handed_over_qty,
  greatest(
    0,
    coalesce(gl.approved_qty, gl.produced_qty)
      - coalesce(h.villa_handover_qty, 0)
      - coalesce(del.direct_delivered_qty, 0)
  )::integer AS remaining_at_gold_qty,
  greatest(
    0,
    coalesce(h.villa_handover_qty, 0) - coalesce(del.villa_delivered_qty, 0)
  )::integer AS remaining_at_villa_qty,
  gl.deviation_notes,
  gl.created_at
FROM public.gold_lots gl
LEFT JOIN public.products p ON p.id = gl.product_id
LEFT JOIN LATERAL (
  SELECT
    coalesce(sum(dl.quantity), 0) AS delivered_qty,
    coalesce(sum(dl.quantity) FILTER (WHERE dl.source_handover_id IS NULL), 0) AS direct_delivered_qty,
    coalesce(sum(dl.quantity) FILTER (WHERE dl.source_handover_id IS NOT NULL), 0) AS villa_delivered_qty
  FROM public.delivery_lines dl
  WHERE dl.gold_lot_id = gl.id
) del ON true
LEFT JOIN LATERAL (
  SELECT
    coalesce(sum(h.quantity), 0) AS handover_qty,
    coalesce(sum(h.quantity) FILTER (WHERE h.ownership_after_handover = 'villa'), 0) AS villa_handover_qty
  FROM public.gold_lot_handovers h
  WHERE h.gold_lot_id = gl.id
) h ON true;

COMMENT ON VIEW ai_read.production_lots IS
  'Partier med produsert/godkjent og avledet rest på Gold/Villa for LINJER med LOT-kobling. Ignorerer leveranser uten gold_lot_id.';

-- ---------------------------------------------------------------------------
-- B2B orders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.customer_orders AS
SELECT
  o.id,
  o.order_number,
  o.status::text AS status,
  o.ordered_by_customer_id,
  ob.name AS ordered_by_name,
  o.ship_to_customer_id,
  st.name AS ship_to_name,
  o.contact_name,
  o.desired_delivery_on,
  o.confirmed_delivery_on,
  o.billing_legal_name_snapshot,
  o.owner_name_snapshot,
  o.confirmed_at,
  o.created_at,
  coalesce(lines.line_count, 0)::integer AS line_count,
  coalesce(lines.pieces, 0)::integer AS pieces
FROM public.customer_orders o
LEFT JOIN public.customers ob ON ob.id = o.ordered_by_customer_id
LEFT JOIN public.customers st ON st.id = o.ship_to_customer_id
LEFT JOIN LATERAL (
  SELECT
    count(*)::integer AS line_count,
    coalesce(sum(l.quantity), 0)::integer AS pieces
  FROM public.customer_order_lines l
  WHERE l.order_id = o.id
) lines ON true;

COMMENT ON VIEW ai_read.customer_orders IS
  'B2B-ordrer. Historisk volum ligger ofte i ai_read.deliveries i stedet.';

-- ---------------------------------------------------------------------------
-- Shop orders (no PII)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.shop_orders AS
SELECT
  s.id,
  s.order_number,
  s.status,
  s.payment_kind,
  s.flavor_slug,
  s.boxes,
  s.pieces,
  round(s.unit_price_ore / 100.0, 2) AS unit_price_nok,
  round(s.total_ore / 100.0, 2) AS total_nok,
  s.fulfillment,
  s.binding,
  s.customer_id,
  s.customer_order_id,
  s.offer_boxes,
  CASE
    WHEN s.offer_total_ore IS NULL THEN NULL
    ELSE round(s.offer_total_ore / 100.0, 2)
  END AS offer_total_nok,
  s.lang,
  s.created_at,
  s.expires_at
FROM public.shop_orders s;

COMMENT ON VIEW ai_read.shop_orders IS
  'Nettbutikkordrer uten navn, e-post, telefon eller adresse.';

-- ---------------------------------------------------------------------------
-- Data quality / inventory readiness
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.data_quality AS
WITH prod AS (
  SELECT
    coalesce(sum(produced_qty), 0)::integer AS produced_pcs,
    coalesce(sum(coalesce(approved_qty, 0)), 0)::integer AS approved_pcs_sum,
    coalesce(sum(coalesce(approved_qty, produced_qty)), 0)::integer AS stock_base_pcs,
    count(*)::integer AS lot_count
  FROM public.gold_lots
),
del AS (
  SELECT
    coalesce(sum(quantity), 0)::integer AS delivered_pcs,
    count(*) FILTER (WHERE quantity > 0 AND gold_lot_id IS NULL)::integer AS lines_missing_lot,
    coalesce(sum(quantity) FILTER (WHERE quantity > 0 AND gold_lot_id IS NULL), 0)::integer AS pcs_missing_lot,
    coalesce(sum(quantity) FILTER (WHERE gold_lot_id IS NOT NULL), 0)::integer AS pcs_with_lot
  FROM public.delivery_lines
)
SELECT
  prod.lot_count,
  prod.produced_pcs,
  prod.approved_pcs_sum,
  prod.stock_base_pcs,
  del.delivered_pcs,
  del.lines_missing_lot,
  del.pcs_missing_lot,
  del.pcs_with_lot,
  (del.delivered_pcs - prod.produced_pcs) AS delivered_minus_produced,
  (del.delivered_pcs - prod.stock_base_pcs) AS delivered_minus_stock_base,
  (del.lines_missing_lot = 0 AND del.delivered_pcs <= prod.stock_base_pcs) AS ok_for_inventory,
  CASE
    WHEN del.lines_missing_lot > 0 THEN
      'Leveranser uten LOT-kobling. Ikke regn lagerbeholdning før linjene er ryddet.'
    WHEN del.delivered_pcs > prod.stock_base_pcs THEN
      'Levert mer enn godkjent/produsert basis. Datakvalitet for lager er upålitelig.'
    ELSE
      'LOT-koblinger ser konsistente ut for lagervurdering på parti-nivå.'
  END AS inventory_advisory
FROM prod, del;

COMMENT ON VIEW ai_read.data_quality IS
  'Integritetssjekk. Bruk ok_for_inventory før lager utledes.';

-- ---------------------------------------------------------------------------
-- KPI one-pager
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ai_read.kpis AS
SELECT
  (SELECT count(*)::integer FROM public.deliveries) AS delivery_count,
  (SELECT coalesce(sum(quantity), 0)::integer FROM public.delivery_lines) AS delivered_pcs,
  (
    SELECT round(avg(unit_price_ore) FILTER (WHERE unit_price_ore IS NOT NULL) / 100.0, 2)
    FROM public.delivery_lines
  ) AS avg_unit_price_nok,
  (
    SELECT round(
      sum(quantity::numeric * unit_price_ore) FILTER (WHERE unit_price_ore IS NOT NULL) / 100.0,
      2
    )
    FROM public.delivery_lines
  ) AS delivery_revenue_nok,
  (SELECT count(*)::integer FROM public.gold_lots) AS lot_count,
  (SELECT coalesce(sum(produced_qty), 0)::integer FROM public.gold_lots) AS produced_pcs,
  (SELECT coalesce(sum(coalesce(approved_qty, 0)), 0)::integer FROM public.gold_lots) AS approved_pcs_sum,
  (SELECT count(*)::integer FROM public.customers WHERE active) AS active_customers,
  (SELECT count(*)::integer FROM public.customer_orders) AS customer_order_count,
  (SELECT count(*)::integer FROM public.shop_orders) AS shop_order_count,
  (SELECT ok_for_inventory FROM ai_read.data_quality) AS ok_for_inventory,
  false AS has_cogs,
  false AS has_capacity_table,
  false AS has_inventory_table;

COMMENT ON VIEW ai_read.kpis IS
  'Hovedtall i én rad. has_* = false betyr at feltet ikke finnes i databasen.';

-- ---------------------------------------------------------------------------
-- Privileges: read-only surface
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA ai_read FROM PUBLIC;
GRANT USAGE ON SCHEMA ai_read TO authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA ai_read FROM PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA ai_read TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA ai_read
  GRANT SELECT ON TABLES TO authenticated, service_role;

-- Dedikert rolle for senere read-only DB-bruker (password/login settes i dashboard).
DO $$
BEGIN
  CREATE ROLE ai_readonly NOINHERIT;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Kunne ikke opprette role ai_readonly — hoppet over.';
END;
$$;

DO $$
BEGIN
  GRANT USAGE ON SCHEMA ai_read TO ai_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA ai_read TO ai_readonly;
  ALTER DEFAULT PRIVILEGES IN SCHEMA ai_read
    GRANT SELECT ON TABLES TO ai_readonly;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'Role ai_readonly finnes ikke — hoppet over grants.';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Mangler rettighet til å grant''e ai_readonly — hoppet over.';
END;
$$;
