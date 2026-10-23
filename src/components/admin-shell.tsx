import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronDown,
  BarChart3,
  ClipboardList,
  Factory,
  FileText,
  Home,
  LogOut,
  Menu,
  Tag,
  Truck,
  Users,
  X,
} from "lucide-react";
import { LanguageToggle, Wordmark } from "@/components/brand";
import { useI18n } from "@/lib/i18n";
import { signOutAndReturn } from "@/lib/sign-out";
import { cn } from "@/lib/utils";

type AdminPath =
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

export function AdminShell({
  operations,
  approver,
  commercial,
  children,
}: {
  operations: boolean;
  approver: boolean;
  commercial: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const location = useRouterState({ select: (state) => state.location });
  const path = location.pathname;
  const tab = searchTab(location.search);
  const labelHash = hashIsEtikett(location.hash);
  const onLotsIndex = path === "/admin/lots";
  const onLotDetail = path.startsWith("/admin/lots/");
  const packingActive =
    (onLotsIndex && (tab === "active" || tab == null)) || (onLotDetail && labelHash);
  const productionActive = (onLotsIndex || onLotDetail) && !packingActive;
  const [menuOpen, setMenuOpen] = useState(false);
  const salesActive =
    path.startsWith("/admin/orders") ||
    path.startsWith("/admin/sales") ||
    path.startsWith("/admin/venues") ||
    path.startsWith("/admin/wholesalers") ||
    path.startsWith("/admin/products");
  const [salesOpen, setSalesOpen] = useState(salesActive);
  const [productionOpen, setProductionOpen] = useState(productionActive);

  useEffect(() => {
    setMenuOpen(false);
    if (salesActive) setSalesOpen(true);
    if (productionActive) setProductionOpen(true);
  }, [path, salesActive, productionActive]);

  const close = () => setMenuOpen(false);
  const showCustomers = operations || commercial;

  return (
    <div className="min-h-screen md:pl-60">
      {menuOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-foreground/30 md:hidden"
          aria-label={t("nav_close")}
          onClick={close}
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-sidebar-border bg-sidebar",
          menuOpen ? "flex" : "hidden md:flex",
        )}
      >
        <div className="px-4 py-4">
          <Wordmark size="sm" />
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-6">
          {operations ? (
            <SideLink
              to="/admin"
              label={t("nav_home")}
              exact
              path={path}
              icon={Home}
              onNavigate={close}
            />
          ) : null}

          <Section
            label={t("nav_sales")}
            icon={ClipboardList}
            open={salesOpen}
            active={salesActive}
            onToggle={() => setSalesOpen((open) => !open)}
          >
            <SideLink
              to="/admin/orders"
              label={t("nav_orders")}
              path={path}
              onNavigate={close}
              nested
            />
            {commercial ? (
              <SideLink
                to="/admin/sales"
                label={t("nav_followup")}
                path={path}
                onNavigate={close}
                nested
              />
            ) : null}
            {showCustomers ? (
              <p className="px-3 pt-3 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {t("nav_customers")}
              </p>
            ) : null}
            {operations ? (
              <SideLink
                to="/admin/venues"
                label={t("nav_venues")}
                path={path}
                onNavigate={close}
                nested
              />
            ) : null}
            {commercial ? (
              <SideLink
                to="/admin/wholesalers"
                label={t("wholesalers")}
                path={path}
                onNavigate={close}
                nested
              />
            ) : null}
            {commercial ? (
              <SideLink
                to="/admin/products"
                label={t("nav_products")}
                path={path}
                onNavigate={close}
                nested
              />
            ) : null}
          </Section>

          {operations ? (
            <Section
              label={t("nav_production")}
              icon={Factory}
              open={productionOpen}
              active={productionActive}
              onToggle={() => setProductionOpen((open) => !open)}
            >
              <SideLink
                to="/admin/lots"
                search={{ tab: "production" }}
                label={t("nav_register_lot")}
                path={path}
                active={onLotsIndex && tab === "production"}
                onNavigate={close}
                nested
              />
              <SideLink
                to="/admin/lots"
                search={{ tab: "history" }}
                label={t("history")}
                path={path}
                active={onLotsIndex && tab === "history"}
                onNavigate={close}
                nested
              />
              <SideLink
                to="/admin/lots"
                search={{ tab: "recall" }}
                label={t("lot_tab_recall")}
                path={path}
                active={onLotsIndex && tab === "recall"}
                onNavigate={close}
                nested
              />
            </Section>
          ) : null}
          {operations ? (
            <SideLink
              to="/admin/lots"
              search={{ tab: "active" }}
              label={t("nav_packing")}
              path={path}
              icon={Tag}
              active={packingActive}
              onNavigate={close}
            />
          ) : null}
          {operations ? (
            <SideLink
              to="/admin/deliveries"
              search={{ lot: "" }}
              label={t("nav_delivery")}
              path={path}
              icon={Truck}
              onNavigate={close}
            />
          ) : null}

          {commercial ? (
            <SideLink
              to="/admin/invoices"
              label={t("invoices")}
              path={path}
              icon={FileText}
              onNavigate={close}
            />
          ) : null}
          {operations ? (
            <SideLink
              to="/admin/reports"
              label={t("reports")}
              path={path}
              icon={BarChart3}
              onNavigate={close}
            />
          ) : null}
          {commercial ? (
            <SideLink
              to="/admin/staff"
              label={t("staff")}
              path={path}
              icon={Users}
              onNavigate={close}
            />
          ) : null}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
          <div className="flex items-center gap-2 px-3 py-2 md:px-5">
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-full border border-border md:hidden"
              aria-label={menuOpen ? t("nav_close") : t("nav_menu")}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
            <span className="hidden shrink-0 rounded-full border border-border bg-background px-3 py-1 text-sm font-semibold sm:inline">
              Gold of Sicily
            </span>
            <AdminShortcuts
              operations={operations}
              approver={approver}
              commercial={commercial}
              layout="bar"
            />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <LanguageToggle />
              <button
                type="button"
                onClick={signOutAndReturn}
                aria-label={t("sign_out")}
                className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

export function AdminShortcuts({
  operations,
  approver,
  commercial,
  layout,
}: {
  operations: boolean;
  approver: boolean;
  commercial: boolean;
  layout: "bar" | "card";
}) {
  const { t } = useI18n();
  const itemClass =
    layout === "bar"
      ? "shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-accent"
      : "block rounded-xl px-3 py-2 text-sm font-semibold hover:bg-accent";
  const links = (
    <>
      {approver ? (
        <Link to="/admin/orders" className={itemClass}>
          {t("home_approve")}
        </Link>
      ) : null}
      {operations ? (
        <Link to="/admin/lots" search={{ tab: "production" }} className={itemClass}>
          {t("home_new_lot")}
        </Link>
      ) : null}
      {operations ? (
        <Link to="/admin/lots" search={{ tab: "active" }} className={itemClass}>
          {t("home_label")}
        </Link>
      ) : null}
      {operations ? (
        <Link to="/admin/deliveries" search={{ lot: "" }} className={itemClass}>
          {t("home_deliver_action")}
        </Link>
      ) : null}
      {commercial ? (
        <Link to="/admin/invoices" className={itemClass}>
          {t("home_invoice")}
        </Link>
      ) : null}
    </>
  );
  if (layout === "card") {
    return <div className="flex flex-col">{links}</div>;
  }
  return <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">{links}</nav>;
}

function searchTab(search: unknown): string | undefined {
  if (!search || typeof search !== "object" || !("tab" in search)) return undefined;
  const tab = (search as { tab?: unknown }).tab;
  return typeof tab === "string" ? tab : undefined;
}

function hashIsEtikett(hash: string) {
  return hash === "etikett" || hash === "#etikett";
}

function pathIs(path: string, to: string, exact?: boolean) {
  if (exact) return path === to;
  return path === to || path.startsWith(`${to}/`);
}

type SideSearch = { tab: "active" | "production" | "history" | "recall" } | { lot: string };

function SideLink({
  to,
  search,
  label,
  exact,
  active,
  path,
  icon: Icon,
  nested,
  onNavigate,
}: {
  to: AdminPath;
  search?: SideSearch;
  label: string;
  exact?: boolean;
  active?: boolean;
  path: string;
  icon?: typeof Home;
  nested?: boolean;
  onNavigate: () => void;
}) {
  const on = active ?? pathIs(path, to, exact);
  return (
    <Link
      to={to}
      {...(search ? { search } : {})}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-lg py-2 text-sm",
        nested ? "px-3 pl-9" : "px-3 font-semibold",
        on
          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0" /> : null}
      {label}
    </Link>
  );
}

function Section({
  label,
  icon: Icon,
  open,
  active,
  onToggle,
  children,
}: {
  label: string;
  icon: typeof Home;
  open: boolean;
  active: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold",
          active
            ? "text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" />
        {label}
        <ChevronDown className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="mt-1 flex flex-col">{children}</div> : null}
    </div>
  );
}
