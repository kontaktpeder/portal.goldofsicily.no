import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { statusToken, useAdminOverview, type CustomerRow } from "@/lib/admin-data";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Gold of Sicily admin" },
      {
        name: "description",
        content: "Sales demand, customer stock, feedback and production planning at a glance.",
      },
      { property: "og:title", content: "Dashboard — Gold of Sicily admin" },
      {
        property: "og:description",
        content: "Sales demand, customer stock and production planning at a glance.",
      },
    ],
  }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const { t, lang } = useI18n();
  const { data } = useAdminOverview();
  const metrics = data?.metrics;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <h1 className="pt-8 text-3xl font-semibold">{t("dashboard")}</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label={t("active_partners")} value={metrics?.activePartners ?? 0} plain />
        <Metric label={t("active_venues")} value={metrics?.activeVenues ?? 0} plain />
        <Metric label={t("sold_this_week")} value={metrics?.soldThisWeek ?? 0} />
        <Metric label={t("stock_at_customers")} value={metrics?.currentStock ?? 0} />
        <Metric label={t("requested_next")} value={metrics?.requestedNext ?? 0} />
        <Metric label={t("awaiting_report")} value={metrics?.awaiting ?? 0} plain />
        <Metric label={t("quality_issues")} value={metrics?.qualityIssues ?? 0} plain />
        <Metric label={t("new_venues")} value={metrics?.newVenues ?? 0} plain />
      </div>

      {(data?.flavorWeek ?? []).length > 0 ? (
        <>
          <h2 className="eyebrow mt-10">{t("flavors_this_week")}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data?.flavorWeek.map((flavor) => (
              <Metric
                key={flavor.productId}
                label={lang === "en" ? flavor.nameEn : flavor.nameNo}
                value={flavor.sold}
              />
            ))}
          </div>
        </>
      ) : null}

      <h2 className="eyebrow mt-10">{t("partners")}</h2>
      <div className="mt-3 space-y-3">
        {(data?.partners ?? []).length === 0 && (data?.unassigned ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_partners")}</p>
        ) : null}

        {(data?.partners ?? []).map((partner) => (
          <section key={partner.id} className="surface-card p-4">
            <Link
              to="/admin/partners/$partnerId"
              params={{ partnerId: partner.id }}
              className="flex items-start justify-between gap-3"
            >
              <div>
                <p className="font-semibold">{partner.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {partner.venueCount} {t("venues_under")}
                  {" · "}
                  {partner.distributedThisMonth.toLocaleString(
                    lang === "no" ? "nb-NO" : "en-GB",
                  )}{" "}
                  {t("pcs")} {t("distributed_month").toLowerCase()}
                </p>
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
            </Link>
            <div className="mt-3 space-y-2">
              {partner.venues.map((row) => (
                <VenueRow key={row.id} row={row} compact />
              ))}
            </div>
          </section>
        ))}

        {(data?.unassigned ?? []).length > 0 ? (
          <section className="surface-card p-4">
            <p className="font-semibold">{t("unassigned_partner")}</p>
            <div className="mt-3 space-y-2">
              {data?.unassigned.map((row) => (
                <VenueRow key={row.id} row={row} compact />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <h2 className="eyebrow mt-10">{t("customers")}</h2>
      <div className="mt-3 space-y-3">
        {(data?.rows ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_customers")}</p>
        ) : (
          data?.rows.map((row) => <VenueRow key={row.id} row={row} />)
        )}
      </div>
    </main>
  );
}

function VenueRow({ row, compact }: { row: CustomerRow; compact?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <Link
      to="/admin/venues/$venueId"
      params={{ venueId: row.id }}
      className={
        compact
          ? "flex items-center gap-3 rounded-xl bg-background/60 px-3 py-2"
          : "surface-card flex items-center gap-4 p-4 transition-shadow hover:shadow-[var(--shadow-lift)]"
      }
    >
      <span className={`size-3 shrink-0 rounded-full ${statusToken(row.status)}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {row.name}
          {!row.active ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({t("inactive")})
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.partnerName ?? t("unassigned_partner")}
          {" · "}
          {t("last_report")}: {row.lastReportAt ? formatDate(row.lastReportAt, lang) : t("never")}
        </p>
        {compact ? null : (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              {t("sold")}: <strong className="tabular-nums">{row.soldThisWeek}</strong>
            </span>
            <span>
              {t("current_stock")}: <strong className="tabular-nums">{row.currentStock}</strong>
            </span>
            <span>
              {t("next_requirement")}:{" "}
              <strong className="tabular-nums">{row.nextRequirement ?? "—"}</strong>
            </span>
            {row.needsReview ? (
              <span className="flex items-center gap-1 text-warning-foreground">
                <AlertTriangle className="size-3" /> {t("needs_review")}
              </span>
            ) : null}
          </div>
        )}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function Metric({ label, value, plain }: { label: string; value: number; plain?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="surface-card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">
        {value}
        {plain ? null : <span className="ml-1 text-xs font-normal">{t("pcs")}</span>}
      </p>
    </div>
  );
}
