import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";
import { supabase } from "@/integrations/supabase/client";
import { listProductionStaff } from "@/lib/admin.functions";
import { useSessionInfo } from "@/hooks/use-session";
import { canApproveOrders, canManageOperations, canRegisterOrders } from "@/lib/access";
import { deliveryLinesPayload } from "@/lib/flavors";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  assignStockSource,
  isGoldLotSchemaError,
  isOpenLot,
  isVillaStockSchemaError,
  suggestLotId,
  toStockLots,
  validateDeliveryStock,
} from "@/lib/lot-stock";
import {
  canCancelOrder,
  formatAgreedDelivery,
  isOrderSchemaError,
  orderDeliveryDraft,
  orderPartyLabel,
  orderPrimaryAction,
  orderProgress,
  remainingQuantity,
  type OrderProgress,
  type OrderWorkflow,
} from "@/lib/orders";
import { formatPriceNok } from "@/lib/slug";
import { errorMessage } from "@/lib/utils";

const fieldClass =
  "h-11 w-full rounded-2xl border-2 border-border bg-card px-3 text-sm outline-none focus:border-primary";

const stockSelect =
  "id, lot_code, product_id, produced_qty, approved_qty, status, delivery_lines(quantity, source_handover_id), gold_lot_handovers(id, quantity, ownership_after_handover, recipient_company)";

const PROGRESS_KEY: Record<OrderProgress, TranslationKey> = {
  draft: "orders_status_draft",
  pending_confirmation: "orders_status_pending_confirmation",
  changes_requested: "orders_status_changes_requested",
  confirmed: "orders_status_confirmed",
  partially_delivered: "orders_status_partially_delivered",
  delivered: "orders_status_delivered",
  cancelled: "orders_status_cancelled",
};

export const Route = createFileRoute("/_authenticated/admin/orders/$orderId")({
  head: () => ({
    meta: [
      { title: "Ordre — Gold of Sicily" },
      { name: "description", content: "Approve an order and register its delivery." },
    ],
  }),
  component: OrderPage,
});

function OrderPage() {
  const { orderId } = Route.useParams();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const session = useSessionInfo();
  const roles = session.data?.roles ?? [];
  const approver = canApproveOrders(roles);
  const registrar = canRegisterOrders(roles);
  const operations = canManageOperations(roles);
  const commercial = Boolean(session.data?.canManageCommercial);
  const action = orderPrimaryAction(approver);
  const staffFn = useServerFn(listProductionStaff);
  const [busy, setBusy] = useState(false);
  const [agreedOn, setAgreedOn] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [deviation, setDeviation] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [deliverQty, setDeliverQty] = useState<Record<string, string>>({});
  const [deliverLot, setDeliverLot] = useState<Record<string, string>>({});

  const order = useQuery({
    queryKey: ["customer-order", orderId],
    queryFn: async () => {
      const embedded =
        "ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(id, name), ship_to:customers!customer_orders_ship_to_customer_id_fkey(id, name)";
      const base =
        "id, order_number, status, contact_name, desired_delivery_on, confirmed_delivery_on, billing_legal_name_snapshot, billing_organization_number_snapshot, owner_id, owner_name_snapshot, due_on, deviation_note, notes, ordered_by_customer_id, ship_to_customer_id";
      const rich = await supabase
        .from("customer_orders")
        .select(`${base}, return_note, approved_at, approved_name_snapshot, ${embedded}`)
        .eq("id", orderId)
        .maybeSingle();
      if (!rich.error) return { pendingSql: false as const, row: rich.data };
      if (!isOrderSchemaError(rich.error.message)) throw rich.error;
      const plain = await supabase
        .from("customer_orders")
        .select(`${base}, ${embedded}`)
        .eq("id", orderId)
        .maybeSingle();
      if (plain.error) throw plain.error;
      return {
        pendingSql: true as const,
        row: plain.data
          ? { ...plain.data, return_note: null, approved_at: null, approved_name_snapshot: null }
          : null,
      };
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

  const products = useQuery({
    queryKey: ["order-products"],
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
    queryKey: ["order-production-staff"],
    enabled: approver,
    queryFn: () => staffFn(),
  });

  const row = order.data?.row ?? null;
  if (row && lines.isSuccess && loadedFor !== row.id) {
    setLoadedFor(row.id);
    setAgreedOn(row.confirmed_delivery_on || row.desired_delivery_on || "");
    setOwnerId(row.owner_id ?? "");
    setDueOn(row.due_on ?? "");
    setDeviation(row.deviation_note ?? "");
    setReturnNote("");
    const nextQty: Record<string, string> = {};
    for (const line of lines.data ?? []) nextQty[line.product_id] = String(line.quantity);
    setLineQty(nextQty);
  }

  const stock = useQuery({
    queryKey: ["order-delivery-lots"],
    enabled: delivering && operations,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gold_lots")
        .select(stockSelect)
        .order("lot_code", { ascending: false })
        .limit(400);
      if (!error) return toStockLots(data ?? []);
      if (isVillaStockSchemaError(error.message) || isGoldLotSchemaError(error)) {
        const fallback = await supabase
          .from("gold_lots")
          .select("id, lot_code, product_id, produced_qty, status, delivery_lines(quantity)")
          .order("lot_code", { ascending: false })
          .limit(400);
        if (fallback.error) {
          if (isGoldLotSchemaError(fallback.error)) return [];
          throw fallback.error;
        }
        return toStockLots(fallback.data ?? []);
      }
      throw error;
    },
  });

  const orderLines = lines.data ?? [];
  const linked = fulfillments.data ?? [];
  const orderedQty = orderLines.reduce((sum, line) => sum + line.quantity, 0);
  const fulfilledQty = linked.reduce((sum, line) => sum + line.quantity, 0);
  const progress = row ? orderProgress(row.status, orderedQty, fulfilledQty) : "draft";
  const editable = row?.status === "draft" || row?.status === "changes_requested";
  const stockLots = stock.data ?? [];

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["customer-order", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["customer-order-lines", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["customer-order-fulfillments", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
    await queryClient.invalidateQueries({ queryKey: ["invoice-desk"] });
    await queryClient.invalidateQueries({ queryKey: ["ops-home"] });
  }

  async function setStatus(
    status: "pending_confirmation" | "confirmed" | "cancelled" | "changes_requested",
  ) {
    if (!row || !registrar) return;
    if (status === "confirmed" && !approver) return;
    if (status === "changes_requested" && !approver) return;
    setBusy(true);
    const userId = session.data?.session?.user.id ?? null;
    const patch =
      status === "confirmed"
        ? {
            status,
            confirmed_delivery_on: agreedOn || row.confirmed_delivery_on || row.desired_delivery_on,
            owner_id: ownerId || row.owner_id || userId,
          }
        : status === "changes_requested"
          ? { status, return_note: returnNote.trim() }
          : { status };
    const { error } = await supabase.from("customer_orders").update(patch).eq("id", row.id);
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("missing price")
          ? t("orders_price_missing")
          : error.message.includes("return note")
            ? t("orders_return_hint")
            : error.message,
      );
      return;
    }
    toast.success(
      status === "cancelled"
        ? t("orders_cancelled")
        : status === "confirmed"
          ? t("orders_confirmed")
          : status === "changes_requested"
            ? t("orders_returned")
            : t("orders_submitted"),
    );
    await refresh();
  }

  async function saveLines() {
    if (!row || !editable) return;
    setBusy(true);
    const catalog = products.data ?? [];
    for (const product of catalog) {
      const quantity = Number.parseInt(lineQty[product.id] ?? "", 10);
      const existing = orderLines.find((line) => line.product_id === product.id);
      const next = Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
      if (!existing && next > 0) {
        const { error } = await supabase.from("customer_order_lines").insert({
          order_id: row.id,
          product_id: product.id,
          quantity: next,
        });
        if (error) {
          setBusy(false);
          toast.error(error.message);
          return;
        }
      } else if (existing && next > 0 && existing.quantity !== next) {
        const { error } = await supabase
          .from("customer_order_lines")
          .update({ quantity: next })
          .eq("id", existing.id);
        if (error) {
          setBusy(false);
          toast.error(error.message);
          return;
        }
      } else if (existing && next <= 0) {
        const { error } = await supabase
          .from("customer_order_lines")
          .delete()
          .eq("id", existing.id);
        if (error) {
          setBusy(false);
          toast.error(error.message);
          return;
        }
      }
    }
    setBusy(false);
    toast.success(t("orders_saved"));
    await refresh();
  }

  async function saveProblem() {
    if (!row || !registrar) return;
    setBusy(true);
    const { error } = await supabase
      .from("customer_orders")
      .update({
        owner_id: ownerId || row.owner_id,
        due_on: dueOn || null,
        deviation_note: deviation.trim() || null,
      })
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error, t("invoice_failed")));
      return;
    }
    toast.success(deviation.trim() ? t("orders_problem_saved") : t("orders_saved"));
    await refresh();
  }

  async function saveDelivery() {
    if (!row || row.status !== "confirmed" || !operations) return;
    const drafts = orderLines
      .map((line) => {
        const quantity = Number.parseInt(deliverQty[line.product_id] ?? "", 10);
        return {
          productId: line.product_id,
          quantity: Number.isInteger(quantity) ? quantity : 0,
          goldLotId: deliverLot[line.product_id] ?? "",
          nameNo: line.product_name_snapshot ?? line.product_id,
          nameEn: line.product_name_snapshot ?? line.product_id,
        };
      })
      .filter((line) => line.quantity > 0);
    if (drafts.length === 0) {
      toast.error(t("delivery_missing"));
      return;
    }
    const reserved = assignStockSource(
      stockLots,
      drafts.map((line) => ({ ...line, goldLotId: line.goldLotId })),
      "gold",
    );
    const withLots = drafts.map((line) => {
      const chosen =
        line.goldLotId ||
        reserved.find((item) => item.productId === line.productId)?.goldLotId ||
        "";
      return { ...line, goldLotId: chosen, sourceHandoverId: "" };
    });
    const stockCheck = validateDeliveryStock(withLots, stockLots);
    if (!stockCheck.ok) {
      toast.error(
        stockCheck.reason === "missing_lot"
          ? t("delivery_lot_required")
          : t("delivery_lot_insufficient"),
      );
      return;
    }
    for (const line of withLots) {
      const orderLine = orderLines.find((item) => item.product_id === line.productId);
      if (!orderLine) continue;
      const done = linked
        .filter((item) => item.order_line_id === orderLine.id)
        .reduce((sum, item) => sum + item.quantity, 0);
      if (done + line.quantity > orderLine.quantity) {
        toast.error(t("orders_remaining"));
        return;
      }
    }
    const draft = orderDeliveryDraft({
      shipToCustomerId: row.ship_to_customer_id,
      orderNumber: row.order_number,
      lines: withLots.flatMap((line) => {
        const orderLine = orderLines.find((item) => item.product_id === line.productId);
        if (!orderLine) return [];
        return [
          {
            orderLineId: orderLine.id,
            productId: line.productId,
            quantity: line.quantity,
            goldLotId: line.goldLotId,
          },
        ];
      }),
    });
    setBusy(true);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const inserted = await supabase
      .from("deliveries")
      .insert({
        customer_id: draft.customerId,
        quantity: draft.quantity,
        delivered_at: today,
        note: draft.note,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      setBusy(false);
      toast.error(inserted.error?.message ?? t("invoice_failed"));
      return;
    }
    let payload: ReturnType<typeof deliveryLinesPayload>;
    try {
      payload = deliveryLinesPayload(
        inserted.data.id,
        withLots.map((line) => ({
          rowId: line.productId,
          productId: line.productId,
          nameNo: line.nameNo,
          nameEn: line.nameEn,
          quantity: line.quantity,
          goldLotId: line.goldLotId,
        })),
      );
    } catch (payloadError) {
      await supabase.from("deliveries").delete().eq("id", inserted.data.id);
      setBusy(false);
      toast.error(
        payloadError instanceof Error ? payloadError.message : t("delivery_lot_required"),
      );
      return;
    }
    const lineInsert = await supabase
      .from("delivery_lines")
      .insert(payload)
      .select("id, product_id, quantity");
    if (lineInsert.error || !lineInsert.data) {
      await supabase.from("deliveries").delete().eq("id", inserted.data.id);
      setBusy(false);
      toast.error(lineInsert.error?.message ?? t("delivery_lot_required"));
      return;
    }
    const links = lineInsert.data.flatMap((deliveryLine) => {
      const planned = draft.lines.find((item) => item.productId === deliveryLine.product_id);
      if (!planned) return [];
      return [
        {
          order_line_id: planned.orderLineId,
          delivery_line_id: deliveryLine.id,
          quantity: deliveryLine.quantity,
        },
      ];
    });
    const linkInsert = await supabase.from("order_line_fulfillments").insert(links);
    if (linkInsert.error) {
      await supabase.from("delivery_lines").delete().eq("delivery_id", inserted.data.id);
      await supabase.from("deliveries").delete().eq("id", inserted.data.id);
      setBusy(false);
      toast.error(linkInsert.error.message);
      return;
    }
    setBusy(false);
    setDelivering(false);
    setDeliverQty({});
    setDeliverLot({});
    toast.success(t("orders_delivery_saved"));
    await refresh();
  }

  if (!row) return <main className="min-h-screen" />;

  const orderer = one(row.ordered_by);
  const site = one(row.ship_to);
  const ordererName = orderer?.name ?? "—";
  const siteName = site?.name ?? "—";
  const party = orderPartyLabel({
    ordererName,
    shipToName: siteName,
    contactName: row.contact_name,
  });
  const waiting =
    row.status === "draft" ||
    row.status === "pending_confirmation" ||
    row.status === "changes_requested";
  const canDeliver =
    operations && row.status === "confirmed" && remainingQuantity(orderedQty, fulfilledQty) > 0;
  const catalog = products.data ?? [];
  const tableRows =
    editable && catalog.length > 0
      ? catalog.map((product) => {
          const line = orderLines.find((item) => item.product_id === product.id);
          return {
            key: product.id,
            productId: product.id,
            name: lang === "en" ? product.name_en : product.name_no,
            ordered: line?.quantity ?? 0,
            lineId: line?.id ?? null,
            price: line?.unit_price_ore ?? null,
          };
        })
      : orderLines.map((line) => {
          const product = one(line.products);
          return {
            key: line.id,
            productId: line.product_id,
            name:
              line.product_name_snapshot ||
              (lang === "en" ? product?.name_en : product?.name_no) ||
              "—",
            ordered: line.quantity,
            lineId: line.id,
            price: line.unit_price_ore,
          };
        });

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <p className="pt-8 text-sm text-muted-foreground">
        <Link to="/admin/orders" className="font-semibold">
          {t("orders_title")}
        </Link>
      </p>
      {order.data?.pendingSql ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("orders_pending_sql")}</p>
      ) : null}
      <h1 className="mt-2 text-3xl font-semibold">
        {ordererName} · {row.order_number}
      </h1>
      {party.contact ? (
        <p className="mt-2 text-sm">
          {t("orders_contact_line")}: {party.contact}
        </p>
      ) : null}
      {party.site ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t("orders_ship_to")}: {party.site}
        </p>
      ) : null}
      <p className="mt-3 text-sm">
        {row.confirmed_delivery_on ? t("orders_confirmed_date") : t("orders_desired_date")}:{" "}
        <strong>
          {row.confirmed_delivery_on
            ? formatAgreedDelivery(row.confirmed_delivery_on, lang)
            : row.desired_delivery_on
              ? formatAgreedDelivery(row.desired_delivery_on, lang)
              : "—"}
        </strong>
      </p>
      <p className="mt-1 text-sm">
        {t("orders_owner_title")}: <strong>{row.owner_name_snapshot ?? "—"}</strong>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t(PROGRESS_KEY[progress])}</p>
      {row.approved_name_snapshot ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t("orders_approved_by")}: {row.approved_name_snapshot}
          {row.approved_at ? ` · ${formatAgreedDelivery(row.approved_at, lang)}` : ""}
        </p>
      ) : null}
      {row.status === "changes_requested" && row.return_note ? (
        <p className="surface-card mt-4 p-4 text-sm">{row.return_note}</p>
      ) : null}

      <section className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">{t("orders_product")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("orders_ordered_qty")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("orders_delivered_qty")}</th>
              <th className="py-2 text-right font-medium">{t("orders_remaining")}</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((line) => {
              const done = line.lineId
                ? linked
                    .filter((item) => item.order_line_id === line.lineId)
                    .reduce((sum, item) => sum + item.quantity, 0)
                : 0;
              const ordered = editable
                ? Number.parseInt(lineQty[line.productId] ?? "", 10) || line.ordered
                : line.ordered;
              if (!editable && ordered <= 0) return null;
              return (
                <tr key={line.key} className="border-t border-border">
                  <td className="py-3 pr-3 font-medium">{line.name}</td>
                  <td className="py-3 pr-3 text-right">
                    {editable ? (
                      <input
                        className={`${fieldClass} ml-auto max-w-28 text-right`}
                        inputMode="numeric"
                        aria-label={line.name}
                        value={
                          lineQty[line.productId] ?? (line.ordered ? String(line.ordered) : "")
                        }
                        onChange={(event) =>
                          setLineQty((current) => ({
                            ...current,
                            [line.productId]: event.target.value,
                          }))
                        }
                      />
                    ) : (
                      line.ordered
                    )}
                  </td>
                  <td className="py-3 pr-3 text-right">{done}</td>
                  <td className="py-3 text-right font-semibold">
                    {remainingQuantity(ordered, done)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {editable && registrar ? (
          <button
            type="button"
            className="mt-3 text-sm font-semibold"
            disabled={busy}
            onClick={() => void saveLines()}
          >
            {t("orders_save")}
          </button>
        ) : null}
      </section>

      {waiting && registrar ? (
        <section className="mt-8 space-y-4">
          {approver ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t("orders_confirmed_date")}
                type="date"
                value={agreedOn}
                onChange={setAgreedOn}
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
            </div>
          ) : null}
          {row.status !== "pending_confirmation" || approver ? (
            <PrimaryButton
              type="button"
              disabled={busy || (action === "submit" && row.status === "pending_confirmation")}
              onClick={() =>
                void setStatus(action === "approve" ? "confirmed" : "pending_confirmation")
              }
            >
              {action === "approve" ? t("orders_confirm") : t("orders_send_confirm")}
            </PrimaryButton>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("orders_status_pending_confirmation")}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t("orders_internal")}</p>
          {approver && row.status === "pending_confirmation" ? (
            <div className="space-y-3">
              <TextAreaField value={returnNote} onChange={setReturnNote} />
              <p className="text-sm text-muted-foreground">{t("orders_return_hint")}</p>
              <button
                type="button"
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
                disabled={busy || returnNote.trim().length === 0}
                onClick={() => void setStatus("changes_requested")}
              >
                {t("orders_return")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canDeliver ? (
        <section className="mt-8 space-y-4">
          {delivering ? (
            <div className="surface-card space-y-4 p-5">
              {orderLines.map((line) => {
                const done = linked
                  .filter((item) => item.order_line_id === line.id)
                  .reduce((sum, item) => sum + item.quantity, 0);
                const left = remainingQuantity(line.quantity, done);
                if (left <= 0) return null;
                const product = one(line.products);
                const name =
                  line.product_name_snapshot ||
                  (lang === "en" ? product?.name_en : product?.name_no) ||
                  "—";
                const typed = Number.parseInt(deliverQty[line.product_id] ?? "", 10);
                const needed = Number.isInteger(typed) ? typed : 0;
                const suggested = suggestLotId(
                  stockLots,
                  line.product_id,
                  needed,
                  deliverLot[line.product_id] ?? "",
                );
                const chosen = deliverLot[line.product_id] || suggested;
                const options = stockLots.filter(
                  (lot) =>
                    lot.productId === line.product_id && isOpenLot(lot.status) && lot.remaining > 0,
                );
                return (
                  <div key={line.id} className="grid gap-3 sm:grid-cols-[1fr_8rem_1fr]">
                    <p className="font-medium">{name}</p>
                    <input
                      className={fieldClass}
                      inputMode="numeric"
                      aria-label={`${name} ${t("orders_deliver_qty")}`}
                      placeholder={String(left)}
                      value={deliverQty[line.product_id] ?? ""}
                      onChange={(event) =>
                        setDeliverQty((current) => ({
                          ...current,
                          [line.product_id]: event.target.value,
                        }))
                      }
                    />
                    <label className="block">
                      <span className="eyebrow mb-2 block">{t("orders_lot")}</span>
                      <select
                        className={fieldClass}
                        value={chosen}
                        onChange={(event) =>
                          setDeliverLot((current) => ({
                            ...current,
                            [line.product_id]: event.target.value,
                          }))
                        }
                      >
                        <option value="" />
                        {options.map((lot) => (
                          <option key={lot.id} value={lot.id}>
                            {lot.lotCode} · {lot.remaining}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })}
              <PrimaryButton type="button" disabled={busy} onClick={() => void saveDelivery()}>
                {t("orders_save_delivery")}
              </PrimaryButton>
            </div>
          ) : (
            <PrimaryButton type="button" disabled={busy} onClick={() => setDelivering(true)}>
              {t("register_delivery")}
            </PrimaryButton>
          )}
        </section>
      ) : null}

      {registrar ? (
        <details className="mt-8 rounded-2xl border border-border px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">{t("orders_more")}</summary>
          <div className="mt-4 space-y-4">
            <p className="text-sm font-semibold">{t("orders_owner_title")}</p>
            {approver ? (
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
            ) : (
              <p className="text-sm">{row.owner_name_snapshot ?? "—"}</p>
            )}
            <TextField label={t("orders_due")} type="date" value={dueOn} onChange={setDueOn} />
            {row.notes ? <p className="text-sm text-muted-foreground">{row.notes}</p> : null}
            <div>
              <p className="eyebrow mb-2">{t("orders_deviation")}</p>
              <TextAreaField value={deviation} onChange={setDeviation} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
                disabled={busy}
                onClick={() => void saveProblem()}
              >
                {t("orders_deviation")}
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
            </div>
          </div>
        </details>
      ) : null}

      {commercial ? (
        <details className="mt-4 rounded-2xl border border-border px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">
            {t("orders_invoice_details")}
          </summary>
          <div className="mt-4 space-y-2 text-sm">
            <p className="text-muted-foreground">{t("orders_invoice_hint")}</p>
            {row.billing_legal_name_snapshot ? (
              <p>
                {t("orders_recipient")}: {row.billing_legal_name_snapshot}
                {row.billing_organization_number_snapshot
                  ? ` · ${row.billing_organization_number_snapshot}`
                  : ""}
              </p>
            ) : null}
            {orderLines.map((line) => {
              const product = one(line.products);
              const name =
                line.product_name_snapshot ||
                (lang === "en" ? product?.name_en : product?.name_no) ||
                "—";
              return (
                <p key={line.id}>
                  {name}
                  {line.unit_price_ore ? ` · ${formatPriceNok(line.unit_price_ore)} kr` : ""}
                </p>
              );
            })}
            {row.status === "confirmed" ? (
              <Link to="/admin/invoices" className="inline-block font-semibold">
                {t("invoices")}
              </Link>
            ) : null}
          </div>
        </details>
      ) : null}
    </main>
  );
}

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
