import { Plus, X } from "lucide-react";
import { NumberStepper } from "@/components/field";
import { useI18n } from "@/lib/i18n";
import {
  flavorLabel,
  productName,
  type CatalogProduct,
  type ReportFlavorLine,
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
