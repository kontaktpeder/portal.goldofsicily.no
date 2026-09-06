export function nextAvailableProductId(
  products: { id: string }[],
  usedIds: Iterable<string>,
  currentId: string,
): string {
  const used = new Set(usedIds);
  const available = products.filter((product) => !used.has(product.id));
  if (available.some((product) => product.id === currentId)) return currentId;
  return available[0]?.id ?? "";
}

export function isUniqueMenuItemConflict(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return (
    error.code === "23505" ||
    /venue_menu_items_(customer|venue)_id_product_id_key/.test(error.message ?? "")
  );
}
