-- Kjør i Lovable Cloud → SQL, eller i Supabase SQL Editor.
-- Forutsetter at products og shift_reports allerede finnes.
-- Trygg å kjøre flere ganger.

CREATE TABLE IF NOT EXISTS public.shift_report_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_report_id UUID NOT NULL REFERENCES public.shift_reports(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  sold INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0),
  remaining_stock INTEGER NOT NULL DEFAULT 0 CHECK (remaining_stock >= 0),
  next_required_quantity INTEGER CHECK (next_required_quantity IS NULL OR next_required_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_report_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_report_lines_report ON public.shift_report_lines(shift_report_id);
CREATE INDEX IF NOT EXISTS idx_shift_report_lines_product ON public.shift_report_lines(product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_report_lines TO authenticated;
GRANT ALL ON public.shift_report_lines TO service_role;

ALTER TABLE public.shift_report_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shift_report_lines_select" ON public.shift_report_lines;
CREATE POLICY "shift_report_lines_select" ON public.shift_report_lines FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.shift_reports r
      WHERE r.id = shift_report_id
        AND r.customer_id = public.current_customer_id()
    )
  );

DROP POLICY IF EXISTS "shift_report_lines_insert" ON public.shift_report_lines;
CREATE POLICY "shift_report_lines_insert" ON public.shift_report_lines FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shift_reports r
      WHERE r.id = shift_report_id
        AND r.submitted_by = auth.uid()
        AND (public.is_admin() OR r.customer_id = public.current_customer_id())
    )
  );

DROP POLICY IF EXISTS "shift_report_lines_admin_update" ON public.shift_report_lines;
CREATE POLICY "shift_report_lines_admin_update" ON public.shift_report_lines FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "shift_report_lines_admin_delete" ON public.shift_report_lines;
CREATE POLICY "shift_report_lines_admin_delete" ON public.shift_report_lines FOR DELETE TO authenticated
  USING (public.is_admin());
