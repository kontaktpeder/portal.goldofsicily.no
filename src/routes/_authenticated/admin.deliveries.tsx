import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { PrimaryButton, TextField } from "@/components/field";
import { DeliveryFlavorBreakdown, DeliveryFlavorEditor } from "@/components/flavor-lines";
import { LotPrerequisitesBanner } from "@/components/lot-prerequisites";
import { useLotPrerequisites } from "@/hooks/use-lot-prerequisites";
import { useSessionInfo } from "@/hooks/use-session";
import { listProductionStaff } from "@/lib/admin.functions";
import { DeliveryDriverEditor, DriverSelect } from "@/components/delivery-driver-editor";
import {
  deliverySettingsPatch,
  isDeliveryDriverSchemaError,
  suggestedDeliveredBy,
} from "@/lib/delivery-driver";
import {
  deliveryLinesPayload,
  initialDeliveryQtys,
  qty,
  sumDeliveryQty,
  type CatalogProduct,
  type DeliveryFlavorQty,
  type StoredDeliveryLine,
} from "@/lib/flavors";
import {
  isGoldLotSchemaError,
  isVillaStockSchemaError,
  toStockLots,
  validateDeliveryStock,
  validateVillaStock,
  type StockSource,
} from "@/lib/lot-stock";
import { DeliveryLotLink } from "@/components/delivery-lot-link";
import { commercialRouteAtConfirmation, productsMissingPrice, type PriceAgreement } from "@/lib/economy";

export const Route = createFileRoute("/_authenticated/admin/deliveries")({
  validateSearch: (search: Record<string, unknown>) => ({
    lot: typeof search.lot === "string" ? search.lot : "",
  }),
  head: () => ({
    meta: [
      { title: "Deliveries — Gold of Sicily admin" },
      {
        name: "description",
        content: "Register and review arancini deliveries to partner venues.",
      },
      { property: "og:title", content: "Deliveries — Gold of Sicily admin" },
      { property: "og:description", content: "Register and review deliveries to partner venues." },
    ],
  }),
  component: AdminDeliveries,
});

const deliverySelect =
  "*, customers!deliveries_customer_id_fkey(name, type), delivery_lines(id, product_id, quantity, gold_lot_id, source_handover_id, unit_price_ore, product_name_snapshot, products(name_no, name_en), gold_lots(id, lot_code))";
const deliverySelectWithoutSource =
  "*, customers!deliveries_customer_id_fkey(name, type), delivery_lines(id, product_id, quantity, gold_lot_id, unit_price_ore, product_name_snapshot, products(name_no, name_en), gold_lots(id, lot_code))";
const stockSelect =
  "id, lot_code, product_id, produced_qty, approved_qty, status, delivery_lines(quantity, source_handover_id), gold_lot_handovers(id, quantity, ownership_after_handover, recipient_company)";

function AdminDeliveries() {
  const { t, lang } = useI18n();
  const { lot: preferredLotId } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prereq = useLotPrerequisites();
  const [open, setOpen] = useState(false);
  const [stockSource, setStockSource] = useState<StockSource>("gold");
  const [customerId, setCustomerId] = useState("");
  const [flavorQtys, setFlavorQtys] = useState<DeliveryFlavorQty[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [deliveredBy, setDeliveredBy] = useState("");
  const [driverTouched, setDriverTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const session = useSessionInfo();
  const listStaff = useServerFn(listProductionStaff);

  useEffect(() => {
    if (preferredLotId) setOpen(true);
  }, [preferredLotId]);

  const { data: productionStaff } = useQuery({
    queryKey: ["production-staff"],
    queryFn: () => listStaff(),
  });
  const staff = productionStaff?.staff ?? [];
  const currentUserId = session.data?.session?.user.id ?? null;

  const staffIds = staff.map((person) => person.id).join("\n");
  useEffect(() => {
    if (!open || driverTouched) return;
    setDeliveredBy(suggestedDeliveredBy(staffIds ? staffIds.split("\n") : [], currentUserId));
  }, [open, driverTouched, staffIds, currentUserId]);

  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, type, supplied_by_customer_id")
        .eq("active", true)
        .order("name");
      return data ?? [];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name_no, name_en, slug, lot_letter")
        .eq("active", true)
        .order("sort_order");
      if (!error) return (data ?? []) as CatalogProduct[];
      if (isGoldLotSchemaError(error)) {
        const fallback = await supabase
          .from("products")
          .select("id, name_no, name_en, slug")
          .eq("active", true)
          .order("sort_order");
        if (fallback.error) throw fallback.error;
        return (fallback.data ?? []) as CatalogProduct[];
      }
      throw error;
    },
  });

  useEffect(() => {
    if (!products) return;
    setFlavorQtys((current) => {
      if (current.length === 0) return initialDeliveryQtys(products);
      const next: DeliveryFlavorQty[] = [];
      for (const product of products) {
        const existing = current.filter((line) => line.productId === product.id);
        if (existing.length > 0) {
          next.push(
            ...existing.map((line) => ({
              ...line,
              nameNo: product.name_no,
              nameEn: product.name_en,
            })),
          );
        } else {
          next.push({
            rowId: product.id,
            productId: product.id,
            nameNo: product.name_no,
            nameEn: product.name_en,
            quantity: 0,
            goldLotId: "",
          });
        }
      }
      return next;
    });
  }, [products]);

  const { data: stockLots = [] } = useQuery({
    queryKey: ["gold-lots-open"],
    enabled: !prereq.schemaMissing,
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

  const total = useMemo(() => sumDeliveryQty(flavorQtys), [flavorQtys]);
  const stockLines = flavorQtys.map((line) => ({
    productId: line.productId,
    quantity: qty(line.quantity),
    goldLotId: line.goldLotId,
    sourceHandoverId: line.sourceHandoverId,
  }));
  const stockCheck = useMemo(
    () =>
      stockSource === "villa"
        ? validateVillaStock(stockLines, stockLots)
        : validateDeliveryStock(stockLines, stockLots),
    [stockLines, stockLots, stockSource],
  );

  const canSave =
    Boolean(customerId) &&
    total > 0 &&
    prereq.ok &&
    stockCheck.ok &&
    flavorQtys.every(
      (line) =>
        qty(line.quantity) <= 0 ||
        (Boolean(line.goldLotId) && (stockSource === "gold" || Boolean(line.sourceHandoverId))),
    );

  const { data: deliveries } = useQuery({
    queryKey: ["admin-deliveries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deliveries")
        .select(deliverySelect)
        .order("delivered_at", { ascending: false })
        .limit(200);
      if (error) {
        if (isVillaStockSchemaError(error.message)) {
          const retry = await supabase
            .from("deliveries")
            .select(deliverySelectWithoutSource)
            .order("delivered_at", { ascending: false })
            .limit(200);
          if (!retry.error) return retry.data ?? [];
        }
        const fallback = await supabase
          .from("deliveries")
          .select("*, customers!deliveries_customer_id_fkey(name, type)")
          .order("delivered_at", { ascending: false })
          .limit(200);
        return fallback.data ?? [];
      }
      return data ?? [];
    },
  });

  function openPriceAgreement(
    customer: { id: string; type: string } | undefined,
    productNames: string[],
  ) {
    const search = { priceDate: date.slice(0, 10), priceNames: productNames.join("|") };
    if (!customer || productNames.length === 0) {
      toast.error(t("price_required"));
      return;
    }
    if (customer.type === "wholesaler") {
      void navigate({
        to: "/admin/wholesalers/$customerId",
        params: { customerId: customer.id },
        search,
      });
      return;
    }
    void navigate({
      to: "/admin/venues/$venueId",
      params: { venueId: customer.id },
      search,
    });
  }

  async function submit() {
    if (!canSave) {
      if (!prereq.ok) toast.error(t("lot_prereq_title"));
      else if (stockCheck.ok === false && stockCheck.reason === "missing_lot")
        toast.error(t("delivery_lot_required"));
      else if (stockCheck.ok === false) toast.error(t("delivery_lot_insufficient"));
      else toast.error(t("delivery_missing"));
      return;
    }
    const customer = customers?.find((row) => row.id === customerId);
    const route = customer
      ? commercialRouteAtConfirmation({
          type: customer.type,
          suppliedByCustomerId: customer.supplied_by_customer_id,
        })
      : null;
    if (route?.commercialRoute === "direct") {
      const { data: agreements, error: priceError } = await supabase
        .from("customer_product_prices")
        .select("product_id, price_ore, valid_from, valid_to")
        .eq("customer_id", customerId);
      if (priceError) {
        toast.error(priceError.message);
        return;
      }
      const prices: PriceAgreement[] = (agreements ?? []).map((price) => ({
        customerId,
        productId: price.product_id,
        priceOre: price.price_ore,
        validFrom: price.valid_from,
        validTo: price.valid_to,
      }));
      const missing = productsMissingPrice(
        flavorQtys.map((line) => ({
          productId: line.productId,
          quantity: qty(line.quantity),
          name: lang === "en" ? line.nameEn : line.nameNo,
        })),
        prices,
        customerId,
        date,
      );
      if (missing.length > 0) {
        openPriceAgreement(customer, missing.map((line) => line.name));
        return;
      }
    }
    setBusy(true);
    const base = {
      customer_id: customerId,
      quantity: total,
      delivered_at: date,
      note: note.trim() || null,
    };
    let driverSkipped = false;
    let created: { id: string } | null = null;
    let error: { message: string } | null = null;
    const inserted = await supabase
      .from("deliveries")
      .insert(deliveredBy ? { ...base, delivered_by: deliveredBy } : base)
      .select("id")
      .single();
    created = inserted.data;
    error = inserted.error;
    if (error && deliveredBy && isDeliveryDriverSchemaError(error.message)) {
      driverSkipped = true;
      const retry = await supabase.from("deliveries").insert(base).select("id").single();
      created = retry.data;
      error = retry.error;
    }
    if (error || !created) {
      setBusy(false);
      toast.error(error?.message ?? t("create_customer_failed"));
      return;
    }
    try {
      const lines = deliveryLinesPayload(created.id, flavorQtys);
      if (lines.length > 0) {
        const { error: lineError } = await supabase.from("delivery_lines").insert(lines);
        if (lineError) {
          await supabase.from("deliveries").delete().eq("id", created.id);
          setBusy(false);
          if (lineError.message.includes("missing price")) {
            openPriceAgreement(
              customer,
              flavorQtys.filter((line) => qty(line.quantity) > 0).map((line) => (lang === "en" ? line.nameEn : line.nameNo)),
            );
          } else if (isVillaStockSchemaError(lineError.message)) {
            toast.warning(t("villa_stock_pending_sql"));
          } else {
            toast.error(lineError.message);
          }
          return;
        }
      }
    } catch (payloadError) {
      setBusy(false);
      toast.error(
        payloadError instanceof Error ? payloadError.message : t("delivery_lot_required"),
      );
      return;
    }
    setBusy(false);
    if (driverSkipped) toast.warning(t("delivered_by_pending_sql"));
    else toast.success(t("register_delivery"));
    setOpen(false);
    setNote("");
    setDeliveredBy("");
    setDriverTouched(false);
    setFlavorQtys(products ? initialDeliveryQtys(products) : []);
    await queryClient.invalidateQueries();
  }

  function startEdit(delivery: { id: string; delivered_at: string; note: string | null }) {
    setEditingId(delivery.id);
    setEditDate(delivery.delivered_at.slice(0, 10));
    setEditNote(delivery.note ?? "");
  }

  async function saveEdit() {
    if (!editingId || !editDate) return;
    setEditBusy(true);
    const patch = deliverySettingsPatch({
      deliveredAt: editDate,
      note: editNote,
    });
    const { error } = await supabase.from("deliveries").update(patch).eq("id", editingId);
    setEditBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("delivery_updated"));
    setEditingId(null);
    await queryClient.invalidateQueries();
  }

  function requestSaveEdit() {
    if (!editingId || !editDate) return;
    toast(t("delivery_edit_confirm"), {
      id: `delivery-edit-${editingId}`,
      duration: Infinity,
      action: {
        label: t("delivery_edit_yes"),
        onClick: () => {
          void saveEdit();
        },
      },
      cancel: {
        label: t("cancel"),
        onClick: () => {},
      },
    });
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("deliveries")}</h1>
        <button
          type="button"
          onClick={() =>
            setOpen((value) => {
              if (!value) setDriverTouched(false);
              return !value;
            })
          }
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          {t("register_delivery")}
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("delivery_workflow")}</p>
      <LotPrerequisitesBanner check={prereq} />

      {open ? (
        <div className="surface-card mt-5 space-y-4 p-5">
          <label className="block">
            <span className="eyebrow mb-2 block">{t("delivery_customer")}</span>
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
            >
              <option value="">—</option>
              {customers?.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {" · "}
                  {customer.type === "wholesaler" ? t("customer_type_wholesaler") : t("customer_type_venue")}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="eyebrow mb-1 block">{t("delivery_qty_per_flavor")}</span>
            <p className="mb-3 text-sm text-muted-foreground">{t("delivery_qty_hint")}</p>
            <div className="mb-4">
              <span className="eyebrow mb-2 block">{t("stock_source")}</span>
              <div className="flex gap-2">
                {(["gold", "villa"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setStockSource(value);
                      setFlavorQtys((current) =>
                        current.map((line) => ({ ...line, goldLotId: "", sourceHandoverId: "" })),
                      );
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${
                      stockSource === value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {value === "gold" ? t("stock_from_gold") : t("stock_from_villa")}
                  </button>
                ))}
              </div>
            </div>
            {(products ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("delivery_no_products")}</p>
            ) : (
              <DeliveryFlavorEditor
                lines={flavorQtys}
                lots={stockLots}
                source={stockSource}
                preferredLotId={preferredLotId}
                onChange={setFlavorQtys}
              />
            )}
            <p className="mt-4 text-lg font-semibold tabular-nums">
              {t("total")}: {total}{" "}
              <span className="text-xs font-normal text-muted-foreground">{t("pcs")}</span>
            </p>
          </div>
          <TextField label={t("date")} value={date} onChange={setDate} type="date" />
          <DriverSelect
            label={t("delivered_by")}
            value={deliveredBy}
            staff={staff}
            emptyLabel={t("delivered_by_none")}
            onChange={(value) => {
              setDriverTouched(true);
              setDeliveredBy(value);
            }}
          />
          <TextField label={t("note")} value={note} onChange={setNote} />
          <PrimaryButton onClick={submit} disabled={busy || !canSave}>
            {busy ? "…" : t("save")}
          </PrimaryButton>
          {!canSave && total > 0 ? (
            <p className="text-sm text-muted-foreground">
              {stockCheck.ok === false && stockCheck.reason === "insufficient"
                ? t("delivery_lot_insufficient")
                : t("delivery_lot_required")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        {(deliveries ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
        ) : (
          deliveries?.map((delivery) => (
            <article key={delivery.id} className="surface-card p-4">
              <p className="font-semibold">
                {(delivery.customers as { name: string } | null)?.name ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(delivery.delivered_at, lang)}
                {"commercial_route" in delivery && delivery.commercial_route === "via_wholesaler"
                  ? ` · ${t("route_via_wholesaler")}`
                  : ` · ${t("route_direct")}`}
                {delivery.note ? ` · ${delivery.note}` : ""}
              </p>
              <DeliveryDriverEditor
                deliveryId={delivery.id}
                deliveredBy={delivery.delivered_by}
                deliveredByName={delivery.delivered_by_name}
                staff={staff}
              />
              <DeliveryFlavorBreakdown
                linkLots
                lines={
                  ("delivery_lines" in delivery
                    ? (delivery.delivery_lines as StoredDeliveryLine[])
                    : null) ?? null
                }
              />
              <DeliveryLotLink
                lots={stockLots}
                lines={
                  ("delivery_lines" in delivery
                    ? (delivery.delivery_lines as StoredDeliveryLine[])
                    : null) ?? null
                }
              />
              {editingId === delivery.id ? (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  <p className="eyebrow">{t("delivery_settings")}</p>
                  <TextField label={t("date")} value={editDate} onChange={setEditDate} type="date" />
                  <TextField label={t("note")} value={editNote} onChange={setEditNote} />
                  <PrimaryButton onClick={requestSaveEdit} disabled={editBusy || !editDate}>
                    {editBusy ? "…" : t("save")}
                  </PrimaryButton>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="w-full py-2 text-sm font-semibold text-muted-foreground"
                  >
                    {t("cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(delivery)}
                  className="mt-3 text-sm font-semibold text-primary"
                >
                  {t("delivery_edit")}
                </button>
              )}
            </article>
          ))
        )}
      </div>
    </main>
  );
}
