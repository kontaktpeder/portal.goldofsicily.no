import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { PrimaryButton, TextField } from "@/components/field";
import { DeliveryFlavorBreakdown, DeliveryFlavorEditor } from "@/components/flavor-lines";
import {
  deliveryLinesPayload,
  initialDeliveryQtys,
  sumDeliveryQty,
  type CatalogProduct,
  type DeliveryFlavorQty,
  type StoredDeliveryLine,
} from "@/lib/flavors";

export const Route = createFileRoute("/_authenticated/admin/deliveries")({
  head: () => ({
    meta: [
      { title: "Deliveries — Gold of Sicily admin" },
      { name: "description", content: "Register and review arancini deliveries to partner venues." },
      { property: "og:title", content: "Deliveries — Gold of Sicily admin" },
      { property: "og:description", content: "Register and review deliveries to partner venues." },
    ],
  }),
  component: AdminDeliveries,
});

function AdminDeliveries() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [flavorQtys, setFlavorQtys] = useState<DeliveryFlavorQty[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("venues")
        .select("id, name")
        .eq("active", true)
        .order("name");
      return data ?? [];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name_no, name_en, slug")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as CatalogProduct[];
    },
  });

  useEffect(() => {
    if (!products) return;
    setFlavorQtys((current) => {
      if (current.length === 0) return initialDeliveryQtys(products);
      const byId = new Map(current.map((line) => [line.productId, line]));
      return products.map((product) => {
        const existing = byId.get(product.id);
        return {
          productId: product.id,
          nameNo: product.name_no,
          nameEn: product.name_en,
          quantity: existing?.quantity ?? 0,
        };
      });
    });
  }, [products]);

  const total = useMemo(() => sumDeliveryQty(flavorQtys), [flavorQtys]);

  const { data: deliveries } = useQuery({
    queryKey: ["admin-deliveries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deliveries")
        .select(
          "*, venues(name), delivery_lines(product_id, quantity, products(name_no, name_en))",
        )
        .order("delivered_at", { ascending: false })
        .limit(200);
      if (error) {
        const fallback = await supabase
          .from("deliveries")
          .select("*, venues(name)")
          .order("delivered_at", { ascending: false })
          .limit(200);
        return fallback.data ?? [];
      }
      return data ?? [];
    },
  });

  async function submit() {
    if (!customerId || total <= 0) {
      toast.error(t("delivery_missing"));
      return;
    }
    setBusy(true);
    const { data: created, error } = await supabase
      .from("deliveries")
      .insert({
        venue_id: customerId,
        quantity: total,
        delivered_at: date,
        note: note.trim() || null,
      })
      .select("id")
      .single();
    if (error || !created) {
      setBusy(false);
      toast.error(error?.message ?? t("create_customer_failed"));
      return;
    }
    const lines = deliveryLinesPayload(created.id, flavorQtys);
    if (lines.length > 0) {
      const { error: lineError } = await supabase.from("delivery_lines").insert(lines);
      if (lineError) {
        setBusy(false);
        toast.error(lineError.message);
        return;
      }
    }
    setBusy(false);
    toast.success(t("register_delivery"));
    setOpen(false);
    setNote("");
    setFlavorQtys(products ? initialDeliveryQtys(products) : []);
    await queryClient.invalidateQueries();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("deliveries")}</h1>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          {t("register_delivery")}
        </button>
      </div>

      {open ? (
        <div className="surface-card mt-5 space-y-4 p-5">
          <label className="block">
            <span className="eyebrow mb-2 block">{t("customer")}</span>
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
            >
              <option value="">—</option>
              {customers?.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="eyebrow mb-1 block">{t("delivery_qty_per_flavor")}</span>
            <p className="mb-3 text-sm text-muted-foreground">{t("delivery_qty_hint")}</p>
            {(products ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("delivery_no_products")}</p>
            ) : (
              <DeliveryFlavorEditor lines={flavorQtys} onChange={setFlavorQtys} />
            )}
            <p className="mt-4 text-lg font-semibold tabular-nums">
              {t("total")}: {total}{" "}
              <span className="text-xs font-normal text-muted-foreground">{t("pcs")}</span>
            </p>
          </div>
          <TextField label={t("date")} value={date} onChange={setDate} type="date" />
          <TextField label={t("note")} value={note} onChange={setNote} />
          <PrimaryButton onClick={submit} disabled={busy || total <= 0}>
            {busy ? "…" : t("save")}
          </PrimaryButton>
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        {(deliveries ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
        ) : (
          deliveries?.map((delivery) => (
            <article key={delivery.id} className="surface-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {(delivery.venues as { name: string } | null)?.name ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(delivery.delivered_at, lang)}
                    {delivery.note ? ` · ${delivery.note}` : ""}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular-nums">
                  {delivery.quantity} <span className="text-xs font-normal">{t("pcs")}</span>
                </p>
              </div>
              <DeliveryFlavorBreakdown
                lines={
                  ("delivery_lines" in delivery
                    ? (delivery.delivery_lines as StoredDeliveryLine[])
                    : null) ?? null
                }
              />
            </article>
          ))
        )}
      </div>
    </main>
  );
}
