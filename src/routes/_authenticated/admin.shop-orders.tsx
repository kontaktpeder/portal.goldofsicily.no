import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistance } from "@/lib/delivery-zone";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  formatOre,
  isWaitingShopOrder,
  staffActions,
  staffSituation,
  type ShopFulfillment,
  type ShopOrderStatus,
  type StaffSituation,
} from "@/lib/shop-order";
import {
  approveNettbestilling,
  declineNettbestilling,
  listNettbestillinger,
  reviseNettbestilling,
} from "@/lib/shop.functions";

export const Route = createFileRoute("/_authenticated/admin/shop-orders")({
  head: () => ({ meta: [{ title: "Nettbestillinger — Gold of Sicily" }] }),
  component: ShopOrdersPage,
});

type Card = {
  id: string;
  orderNumber: string;
  status: ShopOrderStatus;
  flavorName: string;
  boxes: number;
  pieces: number;
  totalOre: number;
  customerName: string;
  email: string;
  phone: string;
  addressLine: string;
  postalCode: string;
  city: string;
  orgNumber: string | null;
  fulfillment: ShopFulfillment;
  binding: boolean;
  customerOrderId: string | null;
  offerBoxes: number | null;
  freightOre: number | null;
  distanceM: number | null;
  offerFreightOre: number | null;
  offerFulfillment: ShopFulfillment | null;
  offerNote: string | null;
};

const SITUATION_KEY: Record<StaffSituation, TranslationKey> = {
  ready: "shop_order_ready",
  clarify: "shop_order_clarify",
  waiting: "shop_order_waiting",
  working: "shop_order_confirming",
  confirmed: "shop_order_confirmed",
  declined: "shop_order_declined",
  expired: "shop_order_expired",
};

function ShopOrdersPage() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const list = useServerFn(listNettbestillinger);
  const approve = useServerFn(approveNettbestilling);
  const decline = useServerFn(declineNettbestilling);
  const revise = useServerFn(reviseNettbestilling);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [boxesById, setBoxesById] = useState<Record<string, string>>({});
  const [freightById, setFreightById] = useState<Record<string, string>>({});
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [fulfillmentById, setFulfillmentById] = useState<Record<string, ShopFulfillment>>({});
  const [reviseId, setReviseId] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ["nettbestillinger"],
    queryFn: () => list(),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["nettbestillinger"] });
  }

  async function onApprove(card: Card) {
    setBusyId(card.id);
    const result = await approve({ data: { id: card.id } });
    setBusyId(null);
    if (!result.ok) {
      toast.error(
        result.reason === "stock"
          ? t("shop_order_stock")
          : result.reason === "busy"
            ? t("shop_order_busy")
            : t("shop_order_expired_note"),
      );
      await refresh();
      return;
    }
    toast.success(t("shop_order_confirmed"));
    await refresh();
  }

  async function onDecline(card: Card) {
    setBusyId(card.id);
    const result = await decline({ data: { id: card.id } });
    setBusyId(null);
    if (!result.ok) toast.error(t("shop_order_busy"));
    await refresh();
  }

  async function onOffer(card: Card) {
    const boxes = Math.floor(Number(boxesById[card.id] ?? card.offerBoxes ?? card.boxes));
    const fulfillment = fulfillmentById[card.id] ?? card.offerFulfillment ?? card.fulfillment;
    const freightRaw = (freightById[card.id] ?? "").trim();
    if (fulfillment === "delivery_request" && !/^\d+$/.test(freightRaw)) {
      toast.error(t("shop_order_clarify_hint"));
      return;
    }
    const freightKr = fulfillment === "pickup" ? 0 : Number(freightRaw);
    setBusyId(card.id);
    const result = await revise({
      data: {
        id: card.id,
        boxes,
        fulfillment,
        freightKr,
        note: noteById[card.id] ?? "",
      },
    });
    setBusyId(null);
    if (!result.ok) toast.error(t("shop_order_offer_note"));
    else toast.success(t("shop_order_waiting"));
    await refresh();
  }

  const listed = orders.data;
  const cards = [...(listed?.orders ?? [])].sort(
    (a, b) => Number(isWaitingShopOrder(b.status)) - Number(isWaitingShopOrder(a.status)),
  );
  const unavailable = orders.isError || listed?.unavailable === true;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <h1 className="pt-8 text-3xl font-semibold">{t("nav_shop_orders")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("shop_orders_intro")}</p>
      {orders.isLoading ? <p className="mt-8 text-sm text-muted-foreground">…</p> : null}
      {!orders.isLoading && unavailable ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("shop_order_unavailable")}</p>
      ) : null}
      {!orders.isLoading && !unavailable && cards.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("shop_order_empty")}</p>
      ) : null}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {cards.map((card) => {
          const actions = staffActions(card);
          const situation = staffSituation(card);
          const busy = busyId === card.id;
          const boxWord = card.boxes === 1 ? t("shop_order_box") : t("shop_order_boxes_plural");
          const freight = card.fulfillment === "pickup" ? (card.freightOre ?? 0) : card.freightOre;
          const showOffer = actions.offer || (actions.revise && reviseId === card.id);
          const chosen = fulfillmentById[card.id] ?? card.offerFulfillment ?? card.fulfillment;
          return (
            <article
              key={card.id}
              className="rounded-2xl border border-border bg-card p-4 shadow-sm"
            >
              <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {lang === "en" ? "Web order" : "Nettbestilling"} {card.orderNumber}
              </p>
              <h2 className="mt-1 text-xl font-semibold">{t(SITUATION_KEY[situation])}</h2>
              {situation === "ready" || situation === "clarify" || situation === "waiting" ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {situation === "ready"
                    ? t("shop_order_ready_hint")
                    : situation === "clarify"
                      ? t("shop_order_clarify_hint")
                      : t("shop_order_waiting_hint")}
                </p>
              ) : null}
              <p className="mt-4 text-lg">
                {card.pieces} arancini · {card.flavorName}
              </p>
              <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t("shop_order_boxes")}</dt>
                <dd>
                  {card.boxes} {boxWord}
                </dd>
                <dt className="text-muted-foreground">{t("shop_order_customer")}</dt>
                <dd>
                  {card.customerName}
                  <span className="block text-muted-foreground">{t("shop_order_private")}</span>
                </dd>
                <dt className="text-muted-foreground">{t("shop_order_handoff")}</dt>
                <dd>
                  {card.fulfillment === "pickup"
                    ? t("shop_order_pickup")
                    : `${t("shop_order_delivery")} · ${card.addressLine}`}
                  {card.distanceM != null ? (
                    <span className="block text-muted-foreground">
                      {formatDistance(card.distanceM, lang)}
                    </span>
                  ) : null}
                </dd>
                <dt className="text-muted-foreground">{t("shop_order_reserved")}</dt>
                <dd>
                  {card.binding &&
                  (card.status === "received" ||
                    card.status === "confirmed" ||
                    card.status === "confirming")
                    ? `${card.pieces} ${t("shop_order_pieces")}`
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">{t("shop_order_goods")}</dt>
                <dd>{formatOre(card.totalOre)}</dd>
                <dt className="text-muted-foreground">{t("shop_order_freight")}</dt>
                <dd>{freight == null ? t("shop_order_freight_open") : formatOre(freight)}</dd>
                <dt className="text-muted-foreground">{t("shop_order_total")}</dt>
                <dd className="text-base font-semibold">
                  {freight == null
                    ? t("shop_order_total_open")
                    : formatOre(card.totalOre + freight)}
                </dd>
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">
                {card.email} · {card.phone}
                <br />
                {card.addressLine}, {card.postalCode} {card.city}
              </p>
              {card.orgNumber ? <p className="mt-2 text-sm">{t("shop_order_org")}</p> : null}
              {card.status === "offer" && card.offerBoxes ? (
                <p className="mt-2 text-sm">
                  {card.offerBoxes} {t("shop_order_boxes_plural")} ·{" "}
                  {card.offerFulfillment === "delivery_request"
                    ? t("shop_order_delivery")
                    : t("shop_order_pickup")}
                  {card.offerFreightOre != null ? ` · ${formatOre(card.offerFreightOre)}` : ""}
                  {card.offerNote ? ` · ${card.offerNote}` : ""}
                </p>
              ) : null}
              {card.status === "expired" ? (
                <p className="mt-2 text-sm">{t("shop_order_expired_note")}</p>
              ) : null}
              {card.customerOrderId ? (
                <p className="mt-3 text-sm">
                  {t("shop_order_next")}{" "}
                  <Link
                    to="/admin/orders/$orderId"
                    params={{ orderId: card.customerOrderId }}
                    className="font-semibold underline"
                  >
                    {t("shop_order_open")}
                  </Link>
                </p>
              ) : null}
              {actions.revise && !showOffer ? (
                <button
                  type="button"
                  className="mt-4 text-sm font-semibold underline"
                  onClick={() => setReviseId(card.id)}
                >
                  {t("shop_order_change")}
                </button>
              ) : null}
              {showOffer ? (
                <div className="mt-4 grid gap-2">
                  <label className="text-sm">
                    {t("shop_order_boxes")}
                    <input
                      inputMode="numeric"
                      className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3"
                      value={boxesById[card.id] ?? String(card.offerBoxes ?? card.boxes)}
                      onChange={(event) =>
                        setBoxesById((current) => ({ ...current, [card.id]: event.target.value }))
                      }
                    />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`handoff-${card.id}`}
                      checked={chosen === "pickup"}
                      onChange={() =>
                        setFulfillmentById((current) => ({ ...current, [card.id]: "pickup" }))
                      }
                    />
                    {t("shop_order_pickup")}
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`handoff-${card.id}`}
                      checked={chosen === "delivery_request"}
                      onChange={() =>
                        setFulfillmentById((current) => ({
                          ...current,
                          [card.id]: "delivery_request",
                        }))
                      }
                    />
                    {t("shop_order_delivery")}
                  </label>
                  {chosen === "delivery_request" ? (
                    <label className="text-sm">
                      {t("shop_order_freight_kr")}
                      <input
                        inputMode="numeric"
                        className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3"
                        value={
                          freightById[card.id] ??
                          (card.freightOre != null ? String(card.freightOre / 100) : "")
                        }
                        onChange={(event) =>
                          setFreightById((current) => ({
                            ...current,
                            [card.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ) : null}
                  <label className="text-sm">
                    {t("shop_order_when")}
                    <input
                      className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3"
                      value={noteById[card.id] ?? ""}
                      onChange={(event) =>
                        setNoteById((current) => ({ ...current, [card.id]: event.target.value }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onOffer(card)}
                    className="h-12 rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  >
                    {t("shop_order_send_offer")}
                  </button>
                </div>
              ) : null}
              {actions.approve ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onApprove(card)}
                  className="mt-4 h-12 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                >
                  {t("shop_order_approve")}
                </button>
              ) : null}
              {actions.decline ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecline(card)}
                  className="mt-3 text-sm font-semibold text-muted-foreground underline"
                >
                  {t("shop_order_decline")}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </main>
  );
}
