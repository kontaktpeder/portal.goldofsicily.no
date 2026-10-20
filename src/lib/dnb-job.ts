import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types.ts";
import {
  kronerToOre,
  outcomeForRemote,
  paymentDueOn,
  type DnbInvoiceStatus,
  type TransferStatus,
} from "./dnb-invoice.ts";
import { transferBasis, type TransferOutcome } from "./dnb-transfer.ts";
import { unimicroConfigFromEnv, unimicroGateway } from "./dnb-unimicro.ts";

type Admin = SupabaseClient<Database>;

const BLOCKED: Record<string, string> = {
  no_distribution:
    "Fant ingen utsendelsesplan «Ingen utsendelse» i DNB. Utkastet er ikke opprettet.",
  ambiguous_customer:
    "Flere kunder i DNB har samme organisasjonsnummer. Utkastet er ikke opprettet.",
  missing_org: "Fakturamottakeren mangler organisasjonsnummer.",
  no_lines: "Grunnlaget har ingen linjer.",
};

export type TransferJobResult = {
  ok: boolean;
  reason?: "not_configured" | "pending_sql" | "in_progress" | "missing";
  message?: string;
  transferStatus?: TransferStatus;
  dnbStatus?: DnbInvoiceStatus | null;
  invoiceNumber?: string | null;
};

function osloToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());
}

function pendingSql(message: string): boolean {
  return /transfer_status|claim_dnb_transfer|record_dnb_transfer|dnb_status|dnb_paid_on/.test(
    message,
  );
}

async function loadDraft(admin: Admin, draftId: string) {
  return admin
    .from("invoice_drafts")
    .select(
      "id, status, legal_name_snapshot, organization_number_snapshot, transfer_status, transfer_reference, payment_due_on, vat_percent, accounting_invoice_id, invoice_draft_lines(delivery_line_id, product_name_snapshot, venue_name_snapshot, quantity, unit_price_ore, active)",
    )
    .eq("id", draftId)
    .maybeSingle();
}

async function record(admin: Admin, draftId: string, outcome: TransferOutcome) {
  const detail =
    outcome.outcome === "blocked" && outcome.detail && BLOCKED[outcome.detail]
      ? BLOCKED[outcome.detail]
      : outcome.detail;
  const { error } = await admin.rpc("record_dnb_transfer", {
    p_id: draftId,
    p_transfer_status: outcome.transferStatus,
    p_dnb_status: outcome.dnbStatus,
    p_accounting_invoice_id: outcome.externalInvoiceId,
    p_accounting_invoice_number: outcome.invoiceNumber,
    p_transfer_error: outcome.transferStatus === "transferred" ? null : detail,
    p_outcome: outcome.outcome,
    p_detail: detail,
    p_dnb_paid_on: outcome.paidOn,
    p_dnb_total_ore: outcome.totalOre,
    p_dnb_rest_ore: outcome.restOre,
    p_dnb_vat_ore: outcome.vatOre,
  });
  if (error) throw new Error(error.message);
}

export async function transferInvoiceBasis(
  admin: Admin,
  draftId: string,
  env: Record<string, string | undefined>,
): Promise<TransferJobResult> {
  const config = unimicroConfigFromEnv(env);
  if (!config) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Unimicro-tilgang mangler. Sett API-adresse, token og selskapsnøkkel på serveren.",
    };
  }

  const loaded = await loadDraft(admin, draftId);
  if (loaded.error) {
    if (pendingSql(loaded.error.message)) {
      return {
        ok: false,
        reason: "pending_sql",
        message:
          "DNB-overføringen er ikke klar i databasen ennå. Kjør SQL for fakturaoverføring i Lovable Cloud.",
      };
    }
    throw new Error(loaded.error.message);
  }
  const draft = loaded.data;
  if (!draft) return { ok: false, reason: "missing", message: "Fakturagrunnlaget finnes ikke." };
  if (draft.status !== "draft") {
    return { ok: false, message: "Bare et åpent grunnlag kan overføres." };
  }

  const claimed = await admin.rpc("claim_dnb_transfer", { p_id: draftId });
  if (claimed.error) {
    if (pendingSql(claimed.error.message)) {
      return {
        ok: false,
        reason: "pending_sql",
        message:
          "DNB-overføringen er ikke klar i databasen ennå. Kjør SQL for fakturaoverføring i Lovable Cloud.",
      };
    }
    throw new Error(claimed.error.message);
  }
  if (!claimed.data)
    return { ok: false, reason: "in_progress", message: "Overføringen pågår allerede." };

  const lines = (draft.invoice_draft_lines ?? []).filter((line) => line.active);
  const vat = draft.vat_percent === 25 ? 25 : 15;
  const outcome = await transferBasis(
    {
      reference: draft.transfer_reference ?? `gos-${draft.id}`,
      legalName: draft.legal_name_snapshot,
      organizationNumber: draft.organization_number_snapshot,
      invoiceDate: osloToday(),
      paymentDueOn: draft.payment_due_on ?? paymentDueOn(osloToday()),
      vatPercent: vat,
      lines: lines.map((line) => ({
        deliveryLineId: line.delivery_line_id,
        productName: line.product_name_snapshot,
        venueName: line.venue_name_snapshot,
        quantity: line.quantity,
        unitPriceOre: line.unit_price_ore,
      })),
      ...(config.paymentInfoTypeId != null ? { paymentInfoTypeId: config.paymentInfoTypeId } : {}),
    },
    unimicroGateway(config),
  );
  await record(admin, draftId, outcome);
  const detail =
    outcome.outcome === "blocked" && outcome.detail && BLOCKED[outcome.detail]
      ? BLOCKED[outcome.detail]
      : outcome.detail;
  return {
    ok: outcome.transferStatus === "transferred",
    message: detail ?? undefined,
    transferStatus: outcome.transferStatus,
    dnbStatus: outcome.dnbStatus,
    invoiceNumber: outcome.invoiceNumber,
  };
}

export async function refreshInvoiceBasis(
  admin: Admin,
  draftId: string,
  env: Record<string, string | undefined>,
): Promise<TransferJobResult> {
  const config = unimicroConfigFromEnv(env);
  if (!config) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Unimicro-tilgang mangler. Sett API-adresse, token og selskapsnøkkel på serveren.",
    };
  }
  const loaded = await loadDraft(admin, draftId);
  if (loaded.error) {
    if (pendingSql(loaded.error.message)) {
      return {
        ok: false,
        reason: "pending_sql",
        message:
          "DNB-overføringen er ikke klar i databasen ennå. Kjør SQL for fakturaoverføring i Lovable Cloud.",
      };
    }
    throw new Error(loaded.error.message);
  }
  const draft = loaded.data;
  if (!draft?.transfer_reference) return { ok: false, reason: "missing" };
  const remote = await unimicroGateway(config).findInvoiceByReference(draft.transfer_reference);
  if (!remote) return { ok: true, message: "Ingen faktura med denne referansen i DNB ennå." };
  const mapped = outcomeForRemote(remote, false);
  await record(admin, draftId, {
    transferStatus: mapped.transferStatus,
    dnbStatus: mapped.dnbStatus,
    externalInvoiceId: String(remote.id),
    invoiceNumber: mapped.invoiceNumber,
    paidOn: mapped.dnbStatus === "paid" ? (remote.paidOn ?? null) : null,
    totalOre: kronerToOre(remote.totalAmount),
    restOre: kronerToOre(remote.restAmount),
    vatOre: remote.vatOre ?? null,
    outcome: "adopted",
    detail: null,
  });
  return {
    ok: true,
    transferStatus: mapped.transferStatus,
    dnbStatus: mapped.dnbStatus,
    invoiceNumber: mapped.invoiceNumber,
  };
}
