import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRequireCommercial } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { formatPriceNok } from "@/lib/slug";
import { billingLegalEntityId, isUninvoicedSale, type CommercialRoute } from "@/lib/economy";
import type { TranslationKey } from "@/lib/i18n";
import { PrimaryButton } from "@/components/field";

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
  quantity: number;
  unitPriceOre: number | null;
  productName: string;
  deliveredAt: string;
  customerId: string;
  customerName: string;
  commercialRoute: CommercialRoute;
  legalEntityId: string | null;
  billingLegalEntityId: string | null;
};

function AdminInvoices() {
  const { t, lang } = useI18n();
  const { allowed, isLoading } = useRequireCommercial();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const bundle = useQuery({
    queryKey: ["invoice-desk"],
    queryFn: async () => {
      const [linesRes, allocatedRes, entitiesRes, draftsRes] = await Promise.all([
        supabase
          .from("delivery_lines")
          .select(
            "id, quantity, unit_price_ore, product_name_snapshot, deliveries!inner(delivered_at, customer_id, customer_name_snapshot, commercial_route, customers!deliveries_customer_id_fkey(legal_entity_id, billing_legal_entity_id))",
          )
          .limit(1000),
        supabase.from("invoice_draft_lines").select("delivery_line_id").eq("active", true),
        supabase.from("legal_entities").select("id, legal_name, organization_number, parent_legal_entity_id"),
        supabase
          .from("invoice_drafts")
          .select("id, status, legal_name_snapshot, organization_number_snapshot, created_at, invoice_draft_lines(id, venue_name_snapshot, product_name_snapshot, quantity, unit_price_ore, active)")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (linesRes.error) throw linesRes.error;
      if (allocatedRes.error) throw allocatedRes.error;
      if (entitiesRes.error) throw entitiesRes.error;
      if (draftsRes.error) throw draftsRes.error;
      return {
        lines: linesRes.data ?? [],
        allocated: new Set((allocatedRes.data ?? []).map((row) => row.delivery_line_id)),
        entities: entitiesRes.data ?? [],
        drafts: draftsRes.data ?? [],
      };
    },
  });

  if (isLoading || !allowed) return <main className="min-h-screen" />;

  const entities = bundle.data?.entities ?? [];
  const links = entities.map((entity) => ({
    id: entity.id,
    parentLegalEntityId: entity.parent_legal_entity_id,
  }));
  const sales: SaleLine[] = (bundle.data?.lines ?? []).flatMap((row) => {
    const delivery = Array.isArray(row.deliveries) ? row.deliveries[0] : row.deliveries;
    if (!delivery || delivery.commercial_route !== "direct") return [];
    const customer = Array.isArray(delivery.customers) ? delivery.customers[0] : delivery.customers;
    return [
      {
        id: row.id,
        quantity: row.quantity,
        unitPriceOre: row.unit_price_ore,
        productName: row.product_name_snapshot,
        deliveredAt: delivery.delivered_at,
        customerId: delivery.customer_id,
        customerName: delivery.customer_name_snapshot,
        commercialRoute: delivery.commercial_route,
        legalEntityId: customer?.legal_entity_id ?? null,
        billingLegalEntityId: customer?.billing_legal_entity_id ?? null,
      },
    ];
  });
  const allocated = bundle.data?.allocated ?? new Set<string>();
  const missingPrice = sales.filter((line) => line.unitPriceOre == null);
  const ready = sales.filter((line) =>
    isUninvoicedSale({
      commercialRoute: line.commercialRoute,
      unitPriceOre: line.unitPriceOre,
      hasActiveAllocation: allocated.has(line.id),
    }),
  );
  const groups = new Map<string, SaleLine[]>();
  const missingRecipient: SaleLine[] = [];
  for (const line of ready) {
    const recipient = billingLegalEntityId(
      { legalEntityId: line.legalEntityId, billingLegalEntityId: line.billingLegalEntityId },
      links,
    );
    if (!recipient) {
      missingRecipient.push(line);
      continue;
    }
    groups.set(recipient, [...(groups.get(recipient) ?? []), line]);
  }

  async function freezePrice(lineId: string) {
    const { error } = await supabase.from("delivery_lines").update({ unit_price_ore: 1 }).eq("id", lineId);
    if (error) {
      toast.error(error.message.includes("missing price") ? t("price_required") : error.message);
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
        delivery_line_id: line.id,
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
                {line.customerName} · {formatDate(line.deliveredAt, lang)} · {line.productName} · {line.quantity}{" "}
                {t("pcs")}
              </span>
              <button type="button" className="font-semibold text-primary" onClick={() => void freezePrice(line.id)}>
                {t("freeze_price")}
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {missingRecipient.length > 0 ? (
        <section className="surface-card mt-4 p-5">
          <h3 className="font-semibold">{t("invoice_recipient_missing")}</h3>
          {missingRecipient.map((line) => (
            <p key={line.id} className="mt-2 text-sm text-muted-foreground">
              {line.customerName} · {formatDate(line.deliveredAt, lang)} · {line.quantity} {t("pcs")}
            </p>
          ))}
        </section>
      ) : null}
      {[...groups.entries()].map(([legalEntityId, lines]) => {
        const entity = entities.find((row) => row.id === legalEntityId);
        const totalOre = lines.reduce((sum, line) => sum + line.quantity * (line.unitPriceOre ?? 0), 0);
        const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
        return (
          <section key={legalEntityId} className="surface-card mt-4 space-y-3 p-5">
            <h3 className="font-semibold">{entity?.legal_name ?? legalEntityId}</h3>
            <p className="text-xs text-muted-foreground">{entity?.organization_number}</p>
            {lines.map((line) => (
              <p key={line.id} className="text-sm">
                {line.customerName} · {formatDate(line.deliveredAt, lang)} · {line.quantity} ×{" "}
                {formatPriceNok(line.unitPriceOre)} kr · {line.productName}
              </p>
            ))}
            <p className="font-semibold">
              {totalQty} {t("pcs")} · {formatPriceNok(totalOre)} kr
            </p>
            <PrimaryButton type="button" disabled={busy} onClick={() => void createDraft(legalEntityId, lines)}>
              {t("create_invoice_draft")}
            </PrimaryButton>
          </section>
        );
      })}

      <h2 className="mt-10 text-xl font-semibold">{t("invoice_drafts")}</h2>
      <div className="mt-4 space-y-3">
        {(bundle.data?.drafts ?? []).map((draft) => {
          const lines = (draft.invoice_draft_lines ?? []).filter((line) => line.active || draft.status !== "draft");
          const total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price_ore, 0);
          return (
            <article key={draft.id} className="surface-card space-y-2 p-5">
              <p className="font-semibold">
                {draft.legal_name_snapshot} · {draft.organization_number_snapshot}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(statusKey(draft.status))} · {formatDate(draft.created_at, lang)} · {formatPriceNok(total)} kr
              </p>
              {lines.map((line) => (
                <p key={line.id} className="text-sm text-muted-foreground">
                  {line.venue_name_snapshot} · {line.product_name_snapshot} · {line.quantity} ×{" "}
                  {formatPriceNok(line.unit_price_ore)} kr
                </p>
              ))}
              <div className="flex gap-2">
                {draft.status === "draft" ? (
                  <button type="button" className="text-sm font-semibold" onClick={() => void setStatus(draft.id, "sent")}>
                    {t("invoice_mark_sent")}
                  </button>
                ) : null}
                {draft.status === "draft" || draft.status === "sent" ? (
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
