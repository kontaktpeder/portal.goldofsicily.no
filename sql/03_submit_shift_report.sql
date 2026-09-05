-- Kjør etter 01 og 02.
-- Portalen kaller denne RPC-en når kunden sender skiftrapport med antall per smak.

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
