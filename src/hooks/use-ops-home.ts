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

type LotQueryRow = {
  id: string;
  product_id: string;
  produced_qty: number;
  status: string;
  gold_lot_handovers: { quantity: number; ownership_after_handover: "gold" | "villa" }[] | null;
  delivery_lines: { quantity: number }[] | null;
};

type ReportQueryRow = {
  venue_id: string;
  created_at: string;
  next_required_quantity: number | null;
  venues: { name: string } | { name: string }[] | null;
  shift_report_lines:
    | {
        product_id: string;
        next_required_quantity: number | null;
        products:
          { name_no: string; name_en: string } | { name_no: string; name_en: string }[] | null;
      }[]
    | null;
};

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
    const venue = asOne(row.venues);
    return {
      venueId: row.venue_id,
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
      const [productsRes, lotsRes, reportsRes] = await Promise.all([
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
            "venue_id, created_at, next_required_quantity, venues(name), shift_report_lines(product_id, next_required_quantity, products(name_no, name_en))",
          )
          .order("created_at", { ascending: false })
          .limit(200),
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

      return {
        stock,
        readyForHandover: handoverLots.length,
        nextNeed: buildNextNeed(reports, stock, lang),
        schemaMissing: Boolean(lotsRes.error && isGoldLotSchemaError(lotsRes.error)),
      };
    },
  });
}
