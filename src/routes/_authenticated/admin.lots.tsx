import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton, TextField } from "@/components/field";
import { useI18n } from "@/lib/i18n";
import {
  formatGoldLotCode,
  nextLotSequence,
  remainingAtGold,
  sumQuantities,
  todayOsloDate,
} from "@/lib/gold-lot";
import { formatDate } from "@/lib/sign-out";
import { errorMessage } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/lots")({
  head: () => ({
    meta: [
      { title: "Gold-LOT — Gold of Sicily admin" },
      {
        name: "description",
        content: "Production lots for one-up one-down food traceability.",
      },
    ],
  }),
  component: AdminLots,
});

type ProductOption = {
  id: string;
  name_no: string;
  name_en: string;
  lot_letter: string | null;
};

type LotRow = {
  id: string;
  lot_code: string;
  production_date: string;
  produced_qty: number;
  carton_count: number;
  produced_by: string | null;
  status: string;
  products: { name_no: string; name_en: string } | null;
  gold_lot_handovers: { quantity: number }[] | null;
};

function AdminLots() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [productionDate, setProductionDate] = useState(todayOsloDate);
  const [producedQty, setProducedQty] = useState("0");
  const [cartonCount, setCartonCount] = useState("0");
  const [producedBy, setProducedBy] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["products-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name_no, name_en, lot_letter")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as ProductOption[];
    },
  });

  const { data: lots } = useQuery({
    queryKey: ["gold-lots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gold_lots")
        .select(
          "id, lot_code, production_date, produced_qty, carton_count, produced_by, status, products(name_no, name_en), gold_lot_handovers(quantity)",
        )
        .order("lot_code", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as LotRow[];
    },
  });

  const selected = products?.find((product) => product.id === productId);
  const previewCode = useMemo(() => {
    const letter = selected?.lot_letter?.trim().toUpperCase() ?? "";
    if (!letter || !productionDate) return "";
    const existing = (lots ?? [])
      .map((lot) => lot.lot_code)
      .filter((code) => code.startsWith(`L-${productionDate.replaceAll("-", "")}-${letter}-`));
    try {
      return formatGoldLotCode(productionDate, letter, nextLotSequence(existing, productionDate, letter));
    } catch {
      return "";
    }
  }, [lots, productionDate, selected]);

  async function submit() {
    if (!productId || Number.parseInt(producedQty, 10) <= 0) {
      toast.error(t("lot_missing"));
      return;
    }
    const letter = selected?.lot_letter?.trim().toUpperCase() ?? "";
    if (!letter) {
      toast.error(t("lot_letter_missing"));
      return;
    }
    setBusy(true);
    let lotCode = previewCode;
    const rpc = await supabase.rpc("next_gold_lot_code", {
      p_production_date: productionDate,
      p_lot_letter: letter,
    });
    if (!rpc.error && rpc.data) lotCode = rpc.data;
    const { data: created, error } = await supabase
      .from("gold_lots")
      .insert({
        lot_code: lotCode,
        production_date: productionDate,
        product_id: productId,
        produced_qty: Number.parseInt(producedQty, 10) || 0,
        carton_count: Number.parseInt(cartonCount, 10) || 0,
        produced_by: producedBy.trim() || null,
        status: "produced",
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !created) {
      toast.error(errorMessage(error, t("create_customer_failed")));
      return;
    }
    toast.success(`${lotCode} ${t("lot_created").toLowerCase()}`);
    setOpen(false);
    setProducedQty("0");
    setCartonCount("0");
    setProducedBy("");
    await queryClient.invalidateQueries({ queryKey: ["gold-lots"] });
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("lots_title")}</h1>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          {t("new_lot")}
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("lots_intro")}</p>

      {open ? (
        <div className="surface-card mt-5 space-y-4 p-5">
          <label className="block">
            <span className="eyebrow mb-2 block">{t("flavors")}</span>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
            >
              <option value="">—</option>
              {(products ?? []).map((product) => (
                <option key={product.id} value={product.id}>
                  {lang === "en" ? product.name_en : product.name_no}
                  {product.lot_letter ? ` (${product.lot_letter})` : ""}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label={t("production_date")}
            type="date"
            value={productionDate}
            onChange={setProductionDate}
          />
          {previewCode ? (
            <p className="font-mono text-lg font-semibold">{previewCode}</p>
          ) : null}
          <TextField label={t("produced_qty")} type="number" value={producedQty} onChange={setProducedQty} />
          <TextField label={t("carton_count")} type="number" value={cartonCount} onChange={setCartonCount} />
          <TextField label={t("produced_by")} value={producedBy} onChange={setProducedBy} />
          <PrimaryButton onClick={submit} disabled={busy}>
            {busy ? "…" : t("save")}
          </PrimaryButton>
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        {(lots ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_lots")}</p>
        ) : (
          lots?.map((lot) => {
            const handed = sumQuantities((lot.gold_lot_handovers ?? []).map((row) => row.quantity));
            const remaining = remainingAtGold(lot.produced_qty, handed);
            const name =
              lang === "en" ? (lot.products?.name_en ?? "") : (lot.products?.name_no ?? "");
            return (
              <Link
                key={lot.id}
                to="/admin/lots/$lotId"
                params={{ lotId: lot.id }}
                className="surface-card block p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-lg font-semibold">{lot.lot_code}</p>
                    <p className="mt-1 text-sm">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(lot.production_date, lang)}
                      {lot.produced_by ? ` · ${lot.produced_by}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">
                      {lot.produced_qty}{" "}
                      <span className="text-xs font-normal">{t("pcs")}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("remaining_gold")}: {remaining}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </main>
  );
}
