import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LogOut } from "lucide-react";
import { useSessionInfo } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import { signOutAndReturn } from "@/lib/sign-out";
import { LanguageToggle, Wordmark } from "@/components/brand";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: info, isLoading } = useSessionInfo();

  useEffect(() => {
    if (!isLoading && info && !info.isAdmin) void navigate({ to: "/report", replace: true });
  }, [info, isLoading, navigate]);

  if (isLoading || !info?.isAdmin) {
    return <main className="min-h-screen" />;
  }

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
          <NavTab to="/admin" label={t("dashboard")} exact />
          <NavTab to="/admin/partners" label={t("partners")} />
          <NavTab to="/admin/venues" label={t("customers")} />
          <NavTab to="/admin/products" label={t("products")} />
          <NavTab to="/admin/reports" label={t("reports")} />
          <NavTab to="/admin/deliveries" label={t("deliveries")} />
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

function NavTab({
  to,
  label,
  exact,
}: {
  to:
    | "/admin"
    | "/admin/venues"
    | "/admin/reports"
    | "/admin/deliveries"
    | "/admin/partners"
    | "/admin/products";
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
