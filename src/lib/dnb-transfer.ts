import {
  draftInvoiceBody,
  nextTransferStep,
  noSendDistributionId,
  outcomeForRemote,
  type FrozenInvoiceLine,
  type RemoteInvoice,
  type TransferStatus,
  type DnbInvoiceStatus,
} from "./dnb-invoice.ts";

export type AccountingGateway = {
  findInvoiceByReference(reference: string): Promise<RemoteInvoice | null>;
  findCustomersByOrg(organizationNumber: string): Promise<{ id: number }[]>;
  createCustomer(input: { organizationNumber: string; name: string }): Promise<{ id: number }>;
  findNoSendPlans(): Promise<{ id: number; name: string }[]>;
  createDraft(body: unknown): Promise<RemoteInvoice>;
};

export type Basis = {
  reference: string;
  legalName: string;
  organizationNumber: string;
  invoiceDate: string;
  paymentDueOn: string;
  vatPercent: number;
  lines: readonly FrozenInvoiceLine[];
  paymentInfoTypeId?: number;
};

export type TransferOutcome = {
  transferStatus: TransferStatus;
  dnbStatus: DnbInvoiceStatus | null;
  externalInvoiceId: string | null;
  invoiceNumber: string | null;
  outcome: "adopted" | "created" | "blocked" | "ambiguous";
  detail: string | null;
};

/**
 * Finds an existing DNB draft by the stable reference before creating one.
 * Does not issue or send the invoice.
 */
export async function transferBasis(basis: Basis, gateway: AccountingGateway): Promise<TransferOutcome> {
  let existing: RemoteInvoice | null = null;
  try {
    existing = await gateway.findInvoiceByReference(basis.reference);
  } catch (error) {
    return ambiguous(error);
  }
  if (existing) return adopted(existing);

  let plans: { id: number; name: string }[] = [];
  let customers: { id: number }[] = [];
  try {
    [plans, customers] = await Promise.all([
      gateway.findNoSendPlans(),
      gateway.findCustomersByOrg(basis.organizationNumber),
    ]);
  } catch (error) {
    return ambiguous(error);
  }

  let step = nextTransferStep({
    existing: null,
    customers,
    distributionPlanId: noSendDistributionId(plans),
    organizationNumber: basis.organizationNumber,
    lineCount: basis.lines.length,
  });

  if (step.action === "create_customer") {
    try {
      const created = await gateway.createCustomer({
        organizationNumber: basis.organizationNumber,
        name: basis.legalName,
      });
      step = { action: "create", customerId: created.id, distributionPlanId: step.distributionPlanId };
    } catch (error) {
      return ambiguous(error);
    }
  }

  if (step.action === "adopt") return adopted(step.invoice);
  if (step.action === "blocked") {
    return {
      transferStatus: "failed",
      dnbStatus: null,
      externalInvoiceId: null,
      invoiceNumber: null,
      outcome: "blocked",
      detail: step.reason,
    };
  }
  if (step.action !== "create") {
    return {
      transferStatus: "failed",
      dnbStatus: null,
      externalInvoiceId: null,
      invoiceNumber: null,
      outcome: "blocked",
      detail: "no_distribution",
    };
  }

  let created: RemoteInvoice;
  try {
    created = await gateway.createDraft(
      draftInvoiceBody({
        invoiceDate: basis.invoiceDate,
        paymentDueOn: basis.paymentDueOn,
        reference: basis.reference,
        customerId: step.customerId,
        customerName: basis.legalName,
        lines: basis.lines,
        vatPercent: basis.vatPercent,
        distributionPlanId: step.distributionPlanId,
        ...(basis.paymentInfoTypeId != null ? { paymentInfoTypeId: basis.paymentInfoTypeId } : {}),
      }),
    );
  } catch (error) {
    return ambiguous(error);
  }

  const mapped = outcomeForRemote(created, true);
  return {
    transferStatus: mapped.transferStatus,
    dnbStatus: mapped.dnbStatus,
    externalInvoiceId: String(created.id),
    invoiceNumber: mapped.invoiceNumber,
    outcome: "created",
    detail: mapped.transferStatus === "needs_review" ? `status ${created.statusCode}` : null,
  };
}

function adopted(invoice: RemoteInvoice): TransferOutcome {
  const mapped = outcomeForRemote(invoice, false);
  return {
    transferStatus: mapped.transferStatus,
    dnbStatus: mapped.dnbStatus,
    externalInvoiceId: String(invoice.id),
    invoiceNumber: mapped.invoiceNumber,
    outcome: "adopted",
    detail: null,
  };
}

function ambiguous(error: unknown): TransferOutcome {
  return {
    transferStatus: "needs_review",
    dnbStatus: null,
    externalInvoiceId: null,
    invoiceNumber: null,
    outcome: "ambiguous",
    detail: error instanceof Error ? error.message : "Unimicro request failed",
  };
}
