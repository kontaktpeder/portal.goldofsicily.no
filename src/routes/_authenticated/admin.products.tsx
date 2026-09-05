import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { slugify } from "@/lib/slug";
import { errorMessage } from "@/lib/utils";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";

export const Route = createFileRoute("/_authenticated/admin/products")({
  head: () => ({
    meta: [{ title: "Products — Gold of Sicily admin" }],
  }),
  component: AdminProducts,
});

function AdminProducts() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [nameNo, setNameNo] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [sku, setSku] = useState("");
  const [descriptionNo, setDescriptionNo] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!nameNo.trim() || !nameEn.trim()) {
      toast.error(t("product_name_no"));
      return;
    }
    setBusy(true);
    const slug = slugify(nameNo);
    const { error } = await supabase.from("products").insert({
      name_no: nameNo.trim(),
      name_en: nameEn.trim(),
      sku: (sku.trim() || slug).toUpperCase(),
      slug,
      description_no: descriptionNo.trim() || null,
      description_en: descriptionEn.trim() || null,
      image_url: imageUrl.trim() || null,
      sort_order: (products?.length ?? 0) * 10 + 10,
      active: true,
    });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error, t("create_customer_failed")));
      return;
    }
    toast.success(t("create_customer_created"));
    setOpen(false);
    setNameNo("");
    setNameEn("");
    setSku("");
    setDescriptionNo("");
    setDescriptionEn("");
    setImageUrl("");
    await queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  async function toggleActive(id: string, active: boolean) {
    const { error } = await supabase.from("products").update({ active }).eq("id", id);
    if (error) toast.error(error.message);
    else await queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("products")}</h1>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          {t("new_product")}
        </button>
      </div>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("products_intro")}</p>

      {open ? (
        <form className="surface-card mt-5 space-y-4 p-5" onSubmit={submit}>
          <TextField label={t("product_name_no")} value={nameNo} onChange={setNameNo} />
          <TextField label={t("product_name_en")} value={nameEn} onChange={setNameEn} />
          <TextField label={t("sku")} value={sku} onChange={setSku} placeholder="GOS-NDUJA" />
          <label className="block">
            <span className="eyebrow mb-2 block">{t("description")} (NO)</span>
            <TextAreaField value={descriptionNo} onChange={setDescriptionNo} />
          </label>
          <label className="block">
            <span className="eyebrow mb-2 block">{t("description")} (EN)</span>
            <TextAreaField value={descriptionEn} onChange={setDescriptionEn} />
          </label>
          <TextField label={t("image_url")} value={imageUrl} onChange={setImageUrl} />
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "…" : t("create")}
          </PrimaryButton>
        </form>
      ) : null}

      <div className="mt-6 space-y-3">
        {(products ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_products")}</p>
        ) : (
          products?.map((product) => (
            <article
              key={product.id}
              className="surface-card flex items-center justify-between gap-4 p-4"
            >
              <div>
                <p className="font-semibold">{product.name_no}</p>
                <p className="text-xs text-muted-foreground">
                  {product.sku} · {product.name_en}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleActive(product.id, !product.active)}
                className="text-xs font-semibold text-muted-foreground"
              >
                {product.active ? t("active") : t("inactive")}
              </button>
            </article>
          ))
        )}
      </div>
    </main>
  );
}
