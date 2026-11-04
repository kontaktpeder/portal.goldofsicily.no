-- Kjør i Lovable Cloud → SQL etter sql/39_accounting_revenue_facts.sql.
-- Kontrollert handlingslag for AI/MCP: foreslå → valider → godkjenn → utfør → logg.
-- Ingen fri skrivetilgang. Grok foreslår; menneske (eller eksplisitt approve) utfører.
-- Also applied as supabase/migrations/20261104240000_admin_actions.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_action_status') THEN
    CREATE TYPE public.admin_action_status AS ENUM (
      'proposed',
      'validated',
      'rejected',
      'approved',
      'executed',
      'failed'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.admin_action_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.admin_action_status NOT NULL DEFAULT 'proposed',
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_message TEXT,
  proposed_by TEXT NOT NULL DEFAULT 'grok',
  proposed_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_action_proposals_type_check CHECK (
    action_type IN (
      'create_delivery_draft',
      'validate_delivery',
      'create_correction_lot',
      'set_customer_price',
      'approve_delivery',
      'register_priced_delivery',
      'list_accounting_discrepancies'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_admin_action_proposals_status
  ON public.admin_action_proposals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_proposals_type
  ON public.admin_action_proposals (action_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_action_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES public.admin_action_proposals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_events_proposal
  ON public.admin_action_events (proposal_id, created_at);

CREATE TABLE IF NOT EXISTS public.delivery_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID REFERENCES public.admin_action_proposals(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  delivered_on DATE NOT NULL,
  note TEXT,
  delivered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'committed', 'cancelled')),
  committed_delivery_id UUID REFERENCES public.deliveries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_draft_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES public.delivery_drafts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  gold_lot_id UUID REFERENCES public.gold_lots(id) ON DELETE RESTRICT,
  source_handover_id UUID REFERENCES public.gold_lot_handovers(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, product_id, gold_lot_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_drafts_status
  ON public.delivery_drafts (status, delivered_on DESC);

DROP TRIGGER IF EXISTS trg_admin_action_proposals_updated_at ON public.admin_action_proposals;
CREATE TRIGGER trg_admin_action_proposals_updated_at
BEFORE UPDATE ON public.admin_action_proposals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_delivery_drafts_updated_at ON public.delivery_drafts;
CREATE TRIGGER trg_delivery_drafts_updated_at
BEFORE UPDATE ON public.delivery_drafts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.admin_action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_action_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_draft_lines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_action_proposals FROM PUBLIC, anon;
REVOKE ALL ON public.admin_action_events FROM PUBLIC, anon;
REVOKE ALL ON public.delivery_drafts FROM PUBLIC, anon;
REVOKE ALL ON public.delivery_draft_lines FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON public.admin_action_proposals TO authenticated;
GRANT SELECT, INSERT ON public.admin_action_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.delivery_drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_draft_lines TO authenticated;
GRANT ALL ON public.admin_action_proposals TO service_role;
GRANT ALL ON public.admin_action_events TO service_role;
GRANT ALL ON public.delivery_drafts TO service_role;
GRANT ALL ON public.delivery_draft_lines TO service_role;

DROP POLICY IF EXISTS "admin_actions_select" ON public.admin_action_proposals;
CREATE POLICY "admin_actions_select" ON public.admin_action_proposals
  FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR public.can_manage_commercial());

DROP POLICY IF EXISTS "admin_actions_insert" ON public.admin_action_proposals;
CREATE POLICY "admin_actions_insert" ON public.admin_action_proposals
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations() OR public.can_manage_commercial());

DROP POLICY IF EXISTS "admin_actions_update" ON public.admin_action_proposals;
CREATE POLICY "admin_actions_update" ON public.admin_action_proposals
  FOR UPDATE TO authenticated
  USING (public.can_manage_operations() OR public.can_manage_commercial())
  WITH CHECK (public.can_manage_operations() OR public.can_manage_commercial());

DROP POLICY IF EXISTS "admin_action_events_select" ON public.admin_action_events;
CREATE POLICY "admin_action_events_select" ON public.admin_action_events
  FOR SELECT TO authenticated
  USING (public.can_manage_operations() OR public.can_manage_commercial());

DROP POLICY IF EXISTS "admin_action_events_insert" ON public.admin_action_events;
CREATE POLICY "admin_action_events_insert" ON public.admin_action_events
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations() OR public.can_manage_commercial());

DROP POLICY IF EXISTS "delivery_drafts_ops" ON public.delivery_drafts;
CREATE POLICY "delivery_drafts_ops" ON public.delivery_drafts
  FOR ALL TO authenticated
  USING (public.can_manage_operations())
  WITH CHECK (public.can_manage_operations());

DROP POLICY IF EXISTS "delivery_draft_lines_ops" ON public.delivery_draft_lines;
CREATE POLICY "delivery_draft_lines_ops" ON public.delivery_draft_lines
  FOR ALL TO authenticated
  USING (public.can_manage_operations())
  WITH CHECK (public.can_manage_operations());

-- Read surface for Grok
CREATE OR REPLACE VIEW ai_read.action_proposals AS
SELECT
  id,
  action_type,
  title,
  rationale,
  status::text AS status,
  validation,
  result,
  error_message,
  proposed_by,
  created_at,
  approved_at,
  executed_at
FROM public.admin_action_proposals
ORDER BY created_at DESC;

COMMENT ON VIEW ai_read.action_proposals IS
  'AI/MCP-forslag. Utføres først etter godkjenning.';

CREATE OR REPLACE VIEW ai_read.accounting_discrepancies AS
SELECT *
FROM (
  VALUES
    (
      'missing_lot_link'::text,
      'Leveringslinjer uten gold_lot_id'::text,
      (
        SELECT coalesce(sum(quantity), 0)::integer
        FROM public.delivery_lines
        WHERE quantity > 0 AND gold_lot_id IS NULL
      ),
      'Koble linjene til LOT eller lag korrigerings-LOT før lager beregnes.'::text
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
      'Registrer manglende leveranser (f.eks. Bowling 200 stk).'
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
      ),
      'Sett kundepris (set_customer_price) før direkte levering.'
    )
) AS t(code, description, quantity, remediation)
WHERE quantity <> 0;

COMMENT ON VIEW ai_read.accounting_discrepancies IS
  'Åpne avvik Grok kan foreslå retting for.';

GRANT SELECT ON ai_read.action_proposals TO authenticated, service_role;
GRANT SELECT ON ai_read.accounting_discrepancies TO authenticated, service_role;

DO $$
BEGIN
  GRANT SELECT ON ai_read.action_proposals TO ai_readonly;
  GRANT SELECT ON ai_read.accounting_discrepancies TO ai_readonly;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN insufficient_privilege THEN NULL;
END;
$$;
