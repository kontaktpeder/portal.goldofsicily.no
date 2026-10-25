import { isGoldLotSchemaError, toStockLots } from "@/lib/lot-stock";
import {
  activeReservedPieces,
  emptyPublicShop,
  isShopSchemaError,
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

  const productsRes = await admin
    .from("products")
    .select("id, slug, lot_letter, active, ingredients_no, allergens_no, storage_no, prep_no")
    .eq("active", true);
  if (productsRes.error) return emptyPublicShop(false);

  const products: ShopProduct[] = (productsRes.data ?? []).map((product) => ({
    id: product.id,
    slug: product.slug,
    lotLetter: product.lot_letter,
    active: product.active,
    facts: {
      ingredients: product.ingredients_no,
      allergens: product.allergens_no,
      storage: product.storage_no,
      prep: product.prep_no,
    },
  }));

  await admin
    .from("shop_reservations")
    .update({ status: "released" })
    .eq("status", "held")
    .lte("expires_at", new Date().toISOString());

  const lotsRes = await admin
    .from("gold_lots")
    .select(LOT_SELECT)
    .neq("status", "recalled")
    .limit(400);
  if (lotsRes.error) {
    if (isGoldLotSchemaError(lotsRes.error))
      return publicShop(shopFlavors(products, new Map()), true);
    return emptyPublicShop(false);
  }

  const stock = toStockLots((lotsRes.data ?? []) as Parameters<typeof toStockLots>[0]);
  const physical = new Map<string, number>();
  for (const lot of stock) {
    if (lot.status === "recalled") continue;
    physical.set(lot.productId, (physical.get(lot.productId) ?? 0) + lot.remaining);
  }

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
      discovery_source: input.discovery,
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
      discovery_source: input.discovery,
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
