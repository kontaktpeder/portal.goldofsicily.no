import { classifyRecallQuery, remainingAtGold, sumQuantities } from "./gold-lot.ts";

export type RecallIngredient = {
  ingredientName: string;
  supplierName: string;
  supplierLotCode: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  bestBefore: string | null;
  matched: boolean;
};

export type RecallHandover = {
  quantity: number;
  cartons: number;
  handedOverAt: string;
  recipientCompany: string;
  recipientPerson: string | null;
  storageLocation: string | null;
  ownership: "gold" | "villa";
};

export type RecallVenueDelivery = {
  venueName: string;
  quantity: number;
  deliveredAt: string;
};

export type RecallLotCard = {
  id: string;
  lotCode: string;
  productNameNo: string;
  productNameEn: string;
  productionDate: string;
  producedQty: number;
  cartonCount: number;
  producedBy: string | null;
  producerNames: string[];
  legacyProducedBy: string | null;
  status: string;
  deviationNotes: string | null;
  remainingQty: number;
  ingredients: RecallIngredient[];
  handovers: RecallHandover[];
  venueDeliveries: RecallVenueDelivery[];
};

export type RecallSearchResult = {
  query: string;
  kind: "gold_lot" | "supplier_lot";
  matchedSupplierLot: string | null;
  lots: RecallLotCard[];
};

export type RecallLotInput = {
  id: string;
  lotCode: string;
  productNameNo: string;
  productNameEn: string;
  productionDate: string;
  producedQty: number;
  cartonCount: number;
  producedBy: string | null;
  producerNames?: string[];
  legacyProducedBy?: string | null;
  status: string;
  deviationNotes: string | null;
  ingredients: Array<{
    ingredientName: string;
    supplierName: string;
    supplierLotCode: string | null;
    quantity: number | null;
    quantityUnit: string | null;
    bestBefore: string | null;
  }>;
  handovers: RecallHandover[];
  venueDeliveries: RecallVenueDelivery[];
};

function normalizeLotToken(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export function buildRecallLotCard(
  input: RecallLotInput,
  matchedSupplierLot?: string | null,
): RecallLotCard {
  const needle = normalizeLotToken(matchedSupplierLot);
  const handedOverQty = sumQuantities(input.handovers.map((row) => row.quantity));
  return {
    id: input.id,
    lotCode: input.lotCode,
    productNameNo: input.productNameNo,
    productNameEn: input.productNameEn,
    productionDate: input.productionDate,
    producedQty: input.producedQty,
    cartonCount: input.cartonCount,
    producedBy: input.producedBy,
    producerNames: input.producerNames ?? [],
    legacyProducedBy: input.legacyProducedBy ?? null,
    status: input.status,
    deviationNotes: input.deviationNotes,
    remainingQty: remainingAtGold(input.producedQty, handedOverQty),
    ingredients: input.ingredients.map((row) => ({
      ...row,
      matched: Boolean(needle) && normalizeLotToken(row.supplierLotCode) === needle,
    })),
    handovers: input.handovers,
    venueDeliveries: input.venueDeliveries,
  };
}

export function buildRecallSearchResult(
  query: string,
  lots: RecallLotInput[],
): RecallSearchResult {
  const classified = classifyRecallQuery(query);
  const matchedSupplierLot = classified.kind === "supplier_lot" ? classified.normalized : null;
  return {
    query: classified.normalized || query.trim(),
    kind: classified.kind,
    matchedSupplierLot,
    lots: lots.map((lot) => buildRecallLotCard(lot, matchedSupplierLot)),
  };
}

export function contactTargets(lot: RecallLotCard): string[] {
  const names = new Set<string>();
  for (const handover of lot.handovers) {
    if (handover.recipientCompany.trim()) names.add(handover.recipientCompany.trim());
  }
  for (const delivery of lot.venueDeliveries) {
    if (delivery.venueName.trim()) names.add(delivery.venueName.trim());
  }
  return [...names];
}
