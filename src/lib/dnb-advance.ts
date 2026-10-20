import { kronerToOre, remotePaidOn } from "./dnb-invoice.ts";
import {
  finalOffsetPlan,
  settlementClaims,
  settlementView,
  type AdvancePayment,
} from "./order-advance.ts";

export type RemotePayment = {
  externalId: string;
  amountOre: number;
  paidOn: string | null;
  /** Set when DNB ties the payment to another document, such as the advance invoice. */
  sourceInvoiceId: string | null;
};

export type InvoiceMoney = {
  id: string;
  invoiceNumber: string | null;
  totalOre: number | null;
  restOre: number | null;
  vatOre: number | null;
  /** Null when the payload had no payment collection. An empty list means DNB listed none. */
  payments: RemotePayment[] | null;
};

export type AdvanceCheck = {
  checked: boolean;
  payments: AdvancePayment[];
  externalPayments: { externalId: string; amountOre: number; paidOn: string | null }[];
  dnbReceivedOre: number | null;
  dnbRestOre: number | null;
  dnbTotalOre: number | null;
  dnbVatOre: number | null;
  hasRest: boolean;
  hasTotal: boolean;
  hasVat: boolean;
  useBalance: boolean;
};

const SOURCE_KEYS = ["SourceCustomerInvoiceID", "PrepaidInvoiceID", "AdvanceInvoiceID"] as const;

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function paymentsFromPayload(value: unknown): RemotePayment[] | null {
  if (!Array.isArray(value)) return null;
  const payments: RemotePayment[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const amountKr = numberOrNull(record["Amount"]) ?? numberOrNull(record["AmountCurrency"]);
    const amountOre = kronerToOre(amountKr);
    const externalId = textOrNull(record["ID"]);
    if (amountOre == null || amountOre <= 0 || !externalId) continue;
    let sourceInvoiceId: string | null = null;
    for (const key of SOURCE_KEYS) {
      const source = textOrNull(record[key]);
      if (source) {
        sourceInvoiceId = source;
        break;
      }
    }
    payments.push({
      externalId,
      amountOre,
      paidOn: remotePaidOn(record["PaymentDate"]),
      sourceInvoiceId,
    });
  }
  return payments;
}

export function invoiceMoneyFromPayload(payload: unknown): InvoiceMoney | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = textOrNull(record["ID"]);
  if (!id) return null;
  const vatKr = numberOrNull(record["VatAmount"]) ?? numberOrNull(record["TaxAmount"]);
  const payments = Object.prototype.hasOwnProperty.call(record, "Payments")
    ? paymentsFromPayload(record["Payments"])
    : null;
  return {
    id,
    invoiceNumber: textOrNull(record["InvoiceNumber"]),
    totalOre: kronerToOre(numberOrNull(record["TaxInclusiveAmount"])),
    restOre: kronerToOre(numberOrNull(record["RestAmount"])),
    vatOre: kronerToOre(vatKr),
    payments,
  };
}

/** A balance is used only when DNB did not list payment rows. Rows are never invented. */
export function interpretAdvanceCheck(invoice: InvoiceMoney | null): AdvanceCheck {
  const empty: AdvanceCheck = {
    checked: false,
    payments: [],
    externalPayments: [],
    dnbReceivedOre: null,
    dnbRestOre: null,
    dnbTotalOre: null,
    dnbVatOre: null,
    hasRest: false,
    hasTotal: false,
    hasVat: false,
    useBalance: false,
  };
  if (!invoice) return empty;
  const hasRest = invoice.restOre != null;
  const hasTotal = invoice.totalOre != null;
  const hasVat = invoice.vatOre != null;
  if (invoice.payments && invoice.payments.length > 0) {
    return {
      checked: true,
      payments: invoice.payments.map((payment) => ({
        amountOre: payment.amountOre,
        paidOn: payment.paidOn,
      })),
      externalPayments: invoice.payments.map((payment) => ({
        externalId: payment.externalId,
        amountOre: payment.amountOre,
        paidOn: payment.paidOn,
      })),
      dnbReceivedOre: null,
      dnbRestOre: invoice.restOre,
      dnbTotalOre: invoice.totalOre,
      dnbVatOre: invoice.vatOre,
      hasRest,
      hasTotal,
      hasVat,
      useBalance: false,
    };
  }
  if (
    hasRest &&
    hasTotal &&
    invoice.restOre != null &&
    invoice.totalOre != null &&
    invoice.restOre <= invoice.totalOre
  ) {
    return {
      checked: true,
      payments: [],
      externalPayments: [],
      dnbReceivedOre: invoice.totalOre - invoice.restOre,
      dnbRestOre: invoice.restOre,
      dnbTotalOre: invoice.totalOre,
      dnbVatOre: invoice.vatOre,
      hasRest,
      hasTotal,
      hasVat,
      useBalance: true,
    };
  }
  return {
    ...empty,
    dnbRestOre: invoice.restOre,
    dnbTotalOre: invoice.totalOre,
    dnbVatOre: invoice.vatOre,
    hasRest,
    hasTotal,
    hasVat,
  };
}

/**
 * Confirmed only when the settlement document lists a payment tied to the advance.
 * Any other payment, or a missing payment list, is not that confirmation.
 */
export function confirmedAdvanceUse(input: {
  settlement: InvoiceMoney | null;
  advanceInvoiceId: string;
  plannedOre: number;
}): number | null {
  if (!input.settlement || input.settlement.payments == null) return null;
  const linked = input.settlement.payments
    .filter((payment) => payment.sourceInvoiceId === input.advanceInvoiceId)
    .reduce((sum, payment) => sum + payment.amountOre, 0);
  return Math.min(input.plannedOre, linked);
}

export function companySentence(
  companyName: string | null,
  unknown: string,
  named: string,
): string {
  if (!companyName) return unknown;
  return named.replace("{name}", companyName);
}

export function companyNameFromPayload(payload: unknown): string | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  for (const key of ["CompanyName", "Name", "LegalName"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export type AdvanceGateway = {
  readInvoice(invoiceId: string): Promise<InvoiceMoney | null>;
};

/** Reads the advance document. A failed read stays unchecked and does not become zero. */
export async function collectAdvancePayments(
  gateway: AdvanceGateway,
  invoiceId: string,
): Promise<AdvanceCheck> {
  try {
    return interpretAdvanceCheck(await gateway.readInvoice(invoiceId));
  } catch {
    return interpretAdvanceCheck(null);
  }
}

export async function readSettlementConfirmation(
  gateway: AdvanceGateway,
  input: { settlementInvoiceId: string; advanceInvoiceId: string; plannedOre: number },
): Promise<number | null> {
  try {
    const settlement = await gateway.readInvoice(input.settlementInvoiceId);
    return confirmedAdvanceUse({
      settlement,
      advanceInvoiceId: input.advanceInvoiceId,
      plannedOre: input.plannedOre,
    });
  } catch {
    return null;
  }
}

/**
 * One order: unchecked, then two payments, a partial invoice, and a capped final settlement.
 * The surplus is kept. A second settlement cannot take it.
 */
export function advanceSettlementChain(input: {
  claimedOre: number;
  paymentChecked: boolean;
  payments: readonly AdvancePayment[];
  dnbReceivedOre: number | null;
  dnbRestOre: number | null;
  lines: readonly {
    fulfillmentId: string;
    quantity: number;
    unitPriceOre: number;
    active: boolean;
  }[];
  finalFulfillmentIds: readonly string[];
  alreadyPlannedOre: number;
  storedSurplusOre: number | null;
  confirmedOre: number | null;
  settlementTotalOre: number | null;
  settlementRestOre: number | null;
  settlementVatOre: number | null;
}) {
  const claims = settlementClaims(input.lines, input.finalFulfillmentIds);
  const finalClaimOre =
    input.settlementTotalOre ?? (claims.finalClaimOre > 0 ? claims.finalClaimOre : null);
  return settlementView({
    percent: 50,
    basisOre: 15_450_000,
    agreedOre: input.claimedOre,
    claimedOre: input.claimedOre,
    paymentChecked: input.paymentChecked,
    payments: input.payments,
    dnbReceivedOre: input.dnbReceivedOre,
    dnbRestOre: input.dnbRestOre,
    finalClaimOre,
    alreadyPlannedOre: input.alreadyPlannedOre,
    storedSurplusOre: input.storedSurplusOre,
    confirmedOre: input.confirmedOre,
    previouslyInvoicedOre: claims.previouslyInvoicedOre,
    vatOre: input.settlementVatOre,
    totalOre: input.settlementTotalOre,
    remainingOre: input.settlementRestOre,
  });
}

export { finalOffsetPlan };
