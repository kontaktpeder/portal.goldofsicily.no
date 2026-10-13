/** Agreed portal prices are kroner ex VAT. Food VAT is the rate shown before transfer. */
export const FOOD_VAT_PERCENT = 15;

/** Unimicro customer-invoice draft. Issuing is a separate action this portal never calls. */
export const DNB_DRAFT_STATUS_CODE = 42001;

/** Documented paid status for a customer invoice. */
export const DNB_PAID_STATUS_CODE = 42004;

export const NO_SEND_DISTRIBUTION_NAME = "ingen utsendelse";

export type TransferStatus = "not_transferred" | "queued" | "transferred" | "failed" | "needs_review";

export type DnbInvoiceStatus = "draft" | "issued" | "partly_paid" | "paid" | "credited";

export type FrozenInvoiceLine = {
  deliveryLineId: string;
  productName: string;
  venueName: string;
  quantity: number;
  unitPriceOre: number;
};

export type RemoteInvoice = {
  id: number;
  statusCode: number;
  invoiceNumber: string | null;
  credited: boolean;
  restAmount: number | null;
  totalAmount: number | null;
};

export type InvoiceItemPayload = {
  ItemText: string;
  Unit: "stk";
  NumberOfItems: number;
  PriceExVat: number;
  VatPercent: number;
  SumTotalExVat: number;
  SumVat: number;
  SumTotalIncVat: number;
  PriceExVatCurrency: number;
  SumTotalExVatCurrency: number;
  SumVatCurrency: number;
  SumTotalIncVatCurrency: number;
};

export function transferReference(draftId: string): string {
  return `gos-${draftId}`;
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function paymentDueOn(fromDay: string, days = 14): string {
  const date = new Date(`${fromDay.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function lineAmounts(quantity: number, unitPriceOre: number, vatPercent: number) {
  const exOre = quantity * unitPriceOre;
  const vatOre = Math.round((exOre * vatPercent) / 100);
  return {
    priceExVat: unitPriceOre / 100,
    sumTotalExVat: exOre / 100,
    sumVat: vatOre / 100,
    sumTotalIncVat: (exOre + vatOre) / 100,
  };
}

/** Prices come from the frozen line. Nothing here reads today's price list. */
export function invoiceItemFromFrozenLine(line: FrozenInvoiceLine, vatPercent: number): InvoiceItemPayload {
  const amounts = lineAmounts(line.quantity, line.unitPriceOre, vatPercent);
  return {
    ItemText: `${line.productName} · ${line.venueName}`,
    Unit: "stk",
    NumberOfItems: line.quantity,
    PriceExVat: amounts.priceExVat,
    VatPercent: vatPercent,
    SumTotalExVat: amounts.sumTotalExVat,
    SumVat: amounts.sumVat,
    SumTotalIncVat: amounts.sumTotalIncVat,
    PriceExVatCurrency: amounts.priceExVat,
    SumTotalExVatCurrency: amounts.sumTotalExVat,
    SumVatCurrency: amounts.sumVat,
    SumTotalIncVatCurrency: amounts.sumTotalIncVat,
  };
}

export function noSendDistributionId(plans: readonly { id: number; name: string }[]): number | null {
  const match = plans.find((plan) => plan.name.trim().toLowerCase() === NO_SEND_DISTRIBUTION_NAME);
  return match?.id ?? null;
}

export function dnbStatusFromRemote(invoice: RemoteInvoice): DnbInvoiceStatus | null {
  if (invoice.credited) return "credited";
  if (invoice.statusCode === DNB_DRAFT_STATUS_CODE) return "draft";
  if (invoice.statusCode === DNB_PAID_STATUS_CODE) return "paid";
  if (
    invoice.restAmount != null &&
    invoice.totalAmount != null &&
    invoice.restAmount > 0 &&
    invoice.restAmount < invoice.totalAmount
  ) {
    return "partly_paid";
  }
  if (invoice.invoiceNumber) return "issued";
  return null;
}

export type DraftInvoiceBody = {
  InvoiceDate: string;
  PaymentDueDate: string;
  OurReference: string;
  CustomerID: number;
  CustomerName: string;
  Items: InvoiceItemPayload[];
  DistributionPlanID: number;
  PaymentInfoTypeID?: number;
};

export function draftInvoiceBody(input: {
  invoiceDate: string;
  paymentDueOn: string;
  reference: string;
  customerId: number;
  customerName: string;
  lines: readonly FrozenInvoiceLine[];
  vatPercent: number;
  distributionPlanId: number;
  paymentInfoTypeId?: number;
}): DraftInvoiceBody {
  const body: DraftInvoiceBody = {
    InvoiceDate: input.invoiceDate.slice(0, 10),
    PaymentDueDate: input.paymentDueOn.slice(0, 10),
    OurReference: input.reference,
    CustomerID: input.customerId,
    CustomerName: input.customerName,
    Items: input.lines.map((line) => invoiceItemFromFrozenLine(line, input.vatPercent)),
    DistributionPlanID: input.distributionPlanId,
  };
  if (input.paymentInfoTypeId != null) body.PaymentInfoTypeID = input.paymentInfoTypeId;
  return body;
}

export type TransferStep =
  | { action: "adopt"; invoice: RemoteInvoice }
  | { action: "blocked"; reason: "no_distribution" | "ambiguous_customer" | "missing_org" | "no_lines" }
  | { action: "create_customer"; distributionPlanId: number }
  | { action: "create"; customerId: number; distributionPlanId: number };

/**
 * Lookup wins. A missing response on the previous try must find the existing draft
 * before a new one is created.
 */
export function nextTransferStep(input: {
  existing: RemoteInvoice | null;
  customers: readonly { id: number }[];
  distributionPlanId: number | null;
  organizationNumber: string;
  lineCount: number;
}): TransferStep {
  if (input.existing) return { action: "adopt", invoice: input.existing };
  if (input.lineCount <= 0) return { action: "blocked", reason: "no_lines" };
  if (!digitsOnly(input.organizationNumber)) return { action: "blocked", reason: "missing_org" };
  if (input.customers.length > 1) return { action: "blocked", reason: "ambiguous_customer" };
  if (input.distributionPlanId == null) return { action: "blocked", reason: "no_distribution" };
  const customerId = input.customers[0]?.id;
  if (customerId == null) return { action: "create_customer", distributionPlanId: input.distributionPlanId };
  return { action: "create", customerId, distributionPlanId: input.distributionPlanId };
}

export function outcomeForRemote(invoice: RemoteInvoice, createdNow: boolean): {
  transferStatus: TransferStatus;
  dnbStatus: DnbInvoiceStatus | null;
  invoiceNumber: string | null;
} {
  const dnbStatus = dnbStatusFromRemote(invoice);
  if (createdNow && dnbStatus !== "draft") {
    return { transferStatus: "needs_review", dnbStatus, invoiceNumber: invoice.invoiceNumber };
  }
  if (!dnbStatus) {
    return { transferStatus: "needs_review", dnbStatus: null, invoiceNumber: invoice.invoiceNumber };
  }
  return {
    transferStatus: "transferred",
    dnbStatus,
    invoiceNumber: dnbStatus === "draft" ? null : invoice.invoiceNumber,
  };
}
