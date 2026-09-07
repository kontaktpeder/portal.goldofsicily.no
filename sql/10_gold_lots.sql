-- Kjør i Lovable Cloud → SQL, eller i Supabase SQL Editor.
-- Gold-LOT is the master ID for production, Villa handover and venue delivery.
-- Format: L-YYYYMMDD-<letter>-NN  (lotmerkingsforskriften: identifikasjon innledet med L)

CREATE TYPE public.gold_lot_status AS ENUM ('produced', 'handed_over', 'closed', 'recalled');
CREATE TYPE public.handover_ownership AS ENUM ('gold', 'villa');

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS lot_letter TEXT;

UPDATE public.products SET lot_letter = 'N' WHERE slug = 'nduja' AND lot_letter IS NULL;
UPDATE public.products SET lot_letter = 'T' WHERE slug = 'truffle' AND lot_letter IS NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_lot_letter_format;
ALTER TABLE public.products
  ADD CONSTRAINT products_lot_letter_format
  CHECK (lot_letter IS NULL OR lot_letter ~ '^[A-Z]$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_lot_letter
  ON public.products (lot_letter)
  WHERE lot_letter IS NOT NULL AND active = true;

CREATE TABLE public.ingredient_suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingredient_suppliers_active ON public.ingredient_suppliers(active, name);

CREATE TABLE public.gold_lots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lot_code TEXT NOT NULL UNIQUE,
  production_date DATE NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  produced_qty INTEGER NOT NULL CHECK (produced_qty >= 0),
  carton_count INTEGER NOT NULL DEFAULT 0 CHECK (carton_count >= 0),
  produced_by TEXT,
  status public.gold_lot_status NOT NULL DEFAULT 'produced',
  deviation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gold_lots_lot_code_format CHECK (lot_code ~ '^L-[0-9]{8}-[A-Z]-[0-9]{2,}$')
);

CREATE INDEX idx_gold_lots_production_date ON public.gold_lots(production_date DESC, lot_code);
CREATE INDEX idx_gold_lots_product ON public.gold_lots(product_id, production_date DESC);

CREATE TABLE public.gold_lot_ingredients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gold_lot_id UUID NOT NULL REFERENCES public.gold_lots(id) ON DELETE CASCADE,
  ingredient_name TEXT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.ingredient_suppliers(id) ON DELETE RESTRICT,
  supplier_lot_code TEXT,
  quantity NUMERIC,
  quantity_unit TEXT NOT NULL DEFAULT 'kg',
  best_before DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gold_lot_ingredients_lot ON public.gold_lot_ingredients(gold_lot_id);
CREATE INDEX idx_gold_lot_ingredients_supplier ON public.gold_lot_ingredients(supplier_id);
CREATE INDEX idx_gold_lot_ingredients_supplier_lot
  ON public.gold_lot_ingredients (lower(supplier_lot_code))
  WHERE supplier_lot_code IS NOT NULL AND btrim(supplier_lot_code) <> '';

CREATE TABLE public.gold_lot_handovers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gold_lot_id UUID NOT NULL REFERENCES public.gold_lots(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  cartons INTEGER NOT NULL DEFAULT 0 CHECK (cartons >= 0),
  handed_over_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recipient_company TEXT NOT NULL,
  recipient_person TEXT,
  recipient_partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  recipient_venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  storage_location TEXT,
  ownership_after_handover public.handover_ownership NOT NULL DEFAULT 'villa',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gold_lot_handovers_lot ON public.gold_lot_handovers(gold_lot_id, handed_over_at DESC);

ALTER TABLE public.delivery_lines
  ADD COLUMN IF NOT EXISTS gold_lot_id UUID REFERENCES public.gold_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_lines_gold_lot ON public.delivery_lines(gold_lot_id)
  WHERE gold_lot_id IS NOT NULL;

ALTER TABLE public.delivery_lines
  DROP CONSTRAINT IF EXISTS delivery_lines_delivery_id_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_lines_delivery_product_lot
  ON public.delivery_lines (delivery_id, product_id, gold_lot_id) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.next_gold_lot_code(p_production_date DATE, p_lot_letter TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  letter TEXT;
  prefix TEXT;
  seq INT;
BEGIN
  letter := upper(substring(regexp_replace(coalesce(p_lot_letter, ''), '[^A-Za-z]', '', 'g') FROM 1 FOR 1));
  IF letter IS NULL OR letter = '' THEN
    RAISE EXCEPTION 'lot_letter must be a single letter';
  END IF;
  prefix := 'L-' || to_char(p_production_date, 'YYYYMMDD') || '-' || letter || '-';
  SELECT COALESCE(MAX(substring(lot_code FROM '[0-9]+$')::INT), 0) + 1
    INTO seq
    FROM public.gold_lots
    WHERE lot_code LIKE prefix || '%';
  RETURN prefix || lpad(seq::TEXT, 2, '0');
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredient_suppliers TO authenticated;
GRANT ALL ON public.ingredient_suppliers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gold_lots TO authenticated;
GRANT ALL ON public.gold_lots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gold_lot_ingredients TO authenticated;
GRANT ALL ON public.gold_lot_ingredients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gold_lot_handovers TO authenticated;
GRANT ALL ON public.gold_lot_handovers TO service_role;
GRANT EXECUTE ON FUNCTION public.next_gold_lot_code(DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_gold_lot_code(DATE, TEXT) TO service_role;

CREATE TRIGGER trg_ingredient_suppliers_updated_at BEFORE UPDATE ON public.ingredient_suppliers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_gold_lots_updated_at BEFORE UPDATE ON public.gold_lots
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ingredient_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gold_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gold_lot_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gold_lot_handovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingredient_suppliers_admin_select" ON public.ingredient_suppliers FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "ingredient_suppliers_admin_insert" ON public.ingredient_suppliers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "ingredient_suppliers_admin_update" ON public.ingredient_suppliers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "ingredient_suppliers_admin_delete" ON public.ingredient_suppliers FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE POLICY "gold_lots_select" ON public.gold_lots FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.delivery_lines dl
      JOIN public.deliveries d ON d.id = dl.delivery_id
      WHERE dl.gold_lot_id = gold_lots.id
        AND d.venue_id = public.current_venue_id()
    )
  );
CREATE POLICY "gold_lots_admin_insert" ON public.gold_lots FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "gold_lots_admin_update" ON public.gold_lots FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "gold_lots_admin_delete" ON public.gold_lots FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE POLICY "gold_lot_ingredients_admin_select" ON public.gold_lot_ingredients FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "gold_lot_ingredients_admin_insert" ON public.gold_lot_ingredients FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "gold_lot_ingredients_admin_update" ON public.gold_lot_ingredients FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "gold_lot_ingredients_admin_delete" ON public.gold_lot_ingredients FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE POLICY "gold_lot_handovers_admin_select" ON public.gold_lot_handovers FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "gold_lot_handovers_admin_insert" ON public.gold_lot_handovers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "gold_lot_handovers_admin_update" ON public.gold_lot_handovers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "gold_lot_handovers_admin_delete" ON public.gold_lot_handovers FOR DELETE TO authenticated
  USING (public.is_admin());
