import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSessionInfo } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { Wordmark } from "@/components/brand";
import { DeliveryFlavorBreakdown, FlavorBreakdown } from "@/components/flavor-lines";
import type { StoredDeliveryLine, StoredFlavorLine } from "@/lib/flavors";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "History — Gold of Sicily" },
      { name: "description", content: "Your previous shift reports and deliveries." },
      { property: "og:title", content: "History — Gold of Sicily" },
      { property: "og:description", content: "Your previous shift reports and deliveries." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { t, lang } = useI18n();
  const { data: info } = useSessionInfo();
  const customerId = info?.customerId ?? null;

  const { data } = useQuery({
    queryKey: ["history", customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const [reports, deliveriesRes] = await Promise.all([
        supabase
          .from("shift_reports")
          .select(
            "id, created_at, sold_this_shift, remaining_stock, next_required_quantity, guest_feedback_rating, preparation_issue, shift_report_lines(product_id, sold, remaining_stock, next_required_quantity, products(name_no, name_en))",
          )
          .eq("venue_id", customerId!)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("deliveries")
          .select(
            "id, quantity, delivered_at, note, delivery_lines(product_id, quantity, gold_lot_id, products(name_no, name_en), gold_lots(id, lot_code))",
          )
          .eq("venue_id", customerId!)
          .order("delivered_at", { ascending: false })
          .limit(50),
      ]);
      const deliveries =
        deliveriesRes.error
          ? await supabase
              .from("deliveries")
              .select("id, quantity, delivered_at, note")
              .eq("venue_id", customerId!)
              .order("delivered_at", { ascending: false })
              .limit(50)
          : deliveriesRes;
      return { reports: reports.data ?? [], deliveries: deliveries.data ?? [] };
    },
  });

  return (
    <main className="min-h-screen pb-16">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-lg items-center justify-between px-5 py-3">
          <Wordmark size="sm" />
          <Link
            to="/report"
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
          >
            <ArrowLeft className="size-3.5" />
            {t("back_to_report")}
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg px-5">
        <h1 className="pt-8 text-3xl font-semibold">{t("history")}</h1>

        <h2 className="eyebrow mt-8">{t("history_reports")}</h2>
        <div className="mt-3 space-y-3">
          {(data?.reports ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
          ) : (
            data?.reports.map((report) => (
              <article key={report.id} className="surface-card p-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-medium">{formatDate(report.created_at, lang)}</p>
                  {report.guest_feedback_rating ? (
                    <span className="text-xs text-muted-foreground">
                      {t(report.guest_feedback_rating)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <Stat label={t("sold")} value={report.sold_this_shift} unit={t("pcs")} />
                  <Stat label={t("stock")} value={report.remaining_stock} unit={t("pcs")} />
                  <Stat
                    label={t("next_need")}
                    value={report.next_required_quantity ?? 0}
                    unit={t("pcs")}
                  />
                </div>
                <FlavorBreakdown lines={report.shift_report_lines as StoredFlavorLine[] | null} />
              </article>
            ))
          )}
        </div>

        <h2 className="eyebrow mt-10">{t("history_deliveries")}</h2>
        <div className="mt-3 space-y-3">
          {(data?.deliveries ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
          ) : (
            data?.deliveries.map((delivery) => (
              <article key={delivery.id} className="surface-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{formatDate(delivery.delivered_at, lang)}</p>
                    {delivery.note ? (
                      <p className="mt-1 text-xs text-muted-foreground">{delivery.note}</p>
                    ) : null}
                  </div>
                  <p className="text-lg font-semibold tabular-nums">
                    {delivery.quantity} <span className="text-xs font-normal">{t("pcs")}</span>
                  </p>
                </div>
                <DeliveryFlavorBreakdown
                  lines={
                    "delivery_lines" in delivery
                      ? (delivery.delivery_lines as StoredDeliveryLine[])
                      : null
                  }
                />
              </article>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded-xl bg-muted/70 px-3 py-2">
      <p className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="text-base font-semibold tabular-nums">
        {value} <span className="text-[0.65rem] font-normal">{unit}</span>
      </p>
    </div>
  );
}
