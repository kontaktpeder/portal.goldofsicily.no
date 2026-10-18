import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";
import { supabase } from "@/integrations/supabase/client";
import { listStaffAccounts } from "@/lib/admin.functions";
import { useSessionInfo } from "@/hooks/use-session";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { formatPriceNok } from "@/lib/slug";
import {
  canCancelOrder,
  fulfillmentBlock,
  orderProgress,
  remainingQuantity,
  type OrderProgress,
  type OrderWorkflow,
} from "@/lib/orders";
import { errorMessage } from "@/lib/utils";

const fieldClass =
  "h-11 w-full rounded-2xl border-2 border-border bg-card px-3 text-sm outline-none focus:border-primary";

const PROGRESS_KEY: Record<OrderProgress, TranslationKey> = {
  draft: "orders_status_draft",
  pending_confirmation: "orders_status_pending_confirmation",
  confirmed: "orders_status_confirmed",
  partially_delivered: "orders_status_partially_delivered",
  delivered: "orders_status_delivered",
  cancelled: "orders_status_cancelled",
};

export const Route = createFileRoute("/_authenticated/admin/orders/$orderId")({
  head: () => ({
    meta: [
      { title: "Ordre — Gold of Sicily" },
      { name: "description", content: "Confirm an order and link deliveries." },
    ],
  }),
  component: OrderPage,
});

function OrderPage() {
  const { orderId } = Route.useParams();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const session = useSessionInfo();
  const commercial = Boolean(session.data?.canManageCommercial);
  const staffFn = useServerFn(listStaffAccounts);
  const [busy, setBusy] = useState(false);
  const [confirmedOn, setConfirmedOn] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [deviation, setDeviation] = useState("");
  const [linkQty, setLinkQty] = useState<Record<string, string>>({});

  const order = useQuery({
    queryKey: ["customer-order", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_orders")
        .select(
          "id, order_number, status, contact_name, desired_delivery_on, confirmed_delivery_on, billing_legal_name_snapshot, billing_organization_number_snapshot, owner_id, owner_name_snapshot, due_on, deviation_note, notes, ordered_by_customer_id, ship_to_customer_id, ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(id, name, type), ship_to:customers!customer_orders_ship_to_customer_id_fkey(id, name)",
        )
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const lines = useQuery({
    queryKey: ["customer-order-lines", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_order_lines")
        .select(
          "id, product_id, quantity, unit_price_ore, product_name_snapshot, products(name_no, name_en)",
        )
        .eq("order_id", orderId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const fulfillments = useQuery({
    queryKey: ["customer-order-fulfillments", orderId],
    queryFn: async () => {
      const lineIds = (lines.data ?? []).map((line) => line.id);
      if (lineIds.length === 0) return [];
      const { data, error } = await supabase
        .from("order_line_fulfillments")
        .select("id, order_line_id, delivery_line_id, quantity")
        .in("order_line_id", lineIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: lines.isSuccess,
  });

  const deliveries = useQuery({
    queryKey: ["order-delivery-candidates", order.data?.ship_to_customer_id],
    enabled: order.data?.status === "confirmed" && Boolean(order.data.ship_to_customer_id),
    queryFn: async () => {
      const shipTo = order.data?.ship_to_customer_id;
      if (!shipTo) return { lines: [], linked: [] };
      const { data, error } = await supabase
        .from("delivery_lines")
        .select(
          "id, quantity, product_id, product_name_snapshot, gold_lots(lot_code), deliveries!inner(customer_id, delivered_at)",
        )
        .eq("deliveries.customer_id", shipTo);
      if (error) throw error;
      const ids = (data ?? []).map((line) => line.id);
      const linked = ids.length
        ? await supabase
            .from("order_line_fulfillments")
            .select("delivery_line_id, quantity")
            .in("delivery_line_id", ids)
        : { data: [], error: null };
      if (linked.error) throw linked.error;
      return { lines: data ?? [], linked: linked.data ?? [] };
    },
  });

  const staff = useQuery({
    queryKey: ["order-staff"],
    enabled: commercial,
    queryFn: () => staffFn(),
  });

  const row = order.data;
  const orderLines = lines.data ?? [];
  const linked = fulfillments.data ?? [];
  const orderedQty = orderLines.reduce((sum, line) => sum + line.quantity, 0);
  const fulfilledQty = linked.reduce((sum, line) => sum + line.quantity, 0);
  const progress = row ? orderProgress(row.status, orderedQty, fulfilledQty) : "draft";

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["customer-order", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["customer-order-lines", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["customer-order-fulfillments", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["order-delivery-candidates"] });
    await queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
    await queryClient.invalidateQueries({ queryKey: ["invoice-desk"] });
    await queryClient.invalidateQueries({ queryKey: ["ops-home"] });
  }

  async function setStatus(status: "pending_confirmation" | "confirmed" | "cancelled") {
    if (!row || !commercial) return;
    setBusy(true);
    const patch =
      status === "confirmed"
        ? {
            status,
            confirmed_delivery_on:
              confirmedOn || row.confirmed_delivery_on || row.desired_delivery_on,
            owner_id: ownerId || row.owner_id,
          }
        : { status };
    const { error } = await supabase.from("customer_orders").update(patch).eq("id", row.id);
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("missing price") ? t("orders_price_missing") : error.message,
      );
      return;
    }
    toast.success(
      status === "cancelled"
        ? t("orders_cancelled")
        : status === "confirmed"
          ? t("orders_confirmed")
          : t("orders_saved"),
    );
    await refresh();
  }

  async function saveWork() {
    if (!row || !commercial) return;
    setBusy(true);
    const { error } = await supabase
      .from("customer_orders")
      .update({
        owner_id: ownerId || row.owner_id,
        due_on: dueOn || row.due_on,
        deviation_note: (deviation || row.deviation_note || "").trim() || null,
      })
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error, t("invoice_failed")));
      return;
    }
    toast.success(t("orders_saved"));
    await refresh();
  }

  async function link(orderLineId: string, deliveryLineId: string) {
    const quantity = Number.parseInt(linkQty[orderLineId] ?? "", 10);
    const orderLine = orderLines.find((line) => line.id === orderLineId);
    const candidate = (deliveries.data?.lines ?? []).find((line) => line.id === deliveryLineId);
    if (!row || !orderLine || !candidate) return;
    const alreadyFulfilled = linked
      .filter((item) => item.order_line_id === orderLineId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const alreadyOnDelivery = (deliveries.data?.linked ?? [])
      .filter((item) => item.delivery_line_id === deliveryLineId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const block = fulfillmentBlock({
      orderStatus: row.status,
      ordered: orderLine.quantity,
      alreadyFulfilled,
      delivered: candidate.quantity,
      alreadyOnDelivery,
      legacyInvoiced: 0,
      quantity: Number.isInteger(quantity) ? quantity : 0,
      sameProduct: candidate.product_id === orderLine.product_id,
      sameSite: true,
    });
    if (block) {
      toast.error(block);
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("order_line_fulfillments").insert({
      order_line_id: orderLineId,
      delivery_line_id: deliveryLineId,
      quantity,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("orders_link_saved"));
    await refresh();
  }

  if (!row) return <main className="min-h-screen" />;
  const orderer = one(row.ordered_by);
  const site = one(row.ship_to);
  const open = row.status === "draft" || row.status === "pending_confirmation";

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <p className="pt-8 text-sm text-muted-foreground">
        <Link to="/admin/orders" className="font-semibold">
          {t("orders_title")}
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-semibold">{row.order_number}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t(PROGRESS_KEY[progress])} · {orderer?.name ?? "—"} → {site?.name ?? "—"}
        {row.contact_name ? ` · ${row.contact_name}` : ""}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("orders_desired_date")}:{" "}
        {row.desired_delivery_on ? formatDate(row.desired_delivery_on, lang) : "—"}
        {" · "}
        {t("orders_confirmed_date")}:{" "}
        {row.confirmed_delivery_on ? formatDate(row.confirmed_delivery_on, lang) : "—"}
        {" · "}
        {t("orders_remaining")} {remainingQuantity(orderedQty, fulfilledQty)}
      </p>
      {row.billing_legal_name_snapshot ? (
        <p className="mt-3 text-sm">
          {t("orders_recipient")}: {row.billing_legal_name_snapshot} ·{" "}
          {row.billing_organization_number_snapshot}
        </p>
      ) : null}
      {row.status === "confirmed" ? (
        <p className="mt-1 text-sm text-muted-foreground">{t("orders_frozen")}</p>
      ) : null}

      <section className="mt-8 space-y-3">
        {orderLines.map((line) => {
          const product = one(line.products);
          const name =
            line.product_name_snapshot ||
            (lang === "en" ? product?.name_en : product?.name_no) ||
            "—";
          const done = linked
            .filter((item) => item.order_line_id === line.id)
            .reduce((sum, item) => sum + item.quantity, 0);
          const candidates = (deliveries.data?.lines ?? []).filter((delivery) => {
            if (delivery.product_id !== line.product_id) return false;
            const used = (deliveries.data?.linked ?? [])
              .filter((item) => item.delivery_line_id === delivery.id)
              .reduce((sum, item) => sum + item.quantity, 0);
            return delivery.quantity - used > 0;
          });
          return (
            <article key={line.id} className="surface-card space-y-3 p-5">
              <p className="font-semibold">{name}</p>
              <p className="text-sm text-muted-foreground">
                {t("orders_ordered_qty")} {line.quantity} · {t("orders_delivered_qty")} {done} ·{" "}
                {t("orders_remaining")} {remainingQuantity(line.quantity, done)}
                {line.unit_price_ore ? ` · ${formatPriceNok(line.unit_price_ore)} kr` : ""}
              </p>
              {row.status === "confirmed" && remainingQuantity(line.quantity, done) > 0 ? (
                candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("orders_link_empty")}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className={`${fieldClass} max-w-28`}
                      inputMode="numeric"
                      value={linkQty[line.id] ?? ""}
                      onChange={(event) =>
                        setLinkQty((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                    />
                    {candidates.map((delivery) => {
                      const parent = one(delivery.deliveries);
                      const lot = one(delivery.gold_lots);
                      return (
                        <button
                          key={delivery.id}
                          type="button"
                          disabled={busy}
                          className="rounded-full border border-border px-3 py-2 text-sm"
                          onClick={() => void link(line.id, delivery.id)}
                        >
                          {t("orders_link")}{" "}
                          {parent?.delivered_at ? formatDate(parent.delivered_at, lang) : ""}{" "}
                          {lot?.lot_code ?? ""}
                        </button>
                      );
                    })}
                  </div>
                )
              ) : null}
            </article>
          );
        })}
      </section>

      {commercial && open ? (
        <section className="surface-card mt-8 space-y-4 p-5">
          <h2 className="text-lg font-semibold">{t("orders_confirm")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("orders_confirmed_date")}
              type="date"
              value={confirmedOn || row.confirmed_delivery_on || row.desired_delivery_on || ""}
              onChange={setConfirmedOn}
            />
            <label className="block">
              <span className="eyebrow mb-2 block">{t("orders_owner")}</span>
              <select
                className={fieldClass}
                value={ownerId || row.owner_id || ""}
                onChange={(event) => setOwnerId(event.target.value)}
              >
                <option value="" />
                {(staff.data?.staff ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName || person.username}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {row.status === "draft" ? (
              <button
                type="button"
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
                disabled={busy}
                onClick={() => void setStatus("pending_confirmation")}
              >
                {t("orders_send_confirm")}
              </button>
            ) : null}
            <PrimaryButton
              type="button"
              disabled={busy}
              onClick={() => void setStatus("confirmed")}
            >
              {t("orders_confirm")}
            </PrimaryButton>
          </div>
        </section>
      ) : null}

      {commercial ? (
        <section className="surface-card mt-8 space-y-4 p-5">
          <h2 className="text-lg font-semibold">{t("orders_work")}</h2>
          <p className="text-sm text-muted-foreground">
            {row.owner_name_snapshot ?? "—"}
            {row.due_on ? ` · ${formatDate(row.due_on, lang)}` : ""}
          </p>
          <TextField
            label={t("orders_due")}
            type="date"
            value={dueOn || row.due_on || ""}
            onChange={setDueOn}
          />
          <label className="block">
            <span className="eyebrow mb-2 block">{t("orders_deviation")}</span>
            <TextAreaField value={deviation || row.deviation_note || ""} onChange={setDeviation} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
              disabled={busy}
              onClick={() => void saveWork()}
            >
              {t("orders_save")}
            </button>
            {canCancelOrder(row.status, fulfilledQty) ? (
              <button
                type="button"
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
                disabled={busy}
                onClick={() => void setStatus("cancelled")}
              >
                {t("orders_cancel")}
              </button>
            ) : null}
            {row.status === "confirmed" ? (
              <Link
                to="/admin/invoices"
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                {t("invoices")}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
