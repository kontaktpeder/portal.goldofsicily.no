import { Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { NumberStepper } from "@/components/field";
import { useI18n } from "@/lib/i18n";
import {
  flavorLabel,
  productName,
  qty,
  storedLot,
  type CatalogProduct,
  type DeliveryFlavorQty,
  type ReportFlavorLine,
  type StoredDeliveryLine,
  type StoredFlavorLine,
  type FlavorQty,
} from "@/lib/flavors";
import {
  allocateFifo,
  lotsWithFormReservation,
  needsLotSplit,
  newestCoveringLot,
  openLotsForProduct,
  suggestLotId,
  totalRemaining,
  type StockLot,
} from "@/lib/lot-stock";
import { cn } from "@/lib/utils";

export function FlavorReportEditor({
  lines,
  catalog,
  onChange,
}: {
  lines: ReportFlavorLine[];
  catalog: CatalogProduct[];
  onChange: (lines: ReportFlavorLine[]) => void;
}) {
  const { t, lang } = useI18n();
  const used = new Set(lines.map((line) => line.productId));
  const available = catalog.filter((product) => !used.has(product.id));

  function patch(productId: string, partial: Partial<ReportFlavorLine>) {
    onChange(lines.map((line) => (line.productId === productId ? { ...line, ...partial } : line)));
  }

  function add(product: CatalogProduct) {
    onChange([
      ...lines,
      {
        productId: product.id,
        nameNo: product.name_no,
        nameEn: product.name_en,
        sold: 0,
        remaining: 0,
        nextNeed: 0,
      },
    ]);
  }

  function remove(productId: string) {
    onChange(lines.filter((line) => line.productId !== productId));
  }

  return (
    <div className="space-y-4">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("no_flavors_on_report")}</p>
      ) : (
        lines.map((line) => (
          <article
            key={line.productId}
            className="rounded-2xl border border-border bg-background/60 p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-semibold">{flavorLabel(line, lang)}</h3>
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => remove(line.productId)}
                  aria-label={t("remove_flavor")}
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="space-y-3">
              <LabeledCount
                label={t("sold")}
                value={line.sold}
                onChange={(sold) => patch(line.productId, { sold })}
              />
              <LabeledCount
                label={t("stock")}
                value={line.remaining}
                onChange={(remaining) => patch(line.productId, { remaining })}
              />
              <LabeledCount
                label={t("next_need")}
                value={line.nextNeed}
                onChange={(nextNeed) => patch(line.productId, { nextNeed })}
              />
            </div>
          </article>
        ))
      )}

      {available.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] tracking-wider text-muted-foreground uppercase">
            {t("add_flavor")}
          </p>
          <div className="flex flex-wrap gap-2">
            {available.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => add(product)}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-card px-3 py-2 text-sm font-semibold"
              >
                <Plus className="size-3.5" />
                {productName(product, lang)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LabeledCount({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FlavorQty;
  onChange: (value: FlavorQty) => void;
}) {
  return <NumberStepper label={label} value={value} onChange={onChange} step={10} compact />;
}

export function FlavorBreakdown({
  lines,
  className,
}: {
  lines: StoredFlavorLine[] | null | undefined;
  className?: string;
}) {
  const { t, lang } = useI18n();
  if (!lines?.length) return null;
  return (
    <ul className={cn("mt-3 space-y-1.5", className)}>
      {lines.map((line) => (
        <li
          key={line.product_id}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
        >
          <span className="font-medium">
            {line.products ? productName(line.products, lang) : t("flavors")}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {line.sold} {t("sold").toLowerCase()}
            {" · "}
            {line.remaining_stock} {t("stock").toLowerCase()}
            {" · "}
            {line.next_required_quantity ?? 0} {t("next_need").toLowerCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DeliveryFlavorEditor({
  lines,
  lots,
  onChange,
}: {
  lines: DeliveryFlavorQty[];
  lots: StockLot[];
  onChange: (lines: DeliveryFlavorQty[]) => void;
}) {
  const { t, lang } = useI18n();
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("no_products")}</p>;
  }

  function replaceProduct(productId: string, next: DeliveryFlavorQty[]) {
    const result: DeliveryFlavorQty[] = [];
    let inserted = false;
    for (const existing of lines) {
      if (existing.productId !== productId) {
        result.push(existing);
        continue;
      }
      if (!inserted) {
        result.push(...next);
        inserted = true;
      }
    }
    if (!inserted) result.push(...next);
    onChange(result);
  }

  function splitProduct(line: DeliveryFlavorQty) {
    const needed = lines
      .filter((item) => item.productId === line.productId)
      .reduce((sum, item) => sum + qty(item.quantity), 0);
    const allocations = allocateFifo(lots, line.productId, needed);
    if (allocations.length === 0) return;
    replaceProduct(
      line.productId,
      allocations.map((allocation) => ({
        rowId: `${line.productId}::${allocation.lotId}`,
        productId: line.productId,
        nameNo: line.nameNo,
        nameEn: line.nameEn,
        quantity: allocation.quantity,
        goldLotId: allocation.lotId,
      })),
    );
  }

  function unsplitProduct(line: DeliveryFlavorQty) {
    const needed = lines
      .filter((item) => item.productId === line.productId)
      .reduce((sum, item) => sum + qty(item.quantity), 0);
    const covering = newestCoveringLot(lots, line.productId, needed);
    replaceProduct(line.productId, [
      {
        rowId: line.productId,
        productId: line.productId,
        nameNo: line.nameNo,
        nameEn: line.nameEn,
        quantity: needed,
        goldLotId: covering?.id ?? "",
      },
    ]);
  }

  return (
    <div className="space-y-3">
      {lines.map((line, index) => {
        const needed = qty(line.quantity);
        const available = lotsWithFormReservation(
          lots,
          lines.map((item) => ({
            productId: item.productId,
            quantity: qty(item.quantity),
            goldLotId: item.goldLotId,
          })),
          index,
        );
        const flavorLots = openLotsForProduct(available, line.productId);
        const selected = available.find(
          (lot) => lot.id === line.goldLotId && lot.productId === line.productId,
        );
        const uniqueOptions =
          selected && !flavorLots.some((lot) => lot.id === selected.id)
            ? [...flavorLots, selected]
            : flavorLots;
        const splitNeeded = needsLotSplit(available, line.productId, needed);
        const productLineCount = lines.filter((item) => item.productId === line.productId).length;
        const flavorName = lang === "en" ? line.nameEn : line.nameNo;
        const remainingTotal = totalRemaining(available, line.productId);
        const showSelect = uniqueOptions.length > 0 && Boolean(line.goldLotId);

        return (
          <article
            key={line.rowId}
            className="rounded-2xl border border-border bg-background/60 p-4"
          >
            <NumberStepper
              compact
              step={10}
              label={flavorName}
              value={line.quantity}
              onChange={(quantity) => {
                const nextQty = qty(quantity);
                const reserved = lotsWithFormReservation(
                  lots,
                  lines.map((item) => ({
                    productId: item.productId,
                    quantity: qty(item.quantity),
                    goldLotId: item.goldLotId,
                  })),
                  index,
                );
                onChange(
                  lines.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          quantity,
                          goldLotId: suggestLotId(
                            reserved,
                            item.productId,
                            nextQty,
                            item.goldLotId,
                          ),
                        }
                      : item,
                  ),
                );
              }}
            />

            {needed > 0 && uniqueOptions.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium">
                  {t("no_active_lot_prefix")} {flavorName}. {t("create_lot_before_delivery")}
                </p>
                <Link
                  to="/admin/lots"
                  search={{ tab: "production", product: line.productId }}
                  className="mt-3 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  {t("create_lot")}
                </Link>
              </div>
            ) : null}

            {showSelect ? (
              <label className="mt-3 block">
                <span className="eyebrow mb-2 block">{t("delivery_lot")}</span>
                <select
                  value={line.goldLotId}
                  onChange={(event) =>
                    onChange(
                      lines.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, goldLotId: event.target.value } : item,
                      ),
                    )
                  }
                  className="h-12 w-full rounded-2xl border-2 border-border bg-card px-4 text-sm outline-none focus:border-primary"
                >
                  {uniqueOptions.map((lot) => (
                    <option
                      key={lot.id}
                      value={lot.id}
                      disabled={lot.remaining <= 0 && lot.id !== line.goldLotId}
                    >
                      {lot.lotCode} · {lot.remaining} {t("lot_available")}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {needed > 0 && splitNeeded ? (
              <div className="mt-3">
                <p className="text-sm text-muted-foreground">{t("split_lots_hint")}</p>
                <button
                  type="button"
                  onClick={() => splitProduct(line)}
                  className="mt-2 rounded-full border border-border px-4 py-2 text-sm font-semibold"
                >
                  {t("split_lots")}
                </button>
              </div>
            ) : null}

            {productLineCount > 1 &&
            index === lines.findIndex((item) => item.productId === line.productId) ? (
              <button
                type="button"
                onClick={() => unsplitProduct(line)}
                className="mt-3 text-sm font-semibold text-muted-foreground"
              >
                {t("unsplit_lots")}
              </button>
            ) : null}

            {needed > 0 && remainingTotal < needed && uniqueOptions.length > 0 ? (
              <p className="mt-2 text-sm text-destructive">{t("delivery_lot_insufficient")}</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function DeliveryFlavorBreakdown({
  lines,
  className,
  linkLots = false,
}: {
  lines: StoredDeliveryLine[] | null | undefined;
  className?: string;
  linkLots?: boolean;
}) {
  const { t, lang } = useI18n();
  const items = (lines ?? []).filter((line) => line.quantity > 0);
  if (items.length === 0) return null;
  return (
    <ul className={cn("mt-3 space-y-3", className)}>
      {items.map((line, index) => {
        const lot = storedLot(line);
        const name = line.products ? productName(line.products, lang) : t("flavors");
        return (
          <li key={`${line.product_id}-${lot?.id ?? index}`} className="text-sm">
            <p className="font-medium tabular-nums">
              {line.quantity} × {name}
            </p>
            {lot ? (
              linkLots ? (
                <Link
                  to="/admin/lots/$lotId"
                  params={{ lotId: lot.id }}
                  className="font-mono text-sm font-semibold text-primary underline-offset-2 hover:underline"
                >
                  {lot.lot_code}
                </Link>
              ) : (
                <p className="font-mono text-sm text-muted-foreground">{lot.lot_code}</p>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function FlavorTotals({
  sold,
  remaining,
  nextNeed,
}: {
  sold: number;
  remaining: number;
  nextNeed: number;
}) {
  const { t } = useI18n();
  return (
    <p className="text-sm text-muted-foreground tabular-nums">
      {t("total")}: {sold} {t("sold").toLowerCase()}
      {" · "}
      {remaining} {t("stock").toLowerCase()}
      {" · "}
      {nextNeed} {t("next_need").toLowerCase()}
    </p>
  );
}
