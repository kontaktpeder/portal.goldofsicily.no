export type CommercialRoute = "direct" | "via_wholesaler";

export type ConfirmationCustomer = {
  type: "venue" | "wholesaler";
  suppliedByCustomerId: string | null;
};

export function commercialRouteAtConfirmation(customer: ConfirmationCustomer): {
  commercialRoute: CommercialRoute;
  wholesalerCustomerId: string | null;
} {
  if (customer.type === "wholesaler" || !customer.suppliedByCustomerId) {
    return { commercialRoute: "direct", wholesalerCustomerId: null };
  }
  return {
    commercialRoute: "via_wholesaler",
    wholesalerCustomerId: customer.suppliedByCustomerId,
  };
}

export type PriceAgreement = {
  customerId: string;
  productId: string;
  priceOre: number;
  validFrom: string;
  validTo: string | null;
};

export function priceOreAt(
  prices: PriceAgreement[],
  customerId: string,
  productId: string,
  deliveredAt: string,
): number | null {
  const day = deliveredAt.slice(0, 10);
  const matches = prices.filter(
    (price) =>
      price.customerId === customerId &&
      price.productId === productId &&
      price.priceOre > 0 &&
      price.validFrom <= day &&
      (price.validTo === null || price.validTo >= day),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0));
  return matches[0]?.priceOre ?? null;
}

export function productsMissingPrice(
  lines: { productId: string; quantity: number; name: string }[],
  prices: PriceAgreement[],
  customerId: string,
  deliveredAt: string,
): { productId: string; name: string }[] {
  const seen = new Set<string>();
  const missing: { productId: string; name: string }[] = [];
  for (const line of lines) {
    if (line.quantity <= 0 || seen.has(line.productId)) continue;
    if (priceOreAt(prices, customerId, line.productId, deliveredAt) !== null) continue;
    seen.add(line.productId);
    missing.push({ productId: line.productId, name: line.name });
  }
  return missing;
}

export function parsePriceGap(search: Record<string, unknown>): { priceDate?: string; priceNames?: string } {
  const priceDate = search["priceDate"];
  const priceNames = search["priceNames"];
  const result: { priceDate?: string; priceNames?: string } = {};
  if (typeof priceDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(priceDate)) {
    result.priceDate = priceDate.slice(0, 10);
  }
  if (typeof priceNames === "string" && priceNames.trim()) result.priceNames = priceNames;
  return result;
}

export function priceGapNames(value: string | undefined): string[] {
  return (value ?? "")
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean);
}

export type LegalEntityLink = {
  id: string;
  parentLegalEntityId: string | null;
};

export function billingLegalEntityId(
  customer: { legalEntityId: string | null; billingLegalEntityId: string | null },
  entities: LegalEntityLink[],
): string | null {
  if (customer.billingLegalEntityId) return customer.billingLegalEntityId;
  if (!customer.legalEntityId) return null;
  const entity = entities.find((row) => row.id === customer.legalEntityId);
  if (!entity) return customer.legalEntityId;
  return entity.parentLegalEntityId ?? entity.id;
}

export function isUninvoicedSale(line: {
  commercialRoute: CommercialRoute;
  unitPriceOre: number | null;
  hasActiveAllocation: boolean;
}): boolean {
  return line.commercialRoute === "direct" && line.unitPriceOre !== null && line.unitPriceOre > 0 && !line.hasActiveAllocation;
}

export function legalEntityParentError(input: {
  id: string;
  parentId: string | null;
  parentIsSubunit: boolean;
  childCount: number;
}): string | null {
  if (!input.parentId) return null;
  if (input.parentId === input.id) return "parent_legal_entity_id cannot reference itself";
  if (input.parentIsSubunit) return "a subunit must point at a hovedenhet";
  if (input.childCount > 0) return "a hovedenhet with subunits cannot become a subunit";
  return null;
}
