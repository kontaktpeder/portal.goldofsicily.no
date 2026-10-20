export const ORDER_WORKFLOW = [
  "draft",
  "pending_confirmation",
  "changes_requested",
  "confirmed",
  "cancelled",
] as const;
export type OrderWorkflow = (typeof ORDER_WORKFLOW)[number];

export type OrderProgress = OrderWorkflow | "partially_delivered" | "delivered";

export type CommercialRoute = "direct" | "via_wholesaler";

export function remainingQuantity(ordered: number, fulfilled: number): number {
  return Math.max(0, ordered - fulfilled);
}

/** Delivery progress is a fact of linked quantity. Workflow status stays on the order. */
export function orderProgress(
  status: OrderWorkflow,
  ordered: number,
  fulfilled: number,
): OrderProgress {
  if (status !== "confirmed") return status;
  if (fulfilled <= 0) return "confirmed";
  if (fulfilled < ordered) return "partially_delivered";
  return "delivered";
}

export function canCancelOrder(status: OrderWorkflow, fulfilled: number): boolean {
  return status !== "cancelled" && fulfilled <= 0;
}

/** One button follows the role. Approval never notifies the customer. */
export function orderPrimaryAction(canApprove: boolean): "approve" | "submit" {
  return canApprove ? "approve" : "submit";
}

export type OrderListBucket = "queue" | "deliver" | "working" | "earlier";

/** Waiting, still to deliver, drafts under work, then finished orders. */
export function orderListBucket(progress: OrderProgress): OrderListBucket {
  if (progress === "pending_confirmation") return "queue";
  if (progress === "confirmed" || progress === "partially_delivered") return "deliver";
  if (progress === "delivered" || progress === "cancelled") return "earlier";
  return "working";
}

const LIST_RANK: Record<OrderProgress, number> = {
  pending_confirmation: 0,
  changes_requested: 1,
  draft: 2,
  confirmed: 3,
  partially_delivered: 4,
  delivered: 5,
  cancelled: 6,
};

export function orderListRank(progress: OrderProgress): number {
  return LIST_RANK[progress];
}

const MONTHS_NO = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
] as const;

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Agreed delivery as Denis should read it: 25. oktober. */
export function formatAgreedDelivery(value: string, lang: "no" | "en"): string {
  const iso = value.slice(0, 10);
  const [yearText, monthText, dayText] = iso.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const monthName = (lang === "en" ? MONTHS_EN : MONTHS_NO)[month - 1];
  if (!year || !monthName || !day) return "—";
  const thisYear = new Date().getFullYear();
  if (lang === "en") {
    return year === thisYear ? `${day} ${monthName}` : `${day} ${monthName} ${year}`;
  }
  return year === thisYear ? `${day}. ${monthName}` : `${day}. ${monthName} ${year}`;
}

export type OrderDeliveryLine = {
  orderLineId: string;
  productId: string;
  quantity: number;
  goldLotId: string;
};

/** Delivery from an order fills the site and the order link. Denis only enters quantity and LOT. */
export function orderDeliveryDraft(input: {
  shipToCustomerId: string;
  orderNumber: string;
  lines: readonly OrderDeliveryLine[];
}): { customerId: string; note: string; quantity: number; lines: OrderDeliveryLine[] } {
  const lines = input.lines.filter((line) => line.quantity > 0 && line.goldLotId);
  return {
    customerId: input.shipToCustomerId,
    note: input.orderNumber,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    lines,
  };
}

export function isOrderSchemaError(message: string): boolean {
  return /customer_orders|customer_order_status|approved_name_snapshot|submitted_name_snapshot|return_note|changes_requested|register_order_delivery|order_delivery_requests|follow_up_on|order_invoice_lines|registered_name_snapshot|dnb_paid_on|advance_percent|order_advance|prepare_order_advance|dnb_total_ore|payments_checked_at|surplus_ore|confirmed_ore/.test(
    message,
  );
}

/** A suggestion only. Denis still types the quantity that was actually handed over. */
export function suggestedDeliveryQuantity(remaining: number, lotAvailable: number): number {
  if (remaining <= 0 || lotAvailable <= 0) return 0;
  return Math.min(Math.floor(remaining), Math.floor(lotAvailable));
}

/** Free quantity on an existing delivery line, after links and a legacy invoice. */
export function linkableQuantity(
  delivered: number,
  alreadyLinked: number,
  legacyInvoiced: number,
): number {
  return Math.max(0, delivered - alreadyLinked - legacyInvoiced);
}

export type DeliveryErrorKind =
  "schema" | "stock" | "lot" | "site" | "quantity" | "driver" | "other";

export function deliveryErrorKind(message: string): DeliveryErrorKind {
  if (
    /register_order_delivery|order_delivery_requests|submitted_name_snapshot|follow_up_on|schema cache|PGRST202/i.test(
      message,
    )
  ) {
    return "schema";
  }
  if (/delivery driver is missing|delivery driver must be staff/i.test(message)) return "driver";
  if (/does not match the order/i.test(message)) return "site";
  if (/ikke nok|not enough|insufficient|villa stock is short/i.test(message)) return "stock";
  if (/gold_lot|requires gold_lot|ikke åpen|not open/i.test(message)) return "lot";
  if (/exceeds|overlaps|quantity is missing|already approved/i.test(message)) return "quantity";
  return "other";
}

export function orderPartyLabel(input: {
  ordererName: string;
  shipToName: string;
  contactName: string | null;
}): { contact: string | null; site: string | null } {
  const contact = input.contactName?.trim() || null;
  const sameSite = input.ordererName.trim() === input.shipToName.trim();
  return { contact, site: sameSite ? null : input.shipToName };
}

export type FulfillmentCheck = {
  orderStatus: OrderWorkflow;
  ordered: number;
  alreadyFulfilled: number;
  delivered: number;
  alreadyOnDelivery: number;
  legacyInvoiced: number;
  quantity: number;
  sameProduct: boolean;
  sameSite: boolean;
};

export function fulfillmentBlock(input: FulfillmentCheck): string | null {
  if (input.orderStatus !== "confirmed") return "only a confirmed order can be delivered";
  if (!input.sameProduct) return "order line and delivery line must be the same product";
  if (!input.sameSite) return "delivery site does not match the order";
  if (input.quantity <= 0) return "fulfillment quantity is missing";
  if (input.alreadyFulfilled + input.quantity > input.ordered)
    return "fulfillment exceeds ordered quantity";
  if (input.alreadyOnDelivery + input.quantity > input.delivered)
    return "fulfillment exceeds delivered quantity";
  if (input.alreadyOnDelivery + input.quantity + input.legacyInvoiced > input.delivered) {
    return "fulfillment overlaps an invoice";
  }
  return null;
}

export type StockOnHand = {
  productId: string;
  available: number;
  atVilla: number;
};

export type ConfirmedNeed = {
  productId: string;
  ordered: number;
  fulfilled: number;
  confirmed: boolean;
};

export type ProductionNeed = {
  productId: string;
  remaining: number;
  onHand: number;
  shortfall: number;
};

export function productionNeed(
  lines: readonly ConfirmedNeed[],
  stock: readonly StockOnHand[],
): ProductionNeed[] {
  const remainingByProduct = new Map<string, number>();
  for (const line of lines) {
    if (!line.confirmed) continue;
    const remaining = remainingQuantity(line.ordered, line.fulfilled);
    remainingByProduct.set(
      line.productId,
      (remainingByProduct.get(line.productId) ?? 0) + remaining,
    );
  }
  const stockByProduct = new Map(stock.map((row) => [row.productId, row.available + row.atVilla]));
  return [...remainingByProduct.entries()]
    .map(([productId, remaining]) => {
      const onHand = stockByProduct.get(productId) ?? 0;
      return {
        productId,
        remaining,
        onHand,
        shortfall: Math.max(0, remaining - onHand),
      };
    })
    .filter((row) => row.remaining > 0)
    .sort((a, b) => b.shortfall - a.shortfall || b.remaining - a.remaining);
}

export type DeskDelivery = {
  deliveryLineId: string;
  quantity: number;
  unitPriceOre: number | null;
  commercialRoute: CommercialRoute;
  billingLegalEntityId: string | null;
};

export type DeskFulfillment = {
  id: string;
  deliveryLineId: string;
  quantity: number;
  unitPriceOre: number;
  billingLegalEntityId: string;
};

export type ActiveInvoiceSlice = {
  deliveryLineId: string;
  fulfillmentId: string | null;
  quantity: number;
};

export type OrderInvoicePortion = DeskFulfillment;

export type LegacyInvoicePortion = {
  deliveryLineId: string;
  quantity: number;
  unitPriceOre: number;
  billingLegalEntityId: string;
};

export function orderInvoicePortions(
  fulfillments: readonly DeskFulfillment[],
  invoiced: readonly ActiveInvoiceSlice[],
): OrderInvoicePortion[] {
  const done = new Set(invoiced.flatMap((row) => (row.fulfillmentId ? [row.fulfillmentId] : [])));
  return fulfillments.filter(
    (row) => row.quantity > 0 && row.unitPriceOre > 0 && !done.has(row.id),
  );
}

export function legacyInvoicePortions(
  deliveries: readonly DeskDelivery[],
  fulfillments: readonly { deliveryLineId: string; quantity: number }[],
  invoiced: readonly ActiveInvoiceSlice[],
): LegacyInvoicePortion[] {
  const legacyDone = new Set(
    invoiced.flatMap((row) => (row.fulfillmentId ? [] : [row.deliveryLineId])),
  );
  const fulfilledByLine = new Map<string, number>();
  for (const row of fulfillments) {
    fulfilledByLine.set(
      row.deliveryLineId,
      (fulfilledByLine.get(row.deliveryLineId) ?? 0) + row.quantity,
    );
  }
  const portions: LegacyInvoicePortion[] = [];
  for (const line of deliveries) {
    if (line.commercialRoute !== "direct") continue;
    if (line.unitPriceOre == null || line.unitPriceOre <= 0) continue;
    if (!line.billingLegalEntityId) continue;
    if (legacyDone.has(line.deliveryLineId)) continue;
    const quantity = line.quantity - (fulfilledByLine.get(line.deliveryLineId) ?? 0);
    if (quantity <= 0) continue;
    portions.push({
      deliveryLineId: line.deliveryLineId,
      quantity,
      unitPriceOre: line.unitPriceOre,
      billingLegalEntityId: line.billingLegalEntityId,
    });
  }
  return portions;
}

export function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function osloToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(now);
}

/** Agreed delivery is "soon" inside this many days, then due today, then late. */
export const DELIVERY_APPROACHING_DAYS = 2;

export type DatedNotice = "late" | "today" | "approaching";

function dateBucket(on: string, today: string): DatedNotice | null {
  const day = on.slice(0, 10);
  const now = today.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}-\d{2}$/.test(now)) return null;
  if (day < now) return "late";
  if (day === now) return "today";
  if (day <= addIsoDays(now, DELIVERY_APPROACHING_DAYS)) return "approaching";
  return null;
}

/** In-portal reminder for the order owner. It stops when nothing remains to deliver. */
export function deliveryNotice(input: {
  agreedOn: string | null;
  today: string;
  remaining: number;
}): DatedNotice | null {
  if (input.remaining <= 0 || !input.agreedOn) return null;
  return dateBucket(input.agreedOn, input.today);
}

/** A follow-up is a concrete note plus a date. A bare date is not a notice. */
export function followUpNotice(input: {
  followUpOn: string | null;
  followUpNote: string | null;
  today: string;
}): { on: string; note: string; state: DatedNotice } | null {
  const note = input.followUpNote?.trim() ?? "";
  if (!note || !input.followUpOn) return null;
  const state = dateBucket(input.followUpOn, input.today);
  if (!state) return null;
  return { on: input.followUpOn.slice(0, 10), note, state };
}

export type OrderNoticeRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  ownerId: string | null;
  agreedOn: string | null;
  remaining: number;
  followUpOn: string | null;
  followUpNote: string | null;
};

export function visibleOrderNotices(input: {
  today: string;
  viewerId: string | null;
  viewerIsLead: boolean;
  orders: readonly OrderNoticeRow[];
}): {
  deliveries: (OrderNoticeRow & { state: DatedNotice })[];
  followUps: (OrderNoticeRow & { note: string; on: string; state: DatedNotice })[];
} {
  const deliveries: (OrderNoticeRow & { state: DatedNotice })[] = [];
  const followUps: (OrderNoticeRow & { note: string; on: string; state: DatedNotice })[] = [];
  for (const order of input.orders) {
    const visible =
      input.viewerIsLead || (input.viewerId != null && order.ownerId === input.viewerId);
    if (!visible) continue;
    const state = deliveryNotice({
      agreedOn: order.agreedOn,
      today: input.today,
      remaining: order.remaining,
    });
    if (state) deliveries.push({ ...order, state });
    const follow = followUpNotice({
      followUpOn: order.followUpOn,
      followUpNote: order.followUpNote,
      today: input.today,
    });
    if (follow) followUps.push({ ...order, note: follow.note, on: follow.on, state: follow.state });
  }
  return { deliveries, followUps };
}

export type OrderInvoiceLine = {
  draftId: string;
  status: string;
  transferStatus: string;
  dnbStatus: string | null;
  accountingInvoiceId: string | null;
  invoiceNumber: string | null;
  dueOn: string | null;
  paidOn: string | null;
  /** Present only when DNB reported them on the goods draft. */
  dnbTotalOre?: number | null;
  dnbRestOre?: number | null;
  dnbVatOre?: number | null;
  fulfillmentId: string;
  quantity: number;
  unitPriceOre: number;
  active: boolean;
};

export type OrderInvoiceStep =
  | { kind: "prepare"; fulfillmentIds: readonly string[] }
  | { kind: "append"; draftId: string; fulfillmentIds: readonly string[] }
  | { kind: "transfer"; draftId: string; transferStatus: string }
  | {
      kind: "open_dnb";
      draftId: string;
      invoiceId: string | null;
      dnbStatus: string | null;
      transferStatus: string;
      invoiceNumber: string | null;
    }
  | {
      kind: "sent";
      draftId: string;
      invoiceNumber: string | null;
      amountOre: number | null;
      dueOn: string | null;
    }
  | {
      kind: "paid";
      draftId: string;
      paidOn: string | null;
      invoiceNumber: string | null;
      amountOre: number | null;
    };

export type OrderInvoicePlan = {
  action: OrderInvoiceStep | null;
  placement: "primary" | "secondary";
  earlier: readonly OrderInvoiceStep[];
};

type InvoiceDraftBucket = {
  id: string;
  status: string;
  transferStatus: string;
  dnbStatus: string | null;
  accountingInvoiceId: string | null;
  invoiceNumber: string | null;
  dueOn: string | null;
  paidOn: string | null;
  fulfillmentIds: string[];
  amountOre: number;
};

function groupInvoiceDrafts(lines: readonly OrderInvoiceLine[]): InvoiceDraftBucket[] {
  const order: string[] = [];
  const map = new Map<string, InvoiceDraftBucket>();
  for (const line of lines) {
    if (!line.active) continue;
    if (line.status === "cancelled" || line.status === "credited") continue;
    const existing = map.get(line.draftId);
    const bucket: InvoiceDraftBucket = existing ?? {
      id: line.draftId,
      status: line.status,
      transferStatus: line.transferStatus,
      dnbStatus: line.dnbStatus,
      accountingInvoiceId: line.accountingInvoiceId,
      invoiceNumber: line.invoiceNumber,
      dueOn: line.dueOn,
      paidOn: line.paidOn,
      fulfillmentIds: [],
      amountOre: 0,
    };
    if (!existing) {
      map.set(line.draftId, bucket);
      order.push(line.draftId);
    }
    if (!bucket.fulfillmentIds.includes(line.fulfillmentId)) {
      bucket.fulfillmentIds.push(line.fulfillmentId);
    }
    bucket.amountOre += line.quantity * line.unitPriceOre;
  }
  return order.flatMap((id) => {
    const bucket = map.get(id);
    return bucket ? [bucket] : [];
  });
}

function classifyDraft(draft: InvoiceDraftBucket): OrderInvoiceStep {
  const amountOre = draft.amountOre > 0 ? draft.amountOre : null;
  if (draft.dnbStatus === "paid") {
    return {
      kind: "paid",
      draftId: draft.id,
      paidOn: draft.paidOn,
      invoiceNumber: draft.invoiceNumber,
      amountOre,
    };
  }
  if (
    draft.dnbStatus === "issued" ||
    draft.dnbStatus === "partly_paid" ||
    draft.status === "sent"
  ) {
    return {
      kind: "sent",
      draftId: draft.id,
      invoiceNumber: draft.invoiceNumber,
      amountOre,
      dueOn: draft.dueOn,
    };
  }
  if (draft.transferStatus === "transferred") {
    return {
      kind: "open_dnb",
      draftId: draft.id,
      invoiceId: draft.accountingInvoiceId,
      dnbStatus: draft.dnbStatus,
      transferStatus: draft.transferStatus,
      invoiceNumber: draft.invoiceNumber,
    };
  }
  return { kind: "transfer", draftId: draft.id, transferStatus: draft.transferStatus };
}

function basisCanTakeLines(draft: InvoiceDraftBucket): boolean {
  return (
    draft.status === "draft" &&
    draft.transferStatus !== "transferred" &&
    draft.dnbStatus !== "issued" &&
    draft.dnbStatus !== "partly_paid" &&
    draft.dnbStatus !== "paid"
  );
}

/**
 * The next invoice job for one order.
 * An open basis is reused. A second draft is only started when nothing open can take the lines.
 */
export function orderInvoiceSteps(input: {
  remaining: number;
  fulfillmentIds: readonly string[];
  lines: readonly OrderInvoiceLine[];
}): OrderInvoicePlan {
  const drafts = groupInvoiceDrafts(input.lines);
  const covered = new Set(drafts.flatMap((draft) => draft.fulfillmentIds));
  const uninvoiced = input.fulfillmentIds.filter((id) => !covered.has(id));
  const steps = drafts.map(classifyDraft);
  const open = drafts.find(basisCanTakeLines) ?? null;

  let action: OrderInvoiceStep | null = null;
  if (uninvoiced.length > 0 && open) {
    const missing = uninvoiced.filter((id) => !open.fulfillmentIds.includes(id));
    action =
      missing.length > 0
        ? { kind: "append", draftId: open.id, fulfillmentIds: missing }
        : { kind: "transfer", draftId: open.id, transferStatus: open.transferStatus };
  } else if (uninvoiced.length > 0) {
    action = { kind: "prepare", fulfillmentIds: uninvoiced };
  } else {
    action =
      steps.find((step) => step.kind === "transfer" || step.kind === "open_dnb") ??
      steps.find((step) => step.kind === "sent") ??
      steps.find((step) => step.kind === "paid") ??
      null;
  }

  if (input.remaining > 0 && action && (action.kind === "paid" || action.kind === "sent")) {
    action = null;
  }

  const actionId = action && "draftId" in action ? action.draftId : null;
  const earlier = steps.filter((step) => !("draftId" in step) || step.draftId !== actionId);

  return {
    action,
    placement: input.remaining > 0 ? "secondary" : "primary",
    earlier,
  };
}

/**
 * The goods invoice does not wait for an advance.
 * A saved advance only changes the final label.
 */
export function goodsInvoicePrepareLabel(input: {
  remaining: number;
  hasAdvanceClaim: boolean;
}): "orders_prepare_invoice" | "orders_prepare_settlement" | "orders_invoice_delivered" {
  if (input.remaining > 0) return "orders_invoice_delivered";
  if (input.hasAdvanceClaim) return "orders_prepare_settlement";
  return "orders_prepare_invoice";
}

export function dnbDocumentKey(
  dnbStatus: string | null,
  transferStatus: string,
):
  | "dnb_waiting"
  | "dnb_issued"
  | "dnb_partly_paid"
  | "dnb_paid"
  | "dnb_credited"
  | "dnb_failed"
  | "dnb_needs_review"
  | "dnb_queued"
  | "dnb_not_transferred" {
  if (transferStatus === "failed") return "dnb_failed";
  if (transferStatus === "needs_review") return "dnb_needs_review";
  if (transferStatus === "queued") return "dnb_queued";
  if (dnbStatus === "issued") return "dnb_issued";
  if (dnbStatus === "partly_paid") return "dnb_partly_paid";
  if (dnbStatus === "paid") return "dnb_paid";
  if (dnbStatus === "credited") return "dnb_credited";
  if (transferStatus === "transferred") return "dnb_waiting";
  return "dnb_not_transferred";
}
