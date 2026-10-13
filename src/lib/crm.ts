export const SALES_STATUSES = [
  "prospect",
  "contacted",
  "interested",
  "tasting",
  "pilot_order",
  "active_customer",
  "waiting",
  "not_relevant",
] as const;
export type SalesStatus = (typeof SALES_STATUSES)[number];

export const CUSTOMER_SEGMENTS = ["restaurant", "hotel", "event", "bar"] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const CRM_ACTIVITY_KINDS = ["call", "email", "meeting", "tasting", "note"] as const;
export type CrmActivityKind = (typeof CRM_ACTIVITY_KINDS)[number];

export const OPEN_PROSPECT_STATUSES = [
  "prospect",
  "contacted",
  "interested",
  "tasting",
  "pilot_order",
] as const satisfies readonly SalesStatus[];

export type ActivationGap = "delivery_address" | "invoice_recipient";

export type DeliverySiteState = {
  active: boolean;
  partnershipLevel: string | null;
  suppliedByCustomerId: string | null;
  salesStatus: SalesStatus | null;
  commercialReadyAt: string | null;
  hasPortalLogin: boolean;
  deliveryAddress: string | null;
  visitAddress: string | null;
  legalEntityId: string | null;
  billingLegalEntityId: string | null;
};

export function effectiveDeliveryAddress(site: {
  deliveryAddress: string | null;
  visitAddress: string | null;
}): string {
  return site.deliveryAddress?.trim() || site.visitAddress?.trim() || "";
}

export function activationChannel(site: {
  suppliedByCustomerId: string | null;
}): "direct" | "via_wholesaler" {
  return site.suppliedByCustomerId ? "via_wholesaler" : "direct";
}

/** Requirements follow the current delivery and billing model. Login and org number are not universal. */
export function activationGaps(site: DeliverySiteState): ActivationGap[] {
  const gaps: ActivationGap[] = [];
  if (!effectiveDeliveryAddress(site)) gaps.push("delivery_address");
  if (activationChannel(site) === "direct" && !site.legalEntityId && !site.billingLegalEntityId) {
    gaps.push("invoice_recipient");
  }
  return gaps;
}

export function salesStatusPatch(status: SalesStatus): { sales_status: SalesStatus } {
  return { sales_status: status };
}

export function commercialReadyPatch(readyAt: string | null): {
  commercial_ready_at: string | null;
} {
  return { commercial_ready_at: readyAt };
}

export function withSalesStatus(site: DeliverySiteState, status: SalesStatus): DeliverySiteState {
  return { ...site, salesStatus: status };
}

export function withCommercialReady(
  site: DeliverySiteState,
  readyAt: string | null,
): DeliverySiteState | { gaps: ActivationGap[] } {
  if (readyAt !== null) {
    const gaps = activationGaps(site);
    if (gaps.length > 0) return { gaps };
  }
  return { ...site, commercialReadyAt: readyAt };
}

export function purchasingContactOwner(input: {
  legalEntityId: string | null;
  parentLegalEntityId: string | null;
}): { legalEntityId: string } | { gap: "legal_entity" } {
  const legalEntityId = input.parentLegalEntityId ?? input.legalEntityId;
  if (!legalEntityId) return { gap: "legal_entity" };
  return { legalEntityId };
}

export function normalizeSiteKey(name: string, city: string | null): string {
  const normalizedName = name.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedCity = (city ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${normalizedName}|${normalizedCity}`;
}

export function findDuplicateSite(
  candidate: { name: string; city: string | null },
  existing: { id: string; name: string; city: string | null }[],
): { id: string; name: string; city: string | null } | null {
  const key = normalizeSiteKey(candidate.name, candidate.city);
  if (!candidate.name.trim()) return null;
  return existing.find((site) => normalizeSiteKey(site.name, site.city) === key) ?? null;
}

export type SalesListRow = {
  id: string;
  salesStatus: SalesStatus;
  segment: CustomerSegment | null;
  salesOwnerId: string | null;
  nextFollowUpOn: string | null;
  salesStatusChangedAt: string | null;
};

export function salesOverview(rows: SalesListRow[], today: string, month: string) {
  return {
    openProspects: rows.filter((row) =>
      (OPEN_PROSPECT_STATUSES as readonly SalesStatus[]).includes(row.salesStatus),
    ).length,
    followUpsDue: rows.filter(
      (row) =>
        row.salesStatus !== "not_relevant" &&
        Boolean(row.nextFollowUpOn) &&
        (row.nextFollowUpOn as string) <= today,
    ).length,
    tastings: rows.filter((row) => row.salesStatus === "tasting").length,
    newCustomersThisMonth: rows.filter(
      (row) =>
        row.salesStatus === "active_customer" &&
        Boolean(row.salesStatusChangedAt?.startsWith(month)),
    ).length,
  };
}

export function matchesSalesFilter(
  row: SalesListRow & { name: string },
  filter: {
    query: string;
    segment: CustomerSegment | "";
    status: SalesStatus | "";
    ownerId: string;
    followUp: "" | "due" | "none";
    today: string;
  },
): boolean {
  const query = filter.query.trim().toLowerCase();
  if (query && !row.name.toLowerCase().includes(query)) return false;
  if (filter.segment && row.segment !== filter.segment) return false;
  if (filter.status && row.salesStatus !== filter.status) return false;
  if (filter.ownerId && row.salesOwnerId !== filter.ownerId) return false;
  if (filter.followUp === "due") {
    if (
      !row.nextFollowUpOn ||
      row.nextFollowUpOn > filter.today ||
      row.salesStatus === "not_relevant"
    ) {
      return false;
    }
  }
  if (filter.followUp === "none" && row.nextFollowUpOn) return false;
  return true;
}

export function newDeliverySiteRow(input: {
  name: string;
  segment: CustomerSegment | null;
  city: string;
  deliveryAddress: string;
  active: boolean;
  salesOwnerId: string | null;
  nextFollowUpOn: string | null;
  legalEntityId: string | null;
}) {
  const city = input.city.trim() || null;
  return {
    name: input.name.trim(),
    type: "venue" as const,
    segment: input.segment,
    city,
    location: city,
    delivery_address: input.deliveryAddress.trim() || null,
    sales_status: "prospect" as const,
    sales_owner_id: input.salesOwnerId,
    next_follow_up_on: input.nextFollowUpOn,
    legal_entity_id: input.legalEntityId,
    active: input.active,
    partnership_level: null,
    supplied_by_customer_id: null,
    public_visible: false,
    public_profile: null,
  };
}
