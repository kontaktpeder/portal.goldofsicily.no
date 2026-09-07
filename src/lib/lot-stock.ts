export type StockLot = {
  id: string;
  lotCode: string;
  productId: string;
  producedQty: number;
  deliveredQty: number;
  remaining: number;
  status: string;
};

export type LotAllocation = {
  lotId: string;
  lotCode: string;
  quantity: number;
};

export type DeliveryStockLine = {
  productId: string;
  quantity: number;
  goldLotId: string;
};

export function lotRemaining(producedQty: number, deliveredQty: number): number {
  return Math.max(0, producedQty - deliveredQty);
}

export function isOpenLot(status: string): boolean {
  return status !== "closed" && status !== "recalled";
}

export function sortNewestFirst(lots: StockLot[]): StockLot[] {
  return [...lots].sort((a, b) => b.lotCode.localeCompare(a.lotCode));
}

export function sortOldestFirst(lots: StockLot[]): StockLot[] {
  return [...lots].sort((a, b) => a.lotCode.localeCompare(b.lotCode));
}

export function openLotsForProduct(lots: StockLot[], productId: string): StockLot[] {
  return lots.filter(
    (lot) => lot.productId === productId && isOpenLot(lot.status) && lot.remaining > 0,
  );
}

/** Newest open LOT that can cover the full quantity. */
export function newestCoveringLot(
  lots: StockLot[],
  productId: string,
  needed: number,
): StockLot | null {
  if (needed <= 0) return null;
  return (
    sortNewestFirst(openLotsForProduct(lots, productId)).find((lot) => lot.remaining >= needed) ??
    null
  );
}

export function totalRemaining(lots: StockLot[], productId: string): number {
  return openLotsForProduct(lots, productId).reduce((sum, lot) => sum + lot.remaining, 0);
}

export function needsLotSplit(lots: StockLot[], productId: string, needed: number): boolean {
  if (needed <= 0) return false;
  if (newestCoveringLot(lots, productId, needed)) return false;
  return totalRemaining(lots, productId) >= needed;
}

/** Oldest-first fill so older food leaves first when one LOT cannot cover. */
export function allocateFifo(lots: StockLot[], productId: string, needed: number): LotAllocation[] {
  if (needed <= 0) return [];
  let left = needed;
  const allocations: LotAllocation[] = [];
  for (const lot of sortOldestFirst(openLotsForProduct(lots, productId))) {
    if (left <= 0) break;
    const take = Math.min(lot.remaining, left);
    if (take <= 0) continue;
    allocations.push({ lotId: lot.id, lotCode: lot.lotCode, quantity: take });
    left -= take;
  }
  return allocations;
}

export function canAllocate(lots: StockLot[], productId: string, needed: number): boolean {
  return needed <= 0 || totalRemaining(lots, productId) >= needed;
}

export function deliveryLineRequiresLot(
  quantity: number,
  goldLotId: string | null | undefined,
): boolean {
  return quantity <= 0 || Boolean(goldLotId);
}

export function suggestLotId(
  lots: StockLot[],
  productId: string,
  needed: number,
  currentLotId: string,
): string {
  if (needed <= 0) return "";
  const current = lots.find((lot) => lot.id === currentLotId && lot.productId === productId);
  if (current && isOpenLot(current.status) && current.remaining >= needed) return currentLotId;
  return newestCoveringLot(lots, productId, needed)?.id ?? "";
}

export function lotsWithFormReservation(
  lots: StockLot[],
  lines: DeliveryStockLine[],
  exceptIndex: number,
): StockLot[] {
  const reserved = new Map<string, number>();
  lines.forEach((line, index) => {
    if (index === exceptIndex) return;
    if (line.quantity > 0 && line.goldLotId) {
      reserved.set(line.goldLotId, (reserved.get(line.goldLotId) ?? 0) + line.quantity);
    }
  });
  return lots.map((lot) => ({
    ...lot,
    remaining: Math.max(0, lot.remaining - (reserved.get(lot.id) ?? 0)),
  }));
}

export function validateDeliveryStock(
  lines: DeliveryStockLine[],
  lots: StockLot[],
): { ok: true } | { ok: false; reason: "missing_lot" | "insufficient" | "unknown_lot" } {
  const reserved = new Map<string, number>();
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    if (!line.goldLotId) return { ok: false, reason: "missing_lot" };
    const lot = lots.find((item) => item.id === line.goldLotId);
    if (!lot || lot.productId !== line.productId) return { ok: false, reason: "unknown_lot" };
    const used = (reserved.get(line.goldLotId) ?? 0) + line.quantity;
    if (used > lot.remaining) return { ok: false, reason: "insufficient" };
    reserved.set(line.goldLotId, used);
  }
  return { ok: true };
}

export function toStockLots(
  rows: Array<{
    id: string;
    lot_code: string;
    product_id: string;
    produced_qty: number;
    status: string;
    delivery_lines?: { quantity: number }[] | null;
  }>,
): StockLot[] {
  return rows.map((row) => {
    const deliveredQty = (row.delivery_lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
    return {
      id: row.id,
      lotCode: row.lot_code,
      productId: row.product_id,
      producedQty: row.produced_qty,
      deliveredQty,
      remaining: lotRemaining(row.produced_qty, deliveredQty),
      status: row.status,
    };
  });
}

export function isGoldLotSchemaError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "42703" ||
    /gold_lots|lot_letter|schema cache/i.test(message)
  );
}
