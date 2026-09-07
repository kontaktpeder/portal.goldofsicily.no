import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton, TextField } from "@/components/field";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { classifyRecallQuery } from "@/lib/gold-lot";
import { buildRecallSearchResult, contactTargets, type RecallLotInput } from "@/lib/recall";
import { formatDate } from "@/lib/sign-out";

const STATUS_KEYS: Record<string, TranslationKey> = {
  produced: "lot_status_produced",
  packed: "lot_status_packed",
  handed_over: "lot_status_handed_over",
  closed: "lot_status_closed",
  recalled: "lot_status_recalled",
};

export function RecallSearch({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const classified = useMemo(() => classifyRecallQuery(query), [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["recall", classified.kind, classified.normalized],
    enabled: classified.normalized.length > 0,
    queryFn: async () => fetchRecallLots(classified.kind, classified.normalized),
  });

  const result = useMemo(
    () => (query.trim() ? buildRecallSearchResult(query, data ?? []) : null),
    [data, query],
  );

  return (
    <div>
      {compact ? null : (
        <>
          <h2 className="text-2xl font-semibold">{t("recall_title")}</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("recall_intro")}</p>
        </>
      )}
      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <TextField
          label={t("recall_search")}
          value={draft}
          onChange={setDraft}
          placeholder={t("recall_placeholder")}
        />
        <PrimaryButton type="submit">{isFetching ? "…" : t("recall_search")}</PrimaryButton>
      </form>

      {query && result && result.lots.length === 0 && !isFetching ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("recall_empty")}</p>
      ) : null}

      {result?.lots.map((lot) => {
        const villa = lot.handovers.filter((row) => row.ownership === "villa");
        const name = lang === "en" ? lot.productNameEn : lot.productNameNo;
        const contacts = contactTargets(lot);
        return (
          <article key={lot.lotCode} className="surface-card mt-6 space-y-5 p-5">
            <div>
              <p className="eyebrow">
                {result.kind === "gold_lot" ? t("recall_kind_gold") : t("recall_kind_supplier")}
                {result.matchedSupplierLot ? ` · ${result.matchedSupplierLot}` : ""}
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold">{lot.lotCode}</p>
              <p className="text-lg">{name}</p>
              <p className="text-sm text-muted-foreground">
                {t("production_date")}: {formatDate(lot.productionDate, lang)}
                {lot.producedBy ? ` · ${lot.producedBy}` : ""}
              </p>
              <p className="text-sm tabular-nums">
                {t("produced_qty")}: {lot.producedQty} {t("pcs")} · {lot.cartonCount}{" "}
                {t("carton_count").toLowerCase()}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("lot_status")}: {t(STATUS_KEYS[lot.status] ?? "lot_status_produced")}
              </p>
            </div>

            <section>
              <h2 className="eyebrow">{t("ingredients")}</h2>
              {lot.ingredients.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t("no_ingredients")}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {lot.ingredients.map((row, index) => (
                    <li
                      key={`${row.ingredientName}-${index}`}
                      className={
                        row.matched ? "rounded-xl bg-primary/10 px-3 py-2 font-medium" : ""
                      }
                    >
                      {row.ingredientName} – {row.supplierName}
                      {row.supplierLotCode ? ` – LOT ${row.supplierLotCode}` : ""}
                      {row.quantity != null ? ` · ${row.quantity} ${row.quantityUnit ?? ""}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="eyebrow">{t("venue_deliveries")}</h2>
              {lot.handovers.length === 0 && lot.venueDeliveries.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t("no_handovers")}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {lot.handovers.map((row, index) => (
                    <li key={`h-${index}`}>
                      {row.quantity} {t("pcs")} → {row.recipientCompany}
                    </li>
                  ))}
                  {lot.venueDeliveries.map((row, index) => (
                    <li key={`v-${index}`}>
                      {row.quantity} {t("pcs")} → {row.venueName}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="eyebrow">Villa</h2>
              {villa.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t("no_handovers")}</p>
              ) : (
                villa.map((row, index) => (
                  <div key={index} className="mt-2 text-sm">
                    <p>
                      {t("handover_at")}: {formatDate(row.handedOverAt, lang)}
                    </p>
                    {row.recipientPerson ? (
                      <p>
                        {t("recipient_person")}: {row.recipientPerson}
                      </p>
                    ) : null}
                    {row.storageLocation ? (
                      <p>
                        {t("storage_location")}: {row.storageLocation}
                      </p>
                    ) : null}
                    <p>
                      {t("ownership")}:{" "}
                      {row.ownership === "villa" ? t("ownership_villa") : t("ownership_gold")}
                    </p>
                  </div>
                ))
              )}
            </section>

            <section>
              <h2 className="eyebrow">{t("deviation_notes")}</h2>
              <p className="mt-2 text-sm">{lot.deviationNotes?.trim() || t("none")}</p>
            </section>

            {contacts.length > 0 ? (
              <section>
                <h2 className="eyebrow">{t("recall_contact")}</h2>
                <p className="mt-2 text-sm">{contacts.join(" · ")}</p>
              </section>
            ) : null}

            <Link
              to="/admin/lots/$lotId"
              params={{ lotId: lot.id }}
              className="inline-block text-sm font-semibold"
            >
              {t("lots_title")} →
            </Link>
          </article>
        );
      })}
    </div>
  );
}

async function fetchRecallLots(
  kind: "gold_lot" | "supplier_lot",
  normalized: string,
): Promise<RecallLotInput[]> {
  if (kind === "gold_lot") {
    const { data, error } = await supabase
      .from("gold_lots")
      .select(
        "id, lot_code, production_date, produced_qty, carton_count, produced_by, status, deviation_notes, products(name_no, name_en), gold_lot_ingredients(ingredient_name, supplier_lot_code, quantity, quantity_unit, best_before, ingredient_suppliers(name)), gold_lot_handovers(quantity, cartons, handed_over_at, recipient_company, recipient_person, storage_location, ownership_after_handover)",
      )
      .ilike("lot_code", `${normalized}%`)
      .order("lot_code", { ascending: false })
      .limit(20);
    if (error) throw error;
    return hydrateLots((data ?? []) as LotQueryRow[]);
  }

  const needle = normalized.replace(/[%_]/g, "");
  const { data: ingredientHits, error: ingredientError } = await supabase
    .from("gold_lot_ingredients")
    .select("gold_lot_id, supplier_lot_code")
    .ilike("supplier_lot_code", `%${needle}%`);
  if (ingredientError) throw ingredientError;
  const lotIds = [...new Set((ingredientHits ?? []).map((row) => row.gold_lot_id))];
  if (lotIds.length === 0) return [];
  const { data, error } = await supabase
    .from("gold_lots")
    .select(
      "id, lot_code, production_date, produced_qty, carton_count, produced_by, status, deviation_notes, products(name_no, name_en), gold_lot_ingredients(ingredient_name, supplier_lot_code, quantity, quantity_unit, best_before, ingredient_suppliers(name)), gold_lot_handovers(quantity, cartons, handed_over_at, recipient_company, recipient_person, storage_location, ownership_after_handover)",
    )
    .in("id", lotIds)
    .order("lot_code", { ascending: false });
  if (error) throw error;
  return hydrateLots((data ?? []) as LotQueryRow[]);
}

type LotQueryRow = {
  id: string;
  lot_code: string;
  production_date: string;
  produced_qty: number;
  carton_count: number;
  produced_by: string | null;
  status: string;
  deviation_notes: string | null;
  products: { name_no: string; name_en: string } | { name_no: string; name_en: string }[] | null;
  gold_lot_ingredients:
    | {
        ingredient_name: string;
        supplier_lot_code: string | null;
        quantity: number | null;
        quantity_unit: string | null;
        best_before: string | null;
        ingredient_suppliers: { name: string } | { name: string }[] | null;
      }[]
    | null;
  gold_lot_handovers:
    | {
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

async function hydrateLots(rows: LotQueryRow[]): Promise<RecallLotInput[]> {
  const ids = rows.map((row) => row.id);
  const { data: lines } = await supabase
    .from("delivery_lines")
    .select("gold_lot_id, quantity, deliveries(delivered_at, venues(name))")
    .in("gold_lot_id", ids);
  const byLot = new Map<string, RecallLotInput["venueDeliveries"]>();
  for (const line of lines ?? []) {
    if (!line.gold_lot_id) continue;
    const delivery = line.deliveries as
      | { delivered_at: string; venues: { name: string } | null }
      | { delivered_at: string; venues: { name: string } | null }[]
      | null;
    const record = Array.isArray(delivery) ? delivery[0] : delivery;
    const list = byLot.get(line.gold_lot_id) ?? [];
    list.push({
      venueName: record?.venues?.name ?? "—",
      quantity: line.quantity,
      deliveredAt: record?.delivered_at ?? "",
    });
    byLot.set(line.gold_lot_id, list);
  }

  return rows.map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return {
      id: row.id,
      lotCode: row.lot_code,
      productNameNo: product?.name_no ?? "",
      productNameEn: product?.name_en ?? "",
      productionDate: row.production_date,
      producedQty: row.produced_qty,
      cartonCount: row.carton_count,
      producedBy: row.produced_by,
      status: row.status,
      deviationNotes: row.deviation_notes,
      ingredients: (row.gold_lot_ingredients ?? []).map((ingredient) => {
        const supplier = Array.isArray(ingredient.ingredient_suppliers)
          ? ingredient.ingredient_suppliers[0]
          : ingredient.ingredient_suppliers;
        return {
          ingredientName: ingredient.ingredient_name,
          supplierName: supplier?.name ?? "—",
          supplierLotCode: ingredient.supplier_lot_code,
          quantity: ingredient.quantity,
          quantityUnit: ingredient.quantity_unit,
          bestBefore: ingredient.best_before,
        };
      }),
      handovers: (row.gold_lot_handovers ?? []).map((handover) => ({
        quantity: handover.quantity,
        cartons: handover.cartons,
        handedOverAt: handover.handed_over_at,
        recipientCompany: handover.recipient_company,
        recipientPerson: handover.recipient_person,
        storageLocation: handover.storage_location,
        ownership: handover.ownership_after_handover,
      })),
      venueDeliveries: byLot.get(row.id) ?? [],
    };
  });
}
