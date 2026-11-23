-- Commit a delivery draft exactly once.
--
-- Approval can be submitted from multiple clients at nearly the same time. The
-- draft row lock makes concurrent commits serialize; later callers return the
-- already-created delivery instead of inserting another one.

CREATE OR REPLACE FUNCTION public.commit_delivery_draft(p_draft_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  draft public.delivery_drafts%ROWTYPE;
  total INTEGER;
  new_delivery_id UUID;
BEGIN
  SELECT *
    INTO draft
    FROM public.delivery_drafts
   WHERE id = p_draft_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found';
  END IF;

  IF draft.status = 'committed' AND draft.committed_delivery_id IS NOT NULL THEN
    RETURN draft.committed_delivery_id;
  END IF;

  IF draft.status = 'cancelled' THEN
    RAISE EXCEPTION 'draft is cancelled';
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::INTEGER
    INTO total
    FROM public.delivery_draft_lines
   WHERE draft_id = p_draft_id;

  IF total <= 0 THEN
    RAISE EXCEPTION 'draft has no lines';
  END IF;

  INSERT INTO public.deliveries (customer_id, quantity, delivered_at, note, delivered_by)
  VALUES (draft.customer_id, total, draft.delivered_on, draft.note, draft.delivered_by)
  RETURNING id INTO new_delivery_id;

  INSERT INTO public.delivery_lines (
    delivery_id,
    product_id,
    quantity,
    gold_lot_id,
    source_handover_id
  )
  SELECT
    new_delivery_id,
    product_id,
    quantity,
    gold_lot_id,
    source_handover_id
  FROM public.delivery_draft_lines
  WHERE draft_id = p_draft_id;

  UPDATE public.delivery_drafts
     SET status = 'committed',
         committed_delivery_id = new_delivery_id
   WHERE id = p_draft_id;

  RETURN new_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_delivery_draft(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_delivery_draft(UUID) TO service_role;
