-- Offentlig profil på serveringsstedet (Gold Partner vs listing).

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS public_profile TEXT NOT NULL DEFAULT 'listing';
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS collaboration_text TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS serving_story TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS menu_material_url TEXT;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS gallery_urls TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venues_public_profile_check'
  ) THEN
    ALTER TABLE public.venues
      ADD CONSTRAINT venues_public_profile_check
      CHECK (public_profile IN ('partner', 'listing'));
  END IF;
END $$;

UPDATE public.venues v
SET public_profile = 'partner'
FROM public.partners p
WHERE v.partner_id = p.id
  AND p.kind = 'direct'
  AND v.public_profile = 'listing';
