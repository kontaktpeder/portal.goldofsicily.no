-- Kjør i Lovable Cloud → SQL etter sql/14_lot_producers.sql.
-- LOT status is derived from actions. Events are the audit trail.
-- Also applied as supabase/migrations/20260907240000_lot_events.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gold_lot_event_type') THEN
    CREATE TYPE public.gold_lot_event_type AS ENUM (
      'created',
      'packed',
      'handover',
      'closed',
      'recalled'
    );
  END IF;
END
$$;

ALTER TABLE public.gold_lots
  ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recalled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recall_reason TEXT;

CREATE TABLE IF NOT EXISTS public.gold_lot_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gold_lot_id UUID NOT NULL REFERENCES public.gold_lots(id) ON DELETE CASCADE,
  event_type public.gold_lot_event_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_gold_lot_events_lot
  ON public.gold_lot_events(gold_lot_id, created_at ASC);

GRANT SELECT, INSERT ON public.gold_lot_events TO authenticated;
GRANT ALL ON public.gold_lot_events TO service_role;

ALTER TABLE public.gold_lot_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gold_lot_events_ops_select" ON public.gold_lot_events;
CREATE POLICY "gold_lot_events_ops_select" ON public.gold_lot_events FOR SELECT TO authenticated
  USING (public.can_manage_operations());
DROP POLICY IF EXISTS "gold_lot_events_ops_insert" ON public.gold_lot_events;
CREATE POLICY "gold_lot_events_ops_insert" ON public.gold_lot_events FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_operations());

INSERT INTO public.gold_lot_events (gold_lot_id, event_type, created_at, metadata)
SELECT
  g.id,
  'created',
  g.created_at,
  jsonb_build_object(
    'legacy', true,
    'actor_name', NULLIF(btrim(COALESCE(g.produced_by, '')), '')
  )
FROM public.gold_lots g
WHERE NOT EXISTS (
  SELECT 1
  FROM public.gold_lot_events e
  WHERE e.gold_lot_id = g.id
    AND e.event_type = 'created'
);
