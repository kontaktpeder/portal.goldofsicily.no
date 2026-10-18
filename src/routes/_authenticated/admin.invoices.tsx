import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRequireCommercial } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { formatPriceNok } from "@/lib/slug";
import { billingLegalEntityId, type CommercialRoute } from "@/lib/economy";
import { legacyInvoicePortions, orderInvoicePortions } from "@/lib/orders";
import { refreshInvoiceDraft, transferInvoiceDraft } from "@/lib/admin.functions";
import type { TranslationKey } from "@/lib/i18n";
import { PrimaryButton } from "@/components/field";

const draftSelect =
  "id, status, legal_name_snapshot, organization_number_snapshot, created_at, transfer_status, transfer_reference, dnb_status, payment_due_on, vat_percent, transfer_error, accounting_invoice_number, invoice_draft_lines(id, venue_name_snapshot, product_name_snapshot, quantity, unit_price_ore, active)";
const draftSelectLegacy =
  "id, status, legal_name_snapshot, organization_number_snapshot, created_at, invoice_draft_lines(id, venue_name_snapshot, product_name_snapshot, quantity, unit_price_ore, active)";

function transferLabel(status: string): TranslationKey {
  if (status === "queued") return "dnb_queued";
  if (status === "transferred") return "dnb_waiting";
  if (status === "failed") return "dnb_failed";
  if (status === "needs_review") return "dnb_needs_review";
  return "dnb_not_transferred";
}

function dnbLabel(status: string): TranslationKey {
  if (status === "issued") return "dnb_issued";
  if (status === "partly_paid") return "dnb_partly_paid";
  if (status === "paid") return "dnb_paid";
  if (status === "credited") return "dnb_credited";
  return "dnb_waiting";
}

function statusKey(status: "draft" | "sent" | "credited" | "cancelled"): TranslationKey {
  if (status === "sent") return "invoice_status_sent";
  if (status === "credited") return "invoice_status_credited";
  if (status === "cancelled") return "invoice_status_cancelled";
  return "invoice_status_draft";
}

export const Route = createFileRoute("/_authenticated/admin/invoices")({
  head: () => ({
    meta: [
      { title: "Faktura — Gold of Sicily admin" },
      { name: "description", content: "Uninvoiced Gold sales and invoice drafts." },
    ],
  }),
  component: AdminInvoices,
});

type SaleLine = {
  id: string;
  deliveryLineId: string;
  fulfillmentId: string | null;
  quantity: number;
  unitPriceOre: number | null;
  productName: string;
  deliveredAt: string;
  customerId: string;
  customerType: string;
  customerName: string;
  commercialRoute: CommercialRoute;
  legalEntityId: string | null;
  billingLegalEntityId: string | null;
  orderNumber: string | null;
};

function AdminInvoices() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { allowed, isLoading } = useRequireCommercial();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<Record<string, true>>({});
  const transfer = useServerFn(transferInvoiceDraft);
  const refreshStatus = useServerFn(refreshInvoiceDraft);

  const bundle = useQuery({
    queryKey: ["invoice-desk"],
    queryFn: async () => {
      const [linesRes, allocatedRes, fulfillmentRes, entitiesRes, draftsRes] = await Promise.all([
        supabase
          .from("delivery_lines")
          .select(
            "id, quantity, unit_price_ore, product_name_snapshot, deliveries!inner(delivered_at, customer_id, customer_name_snapshot, commercial_route, customers!deliveries_customer_id_fkey(type, legal_entity_id, billing_legal_entity_id))",
          )
          .limit(1000),
        supabase
          .from("invoice_draft_lines")
          .select("delivery_line_id, order_line_fulfillment_id, quantity")
          .eq("active", true),
        supabase
          .from("order_line_fulfillments")
          .select(
            "id, quantity, delivery_line_id, customer_order_lines!order_line_fulfillments_order_line_id_fkey(unit_price_ore, product_name_snapshot, customer_orders!customer_order_lines_order_id_fkey(order_number, billing_legal_entity_id, billing_legal_name_snapshot))",
          ),
        supabase
          .from("legal_entities")
          .select("id, legal_name, organization_number, parent_legal_entity_id"),
        supabase
          .from("invoice_drafts")
          .select(draftSelect)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (linesRes.error) throw linesRes.error;
      if (entitiesRes.error) throw entitiesRes.error;
      let activeInvoices = allocatedRes.data ?? [];
      if (allocatedRes.error) {
        if (!/order_line_fulfillment_id/.test(allocatedRes.error.message)) throw allocatedRes.error;
        const fallback = await supabase
          .from("invoice_draft_lines")
          .select("delivery_line_id, quantity")
          .eq("active", true);
        if (fallback.error) throw fallback.error;
        activeInvoices = (fallback.data ?? []).map((row) => ({
          delivery_line_id: row.delivery_line_id,
          order_line_fulfillment_id: null,
          quantity: row.quantity,
        }));
      }
      const fulfillments = fulfillmentRes.error ? [] : (fulfillmentRes.data ?? []);
      if (
        fulfillmentRes.error &&
        !/order_line_fulfillments|customer_orders/.test(fulfillmentRes.error.message)
      ) {
        throw fulfillmentRes.error;
      }
      let drafts = draftsRes.data ?? [];
      let pendingSql = false;
      if (draftsRes.error) {
        if (/transfer_status|dnb_status|payment_due_on|vat_percent/.test(draftsRes.error.message)) {
          pendingSql = true;
          const legacy = await supabase
            .from("invoice_drafts")
            .select(draftSelectLegacy)
            .order("created_at", { ascending: false })
            .limit(50);
          if (legacy.error) throw legacy.error;
          drafts = (legacy.data ?? []) as typeof drafts;
        } else {
          throw draftsRes.error;
        }
      }
      return {
        lines: linesRes.data ?? [],
        activeInvoices,
        fulfillments,
        entities: entitiesRes.data ?? [],
        drafts,
        pendingSql,
      };
    },
  });

  if (isLoading || !allowed) return <main className="min-h-screen" />;

  const entities = bundle.data?.entities ?? [];
  const links = entities.map((entity) => ({
    id: entity.id,
    parentLegalEntityId: entity.parent_legal_entity_id,
  }));
  const catalog = new Map((bundle.data?.lines ?? []).map((row) => [row.id, row]));
  const activeInvoices = (bundle.data?.activeInvoices ?? []).map((row) => ({
    deliveryLineId: row.delivery_line_id,
    fulfillmentId: row.order_line_fulfillment_id,
    quantity: row.quantity,
  }));
  const fulfillmentRows = (bundle.data?.fulfillments ?? []).flatMap((row) => {
    const orderLine = one(row.customer_order_lines);
    const sale = one(orderLine?.customer_orders ?? null);
    if (!orderLine?.unit_price_ore || !sale?.billing_legal_entity_id) return [];
    return [
      {
        id: row.id,
        deliveryLineId: row.delivery_line_id,
        quantity: row.quantity,
        unitPriceOre: orderLine.unit_price_ore,
        billingLegalEntityId: sale.billing_legal_entity_id,
        orderNumber: sale.order_number,
        productName: orderLine.product_name_snapshot,
      },
    ];
  });
  const described = (bundle.data?.lines ?? []).flatMap((row) => {
    const delivery = one(row.deliveries);
    if (!delivery) return [];
    const customer = one(delivery.customers);
    const recipient = billingLegalEntityId(
      {
        legalEntityId: customer?.legal_entity_id ?? null,
        billingLegalEntityId: customer?.billing_legal_entity_id ?? null,
      },
      links,
    );
    return [
      {
        row,
        delivery,
        customer,
        desk: {
          deliveryLineId: row.id,
          quantity: row.quantity,
          unitPriceOre: row.unit_price_ore,
          commercialRoute: delivery.commercial_route,
          billingLegalEntityId: recipient,
        },
      },
    ];
  });
  const legacyQty = new Map(
    legacyInvoicePortions(
      described.map((line) => line.desk),
      fulfillmentRows,
      activeInvoices,
    ).map((portion) => [portion.deliveryLineId, portion.quantity]),
  );
  const orderQty = orderInvoicePortions(fulfillmentRows, activeInvoices);
  const sales: SaleLine[] = described.flatMap((line) => {
    if (line.delivery.commercial_route !== "direct") return [];
    return [
      {
        id: line.row.id,
        deliveryLineId: line.row.id,
        fulfillmentId: null,
        quantity: line.row.quantity,
        unitPriceOre: line.row.unit_price_ore,
        productName: line.row.product_name_snapshot,
        deliveredAt: line.delivery.delivered_at,
        customerId: line.delivery.customer_id,
        customerType: line.customer?.type ?? "venue",
        customerName: line.delivery.customer_name_snapshot,
        commercialRoute: line.delivery.commercial_route,
        legalEntityId: line.customer?.legal_entity_id ?? null,
        billingLegalEntityId: line.customer?.billing_legal_entity_id ?? null,
        orderNumber: null,
      },
    ];
  });
  const missingPrice = sales.filter(
    (line) => line.unitPriceOre == null && (legacyQty.get(line.deliveryLineId) ?? 0) > 0,
  );
  const ready = sales.flatMap((line) => {
    const quantity = legacyQty.get(line.deliveryLineId);
    if (!quantity || line.unitPriceOre == null) return [];
    return [{ ...line, quantity }];
  });
  const orderReady: SaleLine[] = orderQty.flatMap((portion) => {
    const source = catalog.get(portion.deliveryLineId);
    const delivery = source ? one(source.deliveries) : null;
    if (!source || !delivery) return [];
    const meta = fulfillmentRows.find((row) => row.id === portion.id);
    return [
      {
        id: portion.id,
        deliveryLineId: portion.deliveryLineId,
        fulfillmentId: portion.id,
        quantity: portion.quantity,
        unitPriceOre: portion.unitPriceOre,
        productName: meta?.productName || source.product_name_snapshot,
        deliveredAt: delivery.delivered_at,
        customerId: delivery.customer_id,
        customerType: "venue",
        customerName: delivery.customer_name_snapshot,
        commercialRoute: delivery.commercial_route,
        legalEntityId: portion.billingLegalEntityId,
        billingLegalEntityId: portion.billingLegalEntityId,
        orderNumber: meta?.orderNumber ?? null,
      },
    ];
  });
  const groups = groupSales([...orderReady, ...ready], links);
  const missingRecipient = described.flatMap((line) => {
    if (line.delivery.commercial_route !== "direct" || line.desk.billingLegalEntityId) return [];
    if ((legacyQty.get(line.row.id) ?? 0) <= 0 && line.row.unit_price_ore != null) return [];
    if (line.row.unit_price_ore == null) return [];
    return sales.filter((sale) => sale.deliveryLineId === line.row.id);
  });

  function openPriceAgreement(line: SaleLine) {
    const search = { priceDate: line.deliveredAt.slice(0, 10), priceNames: line.productName };
    if (line.customerType === "wholesaler") {
      void navigate({
        to: "/admin/wholesalers/$customerId",
        params: { customerId: line.customerId },
        search,
      });
      return;
    }
    void navigate({ to: "/admin/venues/$venueId", params: { venueId: line.customerId }, search });
  }

  async function freezePrice(line: SaleLine) {
    const { error } = await supabase
      .from("delivery_lines")
      .update({ unit_price_ore: 1 })
      .eq("id", line.id);
    if (error) {
      if (error.message.includes("missing price")) openPriceAgreement(line);
      else toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["invoice-desk"] });
  }

  async function createDraft(legalEntityId: string, lines: SaleLine[]) {
    setBusy(true);
    const { data: draft, error } = await supabase
      .from("invoice_drafts")
      .insert({ legal_entity_id: legalEntityId })
      .select("id")
      .single();
    if (error || !draft) {
      setBusy(false);
      toast.error(error?.message ?? t("invoice_failed"));
      return;
    }
    const { error: lineError } = await supabase.from("invoice_draft_lines").insert(
      lines.map((line) => ({
        invoice_draft_id: draft.id,
        delivery_line_id: line.deliveryLineId,
        ...(line.fulfillmentId ? { order_line_fulfillment_id: line.fulfillmentId } : {}),
      })),
    );
    if (lineError) {
      await supabase.from("invoice_drafts").delete().eq("id", draft.id);
      setBusy(false);
      toast.error(lineError.message);
      return;
    }
    setBusy(false);
    toast.success(t("invoice_draft_created"));
    await queryClient.invalidateQueries({ queryKey: ["invoice-desk"] });
  }

  async function saveTerms(id: string, patch: { vat_percent?: number; payment_due_on?: string }) {
    const { error } = await supabase.from("invoice_drafts").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["invoice-desk"] });
  }

  async function runTransfer(id: string) {
    setBusy(true);
    try {
      const result = await transfer({ data: { draftId: id } });
      if (!result.ok) toast.error(result.message ?? t("invoice_failed"));
      else toast.success(t("dnb_transferred"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("invoice_failed"));
    }
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: ["invoice-desk"] });
  }

  async function runRefresh(id: string) {
    setBusy(true);
    try {
      const result = await refreshStatus({ data: { draftId: id } });
      if (!result.ok) toast.error(result.message ?? t("invoice_failed"));
      else if (result.message) toast(result.message);
      else toast.success(t("dnb_refresh"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("invoice_failed"));
    }
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: ["invoice-desk"] });
  }

  async function setStatus(id: string, status: "sent" | "cancelled" | "credited") {
    const { error } = await supabase.from("invoice_drafts").update({ status }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["invoice-desk"] });
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <h1 className="pt-8 text-3xl font-semibold">{t("invoices")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("invoices_intro")}</p>

      <h2 className="mt-8 text-xl font-semibold">{t("uninvoiced")}</h2>
      {missingPrice.length > 0 ? (
        <section className="surface-card mt-4 space-y-3 p-5">
          <h3 className="font-semibold">{t("missing_price")}</h3>
          {missingPrice.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {line.customerName} · {formatDate(line.deliveredAt, lang)} · {line.productName} ·{" "}
                {line.quantity} {t("pcs")}
              </span>
              <span className="flex shrink-0 gap-3">
                <button
                  type="button"
                  className="font-semibold text-primary"
                  onClick={() => openPriceAgreement(line)}
                >
                  {t("open_price_agreement")}
                </button>
                <button
                  type="button"
                  className="font-semibold text-primary"
                  onClick={() => void freezePrice(line)}
                >
                  {t("freeze_price")}
                </button>
              </span>
            </div>
          ))}
        </section>
      ) : null}
      {missingRecipient.length > 0 ? (
        <section className="surface-card mt-4 p-5">
          <h3 className="font-semibold">{t("invoice_recipient_missing")}</h3>
          {missingRecipient.map((line) => (
            <p key={line.id} className="mt-2 text-sm text-muted-foreground">
              {line.customerName} · {formatDate(line.deliveredAt, lang)} · {line.quantity}{" "}
              {t("pcs")}
              {" · "}
              {line.customerType === "wholesaler" ? (
                <Link
                  to="/admin/wholesalers/$customerId"
                  params={{ customerId: line.customerId }}
                  className="font-semibold text-primary"
                >
                  {t("open_customer")}
                </Link>
              ) : (
                <Link
                  to="/admin/venues/$venueId"
                  params={{ venueId: line.customerId }}
                  className="font-semibold text-primary"
                >
                  {t("open_customer")}
                </Link>
              )}
            </p>
          ))}
        </section>
      ) : null}
      {[...groups.entries()].map(([legalEntityId, lines]) => {
        const entity = entities.find((row) => row.id === legalEntityId);
        const chosen = lines.filter((line) => !skipped[line.id]);
        const totalOre = chosen.reduce(
          (sum, line) => sum + line.quantity * (line.unitPriceOre ?? 0),
          0,
        );
        const totalQty = chosen.reduce((sum, line) => sum + line.quantity, 0);
        return (
          <section key={legalEntityId} className="surface-card mt-4 space-y-3 p-5">
            <h3 className="font-semibold">{entity?.legal_name ?? legalEntityId}</h3>
            <p className="text-xs text-muted-foreground">{entity?.organization_number}</p>
            {lines.map((line) => (
              <label key={line.id} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!skipped[line.id]}
                  onChange={() =>
                    setSkipped((current) => {
                      const next = { ...current };
                      if (next[line.id]) delete next[line.id];
                      else next[line.id] = true;
                      return next;
                    })
                  }
                />
                <span>
                  {line.orderNumber ? `${line.orderNumber} · ` : ""}
                  {line.customerName} · {formatDate(line.deliveredAt, lang)} · {line.quantity} ×{" "}
                  {formatPriceNok(line.unitPriceOre)} kr · {line.productName}
                </span>
              </label>
            ))}
            <p className="font-semibold">
              {totalQty} {t("pcs")} · {formatPriceNok(totalOre)} kr
            </p>
            <PrimaryButton
              type="button"
              disabled={busy || chosen.length === 0}
              onClick={() => void createDraft(legalEntityId, chosen)}
            >
              {t("create_invoice_draft")}
            </PrimaryButton>
          </section>
        );
      })}

      {bundle.data?.pendingSql ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("dnb_pending_sql")}</p>
      ) : null}

      <h2 className="mt-10 text-xl font-semibold">{t("invoice_drafts")}</h2>
      <div className="mt-4 space-y-3">
        {(bundle.data?.drafts ?? []).map((draft) => {
          const lines = (draft.invoice_draft_lines ?? []).filter(
            (line) => line.active || draft.status !== "draft",
          );
          const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price_ore, 0);
          const transferStatus = "transfer_status" in draft ? draft.transfer_status : null;
          const dnbStatus = "dnb_status" in draft ? draft.dnb_status : null;
          const locked =
            transferStatus === "queued" ||
            transferStatus === "transferred" ||
            transferStatus === "needs_review";
          return (
            <article key={draft.id} className="surface-card space-y-2 p-5">
              <p className="font-semibold">
                {draft.legal_name_snapshot} · {draft.organization_number_snapshot}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(statusKey(draft.status))}
                {transferStatus && transferStatus !== "transferred"
                  ? ` · ${t(transferLabel(transferStatus))}`
                  : ""}
                {transferStatus === "transferred" && (!dnbStatus || dnbStatus === "draft")
                  ? ` · ${t("dnb_waiting")}`
                  : ""}
                {dnbStatus && dnbStatus !== "draft" ? ` · ${t(dnbLabel(dnbStatus))}` : ""}
                {" · "}
                {formatDate(draft.created_at, lang)} · {formatPriceNok(total)} kr
              </p>
              {"transfer_reference" in draft && draft.transfer_reference ? (
                <p className="text-xs text-muted-foreground">
                  {t("dnb_reference")}: {draft.transfer_reference}
                  {"payment_due_on" in draft && draft.payment_due_on
                    ? ` · ${t("dnb_due")}: ${formatDate(draft.payment_due_on, lang)}`
                    : ""}
                  {"vat_percent" in draft && draft.vat_percent != null
                    ? ` · ${t("dnb_vat")}: ${draft.vat_percent} %`
                    : ""}
                  {"accounting_invoice_number" in draft && draft.accounting_invoice_number
                    ? ` · ${t("invoice_number")}: ${draft.accounting_invoice_number}`
                    : ""}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("dnb_price_ex_vat")}</p>
              {lines.map((line) => (
                <p key={line.id} className="text-sm text-muted-foreground">
                  {line.venue_name_snapshot} · {line.product_name_snapshot} · {line.quantity} ×{" "}
                  {formatPriceNok(line.unit_price_ore)} kr
                </p>
              ))}
              {"transfer_error" in draft && draft.transfer_error ? (
                <p className="text-sm text-destructive">{draft.transfer_error}</p>
              ) : null}
              {"vat_percent" in draft && draft.status === "draft" && !locked ? (
                <div className="flex flex-wrap gap-3">
                  <label className="text-sm">
                    <span className="mb-1 block text-muted-foreground">{t("dnb_vat")}</span>
                    <select
                      value={draft.vat_percent ?? 15}
                      onChange={(event) =>
                        void saveTerms(draft.id, { vat_percent: Number(event.target.value) })
                      }
                      className="h-10 rounded-xl border border-border bg-card px-3"
                    >
                      <option value={15}>15 %</option>
                      <option value={25}>25 %</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-muted-foreground">{t("dnb_due")}</span>
                    <input
                      type="date"
                      value={draft.payment_due_on ?? ""}
                      onChange={(event) =>
                        void saveTerms(draft.id, { payment_due_on: event.target.value })
                      }
                      className="h-10 rounded-xl border border-border bg-card px-3"
                    />
                  </label>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                {transferStatus && draft.status === "draft" && transferStatus !== "transferred" ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-sm font-semibold text-primary disabled:opacity-60"
                    onClick={() => void runTransfer(draft.id)}
                  >
                    {t("dnb_transfer")}
                  </button>
                ) : null}
                {transferStatus && transferStatus !== "not_transferred" ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-sm font-semibold disabled:opacity-60"
                    onClick={() => void runRefresh(draft.id)}
                  >
                    {t("dnb_refresh")}
                  </button>
                ) : null}
                {draft.status === "draft" && !transferStatus ? (
                  <button
                    type="button"
                    className="text-sm font-semibold"
                    onClick={() => void setStatus(draft.id, "sent")}
                  >
                    {t("invoice_mark_sent")}
                  </button>
                ) : null}
                {(draft.status === "draft" || draft.status === "sent") && !locked ? (
                  <button
                    type="button"
                    className="text-sm font-semibold text-muted-foreground"
                    onClick={() => void setStatus(draft.id, "cancelled")}
                  >
                    {t("cancel")}
                  </button>
                ) : null}
                {draft.status === "sent" ? (
                  <button
                    type="button"
                    className="text-sm font-semibold"
                    onClick={() => void setStatus(draft.id, "credited")}
                  >
                    {t("invoice_credit")}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}

function groupSales(
  lines: SaleLine[],
  links: { id: string; parentLegalEntityId: string | null }[],
): Map<string, SaleLine[]> {
  const groups = new Map<string, SaleLine[]>();
  for (const line of lines) {
    const recipient = billingLegalEntityId(
      { legalEntityId: line.legalEntityId, billingLegalEntityId: line.billingLegalEntityId },
      links,
    );
    if (!recipient) continue;
    groups.set(recipient, [...(groups.get(recipient) ?? []), line]);
  }
  return groups;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
