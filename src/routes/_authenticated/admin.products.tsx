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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNameNo(existing?.name_no ?? "");
    setNameEn(existing?.name_en ?? "");
    setSku(existing?.sku ?? "");
    setDescriptionNo(existing?.description_no ?? "");
    setDescriptionEn(existing?.description_en ?? "");
    setImageUrl(existing?.image_url ?? "");
    setLotLetter(existing?.lot_letter ?? "");
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
