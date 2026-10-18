import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PrimaryButton, TextField } from "@/components/field";
import { supabase } from "@/integrations/supabase/client";
import { listStaffAccounts } from "@/lib/admin.functions";
import { useSessionInfo } from "@/hooks/use-session";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { orderProgress, type OrderProgress, type OrderWorkflow } from "@/lib/orders";
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

export const Route = createFileRoute("/_authenticated/admin/orders/")({
  head: () => ({
    meta: [
      { title: "Ordrer — Gold of Sicily" },
      { name: "description", content: "Register and confirm customer orders." },
    ],
  }),
  component: OrdersPage,
});

type DraftLine = { productId: string; quantity: string };

function OrdersPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionInfo();
  const commercial = Boolean(session.data?.canManageCommercial);
  const staffFn = useServerFn(listStaffAccounts);
  const [orderedBy, setOrderedBy] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [contact, setContact] = useState("");
  const [desiredOn, setDesiredOn] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ productId: "", quantity: "" }]);
  const [busy, setBusy] = useState(false);

  const orders = useQuery({
    queryKey: ["customer-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_orders")
        .select(
          "id, order_number, status, desired_delivery_on, confirmed_delivery_on, owner_name_snapshot, ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(name), ship_to:customers!customer_orders_ship_to_customer_id_fkey(name), customer_order_lines(quantity, order_line_fulfillments(quantity))",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        if (/customer_orders|customer_order_status/.test(error.message))
          return { pendingSql: true as const, rows: [] };
        throw error;
      }
      return { pendingSql: false as const, rows: data ?? [] };
    },
  });

  const customers = useQuery({
    queryKey: ["order-customers"],
    enabled: commercial,
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
    enabled: commercial,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name_no, name_en")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const staff = useQuery({
    queryKey: ["order-staff"],
    enabled: commercial,
    queryFn: () => staffFn(),
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!commercial) return;
    const prepared = new Map<string, number>();
    for (const line of lines) {
      const quantity = Number.parseInt(line.quantity, 10);
      if (!line.productId || !Number.isInteger(quantity) || quantity <= 0) continue;
      prepared.set(line.productId, (prepared.get(line.productId) ?? 0) + quantity);
    }
    if (!orderedBy || !shipTo || prepared.size === 0) {
      toast.error(t("delivery_missing"));
      return;
    }
    setBusy(true);
    const { data: created, error } = await supabase
      .from("customer_orders")
      .insert({
        ordered_by_customer_id: orderedBy,
        ship_to_customer_id: shipTo,
        contact_name: contact.trim() || null,
        desired_delivery_on: desiredOn || null,
        owner_id: ownerId || null,
        due_on: dueOn || null,
        notes: notes.trim() || null,
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !created) {
      setBusy(false);
      toast.error(errorMessage(error, t("invoice_failed")));
      return;
    }
    const { error: lineError } = await supabase.from("customer_order_lines").insert(
      [...prepared.entries()].map(([productId, quantity]) => ({
        order_id: created.id,
        product_id: productId,
        quantity,
      })),
    );
    setBusy(false);
    if (lineError) {
      await supabase.from("customer_orders").delete().eq("id", created.id);
      toast.error(lineError.message);
      return;
    }
    toast.success(t("orders_saved"));
    await queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
    void navigate({ to: "/admin/orders/$orderId", params: { orderId: created.id } });
  }

  const rows = orders.data?.rows ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <h1 className="pt-8 text-3xl font-semibold">{t("orders_title")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("orders_intro")}</p>
      {orders.data?.pendingSql ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("orders_pending_sql")}</p>
      ) : null}

      {commercial ? (
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
            <label className="block">
              <span className="eyebrow mb-2 block">{t("orders_ship_to")}</span>
              <select
                className={fieldClass}
                value={shipTo}
                onChange={(event) => setShipTo(event.target.value)}
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
              onChange={setDesiredOn}
            />
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
            <TextField label={t("orders_due")} type="date" value={dueOn} onChange={setDueOn} />
          </div>
          <TextField label={t("orders_notes")} value={notes} onChange={setNotes} />
          <div className="space-y-3">
            <p className="eyebrow">{t("orders_lines")}</p>
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <select
                  className={fieldClass}
                  value={line.productId}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, productId: event.target.value } : row,
                      ),
                    )
                  }
                >
                  <option value="" />
                  {(products.data ?? []).map((product) => (
                    <option key={product.id} value={product.id}>
                      {lang === "en" ? product.name_en : product.name_no}
                    </option>
                  ))}
                </select>
                <input
                  className={fieldClass}
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, quantity: event.target.value } : row,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <button
              type="button"
              className="text-sm font-semibold"
              onClick={() => setLines((current) => [...current, { productId: "", quantity: "" }])}
            >
              {t("orders_add_line")}
            </button>
          </div>
          <PrimaryButton type="submit" disabled={busy}>
            {t("orders_save")}
          </PrimaryButton>
        </form>
      ) : null}

      <div className="mt-8 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("orders_empty")}</p>
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
          const progress = orderProgress(order.status as OrderWorkflow, ordered, fulfilled);
          const orderer = one(order.ordered_by);
          const site = one(order.ship_to);
          return (
            <Link
              key={order.id}
              to="/admin/orders/$orderId"
              params={{ orderId: order.id }}
              className="surface-card flex items-center justify-between gap-3 p-5"
            >
              <div>
                <p className="font-semibold">
                  {order.order_number} · {orderer?.name ?? "—"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(PROGRESS_KEY[progress])} · {site?.name ?? "—"} · {t("orders_remaining")}{" "}
                  {Math.max(0, ordered - fulfilled)}
                  {order.owner_name_snapshot ? ` · ${order.owner_name_snapshot}` : ""}
                </p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </main>
  );
}

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
