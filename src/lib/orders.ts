export const ORDER_WORKFLOW = ["draft", "pending_confirmation", "confirmed", "cancelled"] as const;
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
