import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isGoldLotSchemaError } from "@/lib/lot-stock";

export type MissingLotLetter = {
  id: string;
  name_no: string;
  name_en: string;
};

export type LotPrerequisites = {
  loading: boolean;
  schemaMissing: boolean;
  missingLetters: MissingLotLetter[];
  ok: boolean;
};

export function useLotPrerequisites(): LotPrerequisites {
  const schema = useQuery({
    queryKey: ["gold-lots-schema"],
    retry: false,
    queryFn: async () => {
      const { error } = await supabase.from("gold_lots").select("id").limit(1);
      if (!error) return { present: true as const };
      if (isGoldLotSchemaError(error)) return { present: false as const };
      throw error;
    },
  });

  const letters = useQuery({
    queryKey: ["products-lot-letters"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name_no, name_en, lot_letter")
        .eq("active", true)
        .order("sort_order");
      if (error) {
        if (isGoldLotSchemaError(error)) {
          return { schemaMissing: true as const, missing: [] as MissingLotLetter[] };
        }
        throw error;
      }
      const missing = (data ?? []).filter(
        (product) => !product.lot_letter?.trim(),
      ) as MissingLotLetter[];
      return { schemaMissing: false as const, missing };
    },
  });

  const schemaMissing = schema.data?.present === false || letters.data?.schemaMissing === true;
  const missingLetters = letters.data?.missing ?? [];
  const loading = schema.isPending || letters.isPending;

  return {
    loading,
    schemaMissing,
    missingLetters,
    ok: !loading && !schemaMissing && missingLetters.length === 0,
  };
}
