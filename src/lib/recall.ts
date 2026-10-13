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
  id?: string;
  quantity: number;
  cartons: number;
  handedOverAt: string;
  recipientCompany: string;
  customerId?: string | null;
  recipientPerson: string | null;
  storageLocation: string | null;
  ownership: "gold" | "villa";
};

export type RecallVenueDelivery = {
  venueName: string;
  quantity: number;
  deliveredAt: string;
  customerId?: string | null;
  commercialRoute?: "direct" | "via_wholesaler";
  wholesalerName?: string | null;
  sourceHandoverId?: string | null;
  lotRecorded?: boolean;
};

export type LotDistribution = {
  endRecipients: Array<{
    customerId: string | null;
    customerName: string;
    quantity: number;
    deliveredAt: string;
    wholesalerName: string | null;
    lotRecorded: boolean;
    handoverLinked: boolean;
  }>;
  missingLot: Array<{ customerName: string; quantity: number }>;
  heldAtWholesaler: Array<{
    handoverId: string;
    customerId: string | null;
    name: string;
    handedOver: number;
    tracedToRecipients: number;
    remaining: number;
  }>;
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
  distribution: LotDistribution;
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
    distribution: traceLotDistribution(input.handovers, input.venueDeliveries),
  };
}

export function traceLotDistribution(
  handovers: RecallHandover[],
  deliveries: RecallVenueDelivery[],
): LotDistribution {
  const endRecipients: LotDistribution["endRecipients"] = [];
  const missingLot: LotDistribution["missingLot"] = [];
  for (const delivery of deliveries) {
    if (delivery.quantity <= 0) continue;
    const lotRecorded = delivery.lotRecorded !== false;
    if (!lotRecorded) {
      missingLot.push({ customerName: delivery.venueName, quantity: delivery.quantity });
    }
    const viaWholesaler = delivery.commercialRoute === "via_wholesaler";
    endRecipients.push({
      customerId: delivery.customerId ?? null,
      customerName: delivery.venueName,
      quantity: delivery.quantity,
      deliveredAt: delivery.deliveredAt,
      wholesalerName: viaWholesaler ? delivery.wholesalerName?.trim() || null : null,
      lotRecorded,
      handoverLinked: !viaWholesaler || Boolean(delivery.sourceHandoverId),
    });
  }

  const heldAtWholesaler: LotDistribution["heldAtWholesaler"] = [];
  handovers.forEach((handover, index) => {
    if (handover.ownership !== "villa" || handover.quantity <= 0) return;
    const handoverId = handover.id ?? `handover-${index}`;
    const tracedToRecipients = deliveries.reduce((sum, delivery) => {
      if (delivery.sourceHandoverId !== handoverId || delivery.quantity <= 0) return sum;
      if (delivery.lotRecorded === false) return sum;
      return sum + delivery.quantity;
    }, 0);
    const remaining = handover.quantity - tracedToRecipients;
    if (remaining <= 0) return;
    heldAtWholesaler.push({
      handoverId,
      customerId: handover.customerId ?? null,
      name: handover.recipientCompany,
      handedOver: handover.quantity,
      tracedToRecipients,
      remaining,
    });
  });

  return { endRecipients, missingLot, heldAtWholesaler };
}

export function buildRecallSearchResult(query: string, lots: RecallLotInput[]): RecallSearchResult {
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
    if (delivery.wholesalerName?.trim()) names.add(delivery.wholesalerName.trim());
  }
  for (const held of lot.distribution.heldAtWholesaler) {
    if (held.name.trim()) names.add(held.name.trim());
  }
  return [...names];
}
