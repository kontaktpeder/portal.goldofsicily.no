import { useI18n } from "@/lib/i18n";

export function PriceGapBanner({ date, productNames }: { date: string; productNames: string[] }) {
  const { t } = useI18n();
  if (!date || productNames.length === 0) return null;
  return (
    <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
      <p className="font-semibold">
        {productNames.join(", ")} {t("price_gap_for")} {date}.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t("price_gap_fix")}</p>
    </div>
  );
}
