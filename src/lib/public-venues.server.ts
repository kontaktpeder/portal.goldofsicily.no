import type { Database } from "@/integrations/supabase/types";
import { formatPriceNok } from "@/lib/slug";
import { isPublicMenuUrl } from "@/lib/venue-menu-file";

type Customer = Database["public"]["Tables"]["venues"]["Row"];
type Product = Database["public"]["Tables"]["products"]["Row"];
type MenuItem = Database["public"]["Tables"]["venue_menu_items"]["Row"];

export type PublicMenuItem = {
  productSlug: string;
  name: string;
  description: string | null;
  priceNok: number | null;
  priceLabel: string | null;
  available: boolean;
  imageUrl: string | null;
};

export type PublicVenueProfile = "partner" | "listing";

export type PublicVenue = {
  slug: string;
  name: string;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  instagram: string | null;
  servingMethod: string | null;
  menuIntro: string | null;
  hasMenu: boolean;
  menu: PublicMenuItem[];
  profile: PublicVenueProfile;
  collaborationText: string | null;
  servingStory: string | null;
  videoUrl: string | null;
  menuMaterialUrl: string | null;
  galleryUrls: string[];
};

function toPublicMenuItem(
  item: MenuItem,
  product: Product | undefined,
  lang: "no" | "en",
): PublicMenuItem | null {
  if (!product || !item.available) return null;
  const name = item.display_name?.trim() || (lang === "en" ? product.name_en : product.name_no);
  return {
    productSlug: product.slug,
    name,
    description:
      item.description?.trim() ||
      (lang === "en" ? product.description_en : product.description_no) ||
      null,
    priceNok: item.price_ore == null ? null : item.price_ore / 100,
    priceLabel: item.price_ore == null ? null : `${formatPriceNok(item.price_ore)} kr`,
    available: item.available,
    imageUrl: item.image_url || product.image_url,
  };
}

function readProfile(venue: Customer): PublicVenueProfile {
  return venue.public_profile === "partner" ? "partner" : "listing";
}

export function mapPublicVenue(
  customer: Customer,
  menuItems: MenuItem[],
  productsById: Map<string, Product>,
  lang: "no" | "en" = "no",
): PublicVenue | null {
  if (!customer.active || !customer.public_visible || !customer.slug) return null;
  const menu = menuItems
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => toPublicMenuItem(item, productsById.get(item.product_id), lang))
    .filter((item): item is PublicMenuItem => Boolean(item));
  const profile = readProfile(customer);
  const rich = profile === "partner";

  return {
    slug: customer.slug,
    name: customer.name,
    city: customer.city || customer.location,
    address: customer.address,
    latitude: customer.latitude,
    longitude: customer.longitude,
    imageUrl: customer.image_url,
    logoUrl: customer.logo_url,
    websiteUrl: customer.website_url,
    instagram: customer.instagram,
    servingMethod: customer.serving_method,
    menuIntro: customer.menu_intro,
    hasMenu: menu.length > 0 || isPublicMenuUrl(customer.menu_material_url),
    menu,
    profile,
    collaborationText: rich ? customer.collaboration_text ?? null : null,
    servingStory: rich ? customer.serving_story ?? null : null,
    videoUrl: rich ? customer.video_url ?? null : null,
    menuMaterialUrl: isPublicMenuUrl(customer.menu_material_url) ? customer.menu_material_url : null,
    galleryUrls: rich ? customer.gallery_urls ?? [] : [],
  };
}

export async function loadPublicVenues(lang: "no" | "en" = "no") {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [venuesRes, menuRes, productsRes] = await Promise.all([
    supabaseAdmin
      .from("venues")
      .select("*")
      .eq("active", true)
      .eq("public_visible", true)
      .not("slug", "is", null)
      .order("name"),
    supabaseAdmin.from("venue_menu_items").select("*").eq("available", true).order("sort_order"),
    supabaseAdmin.from("products").select("*").eq("active", true),
  ]);

  if (venuesRes.error) throw venuesRes.error;
  if (menuRes.error) throw menuRes.error;
  if (productsRes.error) throw productsRes.error;

  const productsById = new Map((productsRes.data ?? []).map((product) => [product.id, product]));
  const menuByVenue = new Map<string, typeof menuRes.data>();
  for (const item of menuRes.data ?? []) {
    const list = menuByVenue.get(item.venue_id) ?? [];
    list.push(item);
    menuByVenue.set(item.venue_id, list);
  }

  return (venuesRes.data ?? [])
    .map((venue) => mapPublicVenue(venue, menuByVenue.get(venue.id) ?? [], productsById, lang))
    .filter((venue): venue is PublicVenue => Boolean(venue));
}

export async function loadPublicVenue(slug: string, lang: "no" | "en" = "no") {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: venue, error } = await supabaseAdmin
    .from("venues")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .eq("public_visible", true)
    .maybeSingle();
  if (error) throw error;
  if (!venue) return null;

  const [menuRes, productsRes] = await Promise.all([
    supabaseAdmin
      .from("venue_menu_items")
      .select("*")
      .eq("venue_id", venue.id)
      .eq("available", true)
      .order("sort_order"),
    supabaseAdmin.from("products").select("*").eq("active", true),
  ]);
  if (menuRes.error) throw menuRes.error;
  if (productsRes.error) throw productsRes.error;

  const productsById = new Map((productsRes.data ?? []).map((product) => [product.id, product]));
  return mapPublicVenue(venue, menuRes.data ?? [], productsById, lang);
}

export function parseLang(request: Request): "no" | "en" {
  const url = new URL(request.url);
  const q = url.searchParams.get("lang");
  if (q === "en" || q === "no") return q;
  const accept = request.headers.get("Accept-Language") ?? "";
  return accept.toLowerCase().startsWith("en") ? "en" : "no";
}
