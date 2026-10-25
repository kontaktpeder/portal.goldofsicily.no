import { PACK_FIFTY, PRICE_FIFTY_ORE, type PaymentKind, type ShopFlavorSlug } from "./shop.ts";

export const SHOP_ORDER_HOLD_HOURS = 48;
export const SHOP_APPROVAL_LOCK_MS = 45_000;
export const SHOP_APPROVED_HOLD_DAYS = 365;
export const PICKUP_PLACE = "Smalgangen 31, 0188 Oslo";

/** Handover is outside the restaurant whose kitchen is rented. */
export function pickupSentence(lang: "no" | "en"): string {
  return lang === "en"
    ? `Pickup is outside ${PICKUP_PLACE}. We meet you outside the restaurant.`
    : `Henting utenfor ${PICKUP_PLACE}. Vi møter deg utenfor restauranten.`;
}

export const SHOP_ORDER_STATUSES = [
  "received",
  "quote",
  "offer",
  "confirming",
  "confirmed",
  "declined",
  "expired",
] as const;
export type ShopOrderStatus = (typeof SHOP_ORDER_STATUSES)[number];

const WAITING_SHOP_ORDER: ReadonlySet<ShopOrderStatus> = new Set([
  "received",
  "quote",
  "offer",
  "confirming",
  "expired",
]);

/** Still needs a person. Confirmed and declined stay off Hjem and Ordrer. */
export function isWaitingShopOrder(status: ShopOrderStatus): boolean {
  return WAITING_SHOP_ORDER.has(status);
}

export type ShopFulfillment = "pickup" | "delivery_request";

export type ShopOrderInput = {
  flavor: ShopFlavorSlug;
  boxes: number;
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  postalCode: string;
  city: string;
  orgNumber: string | null;
  fulfillment: ShopFulfillment;
  lang: "no" | "en";
};

export type OrderKind = "binding" | "quote" | "short";

export function piecePriceOre(): number {
  return PRICE_FIFTY_ORE / PACK_FIFTY;
}

export function orderPieces(boxes: number): number {
  return Math.max(0, Math.floor(boxes)) * PACK_FIFTY;
}

export function orderTotalOre(boxes: number): number {
  return orderPieces(boxes) * piecePriceOre();
}

/** Pickup can bind only when the server setting is open. Delivery stays a request. */
export function classifyShopOrder(input: {
  bindingOpen: boolean;
  fulfillment: ShopFulfillment;
  boxes: number;
  boxesAvailable: number;
}): OrderKind {
  if (!Number.isInteger(input.boxes) || input.boxes < 1) return "short";
  if (input.fulfillment !== "pickup" || !input.bindingOpen) return "quote";
  if (input.boxes > input.boxesAvailable) return "short";
  return "binding";
}

export function parseShopOrder(value: unknown): ShopOrderInput | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const flavor = row["flavor"] === "nduja" || row["flavor"] === "truffle" ? row["flavor"] : null;
  const boxes = typeof row["boxes"] === "number" ? Math.floor(row["boxes"]) : Number.NaN;
  const name = text(row["name"], 80);
  const email = text(row["email"], 255)?.toLowerCase() ?? null;
  const phone = text(row["phone"], 40);
  const addressLine = text(row["addressLine"], 160);
  const postalCode = text(row["postalCode"], 12);
  const city = text(row["city"], 80);
  const orgRaw = text(row["orgNumber"], 20);
  const fulfillment =
    row["fulfillment"] === "pickup" || row["fulfillment"] === "delivery_request"
      ? row["fulfillment"]
      : null;
  const lang = row["lang"] === "en" ? "en" : row["lang"] === "no" ? "no" : null;
  if (!flavor || !Number.isInteger(boxes) || boxes < 1 || boxes > 20) return null;
  if (!name || !email || !email.includes("@") || email.length < 3) return null;
  if (!phone || !addressLine || !postalCode || !city || !fulfillment || !lang) return null;
  const orgNumber = orgRaw ? orgRaw.replace(/\s/g, "") : null;
  if (orgNumber && !/^\d{9}$/.test(orgNumber)) return null;
  return {
    flavor,
    boxes,
    name,
    email,
    phone,
    addressLine,
    postalCode,
    city,
    orgNumber,
    fulfillment,
    lang,
  };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export type ReservationView = {
  id: string;
  status: string;
  pieces: number;
  expiresAt: string;
};

export type ApprovalView = {
  status: ShopOrderStatus;
  binding: boolean;
  fulfillment: ShopFulfillment;
  pieces: number;
  reservation: ReservationView | null;
  customerOrderId: string | null;
  customerId: string | null;
};

export type ApprovalDecision =
  | { action: "already"; customerOrderId: string }
  | { action: "resume" }
  | { action: "claim" }
  | { action: "stop"; reason: "offer" | "closed" | "stock" };

/** One approval. A second click returns the order that was already created. */
export function approvalDecision(order: ApprovalView, now: Date): ApprovalDecision {
  if (order.customerOrderId) return { action: "already", customerOrderId: order.customerOrderId };
  if (order.status === "confirming") return { action: "resume" };
  if (order.status === "offer") return { action: "stop", reason: "offer" };
  if (order.status === "declined" || order.status === "expired" || order.status === "confirmed") {
    return { action: "stop", reason: "closed" };
  }
  if (order.fulfillment !== "pickup") return { action: "stop", reason: "closed" };
  if (order.status !== "received" && order.status !== "quote")
    return { action: "stop", reason: "closed" };
  if (order.binding) {
    if (!reservationCovers(order.reservation, order.pieces, now)) {
      return { action: "stop", reason: "stock" };
    }
  }
  return { action: "claim" };
}

/** A second click waits while the first approval still holds the lock. */
export function approvalLock(input: {
  token: string | null;
  updatedAt: string;
  now: Date;
}): "take" | "wait" {
  if (!input.token) return "take";
  const updated = new Date(input.updatedAt).getTime();
  if (!Number.isFinite(updated)) return "take";
  return input.now.getTime() - updated >= SHOP_APPROVAL_LOCK_MS ? "take" : "wait";
}

export function staffActions(order: {
  status: ShopOrderStatus;
  fulfillment: ShopFulfillment;
  customerOrderId: string | null;
}): { approve: boolean; decline: boolean; offer: boolean } {
  const open =
    order.customerOrderId == null && order.status !== "confirmed" && order.status !== "declined";
  return {
    approve:
      open &&
      order.fulfillment === "pickup" &&
      (order.status === "received" || order.status === "quote" || order.status === "confirming"),
    decline: open && order.status !== "confirming",
    offer:
      open && (order.status === "received" || order.status === "quote" || order.status === "offer"),
  };
}

export function reservationCovers(
  reservation: ReservationView | null,
  pieces: number,
  now: Date,
): boolean {
  if (!reservation || reservation.status !== "held" || reservation.pieces < pieces) return false;
  const expires = new Date(reservation.expiresAt).getTime();
  return Number.isFinite(expires) && expires > now.getTime();
}

export type OfferDecision = { action: "send" } | { action: "stop"; reason: "closed" | "same" };

export function offerDecision(input: {
  status: ShopOrderStatus;
  boxes: number;
  nextBoxes: number;
}): OfferDecision {
  if (input.status !== "received" && input.status !== "quote" && input.status !== "offer") {
    return { action: "stop", reason: "closed" };
  }
  if (!Number.isInteger(input.nextBoxes) || input.nextBoxes < 1 || input.nextBoxes > 20) {
    return { action: "stop", reason: "closed" };
  }
  if (input.nextBoxes === input.boxes && input.status !== "quote")
    return { action: "stop", reason: "same" };
  return { action: "send" };
}

export function acceptOfferDecision(input: {
  status: ShopOrderStatus;
  offerBoxes: number | null;
  boxesAvailable: number;
  fulfillment: ShopFulfillment;
  bindingOpen: boolean;
}):
  | { action: "accept"; kind: OrderKind; boxes: number }
  | { action: "stop"; reason: "closed" | "stock" } {
  if (input.status !== "offer" || input.offerBoxes == null)
    return { action: "stop", reason: "closed" };
  const kind = classifyShopOrder({
    bindingOpen: input.bindingOpen && input.fulfillment === "pickup",
    fulfillment: input.fulfillment,
    boxes: input.offerBoxes,
    boxesAvailable: input.boxesAvailable,
  });
  if (kind === "short") return { action: "stop", reason: "stock" };
  return { action: "accept", kind, boxes: input.offerBoxes };
}

export function receivedMail(input: {
  lang: "no" | "en";
  number: string;
  flavorName: string;
  boxes: number;
  totalOre: number;
  kind: "binding" | "quote";
  fulfillment: ShopFulfillment;
}): { subject: string; text: string } {
  const total = formatOre(input.totalOre);
  const goods = `${input.boxes} eske${input.boxes === 1 ? "" : "r"} · ${input.flavorName}`;
  if (input.lang === "en") {
    const subject = `Received ${input.number}`;
    const text =
      input.kind === "binding"
        ? `${input.number} is received.\n${input.boxes} box${input.boxes === 1 ? "" : "es"} · ${input.flavorName}\n${total}\n${pickupSentence("en")}\nInvoice after delivery.\nThis is not an invoice.`
        : `${input.number} is a request, not an order.\n${input.boxes} box${input.boxes === 1 ? "" : "es"} · ${input.flavorName}\n${total} is the product price. Delivery time and freight are not agreed.\nWe will write if we can take it.`;
    return { subject, text };
  }
  const subject = `Mottatt ${input.number}`;
  const handoff =
    input.fulfillment === "pickup"
      ? pickupSentence("no")
      : "Levering er en forespørsel. Frakt og tid er ikke avtalt.";
  const text =
    input.kind === "binding"
      ? `${input.number} er mottatt.\n${goods}\n${total}\n${handoff}\nFaktura kommer etter levering.\nDette er ikke en faktura.`
      : `${input.number} er en forespørsel, ikke en bestilling.\n${goods}\n${total} er vareprisen.\n${handoff}\nVi skriver hvis vi kan ta den.`;
  return { subject, text };
}

export function confirmedMail(input: {
  lang: "no" | "en";
  number: string;
  flavorName: string;
  boxes: number;
  totalOre: number;
}): { subject: string; text: string } {
  const total = formatOre(input.totalOre);
  if (input.lang === "en") {
    return {
      subject: `Order confirmed ${input.number}`,
      text: `${input.number} is confirmed.\n${input.boxes} box${input.boxes === 1 ? "" : "es"} · ${input.flavorName}\n${total}\n${pickupSentence("en")}\nInvoice follows after delivery. This mail is not an invoice.`,
    };
  }
  return {
    subject: `Ordre bekreftet ${input.number}`,
    text: `${input.number} er bekreftet.\n${input.boxes} eske${input.boxes === 1 ? "" : "r"} · ${input.flavorName}\n${total}\n${pickupSentence("no")}\nFaktura kommer etter levering. Denne e-posten er ikke en faktura.`,
  };
}

export function declinedMail(input: { lang: "no" | "en"; number: string }): {
  subject: string;
  text: string;
} {
  if (input.lang === "en") {
    return {
      subject: `Order declined ${input.number}`,
      text: `${input.number} is declined. Nothing is reserved and nothing will be invoiced.`,
    };
  }
  return {
    subject: `Bestilling avslått ${input.number}`,
    text: `${input.number} er avslått. Ingenting er reservert, og det kommer ingen faktura.`,
  };
}

export function offerMail(input: {
  lang: "no" | "en";
  number: string;
  flavorName: string;
  boxes: number;
  totalOre: number;
  acceptUrl: string;
}): { subject: string; text: string } {
  const total = formatOre(input.totalOre);
  if (input.lang === "en") {
    return {
      subject: `Offer ${input.number}`,
      text: `The terms for ${input.number} changed.\n${input.boxes} box${input.boxes === 1 ? "" : "es"} · ${input.flavorName}\n${total}\n${pickupSentence("en")}\nInvoice after delivery.\nAccept before it becomes an order: ${input.acceptUrl}`,
    };
  }
  return {
    subject: `Tilbud ${input.number}`,
    text: `Vilkårene for ${input.number} er endret.\n${input.boxes} eske${input.boxes === 1 ? "" : "r"} · ${input.flavorName}\n${total}\n${pickupSentence("no")}\nFaktura etter levering.\nGodta før den blir en bestilling: ${input.acceptUrl}`,
  };
}

export function formatOre(ore: number): string {
  const kroner = Math.round(ore / 100);
  const body = Math.abs(kroner)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${body} kr`;
}

export function paymentKind(): PaymentKind {
  return "invoice";
}
