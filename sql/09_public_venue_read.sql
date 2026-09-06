-- Kjør i Lovable Cloud → SQL / Supabase SQL Editor.
-- Lar goldofsicily.no lese publiserte serveringssteder uten portal-domenet.

GRANT SELECT ON public.venues TO anon, authenticated;
GRANT SELECT ON public.venue_menu_items TO anon, authenticated;
GRANT SELECT ON public.products TO anon, authenticated;

DROP POLICY IF EXISTS "venues_public_read" ON public.venues;
CREATE POLICY "venues_public_read" ON public.venues
  FOR SELECT TO anon, authenticated
  USING (active = true AND public_visible = true AND slug IS NOT NULL);

DROP POLICY IF EXISTS "menu_public_read" ON public.venue_menu_items;
CREATE POLICY "menu_public_read" ON public.venue_menu_items
  FOR SELECT TO anon, authenticated
  USING (
    available = true
    AND EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = venue_id
        AND v.active = true
        AND v.public_visible = true
        AND v.slug IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "products_public_read" ON public.products;
CREATE POLICY "products_public_read" ON public.products
  FOR SELECT TO anon, authenticated
  USING (active = true);
