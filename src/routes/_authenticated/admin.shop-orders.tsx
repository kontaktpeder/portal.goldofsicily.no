import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  formatOre,
  isWaitingShopOrder,
  staffActions,
  type ShopFulfillment,
  type ShopOrderStatus,
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
};

const STATUS_KEY: Record<ShopOrderStatus, TranslationKey> = {
  received: "shop_order_pending",
  quote: "shop_order_quote",
  offer: "shop_order_offer",
  confirming: "shop_order_confirming",
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
    setBusyId(card.id);
    const result = await revise({ data: { id: card.id, boxes } });
    setBusyId(null);
    if (!result.ok) toast.error(t("shop_order_offer_note"));
    else toast.success(t("shop_order_offer"));
    await refresh();
  }

  const listed = orders.data;
  const cards = [...(listed?.orders ?? [])].sort(
    (a, b) => Number(isWaitingShopOrder(b.status)) - Number(isWaitingShopOrder(a.status)),
  );
  const unavailable = orders.isError || listed?.unavailable === true;

  return (
    <main className="mx-auto w-full max-w-xl px-5 pb-16">
      <h1 className="pt-8 text-3xl font-semibold">{t("nav_shop_orders")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("shop_orders_intro")}</p>
      {orders.isLoading ? <p className="mt-8 text-sm text-muted-foreground">…</p> : null}
      {!orders.isLoading && unavailable ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("shop_order_unavailable")}</p>
      ) : null}
      {!orders.isLoading && !unavailable && cards.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("shop_order_empty")}</p>
      ) : null}
      <div className="mt-6 flex flex-col gap-4">
        {cards.map((card) => {
          const actions = staffActions(card);
          const busy = busyId === card.id;
          const boxWord = card.boxes === 1 ? t("shop_order_box") : t("shop_order_boxes_plural");
          return (
            <article
              key={card.id}
              className="rounded-2xl border border-border bg-card p-4 shadow-sm"
            >
              <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {lang === "en" ? "Web order" : "Nettbestilling"} {card.orderNumber}
              </p>
              <h2 className="mt-1 text-xl font-semibold">{t(STATUS_KEY[card.status])}</h2>
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
                    : t("shop_order_delivery")}
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
                <dt className="text-muted-foreground">{t("shop_order_total")}</dt>
                <dd className="text-base font-semibold">{formatOre(card.totalOre)}</dd>
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">
                {card.email} · {card.phone}
                <br />
                {card.addressLine}, {card.postalCode} {card.city}
              </p>
              {card.orgNumber ? <p className="mt-2 text-sm">{t("shop_order_org")}</p> : null}
              {card.fulfillment !== "pickup" ? (
                <p className="mt-2 text-sm">{t("shop_order_delivery_note")}</p>
              ) : null}
              {card.status === "offer" ? (
                <p className="mt-2 text-sm">{t("shop_order_offer_note")}</p>
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
              {actions.offer ? (
                <div className="mt-4 flex items-center gap-2">
                  <input
                    inputMode="numeric"
                    aria-label={t("shop_order_boxes")}
                    className="h-11 w-16 rounded-lg border border-border bg-background px-2 text-center"
                    value={boxesById[card.id] ?? String(card.offerBoxes ?? card.boxes)}
                    onChange={(event) =>
                      setBoxesById((current) => ({ ...current, [card.id]: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onOffer(card)}
                    className="h-11 rounded-full border border-border px-4 text-sm font-semibold"
                  >
                    {t("shop_order_send_offer")}
                  </button>
                </div>
              ) : null}
              {actions.approve || actions.decline ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {actions.decline ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDecline(card)}
                      className="h-12 rounded-full border border-border text-sm font-semibold"
                    >
                      {t("shop_order_decline")}
                    </button>
                  ) : (
                    <span />
                  )}
                  {actions.approve ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onApprove(card)}
                      className="h-12 rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                    >
                      {t("shop_order_approve")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </main>
  );
}
