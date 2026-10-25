import { flavorSlug, PACK_FIFTY, type ShopFlavorSlug } from "@/lib/shop";
import { loadPublicShop } from "@/lib/shop.server";
import {
  acceptOfferDecision,
  approvalDecision,
  approvalLock,
  classifyShopOrder,
  confirmedMail,
  declinedMail,
  offerDecision,
  offerMail,
  orderPieces,
  orderTotalOre,
  paymentKind,
  piecePriceOre,
  PICKUP_PLACE,
  receivedMail,
  reservationCovers,
  SHOP_APPROVED_HOLD_DAYS,
  SHOP_ORDER_HOLD_HOURS,
  type ApprovalView,
  type ReservationView,
  type ShopFulfillment,
  type ShopOrderInput,
  type ShopOrderStatus,
} from "@/lib/shop-order";

type Admin = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

async function adminClient(): Promise<Admin | null> {
  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"]) return null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin;
  } catch {
    return null;
  }
}

export type ShopOrderRow = {
  id: string;
  orderNumber: string;
  status: ShopOrderStatus;
  flavor: ShopFlavorSlug;
  flavorName: string;
  boxes: number;
  pieces: number;
  totalOre: number;
  customerName: string;
  email: string;
  phone: string;
  addressLine: string;
  postalCode: string;
  city: string;
  orgNumber: string | null;
  fulfillment: ShopFulfillment;
  binding: boolean;
  customerOrderId: string | null;
  offerBoxes: number | null;
  lang: "no" | "en";
  expiresAt: string | null;
  createdAt: string;
};

const FLAVOR_NAME: Record<ShopFlavorSlug, string> = { nduja: "’Nduja", truffle: "Trøffel" };

function holdUntil(): string {
  return new Date(Date.now() + SHOP_ORDER_HOLD_HOURS * 60 * 60 * 1000).toISOString();
}

function approvedUntil(): string {
  return new Date(Date.now() + SHOP_APPROVED_HOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function sweepQuiet(admin: Admin) {
  try {
    await admin.rpc("sweep_shop_orders");
  } catch {
    // sql/36 can be applied after the portal is published.
  }
}

function mailFrom(): { key: string; from: string } | null {
  const key = process.env["RESEND_API_KEY"];
  const from = process.env["SHOP_MAIL_FROM"];
  if (!key || !from) return null;
  return { key, from };
}

async function sendText(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<"sent" | "unconfigured" | "failed"> {
  const mail = mailFrom();
  if (!mail) return "unconfigured";
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
        subject: input.subject,
        text: input.text,
      }),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

type DbOrder = {
  id: string;
  order_number: string;
  status: string;
  flavor_slug: string;
  boxes: number;
  pieces: number;
  total_ore: number;
  customer_name: string;
  email: string;
  phone: string;
  address_line: string;
  postal_code: string;
  city: string;
  org_number: string | null;
  fulfillment: string;
  binding: boolean;
  reservation_id: string | null;
  customer_id: string | null;
  customer_order_id: string | null;
  offer_boxes: number | null;
  offer_token: string | null;
  lang: string;
  received_mail_at: string | null;
  confirmed_mail_at: string | null;
  mail_error: string | null;
  approval_token: string | null;
  expires_at: string | null;
  product_id: string | null;
  created_at: string;
  updated_at: string;
};

function asStatus(value: string): ShopOrderStatus {
  if (
    value === "received" ||
    value === "quote" ||
    value === "offer" ||
    value === "confirming" ||
    value === "confirmed" ||
    value === "declined" ||
    value === "expired"
  ) {
    return value;
  }
  return "expired";
}

function asFulfillment(value: string): ShopFulfillment {
  return value === "delivery_request" ? "delivery_request" : "pickup";
}

function viewOf(row: ShopOrderRow): ShopOrderRow {
  return row;
}

function toView(row: DbOrder): ShopOrderRow {
  const flavor = row.flavor_slug === "truffle" ? "truffle" : "nduja";
  return viewOf({
    id: row.id,
    orderNumber: row.order_number,
    status: asStatus(row.status),
    flavor,
    flavorName: FLAVOR_NAME[flavor],
    boxes: row.boxes,
    pieces: row.pieces,
    totalOre: row.total_ore,
    customerName: row.customer_name,
    email: row.email,
    phone: row.phone,
    addressLine: row.address_line,
    postalCode: row.postal_code,
    city: row.city,
    orgNumber: row.org_number,
    fulfillment: asFulfillment(row.fulfillment),
    binding: row.binding,
    customerOrderId: row.customer_order_id,
    offerBoxes: row.offer_boxes,
    lang: row.lang === "en" ? "en" : "no",
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

async function productFor(admin: Admin, flavor: ShopFlavorSlug): Promise<string | null> {
  const listed = await admin
    .from("products")
    .select("id, slug, lot_letter, active")
    .eq("active", true);
  if (listed.error) return null;
  const found = (listed.data ?? []).find(
    (product) => flavorSlug({ slug: product.slug, lotLetter: product.lot_letter }) === flavor,
  );
  return found?.id ?? null;
}

async function markMail(
  admin: Admin,
  id: string,
  field: "received_mail_at" | "confirmed_mail_at",
  result: "sent" | "unconfigured" | "failed",
) {
  const patch: {
    mail_error: string | null;
    received_mail_at?: string;
    confirmed_mail_at?: string;
  } = {
    mail_error: result === "sent" ? null : result,
  };
  if (result === "sent") patch[field] = new Date().toISOString();
  await admin.from("shop_orders").update(patch).eq("id", id);
}

export async function placeShopOrder(
  input: ShopOrderInput,
): Promise<
  | { ok: true; order: ShopOrderRow; kind: "binding" | "quote" }
  | { ok: false; reason: "unavailable" | "short" | "invalid" }
> {
  const admin = await adminClient();
  if (!admin) return { ok: false, reason: "unavailable" };
  await sweepQuiet(admin);
  const shop = await loadPublicShop();
  if (!shop.stockKnown) return { ok: false, reason: "unavailable" };
  const stock = shop.flavors.find((flavor) => flavor.slug === input.flavor);
  const kind = classifyShopOrder({
    bindingOpen: shop.ordering.bindingOpen,
    fulfillment: input.fulfillment,
    boxes: input.boxes,
    boxesAvailable: stock?.boxes50 ?? 0,
  });
  if (kind === "short") return { ok: false, reason: "short" };
  const productId = await productFor(admin, input.flavor);
  if (!productId) return { ok: false, reason: "unavailable" };
  const pieces = orderPieces(input.boxes);
  const expiresAt = holdUntil();
  let reservationId: string | null = null;
  if (kind === "binding") {
    const reserved = await admin.rpc("reserve_shop_pieces", {
      p_product_id: productId,
      p_pieces: pieces,
      p_physical_pieces: await physicalForReserve(admin, productId, stock?.boxes50 ?? 0),
      p_expires_at: expiresAt,
      p_payment_kind: paymentKind(),
    });
    if (reserved.error || !reserved.data)
      return { ok: false, reason: reserved.error ? "unavailable" : "short" };
    reservationId = reserved.data;
  }
  const inserted = await admin
    .from("shop_orders")
    .insert({
      status: kind === "binding" ? "received" : "quote",
      payment_kind: paymentKind(),
      flavor_slug: input.flavor,
      product_id: productId,
      boxes: input.boxes,
      pieces,
      unit_price_ore: piecePriceOre(),
      total_ore: orderTotalOre(input.boxes),
      customer_name: input.name,
      email: input.email,
      phone: input.phone,
      address_line: input.addressLine,
      postal_code: input.postalCode,
      city: input.city,
      org_number: input.orgNumber,
      fulfillment: input.fulfillment,
      binding: kind === "binding",
      reservation_id: reservationId,
      lang: input.lang,
      expires_at: kind === "binding" ? expiresAt : null,
    })
    .select("*")
    .single();
  if (inserted.error || !inserted.data) {
    if (reservationId) {
      await admin.from("shop_reservations").update({ status: "released" }).eq("id", reservationId);
    }
    return { ok: false, reason: "unavailable" };
  }
  const order = toView(inserted.data as DbOrder);
  const message = receivedMail({
    lang: input.lang,
    number: order.orderNumber,
    flavorName: order.flavorName,
    boxes: order.boxes,
    totalOre: order.totalOre,
    kind,
    fulfillment: input.fulfillment,
  });
  const mailed = await sendText({ to: input.email, subject: message.subject, text: message.text });
  await markMail(admin, order.id, "received_mail_at", mailed);
  return { ok: true, order, kind };
}

async function loadOrder(admin: Admin, id: string): Promise<DbOrder | null> {
  const row = await admin.from("shop_orders").select("*").eq("id", id).maybeSingle();
  if (row.error || !row.data) return null;
  return row.data as DbOrder;
}

async function physicalForReserve(
  admin: Admin,
  productId: string,
  publicBoxes: number,
): Promise<number> {
  const held = await admin
    .from("shop_reservations")
    .select("pieces, expires_at")
    .eq("product_id", productId)
    .eq("status", "held");
  const now = Date.now();
  const reserved = (held.data ?? []).reduce((sum, row) => {
    const expires = new Date(row.expires_at).getTime();
    return Number.isFinite(expires) && expires > now ? sum + row.pieces : sum;
  }, 0);
  return publicBoxes * PACK_FIFTY + reserved;
}

async function reservationOf(admin: Admin, id: string | null): Promise<ReservationView | null> {
  if (!id) return null;
  const row = await admin
    .from("shop_reservations")
    .select("id, status, pieces, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (row.error || !row.data) return null;
  return {
    id: row.data.id,
    status: row.data.status,
    pieces: row.data.pieces,
    expiresAt: row.data.expires_at,
  };
}

function approvalView(row: DbOrder, reservation: ReservationView | null): ApprovalView {
  return {
    status: asStatus(row.status),
    binding: row.binding,
    fulfillment: asFulfillment(row.fulfillment),
    pieces: row.pieces,
    reservation,
    customerOrderId: row.customer_order_id,
    customerId: row.customer_id,
  };
}

export async function listShopOrders(): Promise<{
  orders: ShopOrderRow[];
  unavailable: boolean;
}> {
  const admin = await adminClient();
  if (!admin) return { orders: [], unavailable: true };
  await sweepQuiet(admin);
  const listed = await admin
    .from("shop_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(40);
  if (listed.error) return { orders: [], unavailable: true };
  const rows = (listed.data ?? []) as DbOrder[];
  await retryFailedMail(admin, rows);
  return { orders: rows.map((row) => toView(row)), unavailable: false };
}

async function retryFailedMail(admin: Admin, rows: readonly DbOrder[]) {
  let attempts = 0;
  for (const row of rows) {
    if (attempts >= 3 || (row.mail_error !== "failed" && row.mail_error !== "unconfigured"))
      continue;
    const flavorName = FLAVOR_NAME[row.flavor_slug === "truffle" ? "truffle" : "nduja"];
    const lang = row.lang === "en" ? "en" : "no";
    if (!row.received_mail_at && (row.status === "received" || row.status === "quote")) {
      attempts += 1;
      const message = receivedMail({
        lang,
        number: row.order_number,
        flavorName,
        boxes: row.boxes,
        totalOre: row.total_ore,
        kind: row.binding ? "binding" : "quote",
        fulfillment: asFulfillment(row.fulfillment),
      });
      const mailed = await sendText({
        to: row.email,
        subject: message.subject,
        text: message.text,
      });
      await markMail(admin, row.id, "received_mail_at", mailed);
    } else if (!row.confirmed_mail_at && row.status === "confirmed") {
      attempts += 1;
      const message = confirmedMail({
        lang,
        number: row.order_number,
        flavorName,
        boxes: row.boxes,
        totalOre: row.total_ore,
      });
      const mailed = await sendText({
        to: row.email,
        subject: message.subject,
        text: message.text,
      });
      await markMail(admin, row.id, "confirmed_mail_at", mailed);
    }
  }
}

async function takeApprovalLock(
  admin: Admin,
  id: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; reason: "busy" | "unavailable" | "done"; customerOrderId: string | null }
> {
  const row = await loadOrder(admin, id);
  if (!row) return { ok: false, reason: "unavailable", customerOrderId: null };
  if (row.customer_order_id)
    return { ok: false, reason: "done", customerOrderId: row.customer_order_id };
  if (row.status !== "confirming") return { ok: false, reason: "busy", customerOrderId: null };
  if (
    approvalLock({ token: row.approval_token, updatedAt: row.updated_at, now: new Date() }) ===
    "wait"
  ) {
    return { ok: false, reason: "busy", customerOrderId: null };
  }
  const token = crypto.randomUUID();
  const stamp = new Date().toISOString();
  const update = admin
    .from("shop_orders")
    .update({ approval_token: token, updated_at: stamp })
    .eq("id", id)
    .eq("status", "confirming")
    .is("customer_order_id", null);
  const locked = row.approval_token
    ? await update.eq("approval_token", row.approval_token).select("id")
    : await update.is("approval_token", null).select("id");
  if (locked.error) return { ok: false, reason: "unavailable", customerOrderId: null };
  if (!locked.data?.length) return { ok: false, reason: "busy", customerOrderId: null };
  return { ok: true, token };
}

async function undoApproval(
  admin: Admin,
  current: DbOrder,
  token: string,
  createdHold: string | null,
) {
  if (createdHold) {
    await admin
      .from("shop_reservations")
      .update({ status: "released" })
      .eq("id", createdHold)
      .eq("status", "held");
  }
  const patch: {
    status: "received" | "quote";
    binding: boolean;
    reservation_id?: string | null;
    approval_token: null;
    updated_at: string;
  } = {
    status: current.binding ? "received" : "quote",
    binding: current.binding,
    approval_token: null,
    updated_at: new Date().toISOString(),
  };
  if (createdHold) patch.reservation_id = current.reservation_id;
  await admin.from("shop_orders").update(patch).eq("id", current.id).eq("approval_token", token);
}

export async function approveShopOrder(
  id: string,
  actorId: string | null,
): Promise<
  | { ok: true; customerOrderId: string; already: boolean }
  | { ok: false; reason: "unavailable" | "stock" | "offer" | "closed" | "busy" }
> {
  const admin = await adminClient();
  if (!admin) return { ok: false, reason: "unavailable" };
  await sweepQuiet(admin);
  const row = await loadOrder(admin, id);
  if (!row) return { ok: false, reason: "unavailable" };
  const reservation = await reservationOf(admin, row.reservation_id);
  const decision = approvalDecision(approvalView(row, reservation), new Date());
  if (decision.action === "already")
    return { ok: true, customerOrderId: decision.customerOrderId, already: true };
  if (decision.action === "stop") {
    if (decision.reason === "stock" && row.reservation_id) {
      await admin
        .from("shop_reservations")
        .update({ status: "released" })
        .eq("id", row.reservation_id)
        .eq("status", "held");
      await admin
        .from("shop_orders")
        .update({ status: "expired" })
        .eq("id", row.id)
        .eq("status", "received");
    }
    return { ok: false, reason: decision.reason };
  }
  if (decision.action === "claim") {
    const claimed = await admin
      .from("shop_orders")
      .update({ status: "confirming", approval_token: null, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", row.status)
      .is("customer_order_id", null)
      .select("id");
    if (claimed.error) return { ok: false, reason: "unavailable" };
    if (!claimed.data?.length) return { ok: false, reason: "busy" };
  }

  const lock = await takeApprovalLock(admin, id);
  if (!lock.ok) {
    if (lock.reason === "done" && lock.customerOrderId) {
      return { ok: true, customerOrderId: lock.customerOrderId, already: true };
    }
    return { ok: false, reason: lock.reason === "unavailable" ? "unavailable" : "busy" };
  }
  const token = lock.token;
  const current = (await loadOrder(admin, id)) ?? row;
  if (current.customer_order_id) {
    await admin
      .from("shop_orders")
      .update({ status: "confirmed", approval_token: null })
      .eq("id", current.id);
    return { ok: true, customerOrderId: current.customer_order_id, already: true };
  }
  if (!current.product_id) {
    await undoApproval(admin, current, token, null);
    return { ok: false, reason: "unavailable" };
  }

  let reservationId = current.reservation_id;
  let createdHold: string | null = null;
  const keptUntil = approvedUntil();
  if (!current.binding) {
    const existing = await reservationOf(admin, current.reservation_id);
    if (existing && reservationCovers(existing, current.pieces, new Date())) {
      reservationId = existing.id;
      await admin
        .from("shop_reservations")
        .update({ expires_at: keptUntil })
        .eq("id", existing.id)
        .eq("status", "held");
    } else {
      const shop = await loadPublicShop();
      const stock = shop.flavors.find((flavor) => flavor.slug === current.flavor_slug);
      const reserved = await admin.rpc("reserve_shop_pieces", {
        p_product_id: current.product_id,
        p_pieces: current.pieces,
        p_physical_pieces: await physicalForReserve(admin, current.product_id, stock?.boxes50 ?? 0),
        p_expires_at: keptUntil,
        p_payment_kind: paymentKind(),
      });
      if (reserved.error || !reserved.data) {
        await undoApproval(admin, current, token, null);
        return { ok: false, reason: "stock" };
      }
      reservationId = reserved.data;
      createdHold = reserved.data;
    }
    await admin
      .from("shop_orders")
      .update({ reservation_id: reservationId, binding: true, expires_at: keptUntil })
      .eq("id", current.id)
      .eq("approval_token", token);
  } else if (reservationId) {
    const extended = await admin
      .from("shop_reservations")
      .update({ expires_at: keptUntil })
      .eq("id", reservationId)
      .eq("status", "held")
      .select("id");
    if (extended.error || !extended.data?.length) {
      await admin
        .from("shop_orders")
        .update({ status: "expired", approval_token: null, updated_at: new Date().toISOString() })
        .eq("id", current.id)
        .eq("approval_token", token);
      return { ok: false, reason: "stock" };
    }
    await admin
      .from("shop_orders")
      .update({ expires_at: keptUntil })
      .eq("id", current.id)
      .eq("approval_token", token);
  }

  let customerId = current.customer_id;
  if (!customerId) {
    const created = await admin
      .from("customers")
      .insert({
        name: current.customer_name,
        type: "venue",
        public_visible: false,
        active: true,
        default_language: current.lang === "en" ? "en" : "no",
        email: current.email,
        phone: current.phone,
        address: `${current.address_line}, ${current.postal_code} ${current.city}`,
        city: current.city,
        contact_name: current.customer_name,
        notes: `Nettbestilling ${current.order_number}. Privatkunde. Fakturamottaker er ikke opprettet.${current.org_number ? ` Oppgitt org.nr ${current.org_number} er ikke fakturamottaker.` : ""}`,
      })
      .select("id")
      .single();
    if (created.error || !created.data) {
      await undoApproval(admin, current, token, createdHold);
      return { ok: false, reason: "unavailable" };
    }
    customerId = created.data.id;
    await admin
      .from("shop_orders")
      .update({ customer_id: customerId })
      .eq("id", current.id)
      .eq("approval_token", token);
  }

  const orderNotes = `Nettbestilling ${current.order_number}. Henting utenfor ${PICKUP_PLACE}. Faktura etter levering. Ingen bedriftspris.`;
  let order = await admin
    .from("customer_orders")
    .insert({
      ordered_by_customer_id: customerId,
      ship_to_customer_id: customerId,
      contact_name: current.customer_name,
      status: "draft",
      owner_id: actorId,
      notes: orderNotes,
    })
    .select("id")
    .single();
  if ((order.error || !order.data) && actorId) {
    order = await admin
      .from("customer_orders")
      .insert({
        ordered_by_customer_id: customerId,
        ship_to_customer_id: customerId,
        contact_name: current.customer_name,
        status: "draft",
        notes: orderNotes,
      })
      .select("id")
      .single();
  }
  if (order.error || !order.data) {
    await undoApproval(admin, current, token, createdHold);
    return { ok: false, reason: "unavailable" };
  }
  const line = await admin.from("customer_order_lines").insert({
    order_id: order.data.id,
    product_id: current.product_id,
    quantity: current.pieces,
    unit_price_ore: piecePriceOre(),
  });
  if (line.error) {
    await admin.from("customer_orders").delete().eq("id", order.data.id);
    await undoApproval(admin, current, token, createdHold);
    return { ok: false, reason: "unavailable" };
  }
  await admin
    .from("customer_orders")
    .update({ status: "pending_confirmation" })
    .eq("id", order.data.id);
  await admin
    .from("shop_orders")
    .update({
      status: "confirmed",
      customer_order_id: order.data.id,
      binding: true,
      approval_token: null,
      expires_at: keptUntil,
    })
    .eq("id", current.id)
    .eq("approval_token", token);

  const message = confirmedMail({
    lang: current.lang === "en" ? "en" : "no",
    number: current.order_number,
    flavorName: FLAVOR_NAME[current.flavor_slug === "truffle" ? "truffle" : "nduja"],
    boxes: current.boxes,
    totalOre: current.total_ore,
  });
  const mailed = await sendText({
    to: current.email,
    subject: message.subject,
    text: message.text,
  });
  await markMail(admin, current.id, "confirmed_mail_at", mailed);
  return { ok: true, customerOrderId: order.data.id, already: false };
}

export async function declineShopOrder(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: "unavailable" | "closed" }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, reason: "unavailable" };
  const row = await loadOrder(admin, id);
  if (!row) return { ok: false, reason: "unavailable" };
  if (row.customer_order_id || row.status === "confirmed" || row.status === "declined") {
    return { ok: false, reason: "closed" };
  }
  const declined = await admin
    .from("shop_orders")
    .update({ status: "declined" })
    .eq("id", id)
    .in("status", ["received", "quote", "offer", "expired"])
    .select("id");
  if (declined.error || !declined.data?.length) return { ok: false, reason: "closed" };
  if (row.reservation_id) {
    await admin
      .from("shop_reservations")
      .update({ status: "released" })
      .eq("id", row.reservation_id)
      .eq("status", "held");
  }
  const message = declinedMail({ lang: row.lang === "en" ? "en" : "no", number: row.order_number });
  await sendText({ to: row.email, subject: message.subject, text: message.text });
  return { ok: true };
}

export async function reviseShopOrder(
  id: string,
  boxes: number,
  origin: string,
): Promise<{ ok: true } | { ok: false; reason: "unavailable" | "closed" | "same" }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, reason: "unavailable" };
  const row = await loadOrder(admin, id);
  if (!row) return { ok: false, reason: "unavailable" };
  const decision = offerDecision({
    status: asStatus(row.status),
    boxes: row.boxes,
    nextBoxes: boxes,
  });
  if (decision.action === "stop") return { ok: false, reason: decision.reason };
  const token = crypto.randomUUID();
  const updated = await admin
    .from("shop_orders")
    .update({
      status: "offer",
      offer_boxes: boxes,
      offer_total_ore: orderTotalOre(boxes),
      offer_token: token,
    })
    .eq("id", id)
    .in("status", ["received", "quote", "offer"])
    .select("id");
  if (updated.error || !updated.data?.length) return { ok: false, reason: "closed" };
  const message = offerMail({
    lang: row.lang === "en" ? "en" : "no",
    number: row.order_number,
    flavorName: FLAVOR_NAME[row.flavor_slug === "truffle" ? "truffle" : "nduja"],
    boxes,
    totalOre: orderTotalOre(boxes),
    acceptUrl: `${origin}/kjop/tilbud?token=${token}`,
  });
  await sendText({ to: row.email, subject: message.subject, text: message.text });
  return { ok: true };
}

export async function offerByToken(token: string): Promise<ShopOrderRow | null> {
  const admin = await adminClient();
  if (!admin) return null;
  const row = await admin.from("shop_orders").select("*").eq("offer_token", token).maybeSingle();
  if (row.error || !row.data) return null;
  return toView(row.data as DbOrder);
}

export async function acceptShopOffer(
  token: string,
): Promise<
  { ok: true; number: string } | { ok: false; reason: "unavailable" | "closed" | "stock" }
> {
  const admin = await adminClient();
  if (!admin) return { ok: false, reason: "unavailable" };
  await sweepQuiet(admin);
  const found = await admin.from("shop_orders").select("*").eq("offer_token", token).maybeSingle();
  if (found.error || !found.data) return { ok: false, reason: "closed" };
  const row = found.data as DbOrder;
  const shop = await loadPublicShop();
  const stock = shop.flavors.find((flavor) => flavor.slug === row.flavor_slug);
  const existingHold = await reservationOf(admin, row.reservation_id);
  const ownBoxes =
    existingHold && reservationCovers(existingHold, existingHold.pieces, new Date())
      ? Math.floor(existingHold.pieces / PACK_FIFTY)
      : 0;
  const decision = acceptOfferDecision({
    status: asStatus(row.status),
    offerBoxes: row.offer_boxes,
    boxesAvailable: (stock?.boxes50 ?? 0) + ownBoxes,
    fulfillment: asFulfillment(row.fulfillment),
    bindingOpen: shop.ordering.bindingOpen,
  });
  if (decision.action === "stop") return { ok: false, reason: decision.reason };
  const boxes = decision.boxes;
  const pieces = orderPieces(boxes);
  const binding = decision.kind === "binding";
  let reservationId = row.reservation_id;
  let createdHold: string | null = null;
  if (binding) {
    if (!row.product_id) return { ok: false, reason: "unavailable" };
    const existing = await reservationOf(admin, row.reservation_id);
    const covered = existing != null && reservationCovers(existing, pieces, new Date());
    if (covered && existing) {
      reservationId = existing.id;
      await admin
        .from("shop_reservations")
        .update({ pieces, expires_at: holdUntil() })
        .eq("id", existing.id)
        .eq("status", "held");
    } else {
      const previousPieces = existing && existing.status === "held" ? existing.pieces : 0;
      if (existing) {
        await admin
          .from("shop_reservations")
          .update({ status: "released" })
          .eq("id", existing.id)
          .eq("status", "held");
      }
      const reserved = await admin.rpc("reserve_shop_pieces", {
        p_product_id: row.product_id,
        p_pieces: pieces,
        p_physical_pieces:
          (await physicalForReserve(admin, row.product_id, stock?.boxes50 ?? 0)) + previousPieces,
        p_expires_at: holdUntil(),
        p_payment_kind: paymentKind(),
      });
      if (reserved.error || !reserved.data) {
        if (previousPieces > 0) {
          const restored = await admin.rpc("reserve_shop_pieces", {
            p_product_id: row.product_id,
            p_pieces: previousPieces,
            p_physical_pieces:
              (await physicalForReserve(admin, row.product_id, stock?.boxes50 ?? 0)) +
              previousPieces,
            p_expires_at: holdUntil(),
            p_payment_kind: paymentKind(),
          });
          if (restored.data) {
            await admin
              .from("shop_orders")
              .update({ reservation_id: restored.data })
              .eq("id", row.id)
              .eq("status", "offer");
          }
        }
        return { ok: false, reason: "stock" };
      }
      reservationId = reserved.data;
      createdHold = reserved.data;
    }
  }
  const saved = await admin
    .from("shop_orders")
    .update({
      status: binding ? "received" : "quote",
      boxes,
      pieces,
      total_ore: orderTotalOre(boxes),
      binding,
      reservation_id: reservationId,
      expires_at: binding ? holdUntil() : null,
      offer_token: null,
    })
    .eq("id", row.id)
    .eq("status", "offer")
    .eq("offer_token", token)
    .select("id");
  if (saved.error || !saved.data?.length) {
    if (createdHold) {
      await admin
        .from("shop_reservations")
        .update({ status: "released" })
        .eq("id", createdHold)
        .eq("status", "held");
    }
    return { ok: false, reason: "closed" };
  }
  return { ok: true, number: row.order_number };
}
