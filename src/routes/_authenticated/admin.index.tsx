import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AdminShortcuts } from "@/components/admin-shell";
import { useLotPrerequisites } from "@/hooks/use-lot-prerequisites";
import { useOpsHome } from "@/hooks/use-ops-home";
import { useSessionInfo } from "@/hooks/use-session";
import { canApproveOrders } from "@/lib/access";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { homeTasks, type FlavorStock, type HomeTask, type NextNeedItem } from "@/lib/ops-home";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Hjem — Gold of Sicily" },
      {
        name: "description",
        content: "The jobs waiting in Gold of Sicily, then stock.",
      },
      { property: "og:title", content: "Hjem — Gold of Sicily" },
      {
        property: "og:description",
        content: "The jobs waiting in Gold of Sicily, then stock.",
      },
    ],
  }),
  component: OpsHome,
});

const TASK_TITLE: Record<HomeTask["id"], TranslationKey> = {
  approve: "home_approve",
  produce: "ops_start_production",
  label: "home_label_task",
  handover: "ops_handover_villa",
  deliver: "ops_register_delivery",
};

function OpsHome() {
  const { t, lang } = useI18n();
  const prereq = useLotPrerequisites();
  const { data, isPending } = useOpsHome(lang);
  const { data: info } = useSessionInfo();
  const tasks = homeTasks({
    approvals: data?.approval ?? [],
    productionShortfall: data?.productionShortfall ?? 0,
    lotsAtGold: data?.lotsAtGold ?? [],
    openDeliveries: data?.openDeliveries ?? [],
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <h1 className="pt-8 text-3xl font-semibold">{t("nav_home")}</h1>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          {!prereq.loading && !prereq.ok ? <GetStarted /> : null}
          <section className="surface-card p-5">
            <h2 className="text-lg font-semibold">{t("home_list")}</h2>
            {isPending ? null : tasks.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("home_list_empty")}</p>
            ) : (
              <div className="mt-3 space-y-2">
                {tasks.map((task) => (
                  <TaskLink key={task.id} task={task}>
                    <TaskCopy title={t(TASK_TITLE[task.id])} hint={taskHint(task, data, t)} />
                  </TaskLink>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="surface-card p-5">
          <h2 className="text-lg font-semibold">{t("home_shortcuts")}</h2>
          <div className="mt-2">
            <AdminShortcuts
              operations={Boolean(info?.canManageOperations)}
              approver={canApproveOrders(info?.roles ?? [])}
              commercial={Boolean(info?.canManageCommercial)}
              layout="card"
            />
          </div>
        </section>
      </div>

      <h2 className="eyebrow mt-10">{t("ops_stock")}</h2>
      <div className="mt-3 space-y-3">
        {(data?.stock ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("ops_stock_empty")}</p>
        ) : (
          data?.stock.map((row) => <StockCard key={row.productId} row={row} lang={lang} />)
        )}
      </div>

      <h2 className="eyebrow mt-10">{t("orders_production")}</h2>
      <div className="mt-3 space-y-2">
        {(data?.production ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("orders_production_empty")}</p>
        ) : (
          data?.production.map((row) => (
            <article key={row.productId} className="surface-card p-5">
              <p className="font-semibold">{lang === "en" ? row.nameEn : row.nameNo}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("orders_remaining")} {row.remaining} · {t("orders_on_hand")} {row.onHand} ·{" "}
                {t("orders_shortfall")} {row.shortfall}
              </p>
            </article>
          ))
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

function GetStarted() {
  const { t, lang } = useI18n();
  const prereq = useLotPrerequisites();
  return (
    <section className="surface-card p-5">
      <h2 className="text-lg font-semibold">{t("home_get_started")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("home_get_started_hint")}</p>
      {prereq.schemaMissing ? (
        <p className="mt-3 text-sm">{t("lot_schema_missing")}</p>
      ) : (
        <div className="mt-3 rounded-xl border border-border px-4 py-3">
          <p className="font-medium">{t("home_letters")}</p>
          <ul className="mt-1 text-sm text-muted-foreground">
            {prereq.missingLetters.map((product) => (
              <li key={product.id}>{lang === "en" ? product.name_en : product.name_no}</li>
            ))}
          </ul>
          <Link
            to="/admin/products"
            className="mt-3 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            {t("open_products")}
          </Link>
        </div>
      )}
    </section>
  );
}

function taskHint(
  task: HomeTask,
  data:
    | {
        approval: { ordererName: string; orderNumber: string }[];
        openDeliveries: { customerName: string; orderNumber: string }[];
      }
    | undefined,
  t: (key: TranslationKey) => string,
) {
  if (task.id === "approve" && task.count === 1 && data?.approval[0]) {
    const order = data.approval[0];
    return `${order.ordererName} · ${order.orderNumber}`;
  }
  if (task.id === "approve") return `${task.count} ${t("home_orders_waiting")}`;
  if (task.id === "produce") return `${t("orders_shortfall")} ${task.count}`;
  if (task.id === "label") {
    return task.count === 1 ? t("home_label_one") : `${task.count} ${t("home_label_many")}`;
  }
  if (task.id === "handover") {
    return task.count === 1 ? t("ops_handover_one") : `${task.count} ${t("ops_handover_many")}`;
  }
  if (task.count === 1 && data?.openDeliveries[0]) {
    const order = data.openDeliveries[0];
    return `${order.customerName} · ${order.orderNumber}`;
  }
  return `${task.count} ${t("home_deliver_many")}`;
}

function TaskLink({ task, children }: { task: HomeTask; children: React.ReactNode }) {
  const className =
    "flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 transition-shadow hover:shadow-[var(--shadow-lift)]";
  const target = task.target;
  if (target.to === "/admin/orders/$orderId") {
    return (
      <Link to="/admin/orders/$orderId" params={{ orderId: target.orderId }} className={className}>
        {children}
      </Link>
    );
  }
  if (target.to === "/admin/lots/$lotId") {
    return (
      <Link
        to="/admin/lots/$lotId"
        params={{ lotId: target.lotId }}
        {...(task.id === "label" ? { hash: "etikett" } : {})}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (target.to === "/admin/lots") {
    return (
      <Link to="/admin/lots" search={{ tab: target.tab }} className={className}>
        {children}
      </Link>
    );
  }
  if (target.to === "/admin/deliveries") {
    return (
      <Link to="/admin/deliveries" search={{ lot: target.lot }} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <Link to="/admin/orders" className={className}>
      {children}
    </Link>
  );
}

function TaskCopy({ title, hint }: { title: string; hint: string }) {
  return (
    <>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
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
