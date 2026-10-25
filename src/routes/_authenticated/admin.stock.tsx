import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { reopenClosedLot } from "@/lib/lot-events-save";
import { isGoldLotSchemaError, isVillaStockSchemaError, toStockLots } from "@/lib/lot-stock";
import { isShopSchemaError, type ReservationRow } from "@/lib/shop";
import {
  buildStockLedger,
  type LedgerProduct,
  type StockFlavorRow,
  type StockLotLine,
} from "@/lib/stock-ledger";

export const Route = createFileRoute("/_authenticated/admin/stock")({
  head: () => ({
    meta: [{ title: "Lager — Gold of Sicily admin" }],
  }),
  component: AdminStock,
});

const STATUS_KEYS: Record<string, TranslationKey> = {
  produced: "lot_status_produced",
  packed: "lot_status_packed",
  handed_over: "lot_status_handed_over",
  closed: "lot_status_closed",
  recalled: "lot_status_recalled",
};

type ProductRow = {
  id: string;
  slug: string;
  lot_letter: string | null;
  name_no: string;
  name_en: string;
  active: boolean;
};

function piecePair(atGold: number, atVilla: number, unit: string): string {
  if (atVilla <= 0) return `${atGold} ${unit}`;
  return `${atGold} ${unit} · Villa ${atVilla}`;
}

function boxCount(lang: "no" | "en", boxes: number): string {
  if (lang === "en") return boxes === 1 ? "1 box" : `${boxes} boxes`;
  return boxes === 1 ? "1 eske" : `${boxes} esker`;
}

function AdminStock() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ledger = useQuery({
    queryKey: ["stock-ledger", lang],
    queryFn: () => loadLedger(lang),
  });

  async function reopen(lot: StockLotLine) {
    if (!lot.restoreTo) return;
    setBusyId(lot.id);
    const result = await reopenClosedLot({ lotId: lot.id, status: lot.restoreTo });
    setBusyId(null);
    setConfirmId(null);
    if (!result.ok) {
      toast.error(result.reason === "not_closed" ? t("lot_reopen_missing") : result.message);
      return;
    }
    if (!result.logged) {
      toast.error(result.schemaMissing ? t("lot_reopen_schema_missing") : result.message);
    } else {
      toast.success(t("lot_reopen_done"));
    }
    await queryClient.invalidateQueries({ queryKey: ["stock-ledger"] });
    await queryClient.invalidateQueries({ queryKey: ["gold-lots"] });
  }

  const data = ledger.data;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <h1 className="pt-8 text-3xl font-semibold">{t("nav_stock")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("stock_intro")}</p>
      {data?.missing ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("lot_schema_missing")}</p>
      ) : (
        <div className="mt-8 space-y-8">
          {(data?.rows ?? []).map((row) => (
            <FlavorStock
              key={row.key}
              row={row}
              lang={lang}
              confirmId={confirmId}
              busyId={busyId}
              onArm={setConfirmId}
              onCancel={() => setConfirmId(null)}
              onReopen={reopen}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function FlavorStock({
  row,
  lang,
  confirmId,
  busyId,
  onArm,
  onCancel,
  onReopen,
}: {
  row: StockFlavorRow;
  lang: "no" | "en";
  confirmId: string | null;
  busyId: string | null;
  onArm: (id: string) => void;
  onCancel: () => void;
  onReopen: (lot: StockLotLine) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <section>
      <h2 className="text-2xl font-semibold">{row.name}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label={t("stock_open_gold")} value={`${row.openAtGold} ${t("pcs")}`} />
        <Figure
          label={t("stock_open_villa")}
          value={`${row.openAtVilla} ${t("pcs")}`}
          {...(row.openAtVilla > 0 ? { note: t("stock_villa_note") } : {})}
        />
        <Figure
          label={t("stock_closed")}
          value={piecePair(row.closedAtGold, row.closedAtVilla, t("pcs"))}
        />
        <Figure
          label={t("stock_recalled")}
          value={piecePair(row.recalledAtGold, row.recalledAtVilla, t("pcs"))}
        />
      </div>
      <p className="mt-3 text-sm">
        {row.shopFlavor && row.websiteBoxes != null ? (
          <>
            <span className="font-semibold">{t("stock_website")}</span>
            {` ${boxCount(lang, row.websiteBoxes)}`}
            {row.websiteRemainder > 0
              ? ` · ${row.websiteRemainder} ${t("pcs")} ${t("stock_remainder")}`
              : ""}
            {row.heldPieces > 0 ? ` · ${row.heldPieces} ${t("pcs")} ${t("stock_held")}` : ""}
          </>
        ) : (
          <span className="text-muted-foreground">{t("stock_not_on_shop")}</span>
        )}
      </p>
      {row.lots.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("stock_empty")}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {row.lots.map((lot) => (
            <li key={lot.id} className="surface-card flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Link
                  to="/admin/lots/$lotId"
                  params={{ lotId: lot.id }}
                  className="font-mono font-semibold"
                >
                  {lot.lotCode}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {t(STATUS_KEYS[lot.rawStatus] ?? "lot_status_produced")}
                  {` · ${t("lot_at_gold")} ${lot.atGold} ${t("pcs")}`}
                  {lot.atVilla > 0 ? ` · ${t("lot_at_villa")} ${lot.atVilla} ${t("pcs")}` : ""}
                </p>
              </div>
              {lot.bucket === "closed" && lot.restoreTo ? (
                confirmId === lot.id ? (
                  <div className="flex flex-col items-stretch gap-1">
                    <button
                      type="button"
                      disabled={busyId === lot.id}
                      onClick={() => void onReopen(lot)}
                      className="rounded-full bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {busyId === lot.id ? "…" : t("lot_reopen_confirm")}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === lot.id}
                      onClick={onCancel}
                      className="text-sm font-semibold text-muted-foreground"
                    >
                      {t("lot_close_cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onArm(lot.id)}
                    className="rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold"
                  >
                    {t("lot_reopen")}
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="surface-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

async function loadLedger(
  lang: "no" | "en",
): Promise<{ missing: boolean; rows: StockFlavorRow[] }> {
  const productsRes = await supabase
    .from("products")
    .select("id, slug, lot_letter, name_no, name_en, active");
  if (productsRes.error) throw productsRes.error;

  const full = await supabase
    .from("gold_lots")
    .select(
      "id, lot_code, produced_qty, approved_qty, status, product_id, gold_lot_handovers(id, quantity, ownership_after_handover, recipient_company), delivery_lines(quantity, source_handover_id)",
    )
    .order("lot_code", { ascending: false })
    .limit(400);

  let raw: unknown[] = full.data ?? [];
  if (full.error) {
    if (isGoldLotSchemaError(full.error)) return { missing: true, rows: [] };
    const message = full.error.message ?? "";
    if (
      !isVillaStockSchemaError(message) &&
      !/approved_qty|ownership_after_handover|recipient_company/.test(message)
    ) {
      throw full.error;
    }
    const plain = await supabase
      .from("gold_lots")
      .select(
        "id, lot_code, produced_qty, status, product_id, gold_lot_handovers(id, quantity), delivery_lines(quantity)",
      )
      .order("lot_code", { ascending: false })
      .limit(400);
    if (plain.error) {
      if (isGoldLotSchemaError(plain.error)) return { missing: true, rows: [] };
      throw plain.error;
    }
    raw = plain.data ?? [];
  }

  const stockRows = raw.map((row) => {
    const lot = row as {
      id: string;
      lot_code: string;
      product_id: string;
      produced_qty: number;
      approved_qty?: number | null;
      status: string;
      delivery_lines?: { quantity: number; source_handover_id?: string | null }[] | null;
      gold_lot_handovers?:
        | {
            id?: string;
            quantity: number;
            ownership_after_handover?: "gold" | "villa";
            recipient_company?: string;
          }[]
        | null;
    };
    return {
      id: lot.id,
      lot_code: lot.lot_code,
      product_id: lot.product_id,
      produced_qty: lot.produced_qty,
      approved_qty: lot.approved_qty ?? null,
      status: lot.status,
      delivery_lines: lot.delivery_lines ?? [],
      gold_lot_handovers: (lot.gold_lot_handovers ?? []).map((handover) => ({
        id: handover.id ?? "",
        quantity: handover.quantity,
        ownership_after_handover: handover.ownership_after_handover ?? "gold",
        recipient_company: handover.recipient_company ?? "",
      })),
    };
  });
  const stock = toStockLots(stockRows);
  const approvedById = new Map(stockRows.map((lot) => [lot.id, lot.approved_qty]));
  const closedIds = stock.filter((lot) => lot.status === "closed").map((lot) => lot.id);
  const previous = new Map<string, string | null>();
  if (closedIds.length > 0) {
    const events = await supabase
      .from("gold_lot_events")
      .select("gold_lot_id, event_type, created_at, metadata")
      .eq("event_type", "closed")
      .in("gold_lot_id", closedIds)
      .order("created_at", { ascending: false })
      .limit(500);
    if (!events.error) {
      for (const event of events.data ?? []) {
        if (previous.has(event.gold_lot_id)) continue;
        previous.set(event.gold_lot_id, readPreviousStatus(event.metadata));
      }
    }
  }

  const holdsRes = await supabase
    .from("shop_reservations")
    .select("product_id, pieces, status, expires_at")
    .eq("status", "held");
  const holds: ReservationRow[] =
    holdsRes.error && isShopSchemaError(holdsRes.error)
      ? []
      : (holdsRes.data ?? []).map((row) => ({
          productId: row.product_id,
          pieces: row.pieces,
          status: row.status,
          expiresAt: row.expires_at,
        }));
  if (holdsRes.error && !isShopSchemaError(holdsRes.error)) throw holdsRes.error;

  const listed = new Map<string, LedgerProduct>();
  for (const product of (productsRes.data ?? []) as ProductRow[]) {
    if (!product.active && !stock.some((lot) => lot.productId === product.id)) continue;
    listed.set(product.id, {
      id: product.id,
      slug: product.slug,
      lotLetter: product.lot_letter,
      nameNo: product.name_no,
      nameEn: product.name_en,
    });
  }

  return {
    missing: false,
    rows: buildStockLedger({
      lang,
      now: new Date(),
      holds,
      products: [...listed.values()],
      lots: stock.map((lot) => ({
        id: lot.id,
        lotCode: lot.lotCode,
        productId: lot.productId,
        status: lot.status,
        atGold: lot.remaining,
        atVilla: (lot.villaHandovers ?? []).reduce((sum, handover) => sum + handover.remaining, 0),
        approvedQty: approvedById.get(lot.id) ?? null,
        previousStatus: previous.get(lot.id) ?? null,
      })),
    }),
  };
}

function readPreviousStatus(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = (metadata as { previous_status?: unknown }).previous_status;
  return typeof raw === "string" && raw.trim() ? raw : null;
}
