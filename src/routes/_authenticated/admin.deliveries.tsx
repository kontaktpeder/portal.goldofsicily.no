import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/sign-out";
import { PrimaryButton, TextField } from "@/components/field";

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
  const [quantity, setQuantity] = useState("400");
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

  const { data: deliveries } = useQuery({
    queryKey: ["admin-deliveries"],
    queryFn: async () => {
      const { data } = await supabase
        .from("deliveries")
        .select("*, venues(name)")
        .order("delivered_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  async function submit() {
    const qty = Number.parseInt(quantity, 10);
    if (!customerId || !Number.isFinite(qty) || qty <= 0) {
      toast.error("Choose a venue and a valid quantity.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("deliveries").insert({
      venue_id: customerId,
      quantity: qty,
      delivered_at: date,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("register_delivery"));
    setOpen(false);
    setNote("");
    await queryClient.invalidateQueries();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("deliveries")}</h1>
        <button
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
          <TextField label={t("quantity")} value={quantity} onChange={setQuantity} />
          <TextField label={t("date")} value={date} onChange={setDate} type="date" />
          <TextField label={t("note")} value={note} onChange={setNote} />
          <PrimaryButton onClick={submit} disabled={busy}>
            {busy ? "…" : t("save")}
          </PrimaryButton>
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        {(deliveries ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
        ) : (
          deliveries?.map((delivery) => (
            <article
              key={delivery.id}
              className="surface-card flex items-center justify-between p-4"
            >
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
            </article>
          ))
        )}
      </div>
    </main>
  );
}
