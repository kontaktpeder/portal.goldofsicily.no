import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { daysSince } from "@/lib/sign-out";

export type CustomerRow = {
  id: string;
  name: string;
  location: string | null;
  city: string | null;
  active: boolean;
  partnerId: string | null;
  publicVisible: boolean;
  createdAt: string;
  lastReportAt: string | null;
  soldThisWeek: number;
  currentStock: number;
  nextRequirement: number | null;
  estimatedStock: number;
  prepIssue: boolean;
  needsReview: boolean;
  status: "green" | "orange" | "red";
};

export type FlavorWeekRow = {
  productId: string;
  nameNo: string;
  nameEn: string;
  sold: number;
};

export type PartnerOverview = {
  id: string;
  name: string;
  kind: "distributor" | "direct";
  active: boolean;
  venueCount: number;
  distributedThisMonth: number;
  venues: CustomerRow[];
};

export function startOfWeek() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - day);
  return monday.toISOString();
}

export function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

export function daysAgoIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const weekStart = startOfWeek();
      const monthStart = startOfMonth();
      const recentCutoff = daysAgoIso(30);
      const [customersRes, reportsRes, deliveriesRes, partnersRes, linesRes] = await Promise.all([
        supabase.from("venues").select("*").order("name"),
        supabase
          .from("shift_reports")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("deliveries")
          .select("*")
          .order("delivered_at", { ascending: false })
          .limit(1000),
        supabase.from("partners").select("*").order("name"),
        supabase
          .from("shift_report_lines")
          .select("sold, product_id, products(name_no, name_en), shift_reports(created_at)")
          .limit(3000),
      ]);

      if (customersRes.error) throw customersRes.error;
      if (partnersRes.error) throw partnersRes.error;

      const customers = customersRes.data ?? [];
      const reports = reportsRes.data ?? [];
      const deliveries = deliveriesRes.data ?? [];
      const partners = partnersRes.data ?? [];

      const rows: CustomerRow[] = customers.map((customer) => {
        const own = reports.filter((r) => r.venue_id === customer.id);
        const latest = own[0] ?? null;
        const soldThisWeek = own
          .filter((r) => r.created_at >= weekStart)
          .reduce((sum, r) => sum + (r.sold_this_shift ?? 0), 0);

        const deliveredSinceReport = latest
          ? deliveries
              .filter((d) => d.venue_id === customer.id && d.created_at > latest.created_at)
              .reduce((sum, d) => sum + d.quantity, 0)
          : deliveries
              .filter((d) => d.venue_id === customer.id)
              .reduce((sum, d) => sum + d.quantity, 0);

        const currentStock = latest?.remaining_stock ?? 0;
        const estimatedStock = currentStock + deliveredSinceReport;
        const age = daysSince(latest?.created_at ?? null);

        let status: CustomerRow["status"] = "green";
        if (!latest || age > 10) status = "red";
        else if (age > 6 || latest.preparation_issue || latest.needs_review || estimatedStock <= 20)
          status = "orange";

        return {
          id: customer.id,
          name: customer.name,
          location: customer.location,
          city: customer.city,
          active: customer.active,
          partnerId: customer.partner_id,
          publicVisible: customer.public_visible,
          createdAt: customer.created_at,
          lastReportAt: latest?.created_at ?? null,
          soldThisWeek,
          currentStock,
          nextRequirement: latest?.next_required_quantity ?? null,
          estimatedStock,
          prepIssue: Boolean(latest?.preparation_issue),
          needsReview: Boolean(latest?.needs_review),
          status: customer.active ? status : "orange",
        };
      });

      const active = rows.filter((row) => row.active);
      const partnerOverviews: PartnerOverview[] = partners.map((partner) => {
        const venues = rows.filter((row) => row.partnerId === partner.id);
        const venueIds = new Set(venues.map((venue) => venue.id));
        const distributedThisMonth = deliveries
          .filter(
            (delivery) => venueIds.has(delivery.venue_id) && delivery.delivered_at >= monthStart,
          )
          .reduce((sum, delivery) => sum + delivery.quantity, 0);
        return {
          id: partner.id,
          name: partner.name,
          kind: partner.kind,
          active: partner.active,
          venueCount: venues.filter((venue) => venue.active).length,
          distributedThisMonth,
          venues,
        };
      });
      const unassigned = rows.filter((row) => !row.partnerId);

      const flavorWeekMap = new Map<string, FlavorWeekRow>();
      for (const line of linesRes.data ?? []) {
        const report = line.shift_reports as { created_at: string } | null;
        if (!report || report.created_at < weekStart) continue;
        const product = line.products as { name_no: string; name_en: string } | null;
        const existing = flavorWeekMap.get(line.product_id);
        if (existing) {
          existing.sold += line.sold ?? 0;
        } else {
          flavorWeekMap.set(line.product_id, {
            productId: line.product_id,
            nameNo: product?.name_no ?? line.product_id,
            nameEn: product?.name_en ?? line.product_id,
            sold: line.sold ?? 0,
          });
        }
      }
      const flavorWeek = [...flavorWeekMap.values()].sort((a, b) => b.sold - a.sold);

      return {
        rows,
        partners: partnerOverviews,
        unassigned,
        flavorWeek,
        metrics: {
          soldThisWeek: active.reduce((sum, row) => sum + row.soldThisWeek, 0),
          currentStock: active.reduce((sum, row) => sum + row.estimatedStock, 0),
          requestedNext: active.reduce((sum, row) => sum + (row.nextRequirement ?? 0), 0),
          awaiting: active.filter((row) => row.status !== "green").length,
          activePartners: partners.filter((partner) => partner.active).length,
          activeVenues: active.length,
          qualityIssues: active.filter((row) => row.prepIssue || row.needsReview).length,
          newVenues: active.filter((row) => row.createdAt >= recentCutoff).length,
        },
      };
    },
  });
}

export function statusToken(status: CustomerRow["status"]) {
  if (status === "green") return "bg-success";
  if (status === "orange") return "bg-warning";
  return "bg-destructive";
}
