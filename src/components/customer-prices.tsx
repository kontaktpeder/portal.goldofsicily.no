import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { formatPriceNok, parseGuestPriceOre } from "@/lib/slug";
import { PrimaryButton, TextField } from "@/components/field";

export function CustomerPrices({ customerId }: { customerId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [price, setPrice] = useState("");
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState("");
  const [busy, setBusy] = useState(false);

  const products = useQuery({
    queryKey: ["products-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name_no")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const prices = useQuery({
    queryKey: ["customer-prices", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_product_prices")
        .select("id, product_id, price_ore, valid_from, valid_to, products(name_no)")
        .eq("customer_id", customerId)
        .order("valid_from", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const priceOre = parseGuestPriceOre(price);
    if (!productId || !priceOre || priceOre <= 0) {
      toast.error(t("price_required"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("customer_product_prices").insert({
      customer_id: customerId,
      product_id: productId,
      price_ore: priceOre,
      valid_from: validFrom,
      valid_to: validTo || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPrice("");
    await queryClient.invalidateQueries({ queryKey: ["customer-prices", customerId] });
  }

  return (
    <section className="surface-card space-y-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">{t("prices")}</h2>
        <p className="text-sm text-muted-foreground">{t("prices_hint")}</p>
      </div>
      <form className="space-y-3" onSubmit={(event) => void add(event)}>
        <label className="block">
          <span className="eyebrow mb-2 block">{t("nav_products")}</span>
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
          >
            <option value="">—</option>
            {products.data?.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name_no}
              </option>
            ))}
          </select>
        </label>
        <TextField label={t("unit_price")} value={price} onChange={setPrice} />
        <TextField label={t("valid_from")} value={validFrom} onChange={setValidFrom} type="date" />
        <TextField label={t("valid_to")} value={validTo} onChange={setValidTo} type="date" />
        <PrimaryButton type="submit" disabled={busy}>
          {t("create")}
        </PrimaryButton>
      </form>
      <ul className="space-y-2">
        {(prices.data ?? []).map((row) => {
          const product = row.products as { name_no: string } | { name_no: string }[] | null;
          const name = Array.isArray(product) ? product[0]?.name_no : product?.name_no;
          return (
            <li key={row.id} className="text-sm">
              <span className="font-semibold">{name ?? row.product_id}</span>
              {" · "}
              {formatPriceNok(row.price_ore)} kr
              {" · "}
              {row.valid_from}
              {row.valid_to ? `–${row.valid_to}` : ""}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
