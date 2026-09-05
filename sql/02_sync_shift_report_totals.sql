-- Kjør etter 01_shift_report_lines.sql.
-- Holder sold / lager / neste behov på shift_reports i sync med smakslinjene.

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

DROP TRIGGER IF EXISTS trg_shift_report_lines_sync ON public.shift_report_lines;
CREATE TRIGGER trg_shift_report_lines_sync
AFTER INSERT OR UPDATE OR DELETE ON public.shift_report_lines
FOR EACH ROW EXECUTE FUNCTION public.sync_shift_report_totals();
