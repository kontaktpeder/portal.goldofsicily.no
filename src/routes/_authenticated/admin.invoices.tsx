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
import { dnbInvoiceHref } from "@/lib/dnb-invoice";
import { billingLegalEntityId, type CommercialRoute } from "@/lib/economy";
import { legacyInvoicePortions, orderInvoicePortions, waitingInvoiceOrders } from "@/lib/orders";
import { refreshInvoiceDraft, transferInvoiceDraft } from "@/lib/admin.functions";
import type { TranslationKey } from "@/lib/i18n";
import { PrimaryButton } from "@/components/field";

const draftSelect =
  "id, status, legal_name_snapshot, organization_number_snapshot, created_at, transfer_status, transfer_reference, dnb_status, payment_due_on, vat_percent, transfer_error, accounting_invoice_id, accounting_invoice_number, invoice_draft_lines(id, venue_name_snapshot, product_name_snapshot, quantity, unit_price_ore, active)";
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
  const [legacyChosen, setLegacyChosen] = useState<Record<string, true>>({});
  const [openOrder, setOpenOrder] = useState<Record<string, true>>({});
  const [openDraft, setOpenDraft] = useState<Record<string, true>>({});
  const transfer = useServerFn(transferInvoiceDraft);
  const refreshStatus = useServerFn(refreshInvoiceDraft);

  const bundle = useQuery({
    queryKey: ["invoice-desk"],
    queryFn: async () => {
      const [linesRes, allocatedRes, fulfillmentRes, entitiesRes, draftsRes, orderLinesRes] =
        await Promise.all([
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
              "id, quantity, delivery_line_id, customer_order_lines!order_line_fulfillments_order_line_id_fkey(unit_price_ore, product_name_snapshot, customer_orders!customer_order_lines_order_id_fkey(id, order_number, billing_legal_entity_id, billing_legal_name_snapshot))",
            ),
          supabase
            .from("legal_entities")
            .select("id, legal_name, organization_number, parent_legal_entity_id"),
          supabase
            .from("invoice_drafts")
            .select(draftSelect)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("customer_order_lines")
            .select(
              "order_id, quantity, customer_orders!customer_order_lines_order_id_fkey(id, order_number, status, billing_legal_name_snapshot, customers!customer_orders_ordered_by_customer_id_fkey(name))",
            ),
        ]);
      if (linesRes.error) throw linesRes.error;
      if (entitiesRes.error) throw entitiesRes.error;
      if (orderLinesRes.error) {
        if (!/customer_order_lines|customer_orders/.test(orderLinesRes.error.message)) {
          throw orderLinesRes.error;
        }
      }
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
        orderLines: orderLinesRes.error ? [] : (orderLinesRes.data ?? []),
      };
    },
  });

  if (isLoading || !allowed) return <main className="min-h-screen" />;

  const entities = bundle.data?.entities ?? [];
  const links = entities.map((entity) => ({
    id: entity.id,
    parentLegalEntityId: entity.parent_legal_entity_id,
  }));
  const activeInvoices = (bundle.data?.activeInvoices ?? []).map((row) => ({
    deliveryLineId: row.delivery_line_id,
    fulfillmentId: row.order_line_fulfillment_id,
    quantity: row.quantity,
  }));
  const fulfillmentRows = (bundle.data?.fulfillments ?? []).flatMap((row) => {
    const orderLine = one(row.customer_order_lines);
    const sale = one(orderLine?.customer_orders ?? null);
    if (!orderLine?.unit_price_ore || !sale?.billing_legal_entity_id || !sale.id) return [];
    return [
      {
        id: row.id,
        deliveryLineId: row.delivery_line_id,
        quantity: row.quantity,
        unitPriceOre: orderLine.unit_price_ore,
        billingLegalEntityId: sale.billing_legal_entity_id,
        orderId: sale.id,
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
  const fulfilledByOrder = new Map<string, number>();
  for (const row of fulfillmentRows) {
    fulfilledByOrder.set(row.orderId, (fulfilledByOrder.get(row.orderId) ?? 0) + row.quantity);
  }
  const orderHeads = new Map<
    string,
    { orderNumber: string; customerName: string; orderedQuantity: number }
  >();
  for (const line of bundle.data?.orderLines ?? []) {
    const sale = one(line.customer_orders);
    if (!sale || sale.status !== "confirmed") continue;
    const customer = one(sale.customers);
    const current = orderHeads.get(sale.id) ?? {
      orderNumber: sale.order_number,
      customerName: customer?.name || sale.billing_legal_name_snapshot || sale.order_number,
      orderedQuantity: 0,
    };
    current.orderedQuantity += line.quantity;
    orderHeads.set(sale.id, current);
  }
  const uninvoicedByOrder = new Map<
    string,
    { productName: string; quantity: number; unitPriceOre: number }[]
  >();
  for (const portion of orderQty) {
    const meta = fulfillmentRows.find((row) => row.id === portion.id);
    if (!meta) continue;
    const list = uninvoicedByOrder.get(meta.orderId) ?? [];
    list.push({
      productName: meta.productName || "—",
      quantity: portion.quantity,
      unitPriceOre: portion.unitPriceOre,
    });
    uninvoicedByOrder.set(meta.orderId, list);
  }
  const waiting = waitingInvoiceOrders(
    [...orderHeads.entries()].map(([orderId, head]) => ({
      orderId,
      orderNumber: head.orderNumber,
      customerName: head.customerName,
      orderedQuantity: head.orderedQuantity,
      fulfilledQuantity: fulfilledByOrder.get(orderId) ?? 0,
      lines: uninvoicedByOrder.get(orderId) ?? [],
    })),
  );
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

  async function createLegacyDrafts() {
    const chosen = ready.filter((line) => legacyChosen[line.id] && line.billingLegalEntityId);
    const byEntity = new Map<string, SaleLine[]>();
    for (const line of chosen) {
      const entityId = line.billingLegalEntityId;
      if (!entityId) continue;
      byEntity.set(entityId, [...(byEntity.get(entityId) ?? []), line]);
    }
    for (const [entityId, lines] of byEntity) {
      await createDraft(entityId, lines);
    }
    setLegacyChosen({});
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
      <h2 className="mt-8 text-xl font-semibold">{t("orders_invoice_waiting")}</h2>
      {waiting.map((row) => (
        <article key={row.orderId} className="surface-card mt-4 space-y-2 p-5">
          <p className="font-semibold">
            {row.customerName} · {row.orderNumber}
          </p>
          <p className="text-sm">
            {t("orders_invoice_waiting")} · {row.quantity} {t("pcs")} ·{" "}
            {formatPriceNok(row.amountOre)} kr {t("orders_invoice_ex_vat")}
          </p>
          <p className="text-sm">
            {t("orders_invoice_next")}:{" "}
            <Link
              to="/admin/orders/$orderId"
              params={{ orderId: row.orderId }}
              className="font-semibold text-primary"
            >
              {t("orders_prepare_invoice")}
            </Link>
          </p>
          <button
            type="button"
            className="text-sm font-semibold"
            onClick={() =>
              setOpenOrder((current) => {
                const next = { ...current };
                if (next[row.orderId]) delete next[row.orderId];
                else next[row.orderId] = true;
                return next;
              })
            }
          >
            {openOrder[row.orderId]
              ? t("orders_invoice_hide_lines")
              : t("orders_invoice_show_lines")}
          </button>
          {openOrder[row.orderId]
            ? row.lines.map((line, index) => (
                <p key={`${row.orderId}-${index}`} className="text-sm text-muted-foreground">
                  {line.productName} · {line.quantity} × {formatPriceNok(line.unitPriceOre)} kr
                </p>
              ))
            : null}
        </article>
      ))}

      {ready.length > 0 ? (
        <section className="surface-card mt-8 space-y-3 p-5">
          <h2 className="text-xl font-semibold">{t("orders_invoice_legacy")}</h2>
          <p className="text-sm text-muted-foreground">{t("orders_invoice_legacy_hint")}</p>
          {ready.map((line) => (
            <label key={line.id} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(legacyChosen[line.id])}
                onChange={() =>
                  setLegacyChosen((current) => {
                    const next = { ...current };
                    if (next[line.id]) delete next[line.id];
                    else next[line.id] = true;
                    return next;
                  })
                }
              />
              <span>
                {line.customerName} · {formatDate(line.deliveredAt, lang)} · {line.quantity} ×{" "}
                {formatPriceNok(line.unitPriceOre)} kr · {line.productName}
              </span>
            </label>
          ))}
          <PrimaryButton
            type="button"
            disabled={busy || !ready.some((line) => legacyChosen[line.id])}
            onClick={() => void createLegacyDrafts()}
          >
            {t("create_invoice_draft")}
          </PrimaryButton>
        </section>
      ) : null}

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
              <p className="text-sm">
                {t("orders_invoice_next")}:{" "}
                {transferStatus && draft.status === "draft" && transferStatus !== "transferred"
                  ? t("dnb_transfer")
                  : transferStatus === "transferred"
                    ? t("orders_open_dnb")
                    : t(statusKey(draft.status))}
              </p>
              <p className="text-xs text-muted-foreground">{t("dnb_price_ex_vat")}</p>
              <button
                type="button"
                className="text-sm font-semibold"
                onClick={() =>
                  setOpenDraft((current) => {
                    const next = { ...current };
                    if (next[draft.id]) delete next[draft.id];
                    else next[draft.id] = true;
                    return next;
                  })
                }
              >
                {openDraft[draft.id]
                  ? t("orders_invoice_hide_lines")
                  : t("orders_invoice_show_lines")}
              </button>
              {openDraft[draft.id]
                ? lines.map((line) => (
                    <p key={line.id} className="text-sm text-muted-foreground">
                      {line.venue_name_snapshot} · {line.product_name_snapshot} · {line.quantity} ×{" "}
                      {formatPriceNok(line.unit_price_ore)} kr
                    </p>
                  ))
                : null}
              {"accounting_invoice_id" in draft && draft.accounting_invoice_id ? (
                <a
                  href={dnbInvoiceHref(draft.accounting_invoice_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-sm font-semibold text-primary"
                >
                  {t("orders_open_dnb")}
                </a>
              ) : null}
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

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
