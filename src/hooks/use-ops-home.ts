import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isGoldLotSchemaError } from "@/lib/lot-stock";
import {
  buildNextNeed,
  flavorStock,
  lotsReadyForHandover,
  type OpsLot,
  type OpsProduct,
  type VenueNeedReport,
} from "@/lib/ops-home";
import { productionNeed, remainingQuantity } from "@/lib/orders";

type LotQueryRow = {
  id: string;
  product_id: string;
  produced_qty: number;
  status: string;
  gold_lot_handovers: { quantity: number; ownership_after_handover: "gold" | "villa" }[] | null;
  delivery_lines: { quantity: number }[] | null;
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

export function useOpsHome(lang: "no" | "en") {
  return useQuery({
    queryKey: ["ops-home", lang],
    queryFn: async () => {
      const [productsRes, lotsRes, reportsRes, orderLinesRes, approvalRes, deliveryRes] =
        await Promise.all([
          supabase
            .from("products")
            .select("id, name_no, name_en")
            .eq("active", true)
            .order("sort_order"),
          supabase
            .from("gold_lots")
            .select(
              "id, product_id, produced_qty, status, gold_lot_handovers(quantity, ownership_after_handover), delivery_lines(quantity)",
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
          supabase
            .from("customer_orders")
            .select(
              "id, order_number, ordered_by:customers!customer_orders_ordered_by_customer_id_fkey(name), customer_order_lines(quantity, order_line_fulfillments(quantity))",
            )
            .eq("status", "confirmed")
            .limit(80),
        ]);

      if (productsRes.error) throw productsRes.error;
      if (lotsRes.error && !isGoldLotSchemaError(lotsRes.error)) throw lotsRes.error;

      const products: OpsProduct[] = (productsRes.data ?? []).map((product) => ({
        id: product.id,
        nameNo: product.name_no,
        nameEn: product.name_en,
      }));
      const lots = lotsRes.error ? [] : toOpsLots((lotsRes.data ?? []) as LotQueryRow[]);
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
      const openDeliveries = deliveryRes.error
        ? []
        : (deliveryRes.data ?? []).flatMap((order) => {
            const ordered = (order.customer_order_lines ?? []).reduce(
              (sum, line) => sum + line.quantity,
              0,
            );
            const fulfilled = (order.customer_order_lines ?? []).reduce(
              (sum, line) =>
                sum +
                (line.order_line_fulfillments ?? []).reduce(
                  (inner, item) => inner + item.quantity,
                  0,
                ),
              0,
            );
            return remainingQuantity(ordered, fulfilled) > 0
              ? [
                  {
                    id: order.id,
                    orderNumber: order.order_number,
                    customerName: asOne(order.ordered_by)?.name ?? "—",
                  },
                ]
              : [];
          });

      return {
        stock,
        readyForHandover: handoverLots.length,
        lotsAtGold: handoverLots.map((lot) => ({ id: lot.id })),
        openDeliveries,
        productionShortfall: production.reduce((sum, row) => sum + row.shortfall, 0),
        nextNeed: buildNextNeed(reports, stock, lang),
        production,
        approval,
        schemaMissing: Boolean(lotsRes.error && isGoldLotSchemaError(lotsRes.error)),
      };
    },
  });
}
