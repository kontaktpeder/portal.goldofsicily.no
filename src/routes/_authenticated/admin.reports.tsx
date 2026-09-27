import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { FlavorBreakdown } from "@/components/flavor-lines";
import type { StoredFlavorLine } from "@/lib/flavors";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Gold of Sicily admin" },
      { name: "description", content: "All submitted shift reports across partner venues." },
      { property: "og:title", content: "Reports — Gold of Sicily admin" },
      { property: "og:description", content: "All submitted shift reports across partner venues." },
    ],
  }),
  component: AdminReports,
});

function AdminReports() {
  const { t, lang } = useI18n();
  const { data } = useQuery({
    queryKey: ["admin-reports"],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("shift_reports")
        .select(
          "*, customers(name), shift_report_lines(product_id, sold, remaining_stock, next_required_quantity, products(name_no, name_en))",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      return rows ?? [];
    },
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <h1 className="pt-8 text-3xl font-semibold">{t("reports")}</h1>
      <div className="mt-6 space-y-3">
        {(data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
        ) : (
          data?.map((report) => (
            <article key={report.id} className="surface-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {(report.customers as { name: string } | null)?.name ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(report.created_at, lang)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <span>
                  {t("sold")}: <strong className="tabular-nums">{report.sold_this_shift}</strong>
                </span>
                <span>
                  {t("stock")}: <strong className="tabular-nums">{report.remaining_stock}</strong>
                </span>
                <span>
                  {t("next_need")}:{" "}
                  <strong className="tabular-nums">{report.next_required_quantity ?? "—"}</strong>
                </span>
                {report.guest_feedback_rating ? (
                  <span>{t(report.guest_feedback_rating)}</span>
                ) : null}
                {report.delivery_correct === false ? (
                  <span>
                    {t("q_delivery")}: {report.actual_quantity_received ?? "?"} {t("pcs")}
                  </span>
                ) : null}
              </div>
              <FlavorBreakdown lines={report.shift_report_lines as StoredFlavorLine[] | null} />
              {report.guest_feedback_text ? (
                <p className="mt-3 text-sm text-muted-foreground">“{report.guest_feedback_text}”</p>
              ) : null}
              {report.preparation_issue ? (
                <p className="mt-2 text-sm">
                  <strong>{t("q_prep")}:</strong> {report.preparation_issue_text ?? "—"}
                </p>
              ) : null}
              {report.needs_review ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning/15 px-3 py-2 text-xs">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <strong>{t("needs_review")}.</strong> {report.review_note}
                  </span>
                </p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </main>
  );
}
