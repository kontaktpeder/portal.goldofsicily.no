import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { LogOut } from "lucide-react";
import { useSessionInfo } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { canApproveOrders, canRegisterOrders } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import {
  formatAgreedDelivery,
  isOrderSchemaError,
  osloToday,
  remainingQuantity,
  visibleOrderNotices,
  type OrderNoticeRow,
} from "@/lib/orders";
import { signOutAndReturn } from "@/lib/sign-out";
import { LanguageToggle, Wordmark } from "@/components/brand";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { data: info, isLoading } = useSessionInfo();
  const registrar = canRegisterOrders(info?.roles ?? []);
  const approver = canApproveOrders(info?.roles ?? []);
  const operations = Boolean(info?.canManageOperations);

  useEffect(() => {
    if (isLoading || !info) return;
    if (!registrar) {
      void navigate({ to: "/report", replace: true });
      return;
    }
    if (!operations && !path.startsWith("/admin/orders")) {
      void navigate({ to: "/admin/orders", replace: true });
    }
  }, [info, isLoading, navigate, operations, path, registrar]);

  if (isLoading || !info || !registrar || (!operations && !path.startsWith("/admin/orders"))) {
    return <main className="min-h-screen" />;
  }

  const commercial = info.canManageCommercial;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/70">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-3">
          <Wordmark size="sm" />
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <button
              onClick={signOutAndReturn}
              aria-label={t("sign_out")}
              className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        <nav className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
          {operations ? <NavTab to="/admin" label={t("dashboard")} exact /> : null}
          {commercial ? <NavTab to="/admin/sales" label={t("nav_sales")} /> : null}
          <NavTab to="/admin/orders" label={t("nav_orders")} />
          {operations ? <NavTab to="/admin/deliveries" label={t("deliveries")} /> : null}
          {operations ? <NavTab to="/admin/lots" label={t("lots")} /> : null}
          {operations ? <NavTab to="/admin/venues" label={t("nav_venues")} /> : null}
          {commercial ? <NavTab to="/admin/wholesalers" label={t("wholesalers")} /> : null}
          {commercial ? <NavTab to="/admin/invoices" label={t("invoices")} /> : null}
          {commercial ? <NavTab to="/admin/products" label={t("nav_products")} /> : null}
          {operations ? <NavTab to="/admin/reports" label={t("reports")} /> : null}
          {commercial ? <NavTab to="/admin/staff" label={t("staff")} /> : null}
        </nav>
      </header>
      {approver ? <ApprovalNotice /> : null}
      <WorkNotices viewerId={info.session?.user.id ?? null} viewerIsLead={approver} />
      <Outlet />
    </div>
  );
}

function ApprovalNotice() {
  const { t } = useI18n();
  const notices = useQuery({
    queryKey: ["order-approval-notices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_orders")
        .select(
          "id, order_number, ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(name)",
        )
        .eq("status", "pending_confirmation")
        .order("created_at", { ascending: true })
        .limit(8);
      if (error) return [];
      return data ?? [];
    },
  });
  const rows = notices.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-3">
        <p className="text-sm font-semibold">{t("orders_notice")}</p>
        {rows.map((order) => {
          const name = one(order.ordered_by)?.name ?? "—";
          return (
            <Link
              key={order.id}
              to="/admin/orders/$orderId"
              params={{ orderId: order.id }}
              className="text-sm font-semibold underline"
            >
              {name} · {order.order_number}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function toWorkNotice(
  order: {
    id: string;
    order_number: string;
    owner_id: string | null;
    confirmed_delivery_on: string | null;
    ordered_by: { name: string } | { name: string }[] | null;
    customer_order_lines:
      { quantity: number; order_line_fulfillments: { quantity: number }[] | null }[] | null;
  },
  followUpOn: string | null,
  followUpNote: string | null,
): OrderNoticeRow {
  const ordered = (order.customer_order_lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
  const fulfilled = (order.customer_order_lines ?? []).reduce(
    (sum, line) =>
      sum + (line.order_line_fulfillments ?? []).reduce((inner, item) => inner + item.quantity, 0),
    0,
  );
  return {
    id: order.id,
    orderNumber: order.order_number,
    customerName: one(order.ordered_by)?.name ?? "—",
    ownerId: order.owner_id,
    agreedOn: order.confirmed_delivery_on,
    remaining: remainingQuantity(ordered, fulfilled),
    followUpOn,
    followUpNote,
  };
}

function WorkNotices({
  viewerId,
  viewerIsLead,
}: {
  viewerId: string | null;
  viewerIsLead: boolean;
}) {
  const { t, lang } = useI18n();
  const notices = useQuery({
    queryKey: ["order-work-notices", viewerId, viewerIsLead],
    queryFn: async () => {
      const embedded =
        "ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(name), customer_order_lines(quantity, order_line_fulfillments(quantity))";
      const rich = await supabase
        .from("customer_orders")
        .select(
          `id, order_number, owner_id, confirmed_delivery_on, follow_up_on, follow_up_note, ${embedded}`,
        )
        .eq("status", "confirmed")
        .limit(80);
      if (!rich.error) {
        return (rich.data ?? []).map((order) =>
          toWorkNotice(order, order.follow_up_on, order.follow_up_note),
        );
      }
      if (!isOrderSchemaError(rich.error.message)) return [];
      const plain = await supabase
        .from("customer_orders")
        .select(`id, order_number, owner_id, confirmed_delivery_on, ${embedded}`)
        .eq("status", "confirmed")
        .limit(80);
      if (plain.error) return [];
      return (plain.data ?? []).map((order) => toWorkNotice(order, null, null));
    },
  });
  const today = osloToday();
  const visible = visibleOrderNotices({
    today,
    viewerId,
    viewerIsLead,
    orders: notices.data ?? [],
  });
  if (visible.deliveries.length === 0 && visible.followUps.length === 0) return null;
  return (
    <div className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-3">
        {visible.deliveries.map((order) => (
          <Link
            key={`delivery-${order.id}`}
            to="/admin/orders/$orderId"
            params={{ orderId: order.id }}
            className="text-sm font-semibold underline"
          >
            {order.state === "late"
              ? t("orders_notice_late")
              : order.state === "today"
                ? t("orders_notice_today")
                : t("orders_notice_soon")}
            {" · "}
            {order.customerName} · {order.orderNumber} · {order.remaining} {t("pcs")}
          </Link>
        ))}
        {visible.followUps.map((order) => (
          <Link
            key={`follow-${order.id}`}
            to="/admin/orders/$orderId"
            params={{ orderId: order.id }}
            className="text-sm underline"
          >
            {t("orders_follow_up")} · {formatAgreedDelivery(order.on, lang)} · {order.note}
          </Link>
        ))}
      </div>
    </div>
  );
}

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function NavTab({
  to,
  label,
  exact,
}: {
  to:
    | "/admin"
    | "/admin/sales"
    | "/admin/orders"
    | "/admin/venues"
    | "/admin/reports"
    | "/admin/deliveries"
    | "/admin/wholesalers"
    | "/admin/invoices"
    | "/admin/products"
    | "/admin/lots"
    | "/admin/staff";
  label: string;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: Boolean(exact) }}
      activeProps={{ className: "bg-primary text-primary-foreground" }}
      inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
      className="rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors"
    >
      {label}
    </Link>
  );
}
