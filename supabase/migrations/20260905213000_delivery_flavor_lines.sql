-- Leveringslinjer per smak. Totaltall på deliveries holdes i sync.

CREATE TABLE IF NOT EXISTS public.delivery_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_lines_delivery ON public.delivery_lines(delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_lines_product ON public.delivery_lines(product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_lines TO authenticated;
GRANT ALL ON public.delivery_lines TO service_role;

ALTER TABLE public.delivery_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_lines_select" ON public.delivery_lines;
CREATE POLICY "delivery_lines_select" ON public.delivery_lines FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.deliveries d
      WHERE d.id = delivery_id
        AND d.venue_id = public.current_venue_id()
    )
  );

DROP POLICY IF EXISTS "delivery_lines_admin_insert" ON public.delivery_lines;
CREATE POLICY "delivery_lines_admin_insert" ON public.delivery_lines FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delivery_lines_admin_update" ON public.delivery_lines;
CREATE POLICY "delivery_lines_admin_update" ON public.delivery_lines FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "delivery_lines_admin_delete" ON public.delivery_lines;
CREATE POLICY "delivery_lines_admin_delete" ON public.delivery_lines FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.sync_delivery_totals()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  did UUID;
BEGIN
  did := COALESCE(NEW.delivery_id, OLD.delivery_id);
  UPDATE public.deliveries
  SET quantity = COALESCE((SELECT SUM(quantity) FROM public.delivery_lines WHERE delivery_id = did), 0)
  WHERE id = did;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_lines_sync ON public.delivery_lines;
CREATE TRIGGER trg_delivery_lines_sync
AFTER INSERT OR UPDATE OR DELETE ON public.delivery_lines
FOR EACH ROW EXECUTE FUNCTION public.sync_delivery_totals();
