import { supabase } from "@/integrations/supabase/client";
import {
  fieldsFromProductRow,
  isPackingSchemaError,
  snapshotProductVersion,
  versionInsertRow,
  type ProductLabelFields,
} from "@/lib/product-version";

export type EnsuredProductVersion = {
  ok: true;
  id: string;
  versionNumber: number;
  snapshot: ProductLabelFields & { fingerprint: string };
};

export type EnsureProductVersionFailure = {
  ok: false;
  schemaMissing: boolean;
  message: string;
};

export async function ensureProductVersionForProduct(
  productId: string,
): Promise<EnsuredProductVersion | EnsureProductVersionFailure> {
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .single();
  if (productError || !product) {
    return {
      ok: false,
      schemaMissing: isPackingSchemaError(productError),
      message: productError?.message ?? "product",
    };
  }
  const snapshot = snapshotProductVersion(fieldsFromProductRow(product));
  const { data: match, error: matchError } = await supabase
    .from("product_versions")
    .select("id, version_number")
    .eq("product_id", productId)
    .eq("fingerprint", snapshot.fingerprint)
    .order("version_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (matchError) {
    return {
      ok: false,
      schemaMissing: isPackingSchemaError(matchError),
      message: matchError.message,
    };
  }
  if (match) {
    return { ok: true, id: match.id, versionNumber: match.version_number, snapshot };
  }
  const { data: latest, error: latestError } = await supabase
    .from("product_versions")
    .select("version_number")
    .eq("product_id", productId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) {
    return {
      ok: false,
      schemaMissing: isPackingSchemaError(latestError),
      message: latestError.message,
    };
  }
  const { data: created, error: versionError } = await supabase
    .from("product_versions")
    .insert(versionInsertRow(productId, (latest?.version_number ?? 0) + 1, snapshot))
    .select("id, version_number")
    .single();
  if (versionError || !created) {
    return {
      ok: false,
      schemaMissing: isPackingSchemaError(versionError),
      message: versionError?.message ?? "version",
    };
  }
  return { ok: true, id: created.id, versionNumber: created.version_number, snapshot };
}
