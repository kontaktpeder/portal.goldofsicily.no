import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton, TextField } from "@/components/field";
import { LotPrerequisitesBanner } from "@/components/lot-prerequisites";
import { useLotPrerequisites } from "@/hooks/use-lot-prerequisites";
import { RecallSearch } from "@/components/recall-search";
import { ProducerPicker } from "@/components/producer-picker";
import { LotCloseButton } from "@/components/lot-close-button";
import { RecordCard } from "@/components/record-card";
import { useI18n } from "@/lib/i18n";
import {
  formatGoldLotCode,
  nextLotSequence,
  todayOsloDate,
  type GoldLotStatus,
} from "@/lib/gold-lot";
import { canCloseLot } from "@/lib/lot-events";
import {
  isGoldLotSchemaError,
  isOpenLot,
  isVillaStockSchemaError,
  toStockLots,
} from "@/lib/lot-stock";
import { ensureProductVersionForProduct } from "@/lib/lot-snapshot";
import {
  displayProducedBy,
  formatProducedByCompat,
  isProducerSchemaError,
  producersFromQuery,
  selectedProductionStaff,
  snapshotProducerName,
} from "@/lib/lot-producers";
import { replaceLotProducers } from "@/lib/lot-producers-save";
import { recordLotEvent } from "@/lib/lot-events-save";
import { listProductionStaff } from "@/lib/admin.functions";
import { flushShopRestock } from "@/lib/shop.functions";
import { formatDate } from "@/lib/sign-out";
import { cn, errorMessage } from "@/lib/utils";

export type LotTab = "active" | "production" | "history" | "recall";

export type LotSearch = {
  tab: LotTab;
  product?: string;
  open?: "handover";
};

function parseLotSearch(search: Record<string, unknown>): LotSearch {
  const raw = search["tab"];
  const tab: LotTab =
    raw === "production" || raw === "history" || raw === "recall" || raw === "active"
      ? raw
      : "active";
  const product = search["product"];
  const open = search["open"] === "handover" ? "handover" : undefined;
  if (typeof product === "string" && product.length > 0) {
    return open ? { tab, product, open } : { tab, product };
  }
  return open ? { tab, open } : { tab };
}

export const Route = createFileRoute("/_authenticated/admin/lots/")({
  validateSearch: parseLotSearch,
  head: () => ({
    meta: [
      { title: "Gold-LOT — Gold of Sicily admin" },
      {
        name: "description",
        content: "Production lots for one-up one-down food traceability.",
      },
    ],
  }),
  component: AdminLots,
});

type ProductOption = {
  id: string;
  name_no: string;
  name_en: string;
  lot_letter: string | null;
};

type LotRow = {
  id: string;
  lot_code: string;
  production_date: string;
  produced_qty: number;
  approved_qty: number | null;
  carton_count: number;
  produced_by: string | null;
  status: string;
  product_id: string;
  products: { name_no: string; name_en: string } | null;
  gold_lot_handovers:
    | {
        id?: string;
        quantity: number;
        ownership_after_handover?: "gold" | "villa";
        recipient_company?: string;
      }[]
    | null;
  delivery_lines: { quantity: number; source_handover_id?: string | null }[] | null;
  gold_lot_producers:
    | {
        user_id: string;
        full_name_snapshot: string;
        employee_number_snapshot: string | null;
      }[]
    | null;
};

const LOT_BASE =
  "id, lot_code, production_date, produced_qty, carton_count, produced_by, status, product_id, products(name_no, name_en)";
const LOT_STOCK =
  "approved_qty, gold_lot_handovers(id, quantity, ownership_after_handover, recipient_company), delivery_lines(quantity, source_handover_id)";
const LOT_STOCK_PLAIN = "gold_lot_handovers(quantity), delivery_lines(quantity)";
const LOT_PRODUCERS = "gold_lot_producers(user_id, full_name_snapshot, employee_number_snapshot)";

function isLotListColumnError(message: string): boolean {
  return (
    isVillaStockSchemaError(message) ||
    /ownership_after_handover|approved_qty|recipient_company/.test(message)
  );
}

function lotStatus(status: string): GoldLotStatus {
  if (
    status === "produced" ||
    status === "packed" ||
    status === "handed_over" ||
    status === "closed" ||
    status === "recalled"
  ) {
    return status;
  }
  return "produced";
}

function normalizeLotRows(data: unknown): LotRow[] {
  return ((data ?? []) as LotRow[]).map((row) => ({
    ...row,
    gold_lot_producers: row.gold_lot_producers ?? [],
    gold_lot_handovers: row.gold_lot_handovers ?? [],
    delivery_lines: row.delivery_lines ?? [],
    approved_qty: row.approved_qty ?? null,
  }));
}

async function selectLots(columns: string) {
  return supabase
    .from("gold_lots")
    .select(columns)
    .order("lot_code", { ascending: false })
    .limit(300);
}

async function loadLotRows(): Promise<LotRow[]> {
  const full = await selectLots(`${LOT_BASE}, ${LOT_STOCK}, ${LOT_PRODUCERS}`);
  if (!full.error) return normalizeLotRows(full.data);
  if (isProducerSchemaError(full.error)) {
    const next = await selectLots(`${LOT_BASE}, ${LOT_STOCK}`);
    if (!next.error) return normalizeLotRows(next.data);
    if (isLotListColumnError(next.error.message ?? "")) {
      const plain = await selectLots(`${LOT_BASE}, ${LOT_STOCK_PLAIN}`);
      if (!plain.error) return normalizeLotRows(plain.data);
      if (isGoldLotSchemaError(plain.error)) return [];
      throw plain.error;
    }
    if (isGoldLotSchemaError(next.error)) return [];
    throw next.error;
  }
  if (isLotListColumnError(full.error.message ?? "")) {
    const plain = await selectLots(`${LOT_BASE}, ${LOT_STOCK_PLAIN}, ${LOT_PRODUCERS}`);
    if (!plain.error) return normalizeLotRows(plain.data);
    if (isProducerSchemaError(plain.error)) {
      const bare = await selectLots(`${LOT_BASE}, ${LOT_STOCK_PLAIN}`);
      if (!bare.error) return normalizeLotRows(bare.data);
      if (isGoldLotSchemaError(bare.error)) return [];
      throw bare.error;
    }
    if (isGoldLotSchemaError(plain.error)) return [];
    throw plain.error;
  }
  if (isGoldLotSchemaError(full.error)) return [];
  throw full.error;
}

function AdminLots() {
  const { t, lang } = useI18n();
  const { tab, product: productFromSearch } = Route.useSearch();
  const queryClient = useQueryClient();
  const listStaff = useServerFn(listProductionStaff);
  const flushRestock = useServerFn(flushShopRestock);
  const prereq = useLotPrerequisites();
  const [productId, setProductId] = useState(productFromSearch ?? "");
  const [productionDate, setProductionDate] = useState(todayOsloDate);
  const [producedQty, setProducedQty] = useState("0");
  const [producerIds, setProducerIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closedIds, setClosedIds] = useState<string[]>([]);

  useEffect(() => {
    if (productFromSearch) setProductId(productFromSearch);
  }, [productFromSearch]);

  const { data: products } = useQuery({
    queryKey: ["products-active"],
    enabled: !prereq.schemaMissing,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name_no, name_en, slug, lot_letter")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as ProductOption[];
    },
  });

  const { data: productionStaff, error: staffError } = useQuery({
    queryKey: ["production-staff"],
    enabled: !prereq.schemaMissing,
    queryFn: () => listStaff(),
  });

  const { data: lots } = useQuery({
    queryKey: ["gold-lots"],
    enabled: !prereq.schemaMissing,
    queryFn: loadLotRows,
  });

  const selected = products?.find((product) => product.id === productId);
  const previewCode = useMemo(() => {
    const letter = selected?.lot_letter?.trim().toUpperCase() ?? "";
    if (!letter || !productionDate) return "";
    const existing = (lots ?? [])
      .map((lot) => lot.lot_code)
      .filter((code) => code.startsWith(`L-${productionDate.replaceAll("-", "")}-${letter}-`));
    try {
      return formatGoldLotCode(
        productionDate,
        letter,
        nextLotSequence(existing, productionDate, letter),
      );
    } catch {
      return "";
    }
  }, [lots, productionDate, selected]);

  const stock = useMemo(
    () =>
      toStockLots(
        (lots ?? []).map((lot) => ({
          id: lot.id,
          lot_code: lot.lot_code,
          product_id: lot.product_id,
          produced_qty: lot.produced_qty,
          approved_qty: lot.approved_qty,
          status: lot.status,
          delivery_lines: (lot.delivery_lines ?? []).map((line) => ({
            quantity: line.quantity,
            source_handover_id: line.source_handover_id ?? null,
          })),
          gold_lot_handovers: (lot.gold_lot_handovers ?? []).map((row, index) => ({
            id: row.id ?? `${lot.id}-${index}`,
            quantity: row.quantity,
            ownership_after_handover: row.ownership_after_handover ?? "villa",
            recipient_company: row.recipient_company ?? "",
          })),
        })),
      ),
    [lots],
  );

  const visibleLots = useMemo(() => {
    const rows = lots ?? [];
    if (tab === "history" || tab === "production") return rows;
    return rows.filter((lot) => {
      const stockLot = stock.find((item) => item.id === lot.id);
      return isOpenLot(lot.status) && (stockLot?.remaining ?? 0) > 0;
    });
  }, [lots, stock, tab]);

  async function submit() {
    if (!prereq.ok) {
      toast.error(t("lot_prereq_title"));
      return;
    }
    if (!productId || Number.parseInt(producedQty, 10) <= 0) {
      toast.error(t("lot_missing"));
      return;
    }
    const letter = selected?.lot_letter?.trim().toUpperCase() ?? "";
    if (!letter) {
      toast.error(t("lot_letter_missing"));
      return;
    }
    const producers = selectedProductionStaff(productionStaff?.staff ?? [], producerIds);
    if (producers.length < 1) {
      toast.error(t("produced_by_required"));
      return;
    }
    setBusy(true);
    const version = await ensureProductVersionForProduct(productId);
    if (!version.ok) {
      setBusy(false);
      toast.error(version.schemaMissing ? t("packing_schema_missing") : version.message);
      return;
    }
    let lotCode = previewCode;
    const rpc = await supabase.rpc("next_gold_lot_code", {
      p_production_date: productionDate,
      p_lot_letter: letter,
    });
    if (!rpc.error && rpc.data) lotCode = rpc.data;
    const { data: created, error } = await supabase
      .from("gold_lots")
      .insert({
        lot_code: lotCode,
        production_date: productionDate,
        product_id: productId,
        produced_qty: Number.parseInt(producedQty, 10) || 0,
        approved_qty: Number.parseInt(producedQty, 10) || 0,
        product_version_id: version.id,
        produced_by: formatProducedByCompat(producers.map(snapshotProducerName)),
        status: "produced",
      })
      .select("id")
      .single();
    if (error || !created) {
      setBusy(false);
      toast.error(errorMessage(error, t("create_customer_failed")));
      return;
    }
    const linked = await replaceLotProducers(created.id, producers);
    const createdEvent = await recordLotEvent({ lotId: created.id, eventType: "created" });
    setBusy(false);
    if (linked.error) {
      toast.error(
        isProducerSchemaError(linked.error) ? t("producer_schema_missing") : linked.error.message,
      );
      return;
    }
    toast.success(`${lotCode} ${t("lot_created").toLowerCase()}`);
    void flushRestock().catch(() => undefined);
    if (!createdEvent.ok) {
      toast.error(
        createdEvent.schemaMissing ? t("lot_events_schema_missing") : createdEvent.message,
      );
    }
    setProducedQty("0");
    setProducerIds([]);
    await queryClient.invalidateQueries({ queryKey: ["gold-lots"] });
    await queryClient.invalidateQueries({ queryKey: ["gold-lots-open"] });
  }

  async function closeListedLot(lotId: string) {
    const lot = (lots ?? []).find((row) => row.id === lotId);
    if (!lot || !canCloseLot(lotStatus(lot.status))) return;
    setBusy(true);
    const updated = await supabase.from("gold_lots").update({ status: "closed" }).eq("id", lotId);
    if (updated.error) {
      setBusy(false);
      toast.error(updated.error.message);
      return;
    }
    const closedEvent = await recordLotEvent({
      lotId,
      eventType: "closed",
      metadata: { previous_status: lot.status },
    });
    setBusy(false);
    setClosingId(null);
    setClosedIds((ids) => [...ids, lotId]);
    if (!closedEvent.ok) {
      toast.error(closedEvent.schemaMissing ? t("lot_events_schema_missing") : closedEvent.message);
    } else {
      toast.success(t("lot_close_done"));
    }
    await queryClient.invalidateQueries({ queryKey: ["gold-lots"] });
    await queryClient.invalidateQueries({ queryKey: ["gold-lots-open"] });
    await queryClient.invalidateQueries({ queryKey: ["ops-home"] });
  }

  const showForm = tab === "production";
  const blocked = !prereq.ok;
  const pageTitle =
    tab === "active"
      ? t("nav_packing")
      : tab === "production"
        ? t("nav_production")
        : tab === "history"
          ? t("history")
          : t("lot_tab_recall");

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{pageTitle}</h1>
        {tab !== "recall" ? (
          <Link
            to="/admin/lots"
            search={productId ? { tab: "production", product: productId } : { tab: "production" }}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="size-4" />
            {t("new_lot")}
          </Link>
        ) : null}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {tab === "active" ? t("packing_pick") : t("lots_intro")}
      </p>
      <LotPrerequisitesBanner check={prereq} />

      <nav className="mt-6 flex gap-1 overflow-x-auto">
        <LotTabLink tab="active" current={tab} label={t("lot_tab_active")} />
        <LotTabLink tab="production" current={tab} label={t("lot_tab_production")} />
        <LotTabLink tab="history" current={tab} label={t("lot_tab_history")} />
        <LotTabLink tab="recall" current={tab} label={t("lot_tab_recall")} />
      </nav>

      {tab === "recall" ? (
        prereq.schemaMissing ? null : (
          <div className="mt-6">
            <RecallSearch compact />
          </div>
        )
      ) : (
        <>
          {showForm && !blocked ? (
            <div className="surface-card mt-5 space-y-4 p-5">
              <label className="block">
                <span className="eyebrow mb-2 block">{t("flavors")}</span>
                <select
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                  className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
                >
                  <option value="">—</option>
                  {(products ?? []).map((product) => (
                    <option key={product.id} value={product.id}>
                      {lang === "en" ? product.name_en : product.name_no}
                      {product.lot_letter ? ` (${product.lot_letter})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <TextField
                label={t("production_date")}
                type="date"
                value={productionDate}
                onChange={setProductionDate}
              />
              {previewCode ? (
                <p className="font-mono text-lg font-semibold">{previewCode}</p>
              ) : null}
              <TextField
                label={t("produced_qty")}
                type="number"
                value={producedQty}
                onChange={setProducedQty}
              />
              {staffError ? (
                <p className="text-sm text-muted-foreground">
                  {isProducerSchemaError(staffError)
                    ? t("producer_schema_missing")
                    : staffError.message}
                </p>
              ) : (
                <ProducerPicker
                  staff={productionStaff?.staff ?? []}
                  selectedIds={producerIds}
                  onChange={setProducerIds}
                />
              )}
              <PrimaryButton onClick={submit} disabled={busy || blocked}>
                {busy ? "…" : t("save")}
              </PrimaryButton>
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            {visibleLots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("no_lots")}</p>
            ) : (
              visibleLots.map((lot) => {
                const onHand = stock.find((item) => item.id === lot.id)?.remaining ?? 0;
                const name =
                  lang === "en" ? (lot.products?.name_en ?? "") : (lot.products?.name_no ?? "");
                const shown = displayProducedBy(
                  producersFromQuery(lot.gold_lot_producers),
                  lot.produced_by,
                );
                const producedLabel =
                  shown.names.length > 0 ? shown.names.join(", ") : shown.legacy;
                const statusNote =
                  lot.status === "closed"
                    ? t("lot_status_closed")
                    : lot.status === "recalled"
                      ? t("lot_status_recalled")
                      : "";
                const meta = [
                  name,
                  formatDate(lot.production_date, lang),
                  producedLabel,
                  statusNote,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const closable = canCloseLot(lotStatus(lot.status)) && !closedIds.includes(lot.id);
                return (
                  <RecordCard
                    key={lot.id}
                    title={lot.lot_code}
                    titleMono
                    meta={meta}
                    figure={{ value: onHand, unit: t("pcs"), label: t("orders_on_hand") }}
                    {...(closable
                      ? {
                          action: (
                            <LotCloseButton
                              armed={closingId === lot.id}
                              busy={busy && closingId === lot.id}
                              onArm={() => setClosingId(lot.id)}
                              onCancel={() => setClosingId(null)}
                              onConfirm={() => void closeListedLot(lot.id)}
                            />
                          ),
                        }
                      : {})}
                    render={(className, body) => (
                      <Link
                        to="/admin/lots/$lotId"
                        params={{ lotId: lot.id }}
                        className={className}
                      >
                        {body}
                      </Link>
                    )}
                  />
                );
              })
            )}
          </div>
        </>
      )}
    </main>
  );
}

function LotTabLink({ tab, current, label }: { tab: LotTab; current: LotTab; label: string }) {
  return (
    <Link
      to="/admin/lots"
      search={{ tab }}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors",
        tab === current
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
