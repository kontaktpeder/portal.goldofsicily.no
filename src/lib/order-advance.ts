/** Commercial advance on the order. Claimed is never the same fact as paid. */

export function agreedAdvanceOre(basisOre: number, percent: number): number {
  if (!Number.isFinite(basisOre) || !Number.isFinite(percent)) return 0;
  if (basisOre <= 0 || percent <= 0 || percent > 100) return 0;
  return Math.round((basisOre * percent) / 100);
}

export function orderBasisOre(
  lines: readonly { quantity: number; unitPriceOre: number | null }[],
): number | null {
  if (lines.length === 0) return null;
  let sum = 0;
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    if (line.unitPriceOre == null || line.unitPriceOre <= 0) return null;
    sum += line.quantity * line.unitPriceOre;
  }
  return sum > 0 ? sum : null;
}

export type AdvancePayment = {
  amountOre: number;
  paidOn: string | null;
};

/**
 * Dated payments win. A single DNB balance is not split into installments,
 * and it is not added on top of the payment rows.
 */
export function receivedAdvance(input: {
  paymentChecked: boolean;
  payments: readonly AdvancePayment[];
  dnbReceivedOre: number | null;
}): { amountOre: number | null; from: "payments" | "dnb" | "none" | "unchecked" } {
  if (!input.paymentChecked) return { amountOre: null, from: "unchecked" };
  if (input.payments.length > 0) {
    return {
      amountOre: input.payments.reduce((sum, payment) => sum + payment.amountOre, 0),
      from: "payments",
    };
  }
  if (input.dnbReceivedOre != null) return { amountOre: input.dnbReceivedOre, from: "dnb" };
  return { amountOre: null, from: "none" };
}

/**
 * What is still open on the advance.
 * A missing check is null. Zero is only used after DNB has reported a number.
 */
export function outstandingAdvance(input: {
  paymentChecked: boolean;
  claimedOre: number | null;
  receivedOre: number | null;
  dnbRestOre: number | null;
}): number | null {
  if (!input.paymentChecked || input.claimedOre == null) return null;
  if (input.dnbRestOre != null) return Math.max(0, input.dnbRestOre);
  if (input.receivedOre == null) return null;
  return Math.max(0, input.claimedOre - input.receivedOre);
}

export type SettlementView = {
  percent: number;
  basisOre: number;
  agreedOre: number;
  claimedOre: number | null;
  paymentChecked: boolean;
  receivedOre: number | null;
  receivedFrom: "payments" | "dnb" | "none" | "unchecked";
  /** Local plan. This is not proof that DNB applied the advance. */
  plannedOre: number | null;
  /** Null until DNB has been read. Zero means DNB listed no linked application. */
  confirmedOre: number | null;
  surplusOre: number | null;
  previouslyInvoicedOre: number;
  outstandingOre: number | null;
  /** Present only when DNB has reported the settlement. Not derived here. */
  vatOre: number | null;
  totalOre: number | null;
  remainingOre: number | null;
};

export function settlementView(input: {
  percent: number;
  basisOre: number;
  agreedOre: number;
  claimedOre: number | null;
  paymentChecked: boolean;
  payments: readonly AdvancePayment[];
  dnbReceivedOre: number | null;
  dnbRestOre: number | null;
  finalClaimOre: number | null;
  alreadyPlannedOre: number;
  storedSurplusOre: number | null;
  confirmedOre: number | null;
  previouslyInvoicedOre: number;
  vatOre: number | null;
  totalOre: number | null;
  remainingOre: number | null;
}): SettlementView {
  const received = receivedAdvance({
    paymentChecked: input.paymentChecked,
    payments: input.payments,
    dnbReceivedOre: input.dnbReceivedOre,
  });
  const plan = finalOffsetPlan({
    paymentChecked: input.paymentChecked,
    receivedOre: received.amountOre,
    finalClaimOre: input.finalClaimOre,
    alreadyPlannedOre: input.alreadyPlannedOre,
    storedSurplusOre: input.storedSurplusOre,
  });
  return {
    percent: input.percent,
    basisOre: input.basisOre,
    agreedOre: input.agreedOre,
    claimedOre: input.claimedOre,
    paymentChecked: input.paymentChecked,
    receivedOre: received.amountOre,
    receivedFrom: received.from,
    plannedOre: plan.plannedOre,
    confirmedOre: input.confirmedOre,
    surplusOre: plan.surplusOre,
    previouslyInvoicedOre: input.previouslyInvoicedOre,
    outstandingOre: outstandingAdvance({
      paymentChecked: input.paymentChecked,
      claimedOre: input.claimedOre,
      receivedOre: received.amountOre,
      dnbRestOre: input.dnbRestOre,
    }),
    vatOre: input.vatOre,
    totalOre: input.totalOre,
    remainingOre: input.remainingOre,
  };
}

/**
 * Caps the unused advance at this settlement's own goods.
 * Surplus stays visible and is not offered to a later draft.
 */
export function finalOffsetPlan(input: {
  paymentChecked: boolean;
  receivedOre: number | null;
  finalClaimOre: number | null;
  alreadyPlannedOre: number;
  storedSurplusOre: number | null;
}): { unusedOre: number | null; plannedOre: number | null; surplusOre: number | null } {
  if (!input.paymentChecked || input.receivedOre == null) {
    return { unusedOre: null, plannedOre: null, surplusOre: input.storedSurplusOre };
  }
  const unused = Math.max(
    0,
    input.receivedOre - input.alreadyPlannedOre - (input.storedSurplusOre ?? 0),
  );
  if (input.storedSurplusOre != null) {
    const claim = input.finalClaimOre == null ? null : Math.max(0, input.finalClaimOre);
    return {
      unusedOre: unused,
      plannedOre: claim == null ? null : Math.min(unused, claim),
      surplusOre: input.storedSurplusOre,
    };
  }
  if (input.finalClaimOre == null) return { unusedOre: unused, plannedOre: null, surplusOre: null };
  const claim = Math.max(0, input.finalClaimOre);
  const planned = Math.min(unused, claim);
  return { unusedOre: unused, plannedOre: planned, surplusOre: unused - planned };
}

/** Previously invoiced goods stay out of the final claim. */
export function settlementClaims(
  lines: readonly {
    fulfillmentId: string;
    quantity: number;
    unitPriceOre: number;
    active: boolean;
  }[],
  finalFulfillmentIds: readonly string[],
): { previouslyInvoicedOre: number; finalClaimOre: number } {
  const finalIds = new Set(finalFulfillmentIds);
  let previouslyInvoicedOre = 0;
  let finalClaimOre = 0;
  for (const line of lines) {
    if (!line.active) continue;
    const amount = line.quantity * line.unitPriceOre;
    if (finalIds.has(line.fulfillmentId)) finalClaimOre += amount;
    else previouslyInvoicedOre += amount;
  }
  return { previouslyInvoicedOre, finalClaimOre };
}

/** How much of the received advance can still be applied. Never uses the claimed amount. */
export function offsetAmount(input: {
  receivedOre: number;
  alreadyOffsetOre: number;
  settlementHasOffset: boolean;
}): number {
  if (input.settlementHasOffset) return 0;
  return Math.max(0, input.receivedOre - input.alreadyOffsetOre);
}

export type OrderWorkAction =
  | { kind: "prepare_advance" }
  | { kind: "check_advance"; invoiceId: string | null }
  | { kind: "open_advance"; invoiceId: string | null; outstandingOre: number }
  | { kind: "register_delivery" }
  | { kind: "prepare_settlement" }
  | { kind: "open_settlement"; invoiceId: string | null }
  | { kind: "invoice_delivered" };

export function orderWorkActions(input: {
  confirmed: boolean;
  remaining: number;
  ordered: number;
  hasAdvanceAgreement: boolean;
  claimPrepared: boolean;
  paymentChecked: boolean;
  advanceInvoiceId: string | null;
  advanceOutstandingOre: number | null;
  uninvoicedDelivered: number;
  settlementInDnb: boolean;
  settlementInvoiceId: string | null;
}): {
  goods: OrderWorkAction | null;
  advance: OrderWorkAction | null;
  final: OrderWorkAction | null;
  partial: OrderWorkAction | null;
} {
  const goods =
    input.confirmed && input.remaining > 0 ? ({ kind: "register_delivery" } as const) : null;

  let advance: OrderWorkAction | null = null;
  if (input.confirmed && input.hasAdvanceAgreement && !input.claimPrepared) {
    advance = { kind: "prepare_advance" };
  } else if (input.claimPrepared && !input.paymentChecked) {
    advance = { kind: "check_advance", invoiceId: input.advanceInvoiceId };
  } else if (
    input.claimPrepared &&
    input.advanceOutstandingOre != null &&
    input.advanceOutstandingOre > 0
  ) {
    advance = {
      kind: "open_advance",
      invoiceId: input.advanceInvoiceId,
      outstandingOre: input.advanceOutstandingOre,
    };
  }

  let final: OrderWorkAction | null = null;
  if (input.confirmed && input.ordered > 0 && input.remaining === 0) {
    final = input.settlementInDnb
      ? { kind: "open_settlement", invoiceId: input.settlementInvoiceId }
      : { kind: "prepare_settlement" };
  }

  const partial =
    input.confirmed && input.remaining > 0 && input.uninvoicedDelivered > 0
      ? ({ kind: "invoice_delivered" } as const)
      : null;

  return { goods, advance, final, partial };
}

/** Goods-invoice figures DNB has already reported. Missing fields stay missing. */
export function goodsDnbFigures(
  lines: readonly {
    draftId?: string;
    dnbTotalOre?: number | null;
    dnbRestOre?: number | null;
    dnbVatOre?: number | null;
  }[],
): { vatOre: number | null; totalOre: number | null; remainingOre: number | null } {
  const draftId = lines[0]?.draftId;
  const scoped =
    draftId == null
      ? lines
      : lines.filter((line) => line.draftId == null || line.draftId === draftId);
  const line = scoped.find(
    (item) => item.dnbVatOre != null || item.dnbTotalOre != null || item.dnbRestOre != null,
  );
  return {
    vatOre: line?.dnbVatOre ?? null,
    totalOre: line?.dnbTotalOre ?? null,
    remainingOre: line?.dnbRestOre ?? null,
  };
}
