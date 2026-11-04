-- Kjør i Lovable Cloud → SQL etter sql/40_admin_actions.sql.
-- Legacy-leveranser uten LOT: merkes via mark_legacy_delivery (propose → approve).
-- data_quality teller legacy for seg og blokkerer ikke ok_for_inventory.
-- Also applied as supabase/migrations/20261105010000_mark_legacy_delivery.sql.

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS legacy_without_lot BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS legacy_marked_at TIMESTAMPTZ;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS legacy_rationale TEXT;

COMMENT ON COLUMN public.deliveries.legacy_without_lot IS
  'True når leveransen er godkjent som legacy før LOT-/pakkesystemet. Linjer uten LOT telles separat i data_quality.';

CREATE INDEX IF NOT EXISTS idx_deliveries_legacy_without_lot
  ON public.deliveries (legacy_without_lot)
  WHERE legacy_without_lot;

-- Allow mark_legacy_delivery on proposals
ALTER TABLE public.admin_action_proposals
  DROP CONSTRAINT IF EXISTS admin_action_proposals_type_check;

ALTER TABLE public.admin_action_proposals
  ADD CONSTRAINT admin_action_proposals_type_check CHECK (
    action_type IN (
      'create_delivery_draft',
      'validate_delivery',
      'create_correction_lot',
      'set_customer_price',
      'approve_delivery',
      'register_priced_delivery',
      'list_accounting_discrepancies',
      'mark_legacy_delivery'
    )
  );

-- ---------------------------------------------------------------------------
-- ai_read views: DROP+CREATE when column lists change
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS ai_read.accounting_discrepancies;
DROP VIEW IF EXISTS ai_read.kpis;
DROP VIEW IF EXISTS ai_read.data_quality;
DROP VIEW IF EXISTS ai_read.delivery_totals;
DROP VIEW IF EXISTS ai_read.deliveries;

CREATE VIEW ai_read.deliveries
WITH (security_invoker = true) AS
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
  (dl.quantity > 0 AND dl.gold_lot_id IS NULL AND NOT d.legacy_without_lot) AS missing_lot_link,
  dl.source_handover_id IS NOT NULL AS from_villa_stock,
  d.note AS delivery_note,
  d.legacy_without_lot,
  d.legacy_marked_at,
  d.legacy_rationale
FROM public.deliveries d
JOIN public.delivery_lines dl ON dl.delivery_id = d.id
LEFT JOIN public.customers c ON c.id = d.customer_id
LEFT JOIN public.products p ON p.id = dl.product_id
LEFT JOIN public.gold_lots gl ON gl.id = dl.gold_lot_id;

COMMENT ON VIEW ai_read.deliveries IS
  'Leveringslinjer med kunde, smak, pris og LOT-status. missing_lot_link=true mangler parti (ekskl. merket legacy).';

CREATE VIEW ai_read.delivery_totals
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT
    coalesce(nullif(btrim(dl.product_name_snapshot), ''), p.name_no) AS product_name,
    p.slug AS product_slug,
    dl.quantity,
    dl.unit_price_ore,
    (dl.quantity > 0 AND dl.gold_lot_id IS NULL AND NOT d.legacy_without_lot) AS missing_lot_link
  FROM public.delivery_lines dl
  JOIN public.deliveries d ON d.id = dl.delivery_id
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
  'Levert volum og prisa leveringsverdi per smak. Uløst missing LOT ekskluderer merket legacy.';

CREATE VIEW ai_read.data_quality
WITH (security_invoker = true) AS
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
    coalesce(sum(dl.quantity), 0)::integer AS delivered_pcs,
    count(*) FILTER (
      WHERE dl.quantity > 0 AND dl.gold_lot_id IS NULL AND NOT d.legacy_without_lot
    )::integer AS lines_missing_lot,
    coalesce(sum(dl.quantity) FILTER (
      WHERE dl.quantity > 0 AND dl.gold_lot_id IS NULL AND NOT d.legacy_without_lot
    ), 0)::integer AS pcs_missing_lot,
    count(*) FILTER (
      WHERE dl.quantity > 0 AND dl.gold_lot_id IS NULL AND d.legacy_without_lot
    )::integer AS lines_legacy_without_lot,
    coalesce(sum(dl.quantity) FILTER (
      WHERE dl.quantity > 0 AND dl.gold_lot_id IS NULL AND d.legacy_without_lot
    ), 0)::integer AS pcs_legacy_without_lot,
    coalesce(sum(dl.quantity) FILTER (WHERE dl.gold_lot_id IS NOT NULL), 0)::integer AS pcs_with_lot
  FROM public.delivery_lines dl
  JOIN public.deliveries d ON d.id = dl.delivery_id
)
SELECT
  prod.lot_count,
  prod.produced_pcs,
  prod.approved_pcs_sum,
  prod.stock_base_pcs,
  del.delivered_pcs,
  del.lines_missing_lot,
  del.pcs_missing_lot,
  del.lines_legacy_without_lot,
  del.pcs_legacy_without_lot,
  del.pcs_with_lot,
  (del.delivered_pcs - prod.produced_pcs) AS delivered_minus_produced,
  (del.pcs_with_lot - prod.stock_base_pcs) AS lot_delivered_minus_stock_base,
  (del.delivered_pcs - prod.stock_base_pcs) AS delivered_minus_stock_base,
  (del.lines_missing_lot = 0 AND del.pcs_with_lot <= prod.stock_base_pcs) AS ok_for_inventory,
  CASE
    WHEN del.lines_missing_lot > 0 THEN
      'Uløste leveranser uten LOT-kobling. Ikke regn lagerbeholdning før linjene er ryddet eller merket legacy.'
    WHEN del.pcs_with_lot > prod.stock_base_pcs THEN
      'LOT-koblede leveranser overstiger godkjent/produsert basis. Datakvalitet for lager er upålitelig.'
    WHEN del.pcs_legacy_without_lot > 0 THEN
      'LOT-koblinger er klare for lagervurdering. Legacy-leveranser uten LOT er merket og holdt utenfor.'
    ELSE
      'LOT-koblinger ser konsistente ut for lagervurdering på parti-nivå.'
  END AS inventory_advisory
FROM prod, del;

COMMENT ON VIEW ai_read.data_quality IS
  'Integritetssjekk. Legacy uten LOT telles i pcs_legacy_without_lot og blokkerer ikke ok_for_inventory.';

-- Discrepancies: only unresolved (non-legacy) missing LOT links
CREATE OR REPLACE VIEW ai_read.accounting_discrepancies
WITH (security_invoker = true) AS
SELECT *
FROM (
  VALUES
    (
      'missing_lot_link'::text,
      'Leveringslinjer uten gold_lot_id (ikke merket legacy)'::text,
      (
        SELECT coalesce(sum(dl.quantity), 0)::integer
        FROM public.delivery_lines dl
        JOIN public.deliveries d ON d.id = dl.delivery_id
        WHERE dl.quantity > 0
          AND dl.gold_lot_id IS NULL
          AND NOT d.legacy_without_lot
      ),
      'Koble linjene til LOT, lag korrigerings-LOT, eller merk legacy med mark_legacy_delivery.'::text
    ),
    (
      'legacy_without_lot',
      'Legacy-leveranser uten LOT (merket)',
      (
        SELECT coalesce(sum(dl.quantity), 0)::integer
        FROM public.delivery_lines dl
        JOIN public.deliveries d ON d.id = dl.delivery_id
        WHERE dl.quantity > 0
          AND dl.gold_lot_id IS NULL
          AND d.legacy_without_lot
      ),
      'Informativt. Holdes utenfor ok_for_inventory.'
    ),
    (
      'portal_vs_accounting_delivered',
      'Faktisk levert (regnskap) minus portal-leveranser',
      (
        SELECT coalesce(
          (SELECT delivered_pcs FROM public.accounting_revenue_periods WHERE active LIMIT 1),
          0
        ) - coalesce((SELECT sum(quantity)::integer FROM public.delivery_lines), 0)
      ),
      'Registrer manglende leveranser.'
    ),
    (
      'unpriced_direct_deliveries',
      'Direkte leveringslinjer uten unit_price_ore',
      (
        SELECT coalesce(sum(dl.quantity), 0)::integer
        FROM public.delivery_lines dl
        JOIN public.deliveries d ON d.id = dl.delivery_id
        WHERE dl.quantity > 0
          AND dl.unit_price_ore IS NULL
          AND d.commercial_route = 'direct'
          AND NOT d.legacy_without_lot
      ),
      'Sett kundepris (set_customer_price) før direkte levering.'
    )
) AS t(code, description, quantity, remediation)
WHERE quantity <> 0;

-- Recreate KPIs (depends on data_quality)
CREATE VIEW ai_read.kpis
WITH (security_invoker = true) AS
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

GRANT SELECT ON ALL TABLES IN SCHEMA ai_read TO anon, authenticated, service_role;

DO $$
BEGIN
  GRANT SELECT ON ALL TABLES IN SCHEMA ai_read TO ai_readonly;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN insufficient_privilege THEN NULL;
END;
$$;
