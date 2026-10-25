-- Kjør i Lovable Cloud → SQL etter sql/32_shop_launch.sql.
-- Offisiell produktspesifikasjon for begge varianter.
-- Teksten er bekreftet. consumer_facts_verified gjør at kjøpssiden
-- viser den som bekreftet, ikke som foreløpig.
-- Betaling åpnes ikke av denne filen.
-- Eldre LOT beholder sin product_version. Neste versjon leser products.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS consumer_facts_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ingredients_en TEXT,
  ADD COLUMN IF NOT EXISTS allergens_en TEXT,
  ADD COLUMN IF NOT EXISTS storage_en TEXT,
  ADD COLUMN IF NOT EXISTS prep_en TEXT;

UPDATE public.products
SET
  unit_weight_g = 45,
  shelf_life_days = 90,
  do_not_refreeze_no = 'Skal ikke fryses på nytt etter opptining.',
  consumer_facts_verified = true,
  ingredients_no = $nduja_no$45 g per stykk.

Carnaroli-ris, vann, grønnsaksbuljong, ’nduja, meierismør, Grana Padano, mozzarella, hvetebatter, krydret panko, solsikkeolje og salt.

’Nduja: svinefett, svin, rød chili inkludert kalabrisk rød chili, salt, dekstrose, sukker, røykaroma, antioksidant E300, konserveringsmidler E250 og E252.
Mozzarella: pasteurisert melk, salt, mikrobiell løpe og melkesyrekultur.
Grana Padano: melk, salt, kalveløpe og lysozym fra egg.
Panko: hvete, vegetabilsk fett, maisstivelse, salt, soyapulver, gjær, E517, E300 og E491.$nduja_no$,
  ingredients_en = $nduja_en$45 g per piece.

Carnaroli rice, water, vegetable bouillon, ’nduja, dairy butter, Grana Padano, mozzarella, wheat batter, seasoned panko breadcrumbs, sunflower oil and salt.

’Nduja: pork fat, pork, red chilli including Calabrian red chilli, salt, dextrose, sugar, smoke flavouring, antioxidant E300, preservatives E250 and E252.
Mozzarella: pasteurised milk, salt, microbial rennet and lactic cultures.
Grana Padano: milk, salt, calf rennet and lysozyme from egg.
Panko: wheat, vegetable shortening, corn starch, salt, soy powder, yeast, E517, E300 and E491.$nduja_en$,
  allergens_no = 'Hvete (gluten), soya, melk, egg og selleri.',
  allergens_en = 'Wheat (gluten), soy, milk, egg and celery.',
  storage_no = $store_no$Oppbevares fryst ved −18 °C eller kaldere. Holdbarhet 3 måneder fra produksjon. Etter opptining: tildekket i maks. 48 timer ved +4 °C. Skal ikke fryses på nytt etter opptining.$store_no$,
  storage_en = $store_en$Keep frozen at −18 °C or colder. Shelf life 3 months from production. After thawing: covered for at most 48 hours at +4 °C. Do not refreeze after thawing.$store_en$,
  prep_no = $prep_no$Airfryer 180 °C i 7–9 minutter. Ovnsvarme 210 °C i 8–10 minutter. Frityr 170 °C i ca. 6 minutter. Varm godt igjennom til minst 70 °C i kjernen.$prep_no$,
  prep_en = $prep_en$Air fryer 180 °C for 7–9 minutes. Convection oven 210 °C for 8–10 minutes. Deep fryer 170 °C for about 6 minutes. Heat thoroughly to at least 70 °C in the core.$prep_en$,
  updated_at = now()
WHERE lower(btrim(slug)) IN ('nduja', 'nduja-mozzarella')
   OR upper(btrim(coalesce(lot_letter, ''))) = 'N';

UPDATE public.products
SET
  shelf_life_days = 90,
  do_not_refreeze_no = 'Skal ikke fryses på nytt etter opptining.',
  consumer_facts_verified = true,
  ingredients_no = $truffle_no$43–47 g per stykk.

Carnaroli-ris, vann, fersk sjampinjong, grønnsaksbuljong, trøffelkrem, meierismør, Grana Padano, hvetebatter, krydret panko og solsikkeolje.

Trøffelkrem: dyrket sopp 65 %, solsikkeolje, steinsopp 5 %, svart sommertrøffel 4 %, salt, hvitløk, persille, pepper og aroma.
Grana Padano: melk, salt, kalveløpe og lysozym fra egg.
Panko: hvete, vegetabilsk fett, maisstivelse, salt, soyapulver, gjær, E517, E300 og E491.
Urteblanding: persille, oregano, salvie, rosmarin, hvitløk, løk, søt paprika og salt.$truffle_no$,
  ingredients_en = $truffle_en$43–47 g per piece.

Carnaroli rice, water, fresh champignon mushrooms, vegetable bouillon, truffle cream, dairy butter, Grana Padano, wheat batter, seasoned panko breadcrumbs and sunflower oil.

Truffle cream: cultivated mushrooms 65%, sunflower oil, porcini mushrooms 5%, black summer truffle 4%, salt, garlic, parsley, pepper and flavouring.
Grana Padano: milk, salt, calf rennet and lysozyme from egg.
Panko: wheat, vegetable shortening, corn starch, salt, soy powder, yeast, E517, E300 and E491.
Herb blend: parsley, oregano, sage, rosemary, garlic, onion, sweet paprika and salt.$truffle_en$,
  allergens_no = 'Hvete (gluten), soya, melk, egg og selleri.',
  allergens_en = 'Wheat (gluten), soy, milk, egg and celery.',
  storage_no = $store_no$Oppbevares fryst ved −18 °C eller kaldere. Holdbarhet 3 måneder fra produksjon. Etter opptining: tildekket i maks. 48 timer ved +4 °C. Skal ikke fryses på nytt etter opptining.$store_no$,
  storage_en = $store_en$Keep frozen at −18 °C or colder. Shelf life 3 months from production. After thawing: covered for at most 48 hours at +4 °C. Do not refreeze after thawing.$store_en$,
  prep_no = $prep_no$Airfryer 180 °C i 7–9 minutter. Ovnsvarme 210 °C i 8–10 minutter. Frityr 170 °C i ca. 6 minutter. Varm godt igjennom til minst 70 °C i kjernen.$prep_no$,
  prep_en = $prep_en$Air fryer 180 °C for 7–9 minutes. Convection oven 210 °C for 8–10 minutes. Deep fryer 170 °C for about 6 minutes. Heat thoroughly to at least 70 °C in the core.$prep_en$,
  updated_at = now()
WHERE lower(btrim(slug)) IN ('truffle', 'truffle-mushroom')
   OR upper(btrim(coalesce(lot_letter, ''))) = 'T';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE consumer_facts_verified
      AND (lower(btrim(slug)) IN ('nduja', 'nduja-mozzarella') OR upper(btrim(coalesce(lot_letter, ''))) = 'N')
  ) THEN
    RAISE EXCEPTION 'Fant ikke ’Nduja-produktet. Sjekk slug eller lot_letter før du kjører på nytt.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE consumer_facts_verified
      AND (lower(btrim(slug)) IN ('truffle', 'truffle-mushroom') OR upper(btrim(coalesce(lot_letter, ''))) = 'T')
  ) THEN
    RAISE EXCEPTION 'Fant ikke trøffelproduktet. Sjekk slug eller lot_letter før du kjører på nytt.';
  END IF;
END $$;
