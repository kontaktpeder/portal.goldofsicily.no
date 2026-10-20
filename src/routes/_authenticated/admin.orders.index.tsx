import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, TextField } from "@/components/field";
import { supabase } from "@/integrations/supabase/client";
import { listProductionStaff } from "@/lib/admin.functions";
import { useSessionInfo } from "@/hooks/use-session";
import { canApproveOrders, canRegisterOrders } from "@/lib/access";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  formatAgreedDelivery,
  isOrderSchemaError,
  orderListBucket,
  orderListRank,
  orderPrimaryAction,
  orderProgress,
  type OrderProgress,
  type OrderWorkflow,
} from "@/lib/orders";
import { errorMessage } from "@/lib/utils";

const fieldClass =
  "h-11 w-full rounded-2xl border-2 border-border bg-card px-3 text-sm outline-none focus:border-primary";

const PROGRESS_KEY: Record<OrderProgress, TranslationKey> = {
  draft: "orders_status_draft",
  pending_confirmation: "orders_status_pending_confirmation",
  changes_requested: "orders_status_changes_requested",
  confirmed: "orders_status_confirmed",
  partially_delivered: "orders_status_partially_delivered",
  delivered: "orders_status_delivered",
  cancelled: "orders_status_cancelled",
};

export const Route = createFileRoute("/_authenticated/admin/orders/")({
  head: () => ({
    meta: [
      { title: "Ordrer — Gold of Sicily" },
      { name: "description", content: "Open orders, approval and delivery." },
    ],
  }),
  component: OrdersPage,
});

type ProductRow = { id: string; name_no: string; name_en: string };

function OrdersPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionInfo();
  const roles = session.data?.roles ?? [];
  const registrar = canRegisterOrders(roles);
  const approver = canApproveOrders(roles);
  const action = orderPrimaryAction(approver);
  const staffFn = useServerFn(listProductionStaff);
  const [openForm, setOpenForm] = useState(false);
  const [orderedBy, setOrderedBy] = useState("");
  const [contact, setContact] = useState("");
  const [desiredOn, setDesiredOn] = useState("");
  const [agreedOn, setAgreedOn] = useState("");
  const [agreedTouched, setAgreedTouched] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const orders = useQuery({
    queryKey: ["customer-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_orders")
        .select(
          "id, order_number, status, contact_name, desired_delivery_on, confirmed_delivery_on, owner_name_snapshot, ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(name), ship_to:customers!customer_orders_ship_to_customer_id_fkey(name), customer_order_lines(quantity, order_line_fulfillments(quantity))",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        if (isOrderSchemaError(error.message)) return { pendingSql: true as const, rows: [] };
        throw error;
      }
      return { pendingSql: false as const, rows: data ?? [] };
    },
  });

  const customers = useQuery({
    queryKey: ["order-customers"],
    enabled: registrar && openForm,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, type")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const products = useQuery({
    queryKey: ["order-products"],
    enabled: registrar && openForm,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name_no, name_en")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  const staff = useQuery({
    queryKey: ["order-production-staff"],
    enabled: approver && openForm,
    queryFn: () => staffFn(),
  });

  function chooseDesired(value: string) {
    setDesiredOn(value);
    if (!agreedTouched) setAgreedOn(value);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!registrar) return;
    const prepared = new Map<string, number>();
    for (const [productId, raw] of Object.entries(quantities)) {
      const quantity = Number.parseInt(raw, 10);
      if (!Number.isInteger(quantity) || quantity <= 0) continue;
      prepared.set(productId, quantity);
    }
    if (!orderedBy || prepared.size === 0) {
      toast.error(t("delivery_missing"));
      return;
    }
    if (action === "approve" && !(agreedOn || desiredOn)) {
      toast.error(t("orders_confirmed_date"));
      return;
    }
    setBusy(true);
    const userId = session.data?.session?.user.id ?? null;
    const { data: created, error } = await supabase
      .from("customer_orders")
      .insert({
        ordered_by_customer_id: orderedBy,
        ship_to_customer_id: orderedBy,
        contact_name: contact.trim() || null,
        desired_delivery_on: desiredOn || null,
        owner_id: ownerId || userId,
        notes: notes.trim() || null,
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !created) {
      setBusy(false);
      toast.error(errorMessage(error, t("orders_save_failed")));
      return;
    }
    const { error: lineError } = await supabase.from("customer_order_lines").insert(
      [...prepared.entries()].map(([productId, quantity]) => ({
        order_id: created.id,
        product_id: productId,
        quantity,
      })),
    );
    if (lineError) {
      await supabase.from("customer_orders").delete().eq("id", created.id);
      setBusy(false);
      toast.error(lineError.message);
      return;
    }
    const patch =
      action === "approve"
        ? {
            status: "confirmed" as const,
            confirmed_delivery_on: agreedOn || desiredOn,
            owner_id: ownerId || userId,
          }
        : { status: "pending_confirmation" as const };
    const { error: statusError } = await supabase
      .from("customer_orders")
      .update(patch)
      .eq("id", created.id);
    setBusy(false);
    if (statusError) {
      toast.error(
        statusError.message.includes("missing price")
          ? t("orders_price_missing")
          : statusError.message.includes("only a production lead")
            ? t("orders_forbidden")
            : isOrderSchemaError(statusError.message)
              ? t("orders_pending_sql")
              : t("orders_save_failed"),
      );
    } else {
      toast.success(action === "approve" ? t("orders_confirmed") : t("orders_submitted"));
    }
    await queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
    await queryClient.invalidateQueries({ queryKey: ["order-approval-notices"] });
    await queryClient.invalidateQueries({ queryKey: ["ops-home"] });
    void navigate({ to: "/admin/orders/$orderId", params: { orderId: created.id } });
  }

  const rows = [...(orders.data?.rows ?? [])].sort((a, b) => {
    const progressA = progressOf(a);
    const progressB = progressOf(b);
    return orderListRank(progressA) - orderListRank(progressB);
  });
  const queue = rows.filter((row) => orderListBucket(progressOf(row)) === "queue");
  const deliver = rows.filter((row) => orderListBucket(progressOf(row)) === "deliver");
  const working = rows.filter((row) => orderListBucket(progressOf(row)) === "working");
  const earlier = rows.filter((row) => orderListBucket(progressOf(row)) === "earlier");
  const chosen = (customers.data ?? []).find((customer) => customer.id === orderedBy) ?? null;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-8">
        <h1 className="text-3xl font-semibold">{t("orders_title")}</h1>
        {registrar ? (
          <button
            type="button"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            onClick={() => setOpenForm((current) => !current)}
          >
            {t("orders_new")}
          </button>
        ) : null}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("orders_intro")}</p>
      {orders.data?.pendingSql ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("orders_pending_sql")}</p>
      ) : null}

      {registrar && openForm ? (
        <form onSubmit={(event) => void save(event)} className="surface-card mt-6 space-y-4 p-5">
          <h2 className="text-lg font-semibold">{t("orders_new")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="eyebrow mb-2 block">{t("orders_orderer")}</span>
              <select
                className={fieldClass}
                value={orderedBy}
                onChange={(event) => setOrderedBy(event.target.value)}
              >
                <option value="" />
                {(customers.data ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
            <TextField label={t("orders_contact")} value={contact} onChange={setContact} />
            <TextField
              label={t("orders_desired_date")}
              type="date"
              value={desiredOn}
              onChange={chooseDesired}
            />
            {action === "approve" ? (
              <TextField
                label={t("orders_confirmed_date")}
                type="date"
                value={agreedOn}
                onChange={(value) => {
                  setAgreedTouched(true);
                  setAgreedOn(value);
                }}
              />
            ) : null}
          </div>
          {chosen ? (
            <p className="text-sm">
              {t("orders_delivers_to")}: <strong>{chosen.name}</strong>
            </p>
          ) : null}
          <div className="space-y-3">
            {(products.data ?? []).map((product) => (
              <label
                key={product.id}
                className="grid items-center gap-3 sm:grid-cols-[1fr_8rem_auto]"
              >
                <span className="font-medium">
                  {lang === "en" ? product.name_en : product.name_no}
                </span>
                <input
                  className={fieldClass}
                  inputMode="numeric"
                  aria-label={lang === "en" ? product.name_en : product.name_no}
                  value={quantities[product.id] ?? ""}
                  onChange={(event) =>
                    setQuantities((current) => ({ ...current, [product.id]: event.target.value }))
                  }
                />
                <span className="text-sm text-muted-foreground">{t("pcs")}</span>
              </label>
            ))}
          </div>
          <details className="rounded-2xl border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">{t("orders_more")}</summary>
            {approver ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="eyebrow mb-2 block">{t("orders_owner")}</span>
                  <select
                    className={fieldClass}
                    value={ownerId}
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
            ) : null}
            <div className="mt-4">
              <TextField label={t("orders_notes")} value={notes} onChange={setNotes} />
            </div>
          </details>
          <PrimaryButton type="submit" disabled={busy}>
            {action === "approve" ? t("orders_confirm") : t("orders_send_confirm")}
          </PrimaryButton>
          <p className="text-sm text-muted-foreground">{t("orders_internal")}</p>
        </form>
      ) : null}

      <OrderGroup title={t("orders_queue")} rows={queue} empty={null} />
      <OrderGroup
        title={t("orders_to_deliver")}
        rows={deliver}
        empty={rows.length === 0 ? t("orders_empty") : null}
      />
      <OrderGroup title={t("orders_working")} rows={working} empty={null} />
      {earlier.length > 0 ? (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
            {t("orders_earlier")}
          </summary>
          <OrderGroup title="" rows={earlier} empty={null} />
        </details>
      ) : null}
    </main>
  );
}

type OrderListRow = {
  id: string;
  order_number: string;
  status: string;
  contact_name: string | null;
  desired_delivery_on: string | null;
  confirmed_delivery_on: string | null;
  owner_name_snapshot: string | null;
  ordered_by: { name: string } | { name: string }[] | null;
  ship_to: { name: string } | { name: string }[] | null;
  customer_order_lines:
    { quantity: number; order_line_fulfillments: { quantity: number }[] | null }[] | null;
};

function progressOf(order: OrderListRow): OrderProgress {
  const ordered = (order.customer_order_lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
  const fulfilled = (order.customer_order_lines ?? []).reduce(
    (sum, line) =>
      sum + (line.order_line_fulfillments ?? []).reduce((inner, row) => inner + row.quantity, 0),
    0,
  );
  return orderProgress(order.status as OrderWorkflow, ordered, fulfilled);
}

function OrderGroup({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: OrderListRow[];
  empty: string | null;
}) {
  const { t, lang } = useI18n();
  if (rows.length === 0 && !empty) return null;
  return (
    <section className="mt-8">
      {title ? <h2 className="eyebrow">{title}</h2> : null}
      <div className="mt-3 space-y-3">
        {rows.length === 0 && empty ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : null}
        {rows.map((order) => {
          const ordered = (order.customer_order_lines ?? []).reduce(
            (sum, line) => sum + line.quantity,
            0,
          );
          const fulfilled = (order.customer_order_lines ?? []).reduce(
            (sum, line) =>
              sum +
              (line.order_line_fulfillments ?? []).reduce((inner, row) => inner + row.quantity, 0),
            0,
          );
          const progress = progressOf(order);
          const orderer = one(order.ordered_by)?.name ?? "—";
          const when = order.confirmed_delivery_on || order.desired_delivery_on;
          return (
            <Link
              key={order.id}
              to="/admin/orders/$orderId"
              params={{ orderId: order.id }}
              className="surface-card flex items-center justify-between gap-3 p-5"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {orderer} · {order.order_number}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {when ? formatAgreedDelivery(when, lang) : "—"}
                  {` · ${t(PROGRESS_KEY[progress])}`}
                  {` · ${t("orders_remaining")} ${Math.max(0, ordered - fulfilled)} ${t("pcs")}`}
                  {order.owner_name_snapshot ? ` · ${order.owner_name_snapshot}` : ""}
                </p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
