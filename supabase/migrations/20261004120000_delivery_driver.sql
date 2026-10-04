-- Kjør i Lovable Cloud → SQL.
-- Hvem som leverte: ansatt-id pluss et fryst navn.
-- Klienten sender bare delivered_by. Triggeren skriver navnet fra profiles,
-- så et senere navnebytte ikke skriver om historikken.
-- Dato, notat og ansatt kan endres. Kunde, rute og prisfrys røres ikke her.
-- Also applied as supabase/migrations/20261004120000_delivery_driver.sql.

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS delivered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivered_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_deliveries_delivered_by
  ON public.deliveries(delivered_by);

CREATE OR REPLACE FUNCTION public.snapshot_delivery_driver()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  person_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.delivered_by IS NOT DISTINCT FROM OLD.delivered_by THEN
    NEW.delivered_by_name := OLD.delivered_by_name;
    RETURN NEW;
  END IF;

  IF NEW.delivered_by IS NULL THEN
    -- Account deletion nulls the id. Keep the name already frozen on the row.
    IF TG_OP = 'UPDATE'
      AND OLD.delivered_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.delivered_by) THEN
      NEW.delivered_by_name := OLD.delivered_by_name;
      RETURN NEW;
    END IF;
    NEW.delivered_by_name := NULL;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = NEW.delivered_by
      AND role IN ('admin', 'ops')
  ) THEN
    RAISE EXCEPTION 'delivery driver must be staff';
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(username), ''))
    INTO person_name
  FROM public.profiles
  WHERE id = NEW.delivered_by;

  IF person_name IS NULL THEN
    RAISE EXCEPTION 'delivery driver is missing';
  END IF;

  NEW.delivered_by_name := person_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deliveries_snapshot_driver ON public.deliveries;
CREATE TRIGGER trg_deliveries_snapshot_driver
BEFORE INSERT OR UPDATE OF delivered_by ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.snapshot_delivery_driver();
