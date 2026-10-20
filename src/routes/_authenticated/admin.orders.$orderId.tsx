import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";
import { DriverSelect } from "@/components/delivery-driver-editor";
import { InvoiceFact, InvoiceStepView } from "@/components/order-invoice-step";
import { OrderSettlementPanel } from "@/components/order-settlement";
import { supabase } from "@/integrations/supabase/client";
import {
  dnbCompanyName,
  listProductionStaff,
  syncOrderAdvance,
  transferInvoiceDraft,
} from "@/lib/admin.functions";
import { useSessionInfo } from "@/hooks/use-session";
import {
  canApproveOrders,
  canManageCommercial,
  canManageOperations,
  canRegisterOrders,
} from "@/lib/access";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  assignStockSource,
  deliveryNeedsStockSourceChoice,
  isGoldLotSchemaError,
  isVillaStockSchemaError,
  openLotsForProduct,
  suggestLotId,
  suggestVillaHandover,
  toStockLots,
  validateDeliveryStock,
  validateVillaStock,
  villaOptions,
  type StockSource,
} from "@/lib/lot-stock";
import { isDeliveryDriverSchemaError, suggestedDeliveredBy } from "@/lib/delivery-driver";
import {
  orderBasisOre,
  settlementClaims,
  settlementView,
  type AdvancePayment,
} from "@/lib/order-advance";
import {
  canCancelOrder,
  deliveryErrorKind,
  deliveryNotice,
  followUpNotice,
  formatAgreedDelivery,
  fulfillmentBlock,
  goodsInvoicePrepareLabel,
  isOrderSchemaError,
  linkableQuantity,
  orderInvoiceSteps,
  orderPartyLabel,
  orderPrimaryAction,
  orderProgress,
  osloToday,
  remainingQuantity,
  suggestedDeliveryQuantity,
  type OrderInvoiceLine,
  type OrderProgress,
  type OrderWorkflow,
} from "@/lib/orders";
import type { ProductionStaff } from "@/lib/lot-producers";
import { formatPriceNok } from "@/lib/slug";
import { errorMessage } from "@/lib/utils";

const fieldClass =
  "h-11 w-full rounded-2xl border-2 border-border bg-card px-3 text-sm outline-none focus:border-primary";

const stockSelect =
  "id, lot_code, product_id, produced_qty, approved_qty, status, delivery_lines(quantity, source_handover_id), gold_lot_handovers(id, quantity, ownership_after_handover, recipient_company)";

const PROGRESS_KEY: Record<OrderProgress, TranslationKey> = {
  draft: "orders_status_draft",
  pending_confirmation: "orders_status_pending_confirmation",
  changes_requested: "orders_status_changes_requested",
  confirmed: "orders_status_confirmed",
  partially_delivered: "orders_status_partially_delivered",
  delivered: "orders_status_delivered",
  cancelled: "orders_status_cancelled",
};

export const Route = createFileRoute("/_authenticated/admin/orders/$orderId")({
  head: () => ({
    meta: [
      { title: "Ordre — Gold of Sicily" },
      { name: "description", content: "Approve an order and register its delivery." },
    ],
  }),
  component: OrderPage,
});

function OrderPage() {
  const { orderId } = Route.useParams();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const session = useSessionInfo();
  const roles = session.data?.roles ?? [];
  const approver = canApproveOrders(roles);
  const registrar = canRegisterOrders(roles);
  const operations = canManageOperations(roles);
  const commercial = canManageCommercial(roles);
  const action = orderPrimaryAction(approver);
  const staffFn = useServerFn(listProductionStaff);
  const transferFn = useServerFn(transferInvoiceDraft);
  const syncAdvanceFn = useServerFn(syncOrderAdvance);
  const companyFn = useServerFn(dnbCompanyName);
  const [busy, setBusy] = useState(false);
  const [agreedOn, setAgreedOn] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [deviation, setDeviation] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [deliverOn, setDeliverOn] = useState("");
  const [deliveredBy, setDeliveredBy] = useState("");
  const [deliverQty, setDeliverQty] = useState<Record<string, string>>({});
  const [deliverLot, setDeliverLot] = useState<Record<string, string>>({});
  const [deliverHandover, setDeliverHandover] = useState<Record<string, string>>({});
  const [stockSource, setStockSource] = useState<StockSource>("gold");
  const [linkLineId, setLinkLineId] = useState("");
  const [linkQty, setLinkQty] = useState("");
  const [linkConfirmed, setLinkConfirmed] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const savingDelivery = useRef(false);
  const deliveryKey = useRef<string | null>(null);
  const suggestedOnce = useRef(false);
  const driverSuggested = useRef(false);

  const order = useQuery({
    queryKey: ["customer-order", orderId],
    queryFn: async () => {
      const embedded =
        "ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(id, name), ship_to:customers!customer_orders_ship_to_customer_id_fkey(id, name)";
      const base =
        "id, order_number, status, contact_name, desired_delivery_on, confirmed_delivery_on, billing_legal_entity_id, billing_legal_name_snapshot, billing_organization_number_snapshot, owner_id, owner_name_snapshot, deviation_note, notes, ordered_by_customer_id, ship_to_customer_id";
      const detail = `${base}, return_note, approved_at, approved_name_snapshot, submitted_at, submitted_name_snapshot`;
      const withAdvance = await supabase
        .from("customer_orders")
        .select(
          `${detail}, follow_up_on, follow_up_note, advance_percent, advance_basis_ore, advance_agreed_ore, ${embedded}`,
        )
        .eq("id", orderId)
        .maybeSingle();
      if (!withAdvance.error) return { pendingSql: false as const, row: withAdvance.data };
      if (!isOrderSchemaError(withAdvance.error.message)) throw withAdvance.error;
      const withFollow = await supabase
        .from("customer_orders")
        .select(`${detail}, follow_up_on, follow_up_note, ${embedded}`)
        .eq("id", orderId)
        .maybeSingle();
      if (!withFollow.error) {
        return {
          pendingSql: true as const,
          row: withFollow.data
            ? {
                ...withFollow.data,
                advance_percent: null,
                advance_basis_ore: null,
                advance_agreed_ore: null,
              }
            : null,
        };
      }
      if (!isOrderSchemaError(withFollow.error.message)) throw withFollow.error;
      const rich = await supabase
        .from("customer_orders")
        .select(`${detail}, ${embedded}`)
        .eq("id", orderId)
        .maybeSingle();
      if (!rich.error) {
        return {
          pendingSql: true as const,
          row: rich.data
            ? {
                ...rich.data,
                follow_up_on: null,
                follow_up_note: null,
                advance_percent: null,
                advance_basis_ore: null,
                advance_agreed_ore: null,
              }
            : null,
        };
      }
      if (!isOrderSchemaError(rich.error.message)) throw rich.error;
      const plain = await supabase
        .from("customer_orders")
        .select(`${base}, ${embedded}`)
        .eq("id", orderId)
        .maybeSingle();
      if (plain.error) throw plain.error;
      return {
        pendingSql: true as const,
        row: plain.data
          ? {
              ...plain.data,
              return_note: null,
              approved_at: null,
              approved_name_snapshot: null,
              submitted_at: null,
              submitted_name_snapshot: null,
              follow_up_on: null,
              follow_up_note: null,
              advance_percent: null,
              advance_basis_ore: null,
              advance_agreed_ore: null,
            }
          : null,
      };
    },
  });

  const lines = useQuery({
    queryKey: ["customer-order-lines", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_order_lines")
        .select(
          "id, product_id, quantity, unit_price_ore, product_name_snapshot, products(name_no, name_en)",
        )
        .eq("order_id", orderId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const fulfillments = useQuery({
    queryKey: ["customer-order-fulfillments", orderId],
    queryFn: async () => {
      const lineIds = (lines.data ?? []).map((line) => line.id);
      if (lineIds.length === 0) return [];
      const rich =
        "id, order_line_id, delivery_line_id, quantity, delivery_lines(id, quantity, product_name_snapshot, gold_lots(lot_code), deliveries(id, delivered_at, note, delivered_by, delivered_by_name, registered_name_snapshot))";
      const { data, error } = await supabase
        .from("order_line_fulfillments")
        .select(rich)
        .in("order_line_id", lineIds);
      if (!error) return data ?? [];
      if (!isOrderSchemaError(error.message) && !isDeliveryDriverSchemaError(error.message)) {
        throw error;
      }
      const plain = await supabase
        .from("order_line_fulfillments")
        .select(
          "id, order_line_id, delivery_line_id, quantity, delivery_lines(id, quantity, product_name_snapshot, gold_lots(lot_code), deliveries(id, delivered_at, note, delivered_by, delivered_by_name))",
        )
        .in("order_line_id", lineIds);
      if (plain.error) throw plain.error;
      return plain.data ?? [];
    },
    enabled: lines.isSuccess,
  });

  const products = useQuery({
    queryKey: ["order-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name_no, name_en")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const staff = useQuery({
    queryKey: ["order-production-staff"],
    enabled: approver || operations,
    queryFn: () => staffFn(),
  });

  const invoiceLines = useQuery({
    queryKey: ["order-invoice-lines", orderId],
    enabled: operations || commercial,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("order_invoice_lines", { p_order_id: orderId });
      if (error) {
        if (isMissingOrderSetup(error.message)) {
          return { pendingSql: true as const, rows: [], error: null };
        }
        return { pendingSql: false as const, rows: [], error: error.message };
      }
      if (!Array.isArray(data)) {
        return { pendingSql: false as const, rows: [], error: "unexpected" };
      }
      return { pendingSql: false as const, rows: toInvoiceLines(data), error: null };
    },
  });

  const advance = useQuery({
    queryKey: ["order-advance", orderId],
    enabled: (operations || commercial) && Boolean(order.data && !order.data.pendingSql),
    queryFn: async () => {
      const claim = await supabase
        .from("order_advance_claims")
        .select(
          "id, amount_ore, accounting_invoice_id, accounting_invoice_number, dnb_rest_ore, dnb_received_ore, payments_checked_at, surplus_ore",
        )
        .eq("order_id", orderId)
        .maybeSingle();
      if (claim.error) {
        if (isMissingOrderSetup(claim.error.message)) {
          return { pendingSql: true as const, claim: null, payments: [], offsets: [], error: null };
        }
        return {
          pendingSql: false as const,
          claim: null,
          payments: [],
          offsets: [],
          error: claim.error.message,
        };
      }
      if (!claim.data) {
        return { pendingSql: false as const, claim: null, payments: [], offsets: [], error: null };
      }
      const [payments, offsets] = await Promise.all([
        supabase
          .from("order_advance_payments")
          .select("amount_ore, paid_on")
          .eq("claim_id", claim.data.id)
          .order("paid_on", { ascending: true }),
        supabase
          .from("order_advance_offsets")
          .select("amount_ore, confirmed_ore, invoice_draft_id")
          .eq("claim_id", claim.data.id),
      ]);
      if (payments.error) {
        return {
          pendingSql: false as const,
          claim: claim.data,
          payments: [],
          offsets: [],
          error: payments.error.message,
        };
      }
      if (offsets.error) {
        return {
          pendingSql: false as const,
          claim: claim.data,
          payments: [],
          offsets: [],
          error: offsets.error.message,
        };
      }
      return {
        pendingSql: false as const,
        claim: claim.data,
        payments: (payments.data ?? []).map((payment): AdvancePayment => ({
          amountOre: payment.amount_ore,
          paidOn: payment.paid_on,
        })),
        offsets: offsets.data ?? [],
        error: null,
      };
    },
  });

  const company = useQuery({
    queryKey: ["dnb-company-name"],
    enabled: operations || commercial,
    queryFn: () => companyFn(),
    staleTime: 60_000,
  });

  const settlementDraftId =
    (invoiceLines.data?.rows ?? []).find(
      (line) => line.transferStatus === "transferred" && line.active,
    )?.draftId ?? null;

  const advanceSync = useQuery({
    queryKey: [
      "order-advance-sync",
      orderId,
      advance.data?.claim?.accounting_invoice_id ?? null,
      settlementDraftId,
    ],
    enabled:
      (operations || commercial) &&
      Boolean(advance.data?.claim?.accounting_invoice_id) &&
      advance.data?.pendingSql !== true,
    queryFn: async () => {
      const result = await syncAdvanceFn({ data: { orderId, settlementDraftId } });
      await queryClient.invalidateQueries({ queryKey: ["order-advance", orderId] });
      return result;
    },
  });

  const row = order.data?.row ?? null;
  if (row && lines.isSuccess && loadedFor !== row.id) {
    setLoadedFor(row.id);
    setAgreedOn(row.confirmed_delivery_on || row.desired_delivery_on || "");
    setOwnerId(row.owner_id ?? "");
    setFollowUpOn(row.follow_up_on ?? "");
    setFollowUpNote(row.follow_up_note ?? "");
    setDeviation(row.deviation_note ?? "");
    setReturnNote("");
    const nextQty: Record<string, string> = {};
    for (const line of lines.data ?? []) nextQty[line.product_id] = String(line.quantity);
    setLineQty(nextQty);
  }

  const repairs = useQuery({
    queryKey: ["order-delivery-repairs", orderId, row?.ship_to_customer_id],
    enabled: repairOpen && commercial && Boolean(row?.ship_to_customer_id),
    queryFn: async () => {
      const siteId = row?.ship_to_customer_id;
      if (!siteId) return [];
      const { data, error } = await supabase
        .from("deliveries")
        .select(
          "id, delivered_at, customer_name_snapshot, delivery_lines(id, product_id, quantity, product_name_snapshot, gold_lots(lot_code), order_line_fulfillments(quantity), invoice_draft_lines(quantity, active, order_line_fulfillment_id))",
        )
        .eq("customer_id", siteId)
        .order("delivered_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });

  const stock = useQuery({
    queryKey: ["order-delivery-lots"],
    enabled: delivering && operations,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gold_lots")
        .select(stockSelect)
        .order("lot_code", { ascending: false })
        .limit(400);
      if (!error) return toStockLots(data ?? []);
      if (isVillaStockSchemaError(error.message) || isGoldLotSchemaError(error)) {
        const fallback = await supabase
          .from("gold_lots")
          .select("id, lot_code, product_id, produced_qty, status, delivery_lines(quantity)")
          .order("lot_code", { ascending: false })
          .limit(400);
        if (fallback.error) {
          if (isGoldLotSchemaError(fallback.error)) return [];
          throw fallback.error;
        }
        return toStockLots(fallback.data ?? []);
      }
      throw error;
    },
  });

  const orderLines = lines.data ?? [];
  const linked = fulfillments.data ?? [];
  const orderedQty = orderLines.reduce((sum, line) => sum + line.quantity, 0);
  const fulfilledQty = linked.reduce((sum, line) => sum + line.quantity, 0);
  const progress = row ? orderProgress(row.status, orderedQty, fulfilledQty) : "draft";
  const editable = row?.status === "draft" || row?.status === "changes_requested";
  const stockLots = stock.data ?? [];
  const seedLines = useRef(orderLines);
  const seedLinked = useRef(linked);
  const seedLots = useRef(stockLots);
  seedLines.current = orderLines;
  seedLinked.current = linked;
  seedLots.current = stockLots;
  const showStockSource = deliveryNeedsStockSourceChoice(
    stockLots,
    orderLines.map((line) => ({
      productId: line.product_id,
      quantity: Number.parseInt(deliverQty[line.product_id] ?? "", 10) || 0,
    })),
  );
  const effectiveSource: StockSource = showStockSource ? stockSource : "gold";

  useEffect(() => {
    if (!delivering || suggestedOnce.current || !stock.isSuccess) return;
    suggestedOnce.current = true;
    const linesNow = seedLines.current;
    const linkedNow = seedLinked.current;
    const lotsNow = seedLots.current;
    setDeliverQty((current) => {
      const next = { ...current };
      for (const line of linesNow) {
        if (next[line.product_id]) continue;
        const done = linkedNow
          .filter((item) => item.order_line_id === line.id)
          .reduce((sum, item) => sum + item.quantity, 0);
        const left = remainingQuantity(line.quantity, done);
        const available = openLotsForProduct(lotsNow, line.product_id).reduce(
          (max, lot) => Math.max(max, lot.remaining),
          0,
        );
        const suggested = suggestedDeliveryQuantity(left, available);
        if (suggested > 0) next[line.product_id] = String(suggested);
      }
      return next;
    });
  }, [delivering, stock.isSuccess]);

  const userId = session.data?.session?.user.id ?? null;
  useEffect(() => {
    if (!delivering || driverSuggested.current) return;
    const ids = (staff.data?.staff ?? []).map((person) => person.id);
    if (ids.length === 0) return;
    driverSuggested.current = true;
    setDeliveredBy(suggestedDeliveredBy(ids, userId));
  }, [delivering, staff.data, userId]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["customer-order", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["customer-order-lines", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["customer-order-fulfillments", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
    await queryClient.invalidateQueries({ queryKey: ["invoice-desk"] });
    await queryClient.invalidateQueries({ queryKey: ["ops-home"] });
    await queryClient.invalidateQueries({ queryKey: ["order-approval-notices"] });
    await queryClient.invalidateQueries({ queryKey: ["order-work-notices"] });
    await queryClient.invalidateQueries({ queryKey: ["order-invoice-lines", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["order-advance", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["admin-deliveries"] });
  }

  function offsetPlan(finalIds: readonly string[], draftId: string | null) {
    const claim = advance.data?.claim;
    const invoiceRows = (invoiceLines.data?.rows ?? []).filter((line) => line.active);
    const claims = settlementClaims(invoiceRows, finalIds);
    const known = new Set(invoiceRows.map((line) => line.fulfillmentId));
    let extra = 0;
    for (const id of finalIds) {
      if (known.has(id)) continue;
      const link = linked.find((item) => item.id === id);
      const line = orderLines.find((item) => item.id === link?.order_line_id);
      if (link && line?.unit_price_ore) extra += link.quantity * line.unit_price_ore;
    }
    const reported =
      draftId == null
        ? undefined
        : invoiceRows.find((line) => line.draftId === draftId && line.dnbTotalOre != null);
    const goodsOre = claims.finalClaimOre + extra;
    const offsets = advance.data?.offsets ?? [];
    const own = draftId ? offsets.find((offset) => offset.invoice_draft_id === draftId) : undefined;
    const view = settlementView({
      percent: Number(row?.advance_percent ?? 0),
      basisOre: row?.advance_basis_ore ?? 0,
      agreedOre: row?.advance_agreed_ore ?? 0,
      claimedOre: claim?.amount_ore ?? null,
      paymentChecked: Boolean(claim?.payments_checked_at),
      payments: advance.data?.payments ?? [],
      dnbReceivedOre: claim?.dnb_received_ore ?? null,
      dnbRestOre: claim?.dnb_rest_ore ?? null,
      finalClaimOre: reported?.dnbTotalOre ?? (goodsOre > 0 ? goodsOre : null),
      alreadyPlannedOre: offsets
        .filter((offset) => offset.invoice_draft_id !== draftId)
        .reduce((sum, offset) => sum + offset.amount_ore, 0),
      storedSurplusOre: claim?.surplus_ore ?? null,
      confirmedOre: own?.confirmed_ore ?? null,
      previouslyInvoicedOre: claims.previouslyInvoicedOre,
      vatOre: reported?.dnbVatOre ?? null,
      totalOre: reported?.dnbTotalOre ?? null,
      remainingOre: reported?.dnbRestOre ?? null,
    });
    if (!own) return view;
    return { ...view, plannedOre: own.amount_ore };
  }

  async function recordOffset(draftId: string, finalIds: readonly string[]) {
    if (!row) return;
    const plan = offsetPlan(finalIds, draftId);
    if (!plan.paymentChecked || plan.receivedOre == null) {
      toast.error(t("orders_payment_unchecked"));
      return;
    }
    if (plan.plannedOre == null || plan.surplusOre == null) return;
    if (plan.plannedOre <= 0 && plan.surplusOre <= 0) return;
    const { error } = await supabase.rpc("record_advance_offset", {
      p_order_id: row.id,
      p_invoice_draft_id: draftId,
      p_ceiling_ore: plan.plannedOre,
      p_surplus_ore: plan.surplusOre,
    });
    if (error) {
      toast.error(isOrderSchemaError(error.message) ? t("orders_pending_sql") : error.message);
    }
  }

  async function setStatus(
    status: "pending_confirmation" | "confirmed" | "cancelled" | "changes_requested",
  ) {
    if (!row || !registrar) return;
    if (status === "confirmed" && !approver) return;
    if (status === "changes_requested" && !approver) return;
    setBusy(true);
    const userId = session.data?.session?.user.id ?? null;
    const patch =
      status === "confirmed"
        ? {
            status,
            confirmed_delivery_on: agreedOn || row.confirmed_delivery_on || row.desired_delivery_on,
            owner_id: ownerId || row.owner_id || userId,
          }
        : status === "changes_requested"
          ? { status, return_note: returnNote.trim() }
          : { status };
    const { error } = await supabase.from("customer_orders").update(patch).eq("id", row.id);
    setBusy(false);
    if (error) {
      toast.error(explainStatusError(error.message));
      return;
    }
    toast.success(
      status === "cancelled"
        ? t("orders_cancelled")
        : status === "confirmed"
          ? t("orders_confirmed")
          : status === "changes_requested"
            ? t("orders_returned")
            : t("orders_submitted"),
    );
    await refresh();
  }

  async function saveLines() {
    if (!row || !editable) return;
    setBusy(true);
    const catalog = products.data ?? [];
    for (const product of catalog) {
      const quantity = Number.parseInt(lineQty[product.id] ?? "", 10);
      const existing = orderLines.find((line) => line.product_id === product.id);
      const next = Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
      if (!existing && next > 0) {
        const { error } = await supabase.from("customer_order_lines").insert({
          order_id: row.id,
          product_id: product.id,
          quantity: next,
        });
        if (error) {
          setBusy(false);
          toast.error(error.message);
          return;
        }
      } else if (existing && next > 0 && existing.quantity !== next) {
        const { error } = await supabase
          .from("customer_order_lines")
          .update({ quantity: next })
          .eq("id", existing.id);
        if (error) {
          setBusy(false);
          toast.error(error.message);
          return;
        }
      } else if (existing && next <= 0) {
        const { error } = await supabase
          .from("customer_order_lines")
          .delete()
          .eq("id", existing.id);
        if (error) {
          setBusy(false);
          toast.error(error.message);
          return;
        }
      }
    }
    setBusy(false);
    toast.success(t("orders_saved"));
    await refresh();
  }

  async function saveFollowUp() {
    if (!row || !registrar) return;
    setBusy(true);
    const { error } = await supabase
      .from("customer_orders")
      .update({
        owner_id: ownerId || row.owner_id,
        follow_up_on: followUpOn || null,
        follow_up_note: followUpNote.trim() || null,
      })
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error, t("orders_save_failed")));
      return;
    }
    toast.success(t("orders_saved"));
    await refresh();
  }

  async function saveProblem() {
    if (!row || !registrar) return;
    setBusy(true);
    const { error } = await supabase
      .from("customer_orders")
      .update({ deviation_note: deviation.trim() || null })
      .eq("id", row.id);
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error, t("orders_save_failed")));
      return;
    }
    toast.success(deviation.trim() ? t("orders_problem_saved") : t("orders_saved"));
    await refresh();
  }

  function explainStatusError(message: string) {
    if (message.includes("missing price")) return t("orders_price_missing");
    if (message.includes("return note")) return t("orders_return_hint");
    if (message.includes("only a production lead")) return t("orders_forbidden");
    if (message.includes("already approved")) return t("orders_already");
    if (message.includes("confirmed delivery date")) return t("orders_confirmed_date");
    if (isOrderSchemaError(message)) return t("orders_pending_sql");
    return t("orders_save_failed");
  }

  function explainDeliveryError(message: string) {
    const kind = deliveryErrorKind(message);
    if (kind === "schema") return t("orders_pending_sql");
    if (kind === "stock") return t("orders_stock_short");
    if (kind === "lot") return t("delivery_lot_required");
    if (kind === "site") return t("orders_site_mismatch");
    if (kind === "driver") return t("orders_driver_required");
    if (kind === "quantity") return t("orders_remaining");
    return message || t("orders_save_failed");
  }

  async function saveDelivery() {
    if (savingDelivery.current || !row || row.status !== "confirmed" || !operations) return;
    savingDelivery.current = true;
    setBusy(true);
    try {
      const drafts = orderLines
        .map((line) => ({
          productId: line.product_id,
          quantity: Number.parseInt(deliverQty[line.product_id] ?? "", 10) || 0,
          goldLotId: deliverLot[line.product_id] ?? "",
          sourceHandoverId: deliverHandover[line.product_id] ?? "",
        }))
        .filter((line) => line.quantity > 0);
      if (drafts.length === 0 || !deliverOn) {
        toast.error(t("delivery_missing"));
        return;
      }
      if (!deliveredBy) {
        toast.error(t("orders_driver_required"));
        return;
      }
      const reserved = assignStockSource(stockLots, drafts, effectiveSource);
      const withLots = drafts.map((line) => {
        const picked = reserved.find((item) => item.productId === line.productId);
        return {
          product_id: line.productId,
          quantity: line.quantity,
          gold_lot_id: line.goldLotId || picked?.goldLotId || "",
          source_handover_id:
            effectiveSource === "villa"
              ? line.sourceHandoverId || picked?.sourceHandoverId || ""
              : "",
        };
      });
      const stockLines = withLots.map((line) => ({
        productId: line.product_id,
        quantity: line.quantity,
        goldLotId: line.gold_lot_id,
        sourceHandoverId: line.source_handover_id,
      }));
      const stockCheck =
        effectiveSource === "villa"
          ? validateVillaStock(stockLines, stockLots)
          : validateDeliveryStock(stockLines, stockLots);
      if (!stockCheck.ok) {
        toast.error(
          stockCheck.reason === "insufficient"
            ? t("orders_stock_short")
            : t("delivery_lot_required"),
        );
        return;
      }
      for (const line of withLots) {
        const orderLine = orderLines.find((item) => item.product_id === line.product_id);
        if (!orderLine) {
          toast.error(t("orders_save_failed"));
          return;
        }
        const done = linked
          .filter((item) => item.order_line_id === orderLine.id)
          .reduce((sum, item) => sum + item.quantity, 0);
        if (done + line.quantity > orderLine.quantity) {
          toast.error(t("orders_remaining"));
          return;
        }
      }
      if (!deliveryKey.current) deliveryKey.current = crypto.randomUUID();
      const saved = await supabase.rpc("register_order_delivery", {
        p_order_id: row.id,
        p_delivered_on: deliverOn,
        p_idempotency_key: deliveryKey.current,
        p_lines: withLots,
        p_delivered_by: deliveredBy,
      });
      if (saved.error || !saved.data) {
        toast.error(explainDeliveryError(saved.error?.message ?? ""));
        return;
      }
      deliveryKey.current = null;
      suggestedOnce.current = false;
      setDelivering(false);
      setDeliverQty({});
      setDeliverLot({});
      setDeliverHandover({});
      setDeliveredBy("");
      driverSuggested.current = false;
      toast.success(t("orders_delivery_saved"));
      await refresh();
    } finally {
      savingDelivery.current = false;
      setBusy(false);
    }
  }

  async function linkExisting(candidate: LinkCandidate) {
    if (!row || !commercial || !linkConfirmed) return;
    const quantity = Number.parseInt(linkQty, 10);
    const orderLine = orderLines.find((line) => line.product_id === candidate.productId);
    if (!orderLine || !Number.isInteger(quantity)) {
      toast.error(t("orders_link_qty"));
      return;
    }
    const done = linked
      .filter((item) => item.order_line_id === orderLine.id)
      .reduce((sum, item) => sum + item.quantity, 0);
    const block = fulfillmentBlock({
      orderStatus: row.status,
      ordered: orderLine.quantity,
      alreadyFulfilled: done,
      delivered: candidate.deliveredQty,
      alreadyOnDelivery: candidate.deliveredQty - candidate.freeQty,
      legacyInvoiced: 0,
      quantity,
      sameProduct: true,
      sameSite: true,
    });
    if (block || quantity > candidate.freeQty) {
      toast.error(
        block?.includes("does not match") ? t("orders_site_mismatch") : t("orders_remaining"),
      );
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("order_line_fulfillments").insert({
      order_line_id: orderLine.id,
      delivery_line_id: candidate.deliveryLineId,
      quantity,
    });
    setBusy(false);
    if (error) {
      toast.error(explainDeliveryError(error.message));
      return;
    }
    setLinkLineId("");
    setLinkQty("");
    setLinkConfirmed(false);
    toast.success(t("orders_link_saved"));
    await refresh();
  }

  async function saveDriver(deliveryId: string, personId: string) {
    if (!operations || !personId) return;
    setBusy(true);
    const { error } = await supabase
      .from("deliveries")
      .update({ delivered_by: personId })
      .eq("id", deliveryId);
    setBusy(false);
    if (error) {
      toast.error(
        isDeliveryDriverSchemaError(error.message) ? t("delivered_by_pending_sql") : error.message,
      );
      return;
    }
    toast.success(t("delivery_updated"));
    await refresh();
  }

  async function prepareInvoice(settle: boolean) {
    if (!row || !commercial) return;
    const action = orderInvoiceSteps({
      remaining: remainingQuantity(orderedQty, fulfilledQty),
      fulfillmentIds: linked.map((item) => item.id),
      lines: invoiceLines.data?.rows ?? [],
    }).action;
    if (!action || (action.kind !== "prepare" && action.kind !== "append")) return;
    if (!row.billing_legal_entity_id) {
      toast.error(t("orders_invoice_no_recipient"));
      return;
    }
    setBusy(true);
    const fresh = await supabase.rpc("order_invoice_lines", { p_order_id: row.id });
    if (fresh.error) {
      setBusy(false);
      toast.error(
        isOrderSchemaError(fresh.error.message) ? t("orders_pending_sql") : fresh.error.message,
      );
      return;
    }
    const again = orderInvoiceSteps({
      remaining: remainingQuantity(orderedQty, fulfilledQty),
      fulfillmentIds: linked.map((item) => item.id),
      lines: toInvoiceLines(fresh.data ?? []),
    });
    if (!again.action || (again.action.kind !== "prepare" && again.action.kind !== "append")) {
      setBusy(false);
      await refresh();
      return;
    }
    let draftId = again.action.kind === "append" ? again.action.draftId : "";
    let createdNow = false;
    if (!draftId) {
      const created = await supabase
        .from("invoice_drafts")
        .insert({ legal_entity_id: row.billing_legal_entity_id })
        .select("id")
        .single();
      if (created.error || !created.data) {
        setBusy(false);
        toast.error(created.error?.message ?? t("invoice_failed"));
        return;
      }
      draftId = created.data.id;
      createdNow = true;
    }
    const rows = again.action.fulfillmentIds.flatMap((id) => {
      const link = linked.find((item) => item.id === id);
      if (!link) return [];
      return [
        {
          invoice_draft_id: draftId,
          delivery_line_id: link.delivery_line_id,
          order_line_fulfillment_id: id,
        },
      ];
    });
    if (rows.length === 0) {
      if (createdNow) await supabase.from("invoice_drafts").delete().eq("id", draftId);
      setBusy(false);
      toast.error(t("invoice_failed"));
      return;
    }
    const inserted = await supabase.from("invoice_draft_lines").insert(rows);
    if (inserted.error) {
      if (createdNow) await supabase.from("invoice_drafts").delete().eq("id", draftId);
      setBusy(false);
      toast.error(inserted.error.message);
      return;
    }
    if (settle && advance.data?.claim) await recordOffset(draftId, again.action.fulfillmentIds);
    setBusy(false);
    toast.success(t("invoice_draft_created"));
    await refresh();
  }

  async function transferDraft(draftId: string) {
    if (!commercial) return;
    setBusy(true);
    if (remainingQuantity(orderedQty, fulfilledQty) === 0 && advance.data?.claim) {
      const ids = (invoiceLines.data?.rows ?? [])
        .filter((line) => line.draftId === draftId && line.active)
        .map((line) => line.fulfillmentId);
      await recordOffset(draftId, ids);
    }
    try {
      const result = await transferFn({ data: { draftId } });
      if (!result.ok) toast.error(result.message ?? t("invoice_failed"));
      else toast.success(t("dnb_transferred"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("invoice_failed"));
    }
    setBusy(false);
    await refresh();
  }

  async function prepareAdvance(percent: number) {
    if (!row || !commercial) return;
    const basis = orderBasisOre(
      orderLines.map((line) => ({ quantity: line.quantity, unitPriceOre: line.unit_price_ore })),
    );
    if (basis == null) {
      toast.error(t("orders_price_missing"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("prepare_order_advance", {
      p_order_id: row.id,
      p_percent: percent,
      p_basis_ore: basis,
    });
    setBusy(false);
    if (error) {
      toast.error(isOrderSchemaError(error.message) ? t("orders_pending_sql") : error.message);
      return;
    }
    toast.success(t("orders_advance_prepared"));
    await refresh();
  }

  async function attachAdvance(invoiceId: string, invoiceNumber: string) {
    if (!row || !commercial) return;
    setBusy(true);
    const { error } = await supabase.rpc("attach_advance_document", {
      p_order_id: row.id,
      p_accounting_invoice_id: invoiceId,
      p_accounting_invoice_number: invoiceNumber,
    });
    setBusy(false);
    if (error) {
      toast.error(isOrderSchemaError(error.message) ? t("orders_pending_sql") : error.message);
      return;
    }
    toast.success(t("orders_advance_attached"));
    await refresh();
  }

  const offsetAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (!commercial || !row) return;
    if (remainingQuantity(orderedQty, fulfilledQty) !== 0) return;
    if (!invoiceLines.isSuccess || invoiceLines.data.pendingSql || invoiceLines.data.error) return;
    if (!advance.data || advance.data.pendingSql || !advance.data.claim?.payments_checked_at)
      return;
    const action = orderInvoiceSteps({
      remaining: 0,
      fulfillmentIds: (fulfillments.data ?? []).map((item) => item.id),
      lines: invoiceLines.data.rows,
    }).action;
    const draftId = action && "draftId" in action ? action.draftId : settlementDraftId;
    if (!draftId) return;
    if (advance.data.offsets.some((offset) => offset.invoice_draft_id === draftId)) return;
    const ids =
      action && (action.kind === "prepare" || action.kind === "append")
        ? action.fulfillmentIds
        : invoiceLines.data.rows
            .filter((line) => line.draftId === draftId && line.active)
            .map((line) => line.fulfillmentId);
    const preview = offsetPlan(ids, draftId);
    if (preview.plannedOre == null || preview.surplusOre == null) return;
    if (preview.plannedOre <= 0 && preview.surplusOre <= 0) return;
    const key = `${row.id}:${draftId}`;
    if (offsetAttempt.current === key) return;
    offsetAttempt.current = key;
    void recordOffset(draftId, ids).then(async () => {
      await queryClient.invalidateQueries({ queryKey: ["order-advance", orderId] });
      await queryClient.invalidateQueries({ queryKey: ["order-advance-sync", orderId] });
    });
    // The plan helpers close over the query data listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    advance.data,
    commercial,
    fulfilledQty,
    fulfillments.data,
    invoiceLines.data,
    invoiceLines.isSuccess,
    orderId,
    orderedQty,
    queryClient,
    row,
    settlementDraftId,
  ]);

  if (!row) return <main className="min-h-screen" />;

  const orderer = one(row.ordered_by);
  const site = one(row.ship_to);
  const ordererName = orderer?.name ?? "—";
  const siteName = site?.name ?? "—";
  const party = orderPartyLabel({
    ordererName,
    shipToName: siteName,
    contactName: row.contact_name,
  });
  const waiting =
    row.status === "draft" ||
    row.status === "pending_confirmation" ||
    row.status === "changes_requested";
  const leftQty = remainingQuantity(orderedQty, fulfilledQty);
  const canDeliver = operations && row.status === "confirmed" && leftQty > 0;
  const today = osloToday();
  const agreedNotice = deliveryNotice({
    agreedOn: row.confirmed_delivery_on,
    today,
    remaining: leftQty,
  });
  const followNotice = followUpNotice({
    followUpOn: row.follow_up_on,
    followUpNote: row.follow_up_note,
    today,
  });
  const invoiceReady = Boolean(
    invoiceLines.data && !invoiceLines.data.pendingSql && !invoiceLines.data.error,
  );
  const invoicePlan =
    row.status === "confirmed" && invoiceReady
      ? orderInvoiceSteps({
          remaining: leftQty,
          fulfillmentIds: linked.map((item) => item.id),
          lines: invoiceLines.data?.rows ?? [],
        })
      : null;
  const lastDeliveredOn = latestDeliveryDay(linked);
  const catalog = products.data ?? [];
  const tableRows =
    editable && catalog.length > 0
      ? catalog.map((product) => {
          const line = orderLines.find((item) => item.product_id === product.id);
          return {
            key: product.id,
            productId: product.id,
            name: lang === "en" ? product.name_en : product.name_no,
            ordered: line?.quantity ?? 0,
            lineId: line?.id ?? null,
            price: line?.unit_price_ore ?? null,
          };
        })
      : orderLines.map((line) => {
          const product = one(line.products);
          return {
            key: line.id,
            productId: line.product_id,
            name:
              line.product_name_snapshot ||
              (lang === "en" ? product?.name_en : product?.name_no) ||
              "—",
            ordered: line.quantity,
            lineId: line.id,
            price: line.unit_price_ore,
          };
        });
  const claim = advance.data?.claim ?? null;
  const liveBasis = orderBasisOre(
    orderLines.map((line) => ({ quantity: line.quantity, unitPriceOre: line.unit_price_ore })),
  );
  const finalAction = invoicePlan?.action;
  const finalIds =
    finalAction && (finalAction.kind === "prepare" || finalAction.kind === "append")
      ? finalAction.fulfillmentIds
      : finalAction && (finalAction.kind === "transfer" || finalAction.kind === "open_dnb")
        ? (invoiceLines.data?.rows ?? [])
            .filter((line) => line.draftId === finalAction.draftId && line.active)
            .map((line) => line.fulfillmentId)
        : [];
  const finalDraftId =
    finalAction && "draftId" in finalAction ? finalAction.draftId : settlementDraftId;
  const settlement =
    claim &&
    row.advance_percent != null &&
    row.advance_basis_ore != null &&
    row.advance_agreed_ore != null
      ? offsetPlan(leftQty === 0 ? finalIds : [], leftQty === 0 ? finalDraftId : null)
      : null;
  const preparingGoods =
    invoicePlan?.action?.kind === "prepare" || invoicePlan?.action?.kind === "append";
  const settleNow = leftQty === 0 && claim != null && preparingGoods;
  const invoiceLabel = preparingGoods
    ? t(goodsInvoicePrepareLabel({ remaining: leftQty, hasAdvanceClaim: claim != null }))
    : null;
  const invoiceFailure =
    invoiceLines.data?.error === "unexpected"
      ? t("orders_invoice_unexpected")
      : (invoiceLines.data?.error ?? null);
  const advanceFailure = advance.data?.error ?? null;
  const settlementPending =
    Boolean(order.data?.pendingSql) ||
    Boolean(advance.data?.pendingSql) ||
    Boolean(invoiceLines.data?.pendingSql) ||
    advanceSync.data?.reason === "pending_sql";

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <p className="pt-8 text-sm text-muted-foreground">
        <Link to="/admin/orders" className="font-semibold">
          {t("orders_title")}
        </Link>
      </p>
      {order.data?.pendingSql ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("orders_pending_sql")}</p>
      ) : null}
      <h1 className="mt-2 text-3xl font-semibold">
        {ordererName} · {row.order_number}
      </h1>
      {party.contact ? (
        <p className="mt-2 text-sm">
          {t("orders_contact_line")}: {party.contact}
        </p>
      ) : null}
      {party.site ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t("orders_ship_to")}: {party.site}
        </p>
      ) : null}
      {row.desired_delivery_on ? (
        <p className="mt-3 text-sm">
          {t("orders_desired_date")}:{" "}
          <strong>{formatAgreedDelivery(row.desired_delivery_on, lang)}</strong>
        </p>
      ) : null}
      {row.confirmed_delivery_on ? (
        <p className="mt-1 text-sm">
          {t("orders_confirmed_date")}:{" "}
          <strong>{formatAgreedDelivery(row.confirmed_delivery_on, lang)}</strong>
        </p>
      ) : null}
      <p className="mt-1 text-sm">
        {t("orders_owner_title")}: <strong>{row.owner_name_snapshot ?? "—"}</strong>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t(PROGRESS_KEY[progress])}</p>
      {row.submitted_name_snapshot ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t("orders_submitted_by")}: {row.submitted_name_snapshot}
          {row.submitted_at ? ` · ${formatAgreedDelivery(row.submitted_at, lang)}` : ""}
        </p>
      ) : null}
      {row.approved_name_snapshot ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t("orders_approved_by")}: {row.approved_name_snapshot}
          {row.approved_at ? ` · ${formatAgreedDelivery(row.approved_at, lang)}` : ""}
        </p>
      ) : null}
      {row.status === "changes_requested" && row.return_note ? (
        <p className="surface-card mt-4 p-4 text-sm">{row.return_note}</p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold">{t("orders_goods")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{t("orders_product")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("orders_ordered_qty")}</th>
                <th className="py-2 pr-3 text-right font-medium">{t("orders_delivered_qty")}</th>
                <th className="py-2 text-right font-medium">{t("orders_remaining")}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((line) => {
                const done = line.lineId
                  ? linked
                      .filter((item) => item.order_line_id === line.lineId)
                      .reduce((sum, item) => sum + item.quantity, 0)
                  : 0;
                const ordered = editable
                  ? Number.parseInt(lineQty[line.productId] ?? "", 10) || line.ordered
                  : line.ordered;
                if (!editable && ordered <= 0) return null;
                return (
                  <tr key={line.key} className="border-t border-border">
                    <td className="py-3 pr-3 font-medium">{line.name}</td>
                    <td className="py-3 pr-3 text-right">
                      {editable ? (
                        <input
                          className={`${fieldClass} ml-auto max-w-28 text-right`}
                          inputMode="numeric"
                          aria-label={line.name}
                          value={
                            lineQty[line.productId] ?? (line.ordered ? String(line.ordered) : "")
                          }
                          onChange={(event) =>
                            setLineQty((current) => ({
                              ...current,
                              [line.productId]: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        line.ordered
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right">{done}</td>
                    <td className="py-3 text-right font-semibold">
                      {remainingQuantity(ordered, done)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {editable && registrar ? (
            <button
              type="button"
              className="mt-3 text-sm font-semibold"
              disabled={busy}
              onClick={() => void saveLines()}
            >
              {t("orders_save")}
            </button>
          ) : null}
        </div>
      </section>

      <DeliveryHistory
        rows={linked}
        showDeliveriesLink={operations}
        staff={operations ? (staff.data?.staff ?? []) : []}
        busy={busy}
        onSaveDriver={(deliveryId, personId) => void saveDriver(deliveryId, personId)}
      />

      {waiting && registrar ? (
        <section className="mt-8 space-y-4">
          {approver ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t("orders_confirmed_date")}
                type="date"
                value={agreedOn}
                onChange={setAgreedOn}
              />
              <label className="block">
                <span className="eyebrow mb-2 block">{t("orders_owner")}</span>
                <select
                  className={fieldClass}
                  value={ownerId}
                  onChange={(event) => setOwnerId(event.target.value)}
                >
                  <option value="" />
                  {(staff.data?.staff ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName || person.username}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {row.status !== "pending_confirmation" || approver ? (
            <PrimaryButton
              type="button"
              disabled={busy || (action === "submit" && row.status === "pending_confirmation")}
              onClick={() =>
                void setStatus(action === "approve" ? "confirmed" : "pending_confirmation")
              }
            >
              {action === "approve" ? t("orders_confirm") : t("orders_send_confirm")}
            </PrimaryButton>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("orders_status_pending_confirmation")}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t("orders_internal")}</p>
          {approver && row.status === "pending_confirmation" ? (
            <div className="space-y-3">
              <TextAreaField value={returnNote} onChange={setReturnNote} />
              <p className="text-sm text-muted-foreground">{t("orders_return_hint")}</p>
              <button
                type="button"
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
                disabled={busy || returnNote.trim().length === 0}
                onClick={() => void setStatus("changes_requested")}
              >
                {t("orders_return")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {progress === "delivered" ? (
        <section className="surface-card mt-8 p-5">
          <p className="text-lg font-semibold">✓ {t("orders_all_delivered")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {fulfilledQty} {t("orders_of")} {orderedQty} {t("pcs")}
            {lastDeliveredOn
              ? ` · ${t("orders_last_delivery")} ${formatAgreedDelivery(lastDeliveredOn, lang)}`
              : ""}
          </p>
        </section>
      ) : null}
      {agreedNotice ? (
        <p className="mt-4 text-sm font-semibold">
          {agreedNotice === "late"
            ? t("orders_notice_late")
            : agreedNotice === "today"
              ? t("orders_notice_today")
              : t("orders_notice_soon")}
          {" · "}
          {leftQty} {t("pcs")}
        </p>
      ) : null}
      {followNotice ? (
        <p className="mt-2 text-sm">
          <strong>{t("orders_follow_up")}</strong>
          {" · "}
          {formatAgreedDelivery(followNotice.on, lang)}
          {" · "}
          {followNotice.note}
        </p>
      ) : null}

      {canDeliver ? (
        <section className="mt-8 space-y-4">
          <h2 className="text-sm font-semibold">{t("orders_delivery_heading")}</h2>
          {delivering ? (
            <DeliveryForm
              siteName={siteName}
              deliverOn={deliverOn}
              onDeliverOn={setDeliverOn}
              lines={orderLines.map((line) => {
                const done = linked
                  .filter((item) => item.order_line_id === line.id)
                  .reduce((sum, item) => sum + item.quantity, 0);
                const product = one(line.products);
                return {
                  id: line.id,
                  productId: line.product_id,
                  name:
                    line.product_name_snapshot ||
                    (lang === "en" ? product?.name_en : product?.name_no) ||
                    "—",
                  left: remainingQuantity(line.quantity, done),
                };
              })}
              stockLots={stockLots}
              source={effectiveSource}
              showSource={showStockSource}
              onSource={(value) => {
                setStockSource(value);
                const drafts = orderLines.map((line) => ({
                  productId: line.product_id,
                  quantity: Number.parseInt(deliverQty[line.product_id] ?? "", 10) || 0,
                  goldLotId: "",
                  sourceHandoverId: "",
                }));
                const assigned = assignStockSource(stockLots, drafts, value);
                setDeliverLot((current) => {
                  const next = { ...current };
                  for (const line of assigned) next[line.productId] = line.goldLotId;
                  return next;
                });
                setDeliverHandover((current) => {
                  const next = { ...current };
                  for (const line of assigned) next[line.productId] = line.sourceHandoverId ?? "";
                  return next;
                });
              }}
              qty={deliverQty}
              lot={deliverLot}
              handover={deliverHandover}
              onQty={(productId, value) =>
                setDeliverQty((current) => ({ ...current, [productId]: value }))
              }
              onLot={(productId, value) =>
                setDeliverLot((current) => ({ ...current, [productId]: value }))
              }
              onHandover={(productId, lotId, handoverId) => {
                setDeliverLot((current) => ({ ...current, [productId]: lotId }));
                setDeliverHandover((current) => ({ ...current, [productId]: handoverId }));
              }}
              deliveredBy={deliveredBy}
              staff={staff.data?.staff ?? []}
              onDeliveredBy={setDeliveredBy}
              busy={busy}
              onSave={() => void saveDelivery()}
            />
          ) : (
            <PrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                setDeliverOn(osloToday());
                driverSuggested.current = false;
                setDeliveredBy("");
                if (!deliveryKey.current) deliveryKey.current = crypto.randomUUID();
                setDelivering(true);
              }}
            >
              {t("register_delivery")}
            </PrimaryButton>
          )}
        </section>
      ) : null}

      {(operations || commercial) && row.status === "confirmed" ? (
        <section className="mt-8 space-y-4">
          <h2 className="text-sm font-semibold">{t("orders_settlement")}</h2>
          {invoiceLines.isPending && !invoiceLines.data ? (
            <p className="text-sm text-muted-foreground">{t("orders_invoice_loading")}</p>
          ) : null}
          {invoiceFailure ? (
            <p className="text-sm font-semibold">
              {invoiceFailure === t("orders_invoice_unexpected")
                ? invoiceFailure
                : `${t("orders_invoice_fetch_failed")} ${invoiceFailure}`}
            </p>
          ) : null}
          {invoiceLines.data?.pendingSql ? (
            <p className="text-sm text-muted-foreground">{t("orders_pending_sql")}</p>
          ) : null}
          {invoicePlan ? (
            <>
              {invoicePlan.earlier.map((step) =>
                "draftId" in step ? <InvoiceFact key={step.draftId} step={step} /> : null,
              )}
              {invoicePlan.action ? (
                <InvoiceStepView
                  step={invoicePlan.action}
                  placement={invoicePlan.placement}
                  commercial={commercial}
                  busy={busy}
                  onPrepare={() => void prepareInvoice(settleNow)}
                  onTransfer={(draftId) => void transferDraft(draftId)}
                  {...(invoiceLabel ? { prepareLabel: invoiceLabel } : {})}
                  companyName={company.data?.name ?? null}
                />
              ) : null}
            </>
          ) : null}
          {invoiceReady && leftQty === 0 && linked.length > 0 && !invoicePlan?.action ? (
            <p className="text-sm font-semibold">{t("orders_invoice_unlinked")}</p>
          ) : null}
          {settlementPending && !invoiceLines.data?.pendingSql ? (
            <p className="text-sm text-muted-foreground">{t("orders_pending_sql")}</p>
          ) : null}
          {advanceFailure ? (
            <p className="text-sm font-semibold">
              {t("orders_advance_fetch_failed")} {advanceFailure}
            </p>
          ) : settlementPending || advance.isLoading ? null : (
            <>
              {!claim && commercial ? (
                <p className="text-sm text-muted-foreground">{t("orders_advance_optional")}</p>
              ) : null}
              <OrderSettlementPanel
                key={claim?.id ?? "new"}
                view={settlement}
                payments={advance.data?.payments ?? []}
                documentId={claim?.accounting_invoice_id ?? null}
                documentNumber={claim?.accounting_invoice_number ?? null}
                commercial={commercial}
                busy={busy}
                basisOre={liveBasis}
                companyName={company.data?.name ?? null}
                onPrepare={(percent) => void prepareAdvance(percent)}
                onAttach={(invoiceId, invoiceNumber) =>
                  void attachAdvance(invoiceId, invoiceNumber)
                }
              />
            </>
          )}
        </section>
      ) : row.status === "confirmed" && leftQty === 0 && !operations && !commercial ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("orders_invoice_owner")}</p>
      ) : null}

      {registrar ? (
        <section className="mt-8 space-y-4 rounded-2xl border border-border px-4 py-4">
          <h2 className="text-sm font-semibold">{t("orders_work")}</h2>
          {approver ? (
            <label className="block">
              <span className="eyebrow mb-2 block">{t("orders_owner")}</span>
              <select
                className={fieldClass}
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
              >
                <option value="" />
                {(staff.data?.staff ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName || person.username}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm">
              {t("orders_owner")}: {row.owner_name_snapshot ?? "—"}
            </p>
          )}
          <h3 className="text-sm font-semibold">{t("orders_follow_up")}</h3>
          <p className="text-sm text-muted-foreground">{t("orders_follow_up_hint")}</p>
          <TextField
            label={t("orders_follow_up")}
            type="date"
            value={followUpOn}
            onChange={setFollowUpOn}
          />
          <TextAreaField value={followUpNote} onChange={setFollowUpNote} />
          {row.notes ? <p className="text-sm text-muted-foreground">{row.notes}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
              disabled={busy}
              onClick={() => void saveFollowUp()}
            >
              {t("orders_save")}
            </button>
            {canCancelOrder(row.status, fulfilledQty) ? (
              <button
                type="button"
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
                disabled={busy}
                onClick={() => void setStatus("cancelled")}
              >
                {t("orders_cancel")}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {registrar ? (
        <section className="mt-4 space-y-3 rounded-2xl border border-border px-4 py-4">
          <h2 className="text-sm font-semibold">{t("orders_deviation")}</h2>
          <p className="text-sm text-muted-foreground">{t("orders_problem_hint")}</p>
          <TextAreaField value={deviation} onChange={setDeviation} />
          <button
            type="button"
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
            disabled={busy}
            onClick={() => void saveProblem()}
          >
            {t("orders_deviation")}
          </button>
        </section>
      ) : null}

      {commercial && row.status === "confirmed" ? (
        <details
          className="mt-4 rounded-2xl border border-border px-4 py-3"
          onToggle={(event) => setRepairOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm font-semibold">{t("orders_choices")}</summary>
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">{t("orders_correct")}</p>
            <div>
              <p className="text-sm font-semibold">{t("orders_link_admin")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("orders_link_help")}</p>
            </div>
            {repairs.isError ? (
              <p className="text-sm text-destructive">{t("orders_save_failed")}</p>
            ) : (
              <RepairList
                rows={repairs.isLoading ? [] : (repairs.data ?? [])}
                orderProductIds={new Set(orderLines.map((line) => line.product_id))}
                selectedId={linkLineId}
                quantity={linkQty}
                confirmed={linkConfirmed}
                busy={busy}
                onSelect={(id) => {
                  setLinkLineId(id);
                  setLinkQty("");
                  setLinkConfirmed(false);
                }}
                onQuantity={setLinkQty}
                onConfirmed={setLinkConfirmed}
                onSave={(candidate) => void linkExisting(candidate)}
              />
            )}
          </div>
        </details>
      ) : null}

      {commercial ? (
        <details className="mt-4 rounded-2xl border border-border px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">
            {t("orders_invoice_details")}
          </summary>
          <div className="mt-4 space-y-2 text-sm">
            <p className="text-muted-foreground">{t("orders_invoice_hint")}</p>
            {row.billing_legal_name_snapshot ? (
              <p>
                {t("orders_recipient")}: {row.billing_legal_name_snapshot}
                {row.billing_organization_number_snapshot
                  ? ` · ${row.billing_organization_number_snapshot}`
                  : ""}
              </p>
            ) : null}
            {orderLines.map((line) => {
              const product = one(line.products);
              const name =
                line.product_name_snapshot ||
                (lang === "en" ? product?.name_en : product?.name_no) ||
                "—";
              return (
                <p key={line.id}>
                  {name}
                  {line.unit_price_ore ? ` · ${formatPriceNok(line.unit_price_ore)} kr` : ""}
                </p>
              );
            })}
            {row.status === "confirmed" ? (
              <Link to="/admin/invoices" className="inline-block font-semibold">
                {t("invoices")}
              </Link>
            ) : null}
          </div>
        </details>
      ) : null}
    </main>
  );
}

type LinkCandidate = {
  deliveryLineId: string;
  deliveredOn: string;
  recipientName: string;
  productId: string;
  productName: string;
  lotCode: string;
  deliveredQty: number;
  freeQty: number;
};

type RepairDelivery = {
  id: string;
  delivered_at: string;
  customer_name_snapshot: string;
  delivery_lines:
    | {
        id: string;
        product_id: string;
        quantity: number;
        product_name_snapshot: string;
        gold_lots: { lot_code: string } | { lot_code: string }[] | null;
        order_line_fulfillments: { quantity: number }[] | null;
        invoice_draft_lines:
          { quantity: number; active: boolean; order_line_fulfillment_id: string | null }[] | null;
      }[]
    | null;
};

function toLinkCandidates(
  rows: RepairDelivery[],
  orderProductIds: ReadonlySet<string>,
): LinkCandidate[] {
  return rows.flatMap((delivery) =>
    (delivery.delivery_lines ?? []).flatMap((line) => {
      if (!orderProductIds.has(line.product_id)) return [];
      const linkedQty = (line.order_line_fulfillments ?? []).reduce(
        (sum, row) => sum + row.quantity,
        0,
      );
      const legacy = (line.invoice_draft_lines ?? [])
        .filter((row) => row.active && !row.order_line_fulfillment_id)
        .reduce((sum, row) => sum + row.quantity, 0);
      const freeQty = linkableQuantity(line.quantity, linkedQty, legacy);
      if (freeQty <= 0) return [];
      return [
        {
          deliveryLineId: line.id,
          deliveredOn: delivery.delivered_at,
          recipientName: delivery.customer_name_snapshot,
          productId: line.product_id,
          productName: line.product_name_snapshot,
          lotCode: one(line.gold_lots)?.lot_code ?? "—",
          deliveredQty: line.quantity,
          freeQty,
        },
      ];
    }),
  );
}

type HistoryDelivery = {
  id: string;
  delivered_at: string;
  note: string | null;
  delivered_by?: string | null;
  delivered_by_name?: string | null;
  registered_name_snapshot?: string | null;
};

function DeliveryHistory({
  rows,
  showDeliveriesLink,
  staff,
  busy,
  onSaveDriver,
}: {
  showDeliveriesLink: boolean;
  staff: readonly ProductionStaff[];
  busy: boolean;
  onSaveDriver: (deliveryId: string, personId: string) => void;
  rows: {
    id: string;
    quantity: number;
    delivery_lines:
      | {
          product_name_snapshot: string;
          gold_lots: { lot_code: string } | { lot_code: string }[] | null;
          deliveries: HistoryDelivery | HistoryDelivery[] | null;
        }
      | {
          product_name_snapshot: string;
          gold_lots: { lot_code: string } | { lot_code: string }[] | null;
          deliveries: HistoryDelivery | HistoryDelivery[] | null;
        }[]
      | null;
  }[];
}) {
  const { t, lang } = useI18n();
  const grouped = new Map<
    string,
    {
      deliveredAt: string;
      deliveredByName: string | null;
      registeredName: string | null;
      lines: { name: string; lot: string; quantity: number }[];
    }
  >();
  for (const row of rows) {
    const line = one(row.delivery_lines);
    const delivery = line ? one(line.deliveries) : null;
    if (!line || !delivery) continue;
    const current = grouped.get(delivery.id) ?? {
      deliveredAt: delivery.delivered_at,
      deliveredByName: delivery.delivered_by_name ?? null,
      registeredName: delivery.registered_name_snapshot ?? null,
      lines: [],
    };
    current.lines.push({
      name: line.product_name_snapshot,
      lot: one(line.gold_lots)?.lot_code ?? "—",
      quantity: row.quantity,
    });
    grouped.set(delivery.id, current);
  }
  const history = [...grouped.entries()];
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">{t("orders_history")}</h2>
      {history.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("orders_history_empty")}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {history.map(([id, delivery]) => (
            <article key={id} className="rounded-2xl border border-border px-4 py-3 text-sm">
              <p className="font-semibold">
                {t("orders_actual")}: {formatAgreedDelivery(delivery.deliveredAt, lang)}
              </p>
              {delivery.deliveredByName ? (
                <p className="mt-1">
                  {t("delivered_by")}: {delivery.deliveredByName}
                </p>
              ) : staff.length > 0 ? (
                <MissingDriver
                  staff={staff}
                  busy={busy}
                  onSave={(personId) => onSaveDriver(id, personId)}
                />
              ) : (
                <p className="mt-1 font-semibold">{t("orders_driver_fill")}</p>
              )}
              {delivery.registeredName ? (
                <p className="mt-1 text-muted-foreground">
                  {t("orders_registered_by")}: {delivery.registeredName}
                </p>
              ) : null}
              {delivery.lines.map((line) => (
                <p key={`${id}-${line.lot}-${line.name}`} className="mt-1 text-muted-foreground">
                  {line.name} · {line.lot} · {line.quantity} {t("pcs")}
                </p>
              ))}
              {showDeliveriesLink ? (
                <Link
                  to="/admin/deliveries"
                  search={{ lot: "" }}
                  className="mt-2 inline-block font-semibold"
                >
                  {t("deliveries")}
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MissingDriver({
  staff,
  busy,
  onSave,
}: {
  staff: readonly ProductionStaff[];
  busy: boolean;
  onSave: (personId: string) => void;
}) {
  const { t } = useI18n();
  const [person, setPerson] = useState("");
  return (
    <div className="mt-3 space-y-3">
      <DriverSelect
        label={t("delivered_by")}
        value={person}
        staff={staff}
        emptyLabel={t("orders_driver_fill")}
        onChange={setPerson}
      />
      <button
        type="button"
        className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
        disabled={busy || person.length === 0}
        onClick={() => onSave(person)}
      >
        {t("orders_save")}
      </button>
    </div>
  );
}

function latestDeliveryDay(
  rows: {
    delivery_lines:
      | { deliveries: { delivered_at: string } | { delivered_at: string }[] | null }
      | { deliveries: { delivered_at: string } | { delivered_at: string }[] | null }[]
      | null;
  }[],
): string | null {
  let last: string | null = null;
  for (const row of rows) {
    const line = one(row.delivery_lines);
    const delivery = line ? one(line.deliveries) : null;
    const day = delivery?.delivered_at.slice(0, 10);
    if (day && (!last || day > last)) last = day;
  }
  return last;
}

function isMissingOrderSetup(message: string): boolean {
  return (
    isOrderSchemaError(message) &&
    /does not exist|schema cache|Could not find the function|Could not find the table/i.test(
      message,
    )
  );
}

function toInvoiceLines(
  rows: {
    draft_id: string;
    draft_status: string;
    transfer_status: string;
    dnb_status: string | null;
    accounting_invoice_id: string | null;
    accounting_invoice_number: string | null;
    payment_due_on: string | null;
    dnb_paid_on: string | null;
    dnb_total_ore?: number | null;
    dnb_rest_ore?: number | null;
    dnb_vat_ore?: number | null;
    fulfillment_id: string | null;
    quantity: number;
    unit_price_ore: number;
    active: boolean;
  }[],
): OrderInvoiceLine[] {
  return rows.flatMap((row) => {
    if (!row.fulfillment_id) return [];
    return [
      {
        draftId: row.draft_id,
        status: row.draft_status,
        transferStatus: row.transfer_status,
        dnbStatus: row.dnb_status,
        accountingInvoiceId: row.accounting_invoice_id,
        invoiceNumber: row.accounting_invoice_number,
        dueOn: row.payment_due_on,
        paidOn: row.dnb_paid_on,
        dnbTotalOre: row.dnb_total_ore ?? null,
        dnbRestOre: row.dnb_rest_ore ?? null,
        dnbVatOre: row.dnb_vat_ore ?? null,
        fulfillmentId: row.fulfillment_id,
        quantity: row.quantity,
        unitPriceOre: row.unit_price_ore,
        active: row.active,
      },
    ];
  });
}

function DeliveryForm({
  siteName,
  deliverOn,
  onDeliverOn,
  deliveredBy,
  staff,
  onDeliveredBy,
  lines,
  stockLots,
  source,
  showSource,
  onSource,
  qty,
  lot,
  handover,
  onQty,
  onLot,
  onHandover,
  busy,
  onSave,
}: {
  siteName: string;
  deliverOn: string;
  onDeliverOn: (value: string) => void;
  deliveredBy: string;
  staff: readonly ProductionStaff[];
  onDeliveredBy: (value: string) => void;
  lines: { id: string; productId: string; name: string; left: number }[];
  stockLots: ReturnType<typeof toStockLots>;
  source: StockSource;
  showSource: boolean;
  onSource: (value: StockSource) => void;
  qty: Record<string, string>;
  lot: Record<string, string>;
  handover: Record<string, string>;
  onQty: (productId: string, value: string) => void;
  onLot: (productId: string, value: string) => void;
  onHandover: (productId: string, lotId: string, handoverId: string) => void;
  busy: boolean;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="surface-card space-y-4 p-5">
      <p className="text-sm">
        {t("orders_delivers_to")}: <strong>{siteName}</strong>
      </p>
      <DriverSelect
        label={t("delivered_by")}
        value={deliveredBy}
        staff={staff}
        emptyLabel={t("orders_driver_fill")}
        onChange={onDeliveredBy}
      />
      <TextField
        label={t("orders_delivery_date")}
        type="date"
        value={deliverOn}
        onChange={onDeliverOn}
      />
      {showSource ? (
        <div>
          <span className="eyebrow mb-2 block">{t("stock_source")}</span>
          <div className="flex gap-2">
            {(["gold", "villa"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onSource(value)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  source === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {value === "gold" ? t("stock_from_gold") : t("stock_from_villa")}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {lines.map((line) => {
        if (line.left <= 0) return null;
        const typed = Number.parseInt(qty[line.productId] ?? "", 10);
        const needed = Number.isInteger(typed) ? typed : 0;
        const available =
          source === "villa"
            ? villaOptions(stockLots, line.productId).reduce(
                (max, item) => Math.max(max, item.remaining),
                0,
              )
            : openLotsForProduct(stockLots, line.productId).reduce(
                (max, item) => Math.max(max, item.remaining),
                0,
              );
        const suggested = suggestedDeliveryQuantity(line.left, available);
        const short = needed > 0 && needed > available;
        const villaPick =
          source === "villa"
            ? suggestVillaHandover(
                stockLots,
                line.productId,
                needed,
                handover[line.productId] ?? "",
              )
            : null;
        const goldPick = suggestLotId(stockLots, line.productId, needed, lot[line.productId] ?? "");
        const chosenLot =
          source === "villa"
            ? (villaPick?.lotId ?? lot[line.productId] ?? "")
            : lot[line.productId] || goldPick;
        const options = openLotsForProduct(stockLots, line.productId);
        const villaChoices = villaOptions(stockLots, line.productId).filter(
          (item) => item.remaining > 0,
        );
        return (
          <div key={line.id} className="space-y-2">
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto_1fr]">
              <p className="font-medium">
                {line.name}
                <span className="mt-1 block text-sm font-normal text-muted-foreground">
                  {t("orders_remaining")} {line.left} {t("pcs")}
                  {suggested > 0 ? ` · ${t("orders_suggested")} ${suggested}` : ""}
                </span>
              </p>
              <input
                className={fieldClass}
                inputMode="numeric"
                aria-label={`${line.name} ${t("orders_deliver_qty")}`}
                value={qty[line.productId] ?? ""}
                onChange={(event) => onQty(line.productId, event.target.value)}
              />
              <span className="self-center text-sm text-muted-foreground">{t("pcs")}</span>
              {source === "villa" ? (
                <label className="block">
                  <span className="eyebrow mb-2 block">{t("orders_lot")}</span>
                  <select
                    className={fieldClass}
                    value={handover[line.productId] || villaPick?.handoverId || ""}
                    onChange={(event) => {
                      const picked = villaChoices.find((item) => item.id === event.target.value);
                      onHandover(line.productId, picked?.lotId ?? "", event.target.value);
                    }}
                  >
                    <option value="" />
                    {villaChoices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.lotCode} · {item.remaining}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block">
                  <span className="eyebrow mb-2 block">{t("orders_lot")}</span>
                  <select
                    className={fieldClass}
                    value={chosenLot}
                    onChange={(event) => onLot(line.productId, event.target.value)}
                  >
                    <option value="" />
                    {options.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.lotCode} · {item.remaining}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {short ? <p className="text-sm text-destructive">{t("orders_stock_short")}</p> : null}
          </div>
        );
      })}
      <PrimaryButton type="button" disabled={busy} onClick={onSave}>
        {t("orders_save_delivery")}
      </PrimaryButton>
    </div>
  );
}

function RepairList({
  rows,
  orderProductIds,
  selectedId,
  quantity,
  confirmed,
  busy,
  onSelect,
  onQuantity,
  onConfirmed,
  onSave,
}: {
  rows: RepairDelivery[];
  orderProductIds: ReadonlySet<string>;
  selectedId: string;
  quantity: string;
  confirmed: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onQuantity: (value: string) => void;
  onConfirmed: (value: boolean) => void;
  onSave: (candidate: LinkCandidate) => void;
}) {
  const { t, lang } = useI18n();
  const candidates = toLinkCandidates(rows, orderProductIds);
  const selected = candidates.find((row) => row.deliveryLineId === selectedId) ?? null;
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("orders_link_empty")}</p>;
  }
  return (
    <div className="space-y-3">
      {candidates.map((row) => (
        <label
          key={row.deliveryLineId}
          className="block rounded-2xl border border-border p-3 text-sm"
        >
          <span className="flex items-start gap-2">
            <input
              type="radio"
              name="repair-delivery"
              checked={selectedId === row.deliveryLineId}
              onChange={() => onSelect(row.deliveryLineId)}
            />
            <span>
              {formatAgreedDelivery(row.deliveredOn, lang)} · {row.recipientName}
              <span className="mt-1 block text-muted-foreground">
                {row.productName} · {row.lotCode} · {t("orders_delivered_qty")} {row.deliveredQty}{" "}
                {t("pcs")} · {t("orders_link_free")} {row.freeQty} {t("pcs")}
              </span>
            </span>
          </span>
        </label>
      ))}
      {selected ? (
        <div className="space-y-3">
          <TextField label={t("orders_link_qty")} value={quantity} onChange={onQuantity} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirmed(event.target.checked)}
            />
            {t("orders_link_confirm")}
          </label>
          <button
            type="button"
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
            disabled={busy || !confirmed || quantity.trim() === ""}
            onClick={() => onSave(selected)}
          >
            {t("orders_link")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
