export function slugify(input: string) {
  const slug = input
    .trim()
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "sted";
}

export function formatPriceNok(priceOre: number | null | undefined) {
  if (priceOre == null) return null;
  const nok = priceOre / 100;
  return Number.isInteger(nok) ? `${nok}` : nok.toFixed(2).replace(".", ",");
}

export function parseGuestPriceOre(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const nok = Number(trimmed);
  if (!Number.isFinite(nok)) return null;
  return Math.round(nok * 100);
}
