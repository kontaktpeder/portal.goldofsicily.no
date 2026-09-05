export type FlavorLang = "no" | "en";

export type FlavorQty = number | "";

export type CatalogProduct = {
  id: string;
  name_no: string;
  name_en: string;
  slug: string;
};

export type ReportFlavorLine = {
  productId: string;
  nameNo: string;
  nameEn: string;
  sold: FlavorQty;
  remaining: FlavorQty;
  nextNeed: FlavorQty;
};

export type StoredFlavorLine = {
  product_id: string;
  sold: number;
  remaining_stock: number;
  next_required_quantity: number | null;
  products: { name_no: string; name_en: string } | null;
};

export function qty(value: FlavorQty) {
  return value === "" ? 0 : value;
}

export function productName(
  product: { name_no: string; name_en: string },
  lang: FlavorLang,
  displayName?: string | null,
) {
  if (displayName?.trim()) return displayName.trim();
  return lang === "en" ? product.name_en : product.name_no;
}

export function flavorLabel(line: Pick<ReportFlavorLine, "nameNo" | "nameEn">, lang: FlavorLang) {
  return lang === "en" ? line.nameEn : line.nameNo;
}

export function emptyFlavorLine(product: CatalogProduct): ReportFlavorLine {
  return {
    productId: product.id,
    nameNo: product.name_no,
    nameEn: product.name_en,
    sold: 0,
    remaining: 0,
    nextNeed: 0,
  };
}

export function initialFlavorLines(
  products: CatalogProduct[],
  menuProductIds: string[],
): ReportFlavorLine[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const fromMenu = menuProductIds
    .map((id) => byId.get(id))
    .filter((p): p is CatalogProduct => Boolean(p));
  const chosen = fromMenu.length > 0 ? fromMenu : products;
  return chosen.map(emptyFlavorLine);
}

export function sumLines(lines: ReportFlavorLine[]) {
  return {
    sold: lines.reduce((sum, line) => sum + qty(line.sold), 0),
    remaining: lines.reduce((sum, line) => sum + qty(line.remaining), 0),
    nextNeed: lines.reduce((sum, line) => sum + qty(line.nextNeed), 0),
  };
}

export function linesPayload(lines: ReportFlavorLine[]) {
  return lines.map((line) => ({
    product_id: line.productId,
    sold: qty(line.sold),
    remaining_stock: qty(line.remaining),
    next_required_quantity: qty(line.nextNeed),
  }));
}
