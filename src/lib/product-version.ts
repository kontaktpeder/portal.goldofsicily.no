export const DEFAULT_STORAGE_NO = "Oppbevares ved -18 °C eller kaldere.";
export const DEFAULT_DO_NOT_REFREEZE_NO = "Bør ikke fryses på nytt etter opptining.";
export const DEFAULT_PRODUCER_NAME = "Gold of Sicily AS";
export const DEFAULT_SHELF_LIFE_DAYS = 180;

export type ProductLabelFields = {
  nameNo: string;
  nameEn: string;
  sku: string;
  legalDesignationNo: string;
  ingredientsNo: string;
  allergensNo: string;
  nutritionNo: string;
  prepNo: string;
  storageNo: string;
  doNotRefreezeNo: string;
  producerName: string;
  producerAddress: string;
  shelfLifeDays: number;
  unitWeightG: number | null;
  unitsPerPackage: number | null;
  packagesPerCarton: number | null;
};

export type ProductVersionSnapshot = ProductLabelFields & {
  fingerprint: string;
};

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function intOrNull(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Math.trunc(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function defaultLegalDesignation(nameNo: string): string {
  const name = text(nameNo);
  if (!name) return "Arancini – DYPFRYST";
  return `Arancini – ${name} – DYPFRYST`;
}

export function normalizeLabelFields(input: Partial<ProductLabelFields> & { nameNo: string; nameEn: string; sku: string }): ProductLabelFields {
  const units = intOrNull(input.unitsPerPackage);
  const perCarton = intOrNull(input.packagesPerCarton);
  return {
    nameNo: text(input.nameNo),
    nameEn: text(input.nameEn),
    sku: text(input.sku),
    legalDesignationNo: text(input.legalDesignationNo) || defaultLegalDesignation(input.nameNo),
    ingredientsNo: text(input.ingredientsNo),
    allergensNo: text(input.allergensNo),
    nutritionNo: text(input.nutritionNo),
    prepNo: text(input.prepNo),
    storageNo: text(input.storageNo) || DEFAULT_STORAGE_NO,
    doNotRefreezeNo: text(input.doNotRefreezeNo) || DEFAULT_DO_NOT_REFREEZE_NO,
    producerName: text(input.producerName) || DEFAULT_PRODUCER_NAME,
    producerAddress: text(input.producerAddress),
    shelfLifeDays: intOrNull(input.shelfLifeDays) ?? DEFAULT_SHELF_LIFE_DAYS,
    unitWeightG: intOrNull(input.unitWeightG),
    unitsPerPackage: units,
    packagesPerCarton: perCarton,
  };
}

export function labelFingerprint(fields: ProductLabelFields): string {
  return JSON.stringify({
    nameNo: fields.nameNo,
    nameEn: fields.nameEn,
    sku: fields.sku,
    legalDesignationNo: fields.legalDesignationNo,
    ingredientsNo: fields.ingredientsNo,
    allergensNo: fields.allergensNo,
    nutritionNo: fields.nutritionNo,
    prepNo: fields.prepNo,
    storageNo: fields.storageNo,
    doNotRefreezeNo: fields.doNotRefreezeNo,
    producerName: fields.producerName,
    producerAddress: fields.producerAddress,
    shelfLifeDays: fields.shelfLifeDays,
    unitWeightG: fields.unitWeightG,
    unitsPerPackage: fields.unitsPerPackage,
    packagesPerCarton: fields.packagesPerCarton,
  });
}

export function snapshotProductVersion(input: Partial<ProductLabelFields> & { nameNo: string; nameEn: string; sku: string }): ProductVersionSnapshot {
  const fields = normalizeLabelFields(input);
  return { ...fields, fingerprint: labelFingerprint(fields) };
}

export function packingConfigReady(fields: Pick<ProductLabelFields, "unitsPerPackage" | "packagesPerCarton">): boolean {
  return (fields.unitsPerPackage ?? 0) >= 1 && (fields.packagesPerCarton ?? 0) >= 1;
}

export function fieldsFromProductRow(row: {
  name_no: string;
  name_en: string;
  sku: string;
  legal_designation_no?: string | null;
  ingredients_no?: string | null;
  allergens_no?: string | null;
  nutrition_no?: string | null;
  prep_no?: string | null;
  storage_no?: string | null;
  do_not_refreeze_no?: string | null;
  producer_name?: string | null;
  producer_address?: string | null;
  shelf_life_days?: number | null;
  unit_weight_g?: number | null;
  units_per_package?: number | null;
  packages_per_carton?: number | null;
}): ProductLabelFields {
  return normalizeLabelFields({
    nameNo: row.name_no,
    nameEn: row.name_en,
    sku: row.sku,
    legalDesignationNo: row.legal_designation_no ?? "",
    ingredientsNo: row.ingredients_no ?? "",
    allergensNo: row.allergens_no ?? "",
    nutritionNo: row.nutrition_no ?? "",
    prepNo: row.prep_no ?? "",
    storageNo: row.storage_no ?? "",
    doNotRefreezeNo: row.do_not_refreeze_no ?? "",
    producerName: row.producer_name ?? "",
    producerAddress: row.producer_address ?? "",
    shelfLifeDays: row.shelf_life_days ?? DEFAULT_SHELF_LIFE_DAYS,
    unitWeightG: row.unit_weight_g ?? null,
    unitsPerPackage: row.units_per_package ?? null,
    packagesPerCarton: row.packages_per_carton ?? null,
  });
}

export function versionInsertRow(
  productId: string,
  versionNumber: number,
  snapshot: ProductVersionSnapshot,
) {
  return {
    product_id: productId,
    version_number: versionNumber,
    fingerprint: snapshot.fingerprint,
    name_no: snapshot.nameNo,
    name_en: snapshot.nameEn,
    sku: snapshot.sku,
    legal_designation_no: snapshot.legalDesignationNo,
    ingredients_no: snapshot.ingredientsNo || null,
    allergens_no: snapshot.allergensNo || null,
    nutrition_no: snapshot.nutritionNo || null,
    prep_no: snapshot.prepNo || null,
    storage_no: snapshot.storageNo,
    do_not_refreeze_no: snapshot.doNotRefreezeNo,
    producer_name: snapshot.producerName,
    producer_address: snapshot.producerAddress || null,
    shelf_life_days: snapshot.shelfLifeDays,
    unit_weight_g: snapshot.unitWeightG,
    units_per_package: snapshot.unitsPerPackage,
    packages_per_carton: snapshot.packagesPerCarton,
  };
}

export function isPackingSchemaError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "42703" ||
    /product_versions|gold_lot_packages|gold_lot_cartons|units_per_package|approved_qty|packed/i.test(
      message,
    )
  );
}
