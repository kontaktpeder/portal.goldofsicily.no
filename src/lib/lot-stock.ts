export type StockLot = {
  id: string;
  lotCode: string;
  productId: string;
  producedQty: number;
  deliveredQty: number;
  remaining: number;
  status: string;
  villaHandovers?: VillaHandoverStock[];
};

export type VillaHandoverStock = {
  id: string;
  lotId: string;
  lotCode: string;
  productId: string;
  recipient: string;
  remaining: number;
};

export type StockSource = "gold" | "villa";

export type LotAllocation = {
  lotId: string;
  lotCode: string;
  quantity: number;
};

export type DeliveryStockLine = {
  productId: string;
  quantity: number;
  goldLotId: string;
  sourceHandoverId?: string;
};

export function lotRemaining(producedQty: number, deliveredQty: number): number {
  return Math.max(0, producedQty - deliveredQty);
}

/** Approved quantity is the pack size. Produced is the fallback before packing. */
export function stockBaseQty(producedQty: number, approvedQty: number | null | undefined): number {
  return approvedQty == null ? producedQty : approvedQty;
}

export function goldAvailableQty(input: {
  producedQty: number;
  approvedQty?: number | null;
  villaHandoverQty: number;
  directDeliveredQty: number;
}): number {
  return Math.max(
    0,
    stockBaseQty(input.producedQty, input.approvedQty) -
      input.villaHandoverQty -
      input.directDeliveredQty,
  );
}

export function villaAvailableQty(handoverQty: number, deliveredFromHandover: number): number {
  return Math.max(0, handoverQty - deliveredFromHandover);
}

export function lotFlowTotals(input: {
  producedQty: number;
  approvedQty?: number | null;
  villaHandoverQty: number;
  directDeliveredQty: number;
  villaDeliveredQty: number;
}): { atGold: number; atVilla: number; deliveredToCustomers: number; totalLeft: number } {
  const atGold = goldAvailableQty(input);
  const atVilla = villaAvailableQty(input.villaHandoverQty, input.villaDeliveredQty);
  const deliveredToCustomers = input.directDeliveredQty + input.villaDeliveredQty;
  return { atGold, atVilla, deliveredToCustomers, totalLeft: atGold + atVilla };
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
  preferredLotId = "",
): string {
  if (needed <= 0) return "";
  const currentId = currentLotId || preferredLotId;
  const current = lots.find((lot) => lot.id === currentId && lot.productId === productId);
  if (current && isOpenLot(current.status) && current.remaining >= needed) return currentId;
  return newestCoveringLot(lots, productId, needed)?.id ?? "";
}

export function villaOptions(lots: readonly StockLot[], productId: string): VillaHandoverStock[] {
  return lots
    .filter((lot) => lot.productId === productId && isOpenLot(lot.status))
    .flatMap((lot) => lot.villaHandovers ?? []);
}

/** Keeps the handover the user already confirmed when it still covers the quantity. */
export function suggestVillaHandover(
  lots: readonly StockLot[],
  productId: string,
  needed: number,
  currentHandoverId: string,
  preferredLotId = "",
): { handoverId: string; lotId: string } | null {
  if (needed <= 0) return null;
  const options = villaOptions(lots, productId).filter((row) => row.remaining >= needed);
  const current = options.find((row) => row.id === currentHandoverId);
  if (current) return { handoverId: current.id, lotId: current.lotId };
  const preferred = options.find((row) => row.lotId === preferredLotId);
  if (preferred) return { handoverId: preferred.id, lotId: preferred.lotId };
  const newest = [...options].sort((a, b) => b.lotCode.localeCompare(a.lotCode))[0];
  return newest ? { handoverId: newest.id, lotId: newest.lotId } : null;
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

export function villaWithFormReservation(
  lots: StockLot[],
  lines: DeliveryStockLine[],
  exceptIndex: number,
): StockLot[] {
  const reserved = new Map<string, number>();
  lines.forEach((line, index) => {
    if (index === exceptIndex) return;
    if (line.quantity > 0 && line.sourceHandoverId) {
      reserved.set(
        line.sourceHandoverId,
        (reserved.get(line.sourceHandoverId) ?? 0) + line.quantity,
      );
    }
  });
  return lots.map((lot) => ({
    ...lot,
    villaHandovers: (lot.villaHandovers ?? []).map((handover) => ({
      ...handover,
      remaining: Math.max(0, handover.remaining - (reserved.get(handover.id) ?? 0)),
    })),
  }));
}

/** The Gold/Villa choice stays hidden until a chosen flavor has Villa stock. */
export function deliveryNeedsStockSourceChoice(
  lots: readonly StockLot[],
  lines: readonly { productId: string; quantity: number }[],
): boolean {
  return lines.some(
    (line) =>
      line.quantity > 0 && villaOptions(lots, line.productId).some((row) => row.remaining > 0),
  );
}

type AssignedLine = {
  productId: string;
  quantity: number;
  goldLotId: string;
  sourceHandoverId?: string;
};

/** Suggest a LOT again when the stock source changes. Earlier lines reserve what they take. */
export function assignStockSource<T extends AssignedLine>(
  lots: StockLot[],
  lines: readonly T[],
  source: StockSource,
  preferredLotId = "",
): T[] {
  const draft: DeliveryStockLine[] = lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    goldLotId: "",
    sourceHandoverId: "",
  }));
  return lines.map((line, index) => {
    if (line.quantity <= 0) {
      draft[index] = {
        productId: line.productId,
        quantity: 0,
        goldLotId: "",
        sourceHandoverId: "",
      };
      return { ...line, goldLotId: "", sourceHandoverId: "" };
    }
    if (source === "villa") {
      const picked = suggestVillaHandover(
        villaWithFormReservation(lots, draft, index),
        line.productId,
        line.quantity,
        "",
        preferredLotId,
      );
      const next = {
        ...line,
        goldLotId: picked?.lotId ?? "",
        sourceHandoverId: picked?.handoverId ?? "",
      };
      draft[index] = {
        productId: line.productId,
        quantity: line.quantity,
        goldLotId: next.goldLotId,
        sourceHandoverId: next.sourceHandoverId,
      };
      return next;
    }
    const goldLotId = suggestLotId(
      lotsWithFormReservation(lots, draft, index),
      line.productId,
      line.quantity,
      "",
      preferredLotId,
    );
    draft[index] = {
      productId: line.productId,
      quantity: line.quantity,
      goldLotId,
      sourceHandoverId: "",
    };
    return { ...line, goldLotId, sourceHandoverId: "" };
  });
}

/** Hos Villa and Totalt igjen appear only after a Villa transfer exists. */
export function showVillaStockMetrics(villaHandoverQty: number): boolean {
  return villaHandoverQty > 0;
}

export function validateVillaStock(
  lines: DeliveryStockLine[],
  lots: StockLot[],
): { ok: true } | { ok: false; reason: "missing_lot" | "insufficient" | "unknown_lot" } {
  const reserved = new Map<string, number>();
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    if (!line.goldLotId || !line.sourceHandoverId) return { ok: false, reason: "missing_lot" };
    const handover = lots
      .flatMap((lot) => lot.villaHandovers ?? [])
      .find((row) => row.id === line.sourceHandoverId && row.productId === line.productId);
    if (!handover || handover.lotId !== line.goldLotId) return { ok: false, reason: "unknown_lot" };
    const used = (reserved.get(handover.id) ?? 0) + line.quantity;
    if (used > handover.remaining) return { ok: false, reason: "insufficient" };
    reserved.set(handover.id, used);
  }
  return { ok: true };
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
    approved_qty?: number | null;
    status: string;
    delivery_lines?: { quantity: number; source_handover_id?: string | null }[] | null;
    gold_lot_handovers?: {
      id: string;
      quantity: number;
      ownership_after_handover: "gold" | "villa";
      recipient_company: string;
    }[] | null;
  }>,
): StockLot[] {
  return rows.map((row) => {
    const lines = row.delivery_lines ?? [];
    const directDeliveredQty = lines
      .filter((line) => !line.source_handover_id)
      .reduce((sum, line) => sum + line.quantity, 0);
    const villaHandovers = (row.gold_lot_handovers ?? [])
      .filter((handover) => handover.ownership_after_handover === "villa")
      .map((handover) => {
        const delivered = lines
          .filter((line) => line.source_handover_id === handover.id)
          .reduce((sum, line) => sum + line.quantity, 0);
        return {
          id: handover.id,
          lotId: row.id,
          lotCode: row.lot_code,
          productId: row.product_id,
          recipient: handover.recipient_company,
          remaining: villaAvailableQty(handover.quantity, delivered),
        };
      });
    const villaHandoverQty = (row.gold_lot_handovers ?? [])
      .filter((handover) => handover.ownership_after_handover === "villa")
      .reduce((sum, handover) => sum + handover.quantity, 0);
    return {
      id: row.id,
      lotCode: row.lot_code,
      productId: row.product_id,
      producedQty: row.produced_qty,
      deliveredQty: directDeliveredQty,
      remaining: goldAvailableQty({
        producedQty: row.produced_qty,
        approvedQty: row.approved_qty,
        villaHandoverQty,
        directDeliveredQty,
      }),
      status: row.status,
      villaHandovers,
    };
  });
}

export function isVillaStockSchemaError(message: string): boolean {
  return /source_handover_id/.test(message);
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
