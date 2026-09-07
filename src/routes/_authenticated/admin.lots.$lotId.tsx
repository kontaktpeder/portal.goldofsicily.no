import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { nowOsloDateTimeLocal, remainingAtGold, sumQuantities } from "@/lib/gold-lot";
import {
  cartonLabelsDocument,
  openLabelPrintWindow,
  packageLabelsDocument,
} from "@/lib/labels";
import { ensureProductVersionForProduct } from "@/lib/lot-snapshot";
import { lotRemaining } from "@/lib/lot-stock";
import {
  cartonInsertRows,
  derivedCartonCount,
  packageInsertRows,
  packingPlanFromStored,
  planPacking,
} from "@/lib/packing";
import {
  fieldsFromProductRow,
  isPackingSchemaError,
  packingConfigReady,
} from "@/lib/product-version";
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
  approved_qty: number | null;
  carton_count: number;
  produced_by: string | null;
  product_id: string;
  product_version_id: string | null;
  status: "produced" | "packed" | "handed_over" | "closed" | "recalled";
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

type ProductVersionRow = {
  id: string;
  version_number: number;
  name_no: string;
  name_en: string;
  sku: string;
  legal_designation_no: string;
  ingredients_no: string | null;
  allergens_no: string | null;
  nutrition_no: string | null;
  prep_no: string | null;
  storage_no: string;
  do_not_refreeze_no: string;
  producer_name: string;
  producer_address: string | null;
  shelf_life_days: number;
  unit_weight_g: number | null;
  units_per_package: number | null;
  packages_per_carton: number | null;
};

type LotCarton = {
  id: string;
  carton_seq: number;
  carton_code: string;
};

type LotPackage = {
  id: string;
  carton_id: string | null;
  package_seq: number;
  package_code: string;
  quantity: number;
};

const STATUS_KEYS: Record<LotDetail["status"], TranslationKey> = {
  produced: "lot_status_produced",
  packed: "lot_status_packed",
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

  const { data: packing } = useQuery({
    queryKey: ["gold-lot-packing", lotId, lot?.product_version_id],
    enabled: Boolean(lot),
    queryFn: async () => {
      let schemaMissing = false;
      let version: ProductVersionRow | null = null;
      if (lot?.product_version_id) {
        const { data, error: versionError } = await supabase
          .from("product_versions")
          .select("*")
          .eq("id", lot.product_version_id)
          .maybeSingle();
        if (versionError && isPackingSchemaError(versionError)) schemaMissing = true;
        else if (versionError) throw versionError;
        else version = (data as ProductVersionRow | null) ?? null;
      }

      const { data: cartonRows, error: cartonError } = await supabase
        .from("gold_lot_cartons")
        .select("id, carton_seq, carton_code")
        .eq("gold_lot_id", lotId)
        .order("carton_seq", { ascending: true });
      if (cartonError) {
        if (isPackingSchemaError(cartonError)) {
          return { schemaMissing: true, version, cartons: [] as LotCarton[], packages: [] as LotPackage[] };
        }
        throw cartonError;
      }

      const { data: packageRows, error: packageError } = await supabase
        .from("gold_lot_packages")
        .select("id, carton_id, package_seq, package_code, quantity")
        .eq("gold_lot_id", lotId)
        .order("package_seq", { ascending: true });
      if (packageError) {
        if (isPackingSchemaError(packageError)) {
          return { schemaMissing: true, version, cartons: [] as LotCarton[], packages: [] as LotPackage[] };
        }
        throw packageError;
      }

      return {
        schemaMissing,
        version,
        cartons: (cartonRows as LotCarton[] | null) ?? [],
        packages: (packageRows as LotPackage[] | null) ?? [],
      };
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
    await queryClient.invalidateQueries({ queryKey: ["gold-lot-packing", lotId] });
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
  const used = sumQuantities((deliveries ?? []).map((row) => row.quantity));
  const remaining = lotRemaining(lot.produced_qty, used);
  const goldLeft = remainingAtGold(lot.produced_qty, handed);
  const cartonCount =
    packing && packing.cartons.length > 0 ? derivedCartonCount(packing.cartons.map((row) => ({ seq: row.carton_seq }))) : lot.carton_count;
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
        {packing?.version ? ` · ${t("product_version")} v${packing.version.version_number}` : ""}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={t("produced_qty")} value={`${lot.produced_qty} ${t("pcs")}`} />
        <Metric label={t("lot_used")} value={`${used} ${t("pcs")}`} />
        <Metric label={t("lot_remaining")} value={`${remaining} ${t("pcs")}`} />
        <Metric label={t("remaining_gold")} value={`${goldLeft} ${t("pcs")}`} />
        <Metric label={t("carton_count")} value={String(cartonCount)} />
        <Metric label={t("lot_status")} value={t(STATUS_KEYS[lot.status] ?? "lot_status_produced")} />
      </div>

      <LotMetaForm lot={lot} onSaved={refresh} />

      <LotPackingSection lot={lot} packing={packing} onSaved={refresh} />

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
        <HandoverForm lotId={lot.id} remaining={goldLeft} onSaved={refresh} />
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

function LotPackingSection({
  lot,
  packing,
  onSaved,
}: {
  lot: LotDetail;
  packing:
    | {
        schemaMissing: boolean;
        version: ProductVersionRow | null;
        cartons: LotCarton[];
        packages: LotPackage[];
      }
    | undefined;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [approvedQty, setApprovedQty] = useState(String(lot.approved_qty ?? lot.produced_qty));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setApprovedQty(String(lot.approved_qty ?? lot.produced_qty));
  }, [lot.approved_qty, lot.produced_qty]);

  if (packing?.schemaMissing) {
    return (
      <section className="mt-10">
        <h2 className="text-2xl font-semibold">{t("packing")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("packing_schema_missing")}</p>
      </section>
    );
  }

  const snapshot = packing?.version ? fieldsFromProductRow(packing.version) : null;
  const canPackSizes = snapshot ? packingConfigReady(snapshot) : false;
  const handedOver = (lot.gold_lot_handovers ?? []).length > 0;
  const locked =
    handedOver || lot.status === "handed_over" || lot.status === "closed" || lot.status === "recalled";
  const storedPlan =
    packing && packing.packages.length > 0
      ? packingPlanFromStored({ packages: packing.packages, cartons: packing.cartons })
      : null;

  let previewPlan = storedPlan;
  const qty = Number.parseInt(approvedQty, 10);
  if (
    snapshot &&
    packingConfigReady(snapshot) &&
    Number.isFinite(qty) &&
    qty >= 1 &&
    qty <= lot.produced_qty
  ) {
    try {
      previewPlan = planPacking({
        lotCode: lot.lot_code,
        approvedQty: qty,
        unitsPerPackage: snapshot.unitsPerPackage!,
        packagesPerCarton: snapshot.packagesPerCarton!,
      });
    } catch {
      previewPlan = storedPlan;
    }
  }

  const typicalQty = Math.max(0, ...(previewPlan?.packages.map((pack) => pack.quantity) ?? []));

  async function runPacking() {
    if (locked) {
      toast.error(t("packing_locked"));
      return;
    }
    const approved = Number.parseInt(approvedQty, 10);
    if (!Number.isFinite(approved) || approved < 1 || approved > lot.produced_qty) {
      toast.error(t("packing_qty"));
      return;
    }
    setBusy(true);
    let versionId = lot.product_version_id;
    let fields = snapshot;
    if (!versionId || !fields) {
      const ensured = await ensureProductVersionForProduct(lot.product_id);
      if (!ensured.ok) {
        setBusy(false);
        toast.error(ensured.schemaMissing ? t("packing_schema_missing") : ensured.message);
        return;
      }
      versionId = ensured.id;
      fields = ensured.snapshot;
    }
    if (!packingConfigReady(fields)) {
      setBusy(false);
      toast.error(t("packing_missing"));
      return;
    }
    let plan;
    try {
      plan = planPacking({
        lotCode: lot.lot_code,
        approvedQty: approved,
        unitsPerPackage: fields.unitsPerPackage!,
        packagesPerCarton: fields.packagesPerCarton!,
      });
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof Error ? error.message : t("packing_qty"));
      return;
    }

    const removePackages = await supabase.from("gold_lot_packages").delete().eq("gold_lot_id", lot.id);
    if (removePackages.error) {
      setBusy(false);
      toast.error(
        isPackingSchemaError(removePackages.error)
          ? t("packing_schema_missing")
          : removePackages.error.message,
      );
      return;
    }
    const removeCartons = await supabase.from("gold_lot_cartons").delete().eq("gold_lot_id", lot.id);
    if (removeCartons.error) {
      setBusy(false);
      toast.error(removeCartons.error.message);
      return;
    }
    const cartonRows = cartonInsertRows(lot.id, plan);
    const inserted = await supabase.from("gold_lot_cartons").insert(cartonRows).select("id, carton_seq");
    if (inserted.error || !inserted.data) {
      setBusy(false);
      toast.error(inserted.error?.message ?? t("create_customer_failed"));
      return;
    }
    const cartonIdBySeq = new Map(inserted.data.map((row) => [row.carton_seq, row.id]));
    const packageRows = packageInsertRows(lot.id, plan, cartonIdBySeq);
    const packed = await supabase.from("gold_lot_packages").insert(packageRows);
    if (packed.error) {
      setBusy(false);
      toast.error(packed.error.message);
      return;
    }
    const updated = await supabase
      .from("gold_lots")
      .update({
        approved_qty: approved,
        product_version_id: versionId,
        status: "packed",
      })
      .eq("id", lot.id);
    setBusy(false);
    if (updated.error) {
      toast.error(updated.error.message);
      return;
    }
    toast.success(t("packing_done"));
    await onSaved();
  }

  function printLabels(kind: "package" | "carton") {
    const plan = storedPlan;
    const fields = snapshot;
    if (!plan || plan.packages.length === 0) {
      toast.error(t("packing_print_empty"));
      return;
    }
    if (!fields) {
      toast.error(t("packing_missing"));
      return;
    }
    const html =
      kind === "package"
        ? packageLabelsDocument(
            { lotCode: lot.lot_code, productionDate: lot.production_date, snapshot: fields },
            plan,
          )
        : cartonLabelsDocument(
            { lotCode: lot.lot_code, productionDate: lot.production_date, snapshot: fields },
            plan,
          );
    openLabelPrintWindow(html);
  }

  return (
    <section className="mt-10">
      <h2 className="text-2xl font-semibold">{t("packing")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("packing_intro")}</p>
      {!canPackSizes && snapshot ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("packing_missing")}</p>
      ) : null}
      <div className="surface-card mt-4 space-y-4 p-5">
        <TextField
          label={t("approved_qty")}
          type="number"
          value={approvedQty}
          onChange={setApprovedQty}
        />
        {snapshot ? (
          <p className="text-sm text-muted-foreground">
            {t("units_per_package")}: {snapshot.unitsPerPackage ?? "—"}
            {" · "}
            {t("packages_per_carton")}: {snapshot.packagesPerCarton ?? "—"}
            {packing?.version ? ` · ${t("product_version")} v${packing.version.version_number}` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("packing_missing")}</p>
        )}
        {previewPlan ? (
          <div>
            <p className="eyebrow">{t("packing_preview")}</p>
            <p className="mt-1 font-semibold">
              {previewPlan.packages.length} {t("packages").toLowerCase()} · {previewPlan.cartons.length}{" "}
              {t("cartons").toLowerCase()}
            </p>
            {previewPlan.remainderQuantity > 0 ? (
              <p className="text-sm text-muted-foreground">
                {previewPlan.packages.at(-1)?.shortCode} = {previewPlan.remainderQuantity} {t("pcs")} (
                {t("remainder_bag")})
              </p>
            ) : null}
          </div>
        ) : null}
        {locked ? <p className="text-sm text-muted-foreground">{t("packing_locked")}</p> : null}
        <PrimaryButton onClick={runPacking} disabled={busy || locked || packing == null || Boolean(snapshot && !canPackSizes)}>
          {busy ? "…" : storedPlan ? t("packing_rerun") : t("packing_run")}
        </PrimaryButton>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PrimaryButton onClick={() => printLabels("package")} disabled={!storedPlan}>
            {t("print_package_labels")}
          </PrimaryButton>
          <PrimaryButton onClick={() => printLabels("carton")} disabled={!storedPlan}>
            {t("print_carton_labels")}
          </PrimaryButton>
        </div>
      </div>

      {storedPlan ? (
        <ul className="mt-4 space-y-2">
          {storedPlan.cartons.map((carton) => {
            const bags = storedPlan.packages.filter((pack) => carton.packageSeqs.includes(pack.seq));
            return (
              <li key={carton.code} className="surface-card p-4">
                <p className="font-mono font-semibold">
                  {carton.shortCode}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{carton.code}</span>
                </p>
                <p className="mt-1 text-sm">
                  {bags
                    .map((pack) => {
                      const rest = pack.quantity < typicalQty ? ` (${t("remainder_bag")})` : "";
                      return `${pack.shortCode} ${pack.quantity} ${t("pcs")}${rest}`;
                    })
                    .join(" · ")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {carton.quantity} {t("pcs")}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function LotMetaForm({ lot, onSaved }: { lot: LotDetail; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [producedBy, setProducedBy] = useState(lot.produced_by ?? "");
  const [status, setStatus] = useState(lot.status);
  const [notes, setNotes] = useState(lot.deviation_notes ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProducedBy(lot.produced_by ?? "");
    setStatus(lot.status);
    setNotes(lot.deviation_notes ?? "");
  }, [lot.produced_by, lot.status, lot.deviation_notes]);

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
          <option value="packed">{t("lot_status_packed")}</option>
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
