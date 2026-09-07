import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { LotPrerequisitesBanner } from "@/components/lot-prerequisites";
import { useLotPrerequisites } from "@/hooks/use-lot-prerequisites";
import { useOpsHome } from "@/hooks/use-ops-home";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { FlavorStock, NextNeedItem } from "@/lib/ops-home";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Drift — Gold of Sicily" },
      {
        name: "description",
        content: "Produce, hand over to Villa, and deliver Gold LOT stock.",
      },
      { property: "og:title", content: "Drift — Gold of Sicily" },
      {
        property: "og:description",
        content: "Produce, hand over to Villa, and deliver Gold LOT stock.",
      },
    ],
  }),
  component: OpsHome,
});

function OpsHome() {
  const { t, lang } = useI18n();
  const prereq = useLotPrerequisites();
  const { data } = useOpsHome(lang);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <h1 className="pt-8 text-3xl font-semibold">{t("ops_today")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("ops_intro")}</p>
      <LotPrerequisitesBanner check={prereq} />

      <div className="mt-6 space-y-3">
        <Link
          to="/admin/lots"
          search={{ tab: "production" }}
          className="surface-card flex items-center justify-between gap-3 p-5 transition-shadow hover:shadow-[var(--shadow-lift)]"
        >
          <TaskCopy title={t("ops_start_production")} hint={t("ops_start_production_hint")} />
        </Link>
        <Link
          to="/admin/lots"
          search={{ tab: "active" }}
          className="surface-card flex items-center justify-between gap-3 p-5 transition-shadow hover:shadow-[var(--shadow-lift)]"
        >
          <TaskCopy
            title={t("ops_handover_villa")}
            hint={handoverHint(data?.readyForHandover ?? 0, t)}
          />
        </Link>
        <Link
          to="/admin/deliveries"
          className="surface-card flex items-center justify-between gap-3 p-5 transition-shadow hover:shadow-[var(--shadow-lift)]"
        >
          <TaskCopy title={t("ops_register_delivery")} hint={t("ops_register_delivery_hint")} />
        </Link>
      </div>

      <h2 className="eyebrow mt-10">{t("ops_stock")}</h2>
      <div className="mt-3 space-y-3">
        {(data?.stock ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("ops_stock_empty")}</p>
        ) : (
          data?.stock.map((row) => <StockCard key={row.productId} row={row} lang={lang} />)
        )}
      </div>

      <h2 className="eyebrow mt-10">{t("next_requirement")}</h2>
      <div className="mt-3 space-y-2">
        {(data?.nextNeed ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("ops_need_empty")}</p>
        ) : (
          data?.nextNeed.map((item) => <NeedRow key={item.id} item={item} />)
        )}
      </div>
    </main>
  );
}

function handoverHint(count: number, t: (key: TranslationKey) => string) {
  if (count <= 0) return t("ops_handover_none");
  if (count === 1) return t("ops_handover_one");
  return `${count} ${t("ops_handover_many")}`;
}

function TaskCopy({ title, hint }: { title: string; hint: string }) {
  return (
    <>
      <div>
        <p className="text-lg font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
    </>
  );
}

function StockCard({ row, lang }: { row: FlavorStock; lang: "no" | "en" }) {
  const { t } = useI18n();
  const name = lang === "en" ? row.nameEn : row.nameNo;
  return (
    <article className="surface-card p-5">
      <p className="text-lg font-semibold">{name}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Stat label={t("ops_produced")} value={row.produced} />
        <Stat label={t("ops_at_villa")} value={row.atVilla} />
        <Stat label={t("ops_delivered")} value={row.delivered} />
        <Stat label={t("ops_available")} value={row.available} />
      </dl>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const { t } = useI18n();
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">
        {value} <span className="text-xs font-normal">{t("pcs")}</span>
      </dd>
    </div>
  );
}

function NeedRow({ item }: { item: NextNeedItem }) {
  const { t } = useI18n();
  const flavor = item.flavorName ?? "";
  const detail =
    item.source === "villa"
      ? `${item.quantity} ${flavor} ${t("lot_available")}`
      : `${t("ops_estimated")} ${item.quantity}${flavor ? ` ${flavor}` : ""}`;
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <p className="font-medium">
        {item.title}
        <span className="font-normal text-muted-foreground">
          {": "}
          <span className="font-semibold text-foreground tabular-nums">{detail}</span>
        </span>
      </p>
    </div>
  );
}
