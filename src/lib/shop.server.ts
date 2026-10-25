import { isGoldLotSchemaError, toStockLots } from "@/lib/lot-stock";
import {
  activeReservedPieces,
  emptyPublicShop,
  isShopSchemaError,
  physicalPiecesByProduct,
  publicShop,
  restockMessage,
  shopFlavors,
  subscribersToNotify,
  type PublicShop,
  type ReservationRow,
  type ShopProduct,
  type WaitlistInput,
  type WaitlistSubscriber,
} from "@/lib/shop";

function toShopProduct(product: {
  id: string;
  slug: string;
  lot_letter: string | null;
  active: boolean;
  ingredients_no: string | null;
  allergens_no: string | null;
  storage_no: string | null;
  prep_no: string | null;
  consumer_facts_verified?: boolean | null;
  ingredients_en?: string | null;
  allergens_en?: string | null;
  storage_en?: string | null;
  prep_en?: string | null;
}): ShopProduct {
  return {
    id: product.id,
    slug: product.slug,
    lotLetter: product.lot_letter,
    active: product.active,
    facts: {
      verified: product.consumer_facts_verified === true,
      ingredients: product.ingredients_no,
      allergens: product.allergens_no,
      storage: product.storage_no,
      prep: product.prep_no,
      ingredientsEn: product.ingredients_en ?? null,
      allergensEn: product.allergens_en ?? null,
      storageEn: product.storage_en ?? null,
      prepEn: product.prep_en ?? null,
    },
  };
}

function isMissingConsumerFactColumn(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42703" ||
    /consumer_facts_verified|ingredients_en|allergens_en|storage_en|prep_en/i.test(message)
  );
}

const LOT_SELECT =
  "id, lot_code, product_id, produced_qty, approved_qty, status, gold_lot_handovers(id, quantity, ownership_after_handover, recipient_company), delivery_lines(quantity, source_handover_id)";

type Admin = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

async function adminClient(): Promise<Admin | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin;
  } catch {
    return null;
  }
}

export async function loadPublicShop(): Promise<PublicShop> {
  try {
    return await readPublicShop();
  } catch {
    return emptyPublicShop(false);
  }
}

async function readPublicShop(): Promise<PublicShop> {
  const admin = await adminClient();
  if (!admin) return emptyPublicShop(false);

  const wide = await admin
    .from("products")
    .select(
      "id, slug, lot_letter, active, ingredients_no, allergens_no, storage_no, prep_no, consumer_facts_verified, ingredients_en, allergens_en, storage_en, prep_en",
    )
    .eq("active", true);
  let products: ShopProduct[];
  if (wide.error && isMissingConsumerFactColumn(wide.error)) {
    const narrow = await admin
      .from("products")
      .select("id, slug, lot_letter, active, ingredients_no, allergens_no, storage_no, prep_no")
      .eq("active", true);
    if (narrow.error) return emptyPublicShop(false);
    products = (narrow.data ?? []).map((product) => toShopProduct(product));
  } else if (wide.error) {
    return emptyPublicShop(false);
  } else {
    products = (wide.data ?? []).map((product) => toShopProduct(product));
  }

  await admin
    .from("shop_reservations")
    .update({ status: "released" })
    .eq("status", "held")
    .lte("expires_at", new Date().toISOString());

  const lotsRes = await admin
    .from("gold_lots")
    .select(LOT_SELECT)
    .in("status", ["produced", "packed", "handed_over"])
    .limit(400);
  if (lotsRes.error) {
    if (isGoldLotSchemaError(lotsRes.error))
      return publicShop(shopFlavors(products, new Map()), true);
    return emptyPublicShop(false);
  }

  const stock = toStockLots((lotsRes.data ?? []) as Parameters<typeof toStockLots>[0]);
  const physical = physicalPiecesByProduct(
    stock.map((lot) => ({
      productId: lot.productId,
      status: lot.status,
      remaining: lot.remaining,
    })),
  );

  const holdsRes = await admin
    .from("shop_reservations")
    .select("product_id, pieces, status, expires_at")
    .eq("status", "held");
  if (holdsRes.error && !isShopSchemaError(holdsRes.error)) return emptyPublicShop(false);

  const now = new Date();
  const holds: ReservationRow[] = holdsRes.error
    ? []
    : (holdsRes.data ?? []).map((row) => ({
        productId: row.product_id,
        pieces: row.pieces,
        status: row.status,
        expiresAt: row.expires_at,
      }));
  for (const [productId, pieces] of physical) {
    physical.set(productId, Math.max(0, pieces - activeReservedPieces(holds, productId, now)));
  }

  return publicShop(shopFlavors(products, physical), true);
}

export async function saveWaitlist(
  input: WaitlistInput,
): Promise<{ ok: true } | { ok: false; reason: "unavailable" }> {
  try {
    return await writeWaitlist(input);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

async function writeWaitlist(
  input: WaitlistInput,
): Promise<{ ok: true } | { ok: false; reason: "unavailable" }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, reason: "unavailable" };

  const inserted = await admin.from("shop_waitlist").insert({
    email: input.email,
    flavor_slug: input.flavor,
    lang: input.lang,
    discovery_source: input.discovery,
    newsletter_consent: input.newsletterConsent,
  });
  if (!inserted.error) return { ok: true };
  if (isShopSchemaError(inserted.error)) return { ok: false, reason: "unavailable" };
  if (inserted.error.code !== "23505") return { ok: false, reason: "unavailable" };

  const updated = await admin
    .from("shop_waitlist")
    .update({
      lang: input.lang,
      ...(input.discovery ? { discovery_source: input.discovery } : {}),
      newsletter_consent: input.newsletterConsent,
      notified_at: null,
    })
    .eq("email", input.email)
    .eq("flavor_slug", input.flavor);
  if (updated.error) return { ok: false, reason: "unavailable" };
  return { ok: true };
}

async function writeLaunchNotice(
  input: WaitlistInput,
): Promise<{ ok: true } | { ok: false; reason: "unavailable" }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, reason: "unavailable" };

  const inserted = await admin.from("shop_launch_notices").insert({
    email: input.email,
    lang: input.lang,
    discovery_source: input.discovery,
    newsletter_consent: input.newsletterConsent,
  });
  if (!inserted.error) return { ok: true };
  if (isShopSchemaError(inserted.error)) return { ok: false, reason: "unavailable" };
  if (inserted.error.code !== "23505") return { ok: false, reason: "unavailable" };

  const updated = await admin
    .from("shop_launch_notices")
    .update({
      lang: input.lang,
      ...(input.discovery ? { discovery_source: input.discovery } : {}),
      newsletter_consent: input.newsletterConsent,
      notified_at: null,
    })
    .eq("email", input.email);
  if (updated.error) return { ok: false, reason: "unavailable" };
  return { ok: true };
}

export async function saveShopNotices(
  input: WaitlistInput,
): Promise<{ ok: true } | { ok: false; reason: "unavailable" }> {
  try {
    if (input.restockNotice) {
      const saved = await writeWaitlist(input);
      if (!saved.ok) return saved;
    }
    if (input.launchNotice) {
      const saved = await writeLaunchNotice(input);
      if (!saved.ok) return saved;
    }
    if (input.restockNotice) await notifyAvailableFlavors();
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function mailFrom(): { key: string; from: string } | null {
  const key = process.env["RESEND_API_KEY"];
  const from = process.env["SHOP_MAIL_FROM"];
  if (!key || !from) return null;
  return { key, from };
}

async function sendRestockEmail(input: {
  to: string;
  lang: "no" | "en";
  flavorName: string;
}): Promise<"sent" | "unconfigured" | "failed"> {
  const mail = mailFrom();
  if (!mail) return "unconfigured";
  const message = restockMessage(input.lang, input.flavorName);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mail.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: mail.from,
        to: [input.to],
        subject: message.subject,
        text: message.text,
      }),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export async function notifyAvailableFlavors(): Promise<{
  sent: number;
  pending: number;
  mailConfigured: boolean;
}> {
  try {
    return await sendAvailableNotices();
  } catch {
    return { sent: 0, pending: 0, mailConfigured: false };
  }
}

async function sendAvailableNotices(): Promise<{
  sent: number;
  pending: number;
  mailConfigured: boolean;
}> {
  const admin = await adminClient();
  if (!admin) return { sent: 0, pending: 0, mailConfigured: false };
  const shop = await loadPublicShop();
  if (!shop.stockKnown) return { sent: 0, pending: 0, mailConfigured: mailFrom() != null };

  const boxes = new Map<string, number>(
    shop.flavors.map((flavor) => [flavor.slug, flavor.boxes50]),
  );
  const names = new Map<string, string>(shop.flavors.map((flavor) => [flavor.slug, flavor.nameNo]));
  const namesEn = new Map<string, string>(
    shop.flavors.map((flavor) => [flavor.slug, flavor.nameEn]),
  );
  const listed = await admin
    .from("shop_waitlist")
    .select("id, email, flavor_slug, lang, notified_at")
    .is("notified_at", null);
  if (listed.error) return { sent: 0, pending: 0, mailConfigured: mailFrom() != null };

  const subscribers: WaitlistSubscriber[] = (listed.data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    flavorSlug: row.flavor_slug,
    lang: row.lang === "en" ? "en" : "no",
    notifiedAt: row.notified_at,
  }));
  const due = subscribersToNotify(subscribers, boxes);
  const mailConfigured = mailFrom() != null;
  if (!mailConfigured) return { sent: 0, pending: due.length, mailConfigured: false };

  let sent = 0;
  for (const row of due) {
    const flavorName = row.lang === "en" ? namesEn.get(row.flavorSlug) : names.get(row.flavorSlug);
    const result = await sendRestockEmail({
      to: row.email,
      lang: row.lang,
      flavorName: flavorName ?? row.flavorSlug,
    });
    if (result !== "sent") continue;
    const marked = await admin
      .from("shop_waitlist")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("notified_at", null);
    if (!marked.error) sent += 1;
  }
  return { sent, pending: due.length - sent, mailConfigured: true };
}
