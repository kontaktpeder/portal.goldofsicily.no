import { Plus, X } from "lucide-react";
import { NumberStepper } from "@/components/field";
import { useI18n } from "@/lib/i18n";
import {
  flavorLabel,
  productName,
  type CatalogProduct,
  type DeliveryFlavorQty,
  type ReportFlavorLine,
  type StoredDeliveryLine,
  type StoredFlavorLine,
  type FlavorQty,
} from "@/lib/flavors";
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
  lots: Array<{ id: string; lot_code: string; product_id: string }>;
  onChange: (lines: DeliveryFlavorQty[]) => void;
}) {
  const { t, lang } = useI18n();
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("no_products")}</p>;
  }
  return (
    <div className="space-y-3">
      {lines.map((line) => {
        const available = lots.filter((lot) => lot.product_id === line.productId);
        return (
          <article key={line.productId} className="rounded-2xl border border-border bg-background/60 p-4">
            <NumberStepper
              compact
              step={10}
              label={lang === "en" ? line.nameEn : line.nameNo}
              value={line.quantity}
              onChange={(quantity) =>
                onChange(
                  lines.map((item) =>
                    item.productId === line.productId ? { ...item, quantity } : item,
                  ),
                )
              }
            />
            <label className="mt-3 block">
              <span className="eyebrow mb-2 block">{t("delivery_lot")}</span>
              <select
                value={line.goldLotId}
                onChange={(event) =>
                  onChange(
                    lines.map((item) =>
                      item.productId === line.productId
                        ? { ...item, goldLotId: event.target.value }
                        : item,
                    ),
                  )
                }
                className="h-12 w-full rounded-2xl border-2 border-border bg-card px-4 text-sm outline-none focus:border-primary"
              >
                <option value="">{t("delivery_lot_none")}</option>
                {available.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.lot_code}
                  </option>
                ))}
              </select>
              {available.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">{t("no_open_lots")}</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{t("delivery_lot_hint")}</p>
              )}
            </label>
          </article>
        );
      })}
    </div>
  );
}

export function DeliveryFlavorBreakdown({
  lines,
  className,
}: {
  lines: StoredDeliveryLine[] | null | undefined;
  className?: string;
}) {
  const { t, lang } = useI18n();
  const items = (lines ?? []).filter((line) => line.quantity > 0);
  if (items.length === 0) return null;
  return (
    <ul className={cn("mt-3 space-y-1.5", className)}>
      {items.map((line) => (
        <li
          key={line.product_id}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
        >
          <span className="font-medium">
            {line.products ? productName(line.products, lang) : t("flavors")}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {line.quantity} {t("pcs")}
            {line.gold_lots?.lot_code ? ` · ${line.gold_lots.lot_code}` : ""}
          </span>
        </li>
      ))}
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
