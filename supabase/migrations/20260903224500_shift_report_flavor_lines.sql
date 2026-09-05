-- Per-flavor lines on shift reports (sold / remaining / next need),
-- so venues can report counts for each arancini flavor like the pilot app.

CREATE TABLE public.shift_report_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_report_id UUID NOT NULL REFERENCES public.shift_reports(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  sold INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0),
  remaining_stock INTEGER NOT NULL DEFAULT 0 CHECK (remaining_stock >= 0),
  next_required_quantity INTEGER CHECK (next_required_quantity IS NULL OR next_required_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_report_id, product_id)
);

CREATE INDEX idx_shift_report_lines_report ON public.shift_report_lines(shift_report_id);
CREATE INDEX idx_shift_report_lines_product ON public.shift_report_lines(product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_report_lines TO authenticated;
GRANT ALL ON public.shift_report_lines TO service_role;

ALTER TABLE public.shift_report_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_report_lines_select" ON public.shift_report_lines FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.shift_reports r
      WHERE r.id = shift_report_id
        AND r.customer_id = public.current_customer_id()
    )
  );

CREATE POLICY "shift_report_lines_insert" ON public.shift_report_lines FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shift_reports r
      WHERE r.id = shift_report_id
        AND r.submitted_by = auth.uid()
        AND (public.is_admin() OR r.customer_id = public.current_customer_id())
    )
  );

CREATE POLICY "shift_report_lines_admin_update" ON public.shift_report_lines FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "shift_report_lines_admin_delete" ON public.shift_report_lines FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.sync_shift_report_totals()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  rid UUID;
BEGIN
  rid := COALESCE(NEW.shift_report_id, OLD.shift_report_id);
  UPDATE public.shift_reports r
  SET
    sold_this_shift = COALESCE((SELECT SUM(sold) FROM public.shift_report_lines WHERE shift_report_id = rid), 0),
    remaining_stock = COALESCE((SELECT SUM(remaining_stock) FROM public.shift_report_lines WHERE shift_report_id = rid), 0),
    next_required_quantity = (
      SELECT SUM(COALESCE(next_required_quantity, 0)) FROM public.shift_report_lines WHERE shift_report_id = rid
    )
  WHERE r.id = rid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_shift_report_lines_sync
AFTER INSERT OR UPDATE OR DELETE ON public.shift_report_lines
FOR EACH ROW EXECUTE FUNCTION public.sync_shift_report_totals();

CREATE OR REPLACE FUNCTION public.submit_shift_report(
  p_customer_id UUID,
  p_delivery_id UUID DEFAULT NULL,
  p_delivery_correct BOOLEAN DEFAULT NULL,
  p_actual_quantity_received INTEGER DEFAULT NULL,
  p_guest_feedback_rating public.feedback_rating DEFAULT NULL,
  p_guest_feedback_text TEXT DEFAULT NULL,
  p_preparation_issue BOOLEAN DEFAULT false,
  p_preparation_issue_text TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_sold INTEGER := 0;
  v_stock INTEGER := 0;
  v_next INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_admin() OR p_customer_id = public.current_customer_id()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array';
  END IF;

  SELECT
    COALESCE(SUM(GREATEST(COALESCE((elem->>'sold')::INTEGER, 0), 0)), 0),
    COALESCE(SUM(GREATEST(COALESCE((elem->>'remaining_stock')::INTEGER, 0), 0)), 0),
    COALESCE(SUM(GREATEST(COALESCE((elem->>'next_required_quantity')::INTEGER, 0), 0)), 0)
  INTO v_sold, v_stock, v_next
  FROM jsonb_array_elements(p_lines) AS elem;

  INSERT INTO public.shift_reports (
    customer_id,
    submitted_by,
    delivery_id,
    delivery_correct,
    actual_quantity_received,
    sold_this_shift,
    remaining_stock,
    guest_feedback_rating,
    guest_feedback_text,
    preparation_issue,
    preparation_issue_text,
    next_required_quantity
  ) VALUES (
    p_customer_id,
    auth.uid(),
    p_delivery_id,
    p_delivery_correct,
    p_actual_quantity_received,
    v_sold,
    v_stock,
    p_guest_feedback_rating,
    NULLIF(btrim(COALESCE(p_guest_feedback_text, '')), ''),
    COALESCE(p_preparation_issue, false),
    CASE
      WHEN COALESCE(p_preparation_issue, false)
        THEN NULLIF(btrim(COALESCE(p_preparation_issue_text, '')), '')
      ELSE NULL
    END,
    v_next
  )
  RETURNING id INTO v_id;

  INSERT INTO public.shift_report_lines (
    shift_report_id, product_id, sold, remaining_stock, next_required_quantity
  )
  SELECT
    v_id,
    (elem->>'product_id')::UUID,
    GREATEST(COALESCE((elem->>'sold')::INTEGER, 0), 0),
    GREATEST(COALESCE((elem->>'remaining_stock')::INTEGER, 0), 0),
    GREATEST(COALESCE((elem->>'next_required_quantity')::INTEGER, 0), 0)
  FROM jsonb_array_elements(p_lines) AS elem
  WHERE NULLIF(elem->>'product_id', '') IS NOT NULL;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_shift_report(
  UUID, UUID, BOOLEAN, INTEGER, public.feedback_rating, TEXT, BOOLEAN, TEXT, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_shift_report(
  UUID, UUID, BOOLEAN, INTEGER, public.feedback_rating, TEXT, BOOLEAN, TEXT, JSONB
) TO service_role;
