import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../integrations/supabase/types.ts";
import { collectAdvancePayments, readSettlementConfirmation } from "./dnb-advance.ts";
import { unimicroConfigFromEnv, unimicroGateway } from "./dnb-unimicro.ts";

type Admin = SupabaseClient<Database>;

export type AdvanceSyncResult = {
  ok: boolean;
  reason?: "not_configured" | "pending_sql" | "missing";
  checked: boolean;
  confirmedOre: number | null;
};

function pendingSql(message: string): boolean {
  return /order_advance|payments_checked_at|record_advance_check|record_advance_confirmation|surplus_ore|confirmed_ore/.test(
    message,
  );
}

export async function syncOrderAdvance(
  admin: Admin,
  orderId: string,
  settlementDraftId: string | null,
  env: Record<string, string | undefined>,
): Promise<AdvanceSyncResult> {
  const config = unimicroConfigFromEnv(env);
  if (!config) return { ok: false, reason: "not_configured", checked: false, confirmedOre: null };
  const gateway = unimicroGateway(config);
  const claim = await admin
    .from("order_advance_claims")
    .select("accounting_invoice_id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (claim.error) {
    if (pendingSql(claim.error.message)) {
      return { ok: false, reason: "pending_sql", checked: false, confirmedOre: null };
    }
    throw new Error(claim.error.message);
  }
  const advanceInvoiceId = claim.data?.accounting_invoice_id;
  if (!advanceInvoiceId) return { ok: true, checked: false, confirmedOre: null };

  const check = await collectAdvancePayments(gateway, advanceInvoiceId);
  if (!check.checked) return { ok: true, checked: false, confirmedOre: null };
  const recorded = await admin.rpc("record_advance_check", {
    p_order_id: orderId,
    p_payments: check.externalPayments.map((payment) => ({
      external_id: payment.externalId,
      amount_ore: payment.amountOre,
      paid_on: payment.paidOn ?? "",
    })) as Json,
    p_use_balance: check.useBalance,
    p_dnb_received_ore: check.dnbReceivedOre,
    p_has_rest: check.hasRest,
    p_dnb_rest_ore: check.dnbRestOre,
    p_has_total: check.hasTotal,
    p_dnb_total_ore: check.dnbTotalOre,
    p_has_vat: check.hasVat,
    p_dnb_vat_ore: check.dnbVatOre,
  });
  if (recorded.error) {
    if (pendingSql(recorded.error.message)) {
      return { ok: false, reason: "pending_sql", checked: false, confirmedOre: null };
    }
    throw new Error(recorded.error.message);
  }

  if (!settlementDraftId) return { ok: true, checked: true, confirmedOre: null };
  const [draft, offset] = await Promise.all([
    admin
      .from("invoice_drafts")
      .select("accounting_invoice_id")
      .eq("id", settlementDraftId)
      .maybeSingle(),
    admin
      .from("order_advance_offsets")
      .select("amount_ore")
      .eq("invoice_draft_id", settlementDraftId)
      .maybeSingle(),
  ]);
  if (draft.error) {
    if (pendingSql(draft.error.message)) {
      return { ok: false, reason: "pending_sql", checked: true, confirmedOre: null };
    }
    throw new Error(draft.error.message);
  }
  if (offset.error) {
    if (pendingSql(offset.error.message)) {
      return { ok: false, reason: "pending_sql", checked: true, confirmedOre: null };
    }
    throw new Error(offset.error.message);
  }
  const settlementInvoiceId = draft.data?.accounting_invoice_id;
  if (!settlementInvoiceId || !offset.data) return { ok: true, checked: true, confirmedOre: null };
  const confirmed = await readSettlementConfirmation(gateway, {
    settlementInvoiceId,
    advanceInvoiceId,
    plannedOre: offset.data.amount_ore,
  });
  if (confirmed == null) return { ok: true, checked: true, confirmedOre: null };
  const saved = await admin.rpc("record_advance_confirmation", {
    p_order_id: orderId,
    p_invoice_draft_id: settlementDraftId,
    p_confirmed_ore: confirmed,
  });
  if (saved.error && !pendingSql(saved.error.message)) throw new Error(saved.error.message);
  return { ok: true, checked: true, confirmedOre: confirmed };
}

export async function readDnbCompanyName(
  env: Record<string, string | undefined>,
): Promise<string | null> {
  const config = unimicroConfigFromEnv(env);
  if (!config) return null;
  return unimicroGateway(config).companyName();
}
