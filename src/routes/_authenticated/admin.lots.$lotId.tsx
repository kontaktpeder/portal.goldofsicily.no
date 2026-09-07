import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { nowOsloDateTimeLocal, remainingAtGold, sumQuantities } from "@/lib/gold-lot";
import { formatDate } from "@/lib/sign-out";
import { errorMessage } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/lots/$lotId")({
  head: () => ({
    meta: [{ title: "Gold-LOT — Gold of Sicily admin" }],
  }),
  component: AdminLotDetail,
});

type Supplier = { id: string; name: string };
type Partner = { id: string; name: string };
type Venue = { id: string; name: string };

type LotDetail = {
  id: string;
  lot_code: string;
  production_date: string;
  produced_qty: number;
  carton_count: number;
  produced_by: string | null;
  status: "produced" | "handed_over" | "closed" | "recalled";
  deviation_notes: string | null;
  products: { name_no: string; name_en: string } | null;
  gold_lot_ingredients:
    | {
        id: string;
        ingredient_name: string;
        supplier_lot_code: string | null;
        quantity: number | null;
        quantity_unit: string;
        best_before: string | null;
        ingredient_suppliers: { name: string } | null;
      }[]
    | null;
  gold_lot_handovers:
    | {
        id: string;
        quantity: number;
        cartons: number;
        handed_over_at: string;
        recipient_company: string;
        recipient_person: string | null;
        storage_location: string | null;
        ownership_after_handover: "gold" | "villa";
      }[]
    | null;
};

const STATUS_KEYS: Record<LotDetail["status"], TranslationKey> = {
  produced: "lot_status_produced",
  handed_over: "lot_status_handed_over",
  closed: "lot_status_closed",
  recalled: "lot_status_recalled",
};

function AdminLotDetail() {
  const { lotId } = Route.useParams();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();

  const { data: lot, error } = useQuery({
    queryKey: ["gold-lot", lotId],
    queryFn: async () => {
      const { data, error: loadError } = await supabase
        .from("gold_lots")
        .select(
          "*, products(name_no, name_en), gold_lot_ingredients(*, ingredient_suppliers(name)), gold_lot_handovers(*)",
        )
        .eq("id", lotId)
        .single();
      if (loadError) throw loadError;
      return data as LotDetail;
    },
  });

  const { data: deliveries } = useQuery({
    queryKey: ["gold-lot-deliveries", lotId],
    queryFn: async () => {
      const { data, error: loadError } = await supabase
        .from("delivery_lines")
        .select("quantity, deliveries(delivered_at, venues(name))")
        .eq("gold_lot_id", lotId);
      if (loadError) throw loadError;
      return data ?? [];
    },
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["gold-lot", lotId] });
    await queryClient.invalidateQueries({ queryKey: ["gold-lots"] });
    await queryClient.invalidateQueries({ queryKey: ["gold-lot-deliveries", lotId] });
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </main>
    );
  }
  if (!lot) {
    return <main className="mx-auto w-full max-w-5xl px-5 py-10" />;
  }

  const handed = sumQuantities((lot.gold_lot_handovers ?? []).map((row) => row.quantity));
  const remaining = remainingAtGold(lot.produced_qty, handed);
  const productName = lang === "en" ? (lot.products?.name_en ?? "") : (lot.products?.name_no ?? "");

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <p className="pt-6 text-sm">
        <Link to="/admin/lots" className="font-semibold text-muted-foreground">
          ← {t("lots_title")}
        </Link>
      </p>
      <h1 className="mt-3 font-mono text-3xl font-semibold">{lot.lot_code}</h1>
      <p className="mt-1 text-lg">{productName}</p>
      <p className="text-sm text-muted-foreground">
        {t("production_date")}: {formatDate(lot.production_date, lang)}
        {lot.produced_by ? ` · ${lot.produced_by}` : ""}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={t("produced_qty")} value={`${lot.produced_qty} ${t("pcs")}`} />
        <Metric label={t("carton_count")} value={String(lot.carton_count)} />
        <Metric label={t("remaining_gold")} value={`${remaining} ${t("pcs")}`} />
        <Metric label={t("lot_status")} value={t(STATUS_KEYS[lot.status])} />
      </div>

      <LotMetaForm lot={lot} onSaved={refresh} />

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">{t("ingredients")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("ingredients_hint")}</p>
        {(lot.gold_lot_ingredients ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("no_ingredients")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {(lot.gold_lot_ingredients ?? []).map((row) => (
              <li key={row.id} className="surface-card p-4">
                <p className="font-semibold">{row.ingredient_name}</p>
                <p className="text-sm text-muted-foreground">
                  {row.ingredient_suppliers?.name ?? "—"}
                  {row.supplier_lot_code ? ` · LOT ${row.supplier_lot_code}` : ""}
                  {row.quantity != null
                    ? ` · ${row.quantity} ${row.quantity_unit}`
                    : ""}
                  {row.best_before ? ` · ${t("best_before")} ${formatDate(row.best_before, lang)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <IngredientForm lotId={lot.id} onSaved={refresh} />
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">{t("handovers")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("handovers_hint")}</p>
        {(lot.gold_lot_handovers ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("no_handovers")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {(lot.gold_lot_handovers ?? []).map((row) => (
              <li key={row.id} className="surface-card p-4">
                <p className="font-semibold">
                  {row.quantity} {t("pcs")} → {row.recipient_company}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatDate(row.handed_over_at, lang)}
                  {row.recipient_person ? ` · ${t("recipient_person")}: ${row.recipient_person}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {row.storage_location ? `${t("storage_location")}: ${row.storage_location} · ` : ""}
                  {row.ownership_after_handover === "villa" ? t("ownership_villa") : t("ownership_gold")}
                </p>
              </li>
            ))}
          </ul>
        )}
        <HandoverForm lotId={lot.id} remaining={remaining} onSaved={refresh} />
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">{t("venue_deliveries")}</h2>
        {(deliveries ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("no_venue_deliveries")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {deliveries?.map((row, index) => {
              const delivery = row.deliveries as
                | { delivered_at: string; venues: { name: string } | null }
                | { delivered_at: string; venues: { name: string } | null }[]
                | null;
              const record = Array.isArray(delivery) ? delivery[0] : delivery;
              return (
                <li key={`${row.quantity}-${index}`} className="surface-card p-4">
                  <p className="font-semibold">
                    {row.quantity} {t("pcs")} → {record?.venues?.name ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(record?.delivered_at, lang)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function LotMetaForm({ lot, onSaved }: { lot: LotDetail; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [producedBy, setProducedBy] = useState(lot.produced_by ?? "");
  const [status, setStatus] = useState(lot.status);
  const [notes, setNotes] = useState(lot.deviation_notes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("gold_lots")
      .update({
        produced_by: producedBy.trim() || null,
        status,
        deviation_notes: notes.trim() || null,
      })
      .eq("id", lot.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("save"));
    await onSaved();
  }

  return (
    <div className="surface-card mt-6 space-y-4 p-5">
      <TextField label={t("produced_by")} value={producedBy} onChange={setProducedBy} />
      <label className="block">
        <span className="eyebrow mb-2 block">{t("lot_status")}</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as LotDetail["status"])}
          className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
        >
          <option value="produced">{t("lot_status_produced")}</option>
          <option value="handed_over">{t("lot_status_handed_over")}</option>
          <option value="closed">{t("lot_status_closed")}</option>
          <option value="recalled">{t("lot_status_recalled")}</option>
        </select>
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("deviation_notes")}</span>
        <TextAreaField value={notes} onChange={setNotes} placeholder={t("none")} />
      </label>
      <PrimaryButton onClick={save} disabled={busy}>
        {busy ? "…" : t("save")}
      </PrimaryButton>
    </div>
  );
}

function IngredientForm({ lotId, onSaved }: { lotId: string; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [supplierLot, setSupplierLot] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("kg");
  const [bestBefore, setBestBefore] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: suppliers } = useQuery({
    queryKey: ["ingredient-suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredient_suppliers")
        .select("id, name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });

  async function submit() {
    if (!name.trim()) {
      toast.error(t("ingredient_name"));
      return;
    }
    setBusy(true);
    let resolvedSupplier = supplierId;
    if (!resolvedSupplier && newSupplier.trim()) {
      const { data: created, error } = await supabase
        .from("ingredient_suppliers")
        .insert({ name: newSupplier.trim(), active: true })
        .select("id")
        .single();
      if (error || !created) {
        setBusy(false);
        toast.error(errorMessage(error, t("create_customer_failed")));
        return;
      }
      resolvedSupplier = created.id;
      await queryClient.invalidateQueries({ queryKey: ["ingredient-suppliers"] });
    }
    if (!resolvedSupplier) {
      setBusy(false);
      toast.error(t("ingredient_supplier"));
      return;
    }
    const { error } = await supabase.from("gold_lot_ingredients").insert({
      gold_lot_id: lotId,
      ingredient_name: name.trim(),
      supplier_id: resolvedSupplier,
      supplier_lot_code: supplierLot.trim() || null,
      quantity: quantity.trim() ? Number(quantity) : null,
      quantity_unit: unit.trim() || "kg",
      best_before: bestBefore || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setName("");
    setSupplierLot("");
    setQuantity("");
    setBestBefore("");
    setNewSupplier("");
    toast.success(t("add_ingredient"));
    await onSaved();
  }

  return (
    <div className="surface-card mt-4 space-y-4 p-5">
      <TextField label={t("ingredient_name")} value={name} onChange={setName} />
      <label className="block">
        <span className="eyebrow mb-2 block">{t("ingredient_supplier")}</span>
        <select
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
          className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
        >
          <option value="">—</option>
          {(suppliers ?? []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <TextField label={t("new_supplier")} value={newSupplier} onChange={setNewSupplier} />
      <TextField
        label={t("supplier_lot")}
        value={supplierLot}
        onChange={setSupplierLot}
        placeholder={t("supplier_lot_hint")}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField label={t("quantity_used")} type="number" value={quantity} onChange={setQuantity} />
        <TextField label={t("quantity_unit")} value={unit} onChange={setUnit} />
      </div>
      <TextField label={t("best_before")} type="date" value={bestBefore} onChange={setBestBefore} />
      <PrimaryButton onClick={submit} disabled={busy}>
        {busy ? "…" : t("add_ingredient")}
      </PrimaryButton>
    </div>
  );
}

function HandoverForm({
  lotId,
  remaining,
  onSaved,
}: {
  lotId: string;
  remaining: number;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [quantity, setQuantity] = useState(String(remaining || 0));
  const [cartons, setCartons] = useState("0");
  const [handedOverAt, setHandedOverAt] = useState(nowOsloDateTimeLocal);
  const [recipientKey, setRecipientKey] = useState("");
  const [company, setCompany] = useState("");
  const [person, setPerson] = useState("");
  const [storage, setStorage] = useState("");
  const [ownership, setOwnership] = useState<"villa" | "gold">("villa");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuantity(String(remaining || 0));
  }, [remaining]);

  const { data: partners } = useQuery({
    queryKey: ["partners-list"],
    queryFn: async () => {
      const { data } = await supabase.from("partners").select("id, name").eq("active", true).order("name");
      return (data ?? []) as Partner[];
    },
  });
  const { data: venues } = useQuery({
    queryKey: ["venues-list"],
    queryFn: async () => {
      const { data } = await supabase.from("venues").select("id, name").eq("active", true).order("name");
      return (data ?? []) as Venue[];
    },
  });

  const recipientOptions = useMemo(() => {
    const partnerOpts = (partners ?? []).map((partner) => ({
      key: `partner:${partner.id}`,
      label: partner.name,
      company: partner.name,
      partnerId: partner.id,
      venueId: null as string | null,
    }));
    const venueOpts = (venues ?? []).map((venue) => ({
      key: `venue:${venue.id}`,
      label: venue.name,
      company: venue.name,
      partnerId: null as string | null,
      venueId: venue.id,
    }));
    return [...partnerOpts, ...venueOpts];
  }, [partners, venues]);

  function pickRecipient(key: string) {
    setRecipientKey(key);
    const found = recipientOptions.find((option) => option.key === key);
    if (found) setCompany(found.company);
  }

  async function submit() {
    const qty = Number.parseInt(quantity, 10) || 0;
    const chosen = recipientOptions.find((option) => option.key === recipientKey);
    const recipientCompany = company.trim() || chosen?.company || "";
    if (!recipientCompany || qty <= 0) {
      toast.error(t("recipient_company"));
      return;
    }
    setBusy(true);
    const handedAt = handedOverAt ? new Date(handedOverAt).toISOString() : new Date().toISOString();
    const { error } = await supabase.from("gold_lot_handovers").insert({
      gold_lot_id: lotId,
      quantity: qty,
      cartons: Number.parseInt(cartons, 10) || 0,
      handed_over_at: handedAt,
      recipient_company: recipientCompany,
      recipient_person: person.trim() || null,
      recipient_partner_id: chosen?.partnerId ?? null,
      recipient_venue_id: chosen?.venueId ?? null,
      storage_location: storage.trim() || null,
      ownership_after_handover: ownership,
    });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    if (remaining - qty <= 0) {
      await supabase.from("gold_lots").update({ status: "handed_over" }).eq("id", lotId);
    }
    setBusy(false);
    toast.success(t("add_handover"));
    await onSaved();
  }

  return (
    <div className="surface-card mt-4 space-y-4 p-5">
      <TextField label={t("handover_qty")} type="number" value={quantity} onChange={setQuantity} />
      <TextField label={t("carton_count")} type="number" value={cartons} onChange={setCartons} />
      <TextField
        label={t("handover_at")}
        type="datetime-local"
        value={handedOverAt}
        onChange={setHandedOverAt}
      />
      <label className="block">
        <span className="eyebrow mb-2 block">{t("choose_recipient")}</span>
        <select
          value={recipientKey}
          onChange={(event) => pickRecipient(event.target.value)}
          className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
        >
          <option value="">{t("recipient_other")}</option>
          {recipientOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <TextField label={t("recipient_company")} value={company} onChange={setCompany} />
      <TextField label={t("recipient_person")} value={person} onChange={setPerson} />
      <TextField label={t("storage_location")} value={storage} onChange={setStorage} />
      <label className="block">
        <span className="eyebrow mb-2 block">{t("ownership")}</span>
        <select
          value={ownership}
          onChange={(event) => setOwnership(event.target.value as "villa" | "gold")}
          className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
        >
          <option value="villa">{t("ownership_villa")}</option>
          <option value="gold">{t("ownership_gold")}</option>
        </select>
      </label>
      <PrimaryButton onClick={submit} disabled={busy}>
        {busy ? "…" : t("add_handover")}
      </PrimaryButton>
    </div>
  );
}
