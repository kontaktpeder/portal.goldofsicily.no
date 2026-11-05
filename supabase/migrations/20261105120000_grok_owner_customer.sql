-- Kjør i Lovable Cloud → SQL etter sql/41_mark_legacy_delivery.sql.
-- Grok med actions-token er eier: kan opprette kunder (create_customer) og utføre handlinger.
-- Also applied as supabase/migrations/20261105120000_grok_owner_customer.sql.

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
      'mark_legacy_delivery',
      'create_customer'
    )
  );

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
      'owner_access',
      'Grok har eier-tilgang og kan opprette kunder',
      true,
      'Handling create_customer. Kjør med op=commit. Alt logges.'
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
  'Katalog over AI-datasett. available=false betyr at tallet ikke skal oppfinnes. owner_access sier at Grok er eier.';
