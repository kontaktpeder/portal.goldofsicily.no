import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSessionInfo } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import { isWaitingShopOrder } from "@/lib/shop-order";
import { listNettbestillinger } from "@/lib/shop.functions";

/** Open web requests, shown where staff already look. They are not customer orders yet. */
export function ShopOrderNotice() {
  const { t } = useI18n();
  const session = useSessionInfo();
  const list = useServerFn(listNettbestillinger);
  const enabled = Boolean(session.data?.canManageOperations);
  const orders = useQuery({
    queryKey: ["nettbestillinger"],
    enabled,
    queryFn: () => list(),
  });
  if (!enabled) return null;
  if (orders.isError || orders.data?.unavailable) {
    return (
      <p className="mt-4 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
        {t("shop_order_unavailable")}
      </p>
    );
  }
  if (!orders.data) return null;
  const waiting = orders.data.orders.filter((row) => isWaitingShopOrder(row.status));
  const first = waiting[0];
  if (!first) return null;
  return (
    <Link
      to="/admin/shop-orders"
      className="mt-4 block rounded-2xl border border-border bg-card px-4 py-3 hover:bg-accent"
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {t("nav_shop_orders")}
        {waiting.length > 1 ? ` · ${waiting.length}` : ""}
      </p>
      <p className="mt-1 text-base font-semibold">
        {first.orderNumber} · {first.customerName}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {first.boxes} {first.boxes === 1 ? t("shop_order_box") : t("shop_order_boxes_plural")} ·{" "}
        {first.flavorName}
      </p>
      <p className="mt-1 text-sm">{t("shop_order_notice")}</p>
    </Link>
  );
}
