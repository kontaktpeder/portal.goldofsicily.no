import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { AdminShell } from "@/components/admin-shell";
import { useSessionInfo } from "@/hooks/use-session";
import { canApproveOrders, canRegisterOrders } from "@/lib/access";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
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

  return (
    <AdminShell operations={operations} approver={approver} commercial={info.canManageCommercial}>
      <Outlet />
    </AdminShell>
  );
}
