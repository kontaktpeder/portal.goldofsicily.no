import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRequireCommercial } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import { slugify } from "@/lib/slug";
import { errorMessage } from "@/lib/utils";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";

export const Route = createFileRoute("/_authenticated/admin/products")({
  head: () => ({
    meta: [{ title: "Smaker — Gold of Sicily admin" }],
  }),
  component: AdminProducts,
});

type ProductRow = {
  id: string;
  sku: string;
  slug: string;
  name_no: string;
  name_en: string;
  description_no: string | null;
  description_en: string | null;
  image_url: string | null;
  lot_letter: string | null;
  units_per_package: number | null;
  packages_per_carton: number | null;
  unit_weight_g: number | null;
  legal_designation_no: string | null;
  ingredients_no: string | null;
  allergens_no: string | null;
  nutrition_no: string | null;
  prep_no: string | null;
  storage_no: string | null;
  do_not_refreeze_no: string | null;
  producer_name: string | null;
  producer_address: string | null;
  shelf_life_days: number | null;
  active: boolean;
  sort_order: number;
};

function AdminProducts() {
  const { t } = useI18n();
  const { allowed, isLoading: sessionLoading } = useRequireCommercial();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("sort_order");
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  async function saved() {
    setOpen(false);
    setEditingId(null);
    await queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  async function toggleActive(id: string, active: boolean) {
    const { error } = await supabase.from("products").update({ active }).eq("id", id);
    if (error) toast.error(error.message);
    else await queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  const editing = products?.find((product) => product.id === editingId) ?? null;

  if (sessionLoading || !allowed) {
    return <main className="min-h-screen" />;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("products")}</h1>
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setOpen((value) => !value);
          }}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          {t("new_product")}
        </button>
      </div>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("products_intro")}</p>

      {open && !editing ? (
        <ProductForm
          sortOrder={(products?.length ?? 0) * 10 + 10}
          onSaved={saved}
          onCancel={() => setOpen(false)}
        />
      ) : null}

      <div className="mt-6 space-y-3">
        {(products ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_products")}</p>
        ) : (
          products?.map((product) =>
            editingId === product.id && editing ? (
              <ProductForm
                key={product.id}
                existing={editing}
                onSaved={saved}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <article
                key={product.id}
                className="surface-card flex items-center justify-between gap-4 p-4"
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setEditingId(product.id);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="font-semibold">{product.name_no}</p>
                  <p className="text-xs text-muted-foreground">
                    {product.name_en}
                    {product.sku ? ` · ${product.sku}` : ""}
                    {product.lot_letter ? ` · L-${product.lot_letter}` : ""}
                    {product.units_per_package && product.packages_per_carton
                      ? ` · ${product.units_per_package} × ${product.packages_per_carton}`
                      : ""}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => toggleActive(product.id, !product.active)}
                  className="text-xs font-semibold text-muted-foreground"
                >
                  {product.active ? t("active") : t("inactive")}
                </button>
              </article>
            ),
          )
        )}
      </div>
    </main>
  );
}

function ProductForm({
  existing,
  sortOrder,
  onSaved,
  onCancel,
}: {
  existing?: ProductRow;
  sortOrder?: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [nameNo, setNameNo] = useState(existing?.name_no ?? "");
  const [nameEn, setNameEn] = useState(existing?.name_en ?? "");
  const [sku, setSku] = useState(existing?.sku ?? "");
  const [descriptionNo, setDescriptionNo] = useState(existing?.description_no ?? "");
  const [descriptionEn, setDescriptionEn] = useState(existing?.description_en ?? "");
  const [imageUrl, setImageUrl] = useState(existing?.image_url ?? "");
  const [lotLetter, setLotLetter] = useState(existing?.lot_letter ?? "");
  const [unitsPerPackage, setUnitsPerPackage] = useState(
    existing?.units_per_package ? String(existing.units_per_package) : "25",
  );
  const [packagesPerCarton, setPackagesPerCarton] = useState(
    existing?.packages_per_carton ? String(existing.packages_per_carton) : "4",
  );
  const [unitWeightG, setUnitWeightG] = useState(
    existing?.unit_weight_g ? String(existing.unit_weight_g) : "100",
  );
  const [legalDesignation, setLegalDesignation] = useState(existing?.legal_designation_no ?? "");
  const [ingredientsNo, setIngredientsNo] = useState(existing?.ingredients_no ?? "");
  const [allergensNo, setAllergensNo] = useState(existing?.allergens_no ?? "");
  const [nutritionNo, setNutritionNo] = useState(existing?.nutrition_no ?? "");
  const [prepNo, setPrepNo] = useState(existing?.prep_no ?? "");
  const [storageNo, setStorageNo] = useState(existing?.storage_no ?? "");
  const [doNotRefreeze, setDoNotRefreeze] = useState(existing?.do_not_refreeze_no ?? "");
  const [producerName, setProducerName] = useState(existing?.producer_name ?? "Gold of Sicily AS");
  const [producerAddress, setProducerAddress] = useState(existing?.producer_address ?? "");
  const [shelfLifeDays, setShelfLifeDays] = useState(
    existing?.shelf_life_days ? String(existing.shelf_life_days) : "180",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNameNo(existing?.name_no ?? "");
    setNameEn(existing?.name_en ?? "");
    setSku(existing?.sku ?? "");
    setDescriptionNo(existing?.description_no ?? "");
    setDescriptionEn(existing?.description_en ?? "");
    setImageUrl(existing?.image_url ?? "");
    setLotLetter(existing?.lot_letter ?? "");
    setUnitsPerPackage(existing?.units_per_package ? String(existing.units_per_package) : "25");
    setPackagesPerCarton(existing?.packages_per_carton ? String(existing.packages_per_carton) : "4");
    setUnitWeightG(existing?.unit_weight_g ? String(existing.unit_weight_g) : "100");
    setLegalDesignation(existing?.legal_designation_no ?? "");
    setIngredientsNo(existing?.ingredients_no ?? "");
    setAllergensNo(existing?.allergens_no ?? "");
    setNutritionNo(existing?.nutrition_no ?? "");
    setPrepNo(existing?.prep_no ?? "");
    setStorageNo(existing?.storage_no ?? "");
    setDoNotRefreeze(existing?.do_not_refreeze_no ?? "");
    setProducerName(existing?.producer_name ?? "Gold of Sicily AS");
    setProducerAddress(existing?.producer_address ?? "");
    setShelfLifeDays(existing?.shelf_life_days ? String(existing.shelf_life_days) : "180");
  }, [existing]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!nameNo.trim() || !nameEn.trim()) {
      toast.error(t("product_both_names"));
      return;
    }
    setBusy(true);
    const slug = existing?.slug || slugify(nameNo);
    const payload = {
      name_no: nameNo.trim(),
      name_en: nameEn.trim(),
      sku: (sku.trim() || slug).toUpperCase(),
      slug,
      description_no: descriptionNo.trim() || null,
      description_en: descriptionEn.trim() || null,
      image_url: imageUrl.trim() || null,
      lot_letter: lotLetter.trim().toUpperCase().slice(0, 1) || null,
      units_per_package: Number.parseInt(unitsPerPackage, 10) || null,
      packages_per_carton: Number.parseInt(packagesPerCarton, 10) || null,
      unit_weight_g: Number.parseInt(unitWeightG, 10) || null,
      legal_designation_no: legalDesignation.trim() || null,
      ingredients_no: ingredientsNo.trim() || null,
      allergens_no: allergensNo.trim() || null,
      nutrition_no: nutritionNo.trim() || null,
      prep_no: prepNo.trim() || null,
      storage_no: storageNo.trim() || null,
      do_not_refreeze_no: doNotRefreeze.trim() || null,
      producer_name: producerName.trim() || null,
      producer_address: producerAddress.trim() || null,
      shelf_life_days: Number.parseInt(shelfLifeDays, 10) || null,
    };
    const { error } = existing
      ? await supabase.from("products").update(payload).eq("id", existing.id)
      : await supabase.from("products").insert({
          ...payload,
          sort_order: sortOrder ?? 10,
          active: true,
        });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error, t("create_customer_failed")));
      return;
    }
    toast.success(t("save"));
    onSaved();
  }

  return (
    <form className="surface-card mt-5 space-y-4 p-5" onSubmit={submit}>
      <p className="eyebrow">{existing ? t("edit_product") : t("new_product")}</p>
      <TextField label={t("product_name_no")} value={nameNo} onChange={setNameNo} />
      <TextField label={t("product_name_en")} value={nameEn} onChange={setNameEn} />
      <TextField label={t("sku")} value={sku} onChange={setSku} placeholder="GOS-NDUJA" />
      <TextField
        label={t("lot_letter")}
        value={lotLetter}
        onChange={(value) => setLotLetter(value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1))}
        placeholder="T"
      />
      <p className="-mt-2 text-xs text-muted-foreground">{t("lot_letter_hint")}</p>
      <p className="eyebrow pt-2">{t("packing_units")}</p>
      <div className="grid grid-cols-3 gap-3">
        <TextField
          label={t("units_per_package")}
          type="number"
          value={unitsPerPackage}
          onChange={setUnitsPerPackage}
        />
        <TextField
          label={t("packages_per_carton")}
          type="number"
          value={packagesPerCarton}
          onChange={setPackagesPerCarton}
        />
        <TextField
          label={t("unit_weight_g")}
          type="number"
          value={unitWeightG}
          onChange={setUnitWeightG}
        />
      </div>
      <p className="eyebrow pt-2">{t("label_fields")}</p>
      <TextField label={t("legal_designation")} value={legalDesignation} onChange={setLegalDesignation} />
      <label className="block">
        <span className="eyebrow mb-2 block">{t("ingredients_list")}</span>
        <TextAreaField value={ingredientsNo} onChange={setIngredientsNo} />
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("allergens_list")}</span>
        <TextAreaField value={allergensNo} onChange={setAllergensNo} />
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("nutrition_decl")}</span>
        <TextAreaField value={nutritionNo} onChange={setNutritionNo} />
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("prep_instructions")}</span>
        <TextAreaField value={prepNo} onChange={setPrepNo} />
      </label>
      <TextField label={t("storage_instructions")} value={storageNo} onChange={setStorageNo} />
      <TextField label={t("do_not_refreeze")} value={doNotRefreeze} onChange={setDoNotRefreeze} />
      <TextField label={t("producer_name")} value={producerName} onChange={setProducerName} />
      <TextField label={t("producer_address")} value={producerAddress} onChange={setProducerAddress} />
      <TextField
        label={t("shelf_life_days")}
        type="number"
        value={shelfLifeDays}
        onChange={setShelfLifeDays}
      />
      <label className="block">
        <span className="eyebrow mb-2 block">{t("product_desc_no")}</span>
        <TextAreaField value={descriptionNo} onChange={setDescriptionNo} />
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("product_desc_en")}</span>
        <TextAreaField value={descriptionEn} onChange={setDescriptionEn} />
      </label>
      <TextField label={t("image_url")} value={imageUrl} onChange={setImageUrl} />
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? "…" : t("save")}
      </PrimaryButton>
      <button
        type="button"
        onClick={onCancel}
        className="w-full text-sm font-semibold text-muted-foreground"
      >
        {t("cancel")}
      </button>
    </form>
  );
}
