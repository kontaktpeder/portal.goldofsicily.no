-- Offentlig menyfil per serveringssted (PDF/bilde, maks 50 MB).

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS menu_material_path TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS menu_material_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'venue-menus',
  'venue-menus',
  true,
  52428800,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "venue_menus_select_public" ON storage.objects;
CREATE POLICY "venue_menus_select_public"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'venue-menus');

DROP POLICY IF EXISTS "venue_menus_insert_managers" ON storage.objects;
CREATE POLICY "venue_menus_insert_managers"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'venue-menus'
  AND (
    public.is_admin()
    OR split_part(name, '/', 1) = public.current_venue_id()::text
  )
);

DROP POLICY IF EXISTS "venue_menus_update_managers" ON storage.objects;
CREATE POLICY "venue_menus_update_managers"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'venue-menus'
  AND (
    public.is_admin()
    OR split_part(name, '/', 1) = public.current_venue_id()::text
  )
)
WITH CHECK (
  bucket_id = 'venue-menus'
  AND (
    public.is_admin()
    OR split_part(name, '/', 1) = public.current_venue_id()::text
  )
);

DROP POLICY IF EXISTS "venue_menus_delete_managers" ON storage.objects;
CREATE POLICY "venue_menus_delete_managers"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'venue-menus'
  AND (
    public.is_admin()
    OR split_part(name, '/', 1) = public.current_venue_id()::text
  )
);
