import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isGoldLotSchemaError } from "@/lib/lot-stock";
import {
  buildNextNeed,
  flavorStock,
  isUrgentDay,
  lotsReadyForHandover,
  type HomeDatedOrder,
  type HomeInvoiceDraft,
  type HomeLotRef,
  type OpsLot,
  type OpsProduct,
  type VenueNeedReport,
} from "@/lib/ops-home";
import {
  deliveryNotice,
  followUpNotice,
  isOrderSchemaError,
  osloToday,
  productionNeed,
  remainingQuantity,
} from "@/lib/orders";

type LotQueryRow = {
  id: string;
  lot_code: string;
  product_id: string;
  produced_qty: number;
  status: string;
  products: { name_no: string; name_en: string } | { name_no: string; name_en: string }[] | null;
  gold_lot_handovers: { quantity: number; ownership_after_handover: "gold" | "villa" }[] | null;
  delivery_lines: { quantity: number }[] | null;
};

type OrderQueryRow = {
  id: string;
  order_number: string;
  confirmed_delivery_on?: string | null;
  owner_id?: string | null;
  follow_up_on?: string | null;
  follow_up_note?: string | null;
  ordered_by: { name: string } | { name: string }[] | null;
  customer_order_lines?: {
    quantity: number;
    order_line_fulfillments: { quantity: number }[] | null;
  }[];
};

export type HomeViewer = {
  userId: string | null;
  lead: boolean;
  commercial: boolean;
};

type ReportQueryRow = {
  customer_id: string;
  created_at: string;
  next_required_quantity: number | null;
  customers: { name: string } | { name: string }[] | null;
  shift_report_lines:
    | {
        product_id: string;
        next_required_quantity: number | null;
        products:
          { name_no: string; name_en: string } | { name_no: string; name_en: string }[] | null;
      }[]
    | null;
};

function oneStatus(value: { status: string } | { status: string }[] | null): string | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.status ?? null) : value.status;
}

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toOpsLots(rows: LotQueryRow[]): OpsLot[] {
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    producedQty: row.produced_qty,
    status: row.status,
    deliveredQty: (row.delivery_lines ?? []).reduce((sum, line) => sum + line.quantity, 0),
    handovers: (row.gold_lot_handovers ?? []).map((handover) => ({
      quantity: handover.quantity,
      ownership: handover.ownership_after_handover,
    })),
  }));
}

function toNeedReports(rows: ReportQueryRow[]): VenueNeedReport[] {
  return rows.map((row) => {
    const venue = asOne(row.customers);
    return {
      venueId: row.customer_id,
      venueName: venue?.name ?? "—",
      createdAt: row.created_at,
      nextRequired: row.next_required_quantity,
      lines: (row.shift_report_lines ?? []).map((line) => {
        const product = asOne(line.products);
        return {
          productId: line.product_id,
          nameNo: product?.name_no ?? "",
          nameEn: product?.name_en ?? "",
          nextNeed: line.next_required_quantity ?? 0,
        };
      }),
    };
  });
}

function lotRef(row: LotQueryRow): HomeLotRef {
  const product = asOne(row.products);
  return {
    id: row.id,
    lotCode: row.lot_code,
    nameNo: product?.name_no ?? "",
    nameEn: product?.name_en ?? "",
  };
}

function orderRemaining(order: OrderQueryRow): number {
  const ordered = (order.customer_order_lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
  const fulfilled = (order.customer_order_lines ?? []).reduce(
    (sum, line) =>
      sum + (line.order_line_fulfillments ?? []).reduce((inner, item) => inner + item.quantity, 0),
    0,
  );
  return remainingQuantity(ordered, fulfilled);
}

function customerName(order: OrderQueryRow): string {
  return asOne(order.ordered_by)?.name ?? "—";
}

export function useOpsHome(lang: "no" | "en", viewer: HomeViewer, enabled = true) {
  return useQuery({
    queryKey: ["ops-home", lang, viewer.userId, viewer.lead, viewer.commercial],
    enabled,
    queryFn: async () => {
      const [
        productsRes,
        lotsRes,
        reportsRes,
        orderLinesRes,
        approvalRes,
        confirmedOrders,
        followOrders,
        invoiceDrafts,
      ] = await Promise.all([
        supabase
          .from("products")
          .select("id, name_no, name_en")
          .eq("active", true)
          .order("sort_order"),
        supabase
          .from("gold_lots")
          .select(
            "id, lot_code, product_id, produced_qty, status, products(name_no, name_en), gold_lot_handovers(quantity, ownership_after_handover), delivery_lines(quantity)",
          )
          .neq("status", "recalled")
          .limit(400),
        supabase
          .from("shift_reports")
          .select(
            "customer_id, created_at, next_required_quantity, customers(name), shift_report_lines(product_id, next_required_quantity, products(name_no, name_en))",
          )
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("customer_order_lines")
          .select(
            "product_id, quantity, order_line_fulfillments(quantity), customer_orders!inner(status)",
          ),
        supabase
          .from("customer_orders")
          .select(
            "id, order_number, ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(name)",
          )
          .eq("status", "pending_confirmation")
          .order("created_at", { ascending: true })
          .limit(20),
        loadConfirmedOrders(),
        loadFollowUps(),
        loadInvoiceDrafts(viewer.commercial),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (lotsRes.error && !isGoldLotSchemaError(lotsRes.error)) throw lotsRes.error;

      const products: OpsProduct[] = (productsRes.data ?? []).map((product) => ({
        id: product.id,
        nameNo: product.name_no,
        nameEn: product.name_en,
      }));
      const lotRows = lotsRes.error ? [] : ((lotsRes.data ?? []) as LotQueryRow[]);
      const lots = toOpsLots(lotRows);
      const lotRefs = new Map(lotRows.map((row) => [row.id, lotRef(row)]));
      const reports = reportsRes.error
        ? []
        : toNeedReports((reportsRes.data ?? []) as ReportQueryRow[]);
      const stock = flavorStock(products, lots);
      const handoverLots = lotsReadyForHandover(lots);
      const orderLines = orderLinesRes.error ? [] : (orderLinesRes.data ?? []);
      const production = productionNeed(
        orderLines.map((line) => ({
          productId: line.product_id,
          ordered: line.quantity,
          fulfilled: (line.order_line_fulfillments ?? []).reduce(
            (sum, row) => sum + row.quantity,
            0,
          ),
          confirmed: oneStatus(line.customer_orders) === "confirmed",
        })),
        stock,
      ).map((row) => {
        const product = products.find((item) => item.id === row.productId);
        return {
          ...row,
          nameNo: product?.nameNo ?? "",
          nameEn: product?.nameEn ?? "",
        };
      });

      const approval = approvalRes.error
        ? []
        : (approvalRes.data ?? []).map((order) => ({
            id: order.id,
            orderNumber: order.order_number,
            ordererName: asOne(order.ordered_by)?.name ?? "—",
          }));
      const today = osloToday();
      const openDeliveries: { id: string; orderNumber: string; customerName: string }[] = [];
      const dueDeliveries: HomeDatedOrder[] = [];
      for (const order of confirmedOrders) {
        const remaining = orderRemaining(order);
        if (remaining <= 0) continue;
        const name = customerName(order);
        openDeliveries.push({ id: order.id, orderNumber: order.order_number, customerName: name });
        const state = deliveryNotice({
          agreedOn: order.confirmed_delivery_on ?? null,
          today,
          remaining,
        });
        if (!isUrgentDay(state)) continue;
        dueDeliveries.push({
          id: order.id,
          orderNumber: order.order_number,
          customerName: name,
          state,
        });
      }
      const followUps: HomeDatedOrder[] = [];
      for (const order of followOrders) {
        const visible = viewer.lead || (viewer.userId != null && order.owner_id === viewer.userId);
        if (!visible) continue;
        const follow = followUpNotice({
          followUpOn: order.follow_up_on ?? null,
          followUpNote: order.follow_up_note ?? null,
          today,
        });
        if (!follow || !isUrgentDay(follow.state)) continue;
        followUps.push({
          id: order.id,
          orderNumber: order.order_number,
          customerName: customerName(order),
          state: follow.state,
          note: follow.note,
        });
      }

      return {
        stock,
        readyForHandover: handoverLots.length,
        lotsAtGold: handoverLots.flatMap((lot) => {
          const ref = lotRefs.get(lot.id);
          return ref ? [ref] : [];
        }),
        openDeliveries,
        dueDeliveries,
        followUps,
        invoiceDrafts,
        productionShortfall: production.reduce((sum, row) => sum + row.shortfall, 0),
        nextNeed: buildNextNeed(reports, stock, lang),
        production,
        approval,
        schemaMissing: Boolean(lotsRes.error && isGoldLotSchemaError(lotsRes.error)),
      };
    },
  });
}

const orderCustomer = "ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(name)";

async function loadConfirmedOrders(): Promise<OrderQueryRow[]> {
  const rich = await supabase
    .from("customer_orders")
    .select(
      `id, order_number, confirmed_delivery_on, owner_id, follow_up_on, follow_up_note, ${orderCustomer}, customer_order_lines(quantity, order_line_fulfillments(quantity))`,
    )
    .eq("status", "confirmed")
    .limit(80);
  if (!rich.error) return (rich.data ?? []) as OrderQueryRow[];
  if (!isOrderSchemaError(rich.error.message)) throw rich.error;
  const fallback = await supabase
    .from("customer_orders")
    .select(
      `id, order_number, ${orderCustomer}, customer_order_lines(quantity, order_line_fulfillments(quantity))`,
    )
    .eq("status", "confirmed")
    .limit(80);
  if (fallback.error) {
    if (isOrderSchemaError(fallback.error.message)) return [];
    throw fallback.error;
  }
  return (fallback.data ?? []) as OrderQueryRow[];
}

async function loadFollowUps(): Promise<OrderQueryRow[]> {
  const res = await supabase
    .from("customer_orders")
    .select(`id, order_number, owner_id, follow_up_on, follow_up_note, ${orderCustomer}`)
    .not("follow_up_on", "is", null)
    .neq("status", "cancelled")
    .neq("status", "draft")
    .limit(40);
  if (res.error) {
    if (isOrderSchemaError(res.error.message)) return [];
    throw res.error;
  }
  return (res.data ?? []) as OrderQueryRow[];
}

async function loadInvoiceDrafts(commercial: boolean): Promise<HomeInvoiceDraft[]> {
  if (!commercial) return [];
  const rich = await supabase
    .from("invoice_drafts")
    .select("id, legal_name_snapshot, transfer_status")
    .eq("status", "draft")
    .limit(30);
  if (rich.error) {
    if (!/transfer_status|invoice_drafts|permission|row-level/i.test(rich.error.message)) {
      throw rich.error;
    }
    const legacy = await supabase
      .from("invoice_drafts")
      .select("id, legal_name_snapshot")
      .eq("status", "draft")
      .limit(30);
    if (legacy.error) return [];
    return (legacy.data ?? []).map((row) => ({ id: row.id, name: row.legal_name_snapshot }));
  }
  return (rich.data ?? [])
    .filter((row) => row.transfer_status !== "transferred")
    .map((row) => ({ id: row.id, name: row.legal_name_snapshot }));
}
