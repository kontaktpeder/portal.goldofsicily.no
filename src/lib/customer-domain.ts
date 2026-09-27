export const CUSTOMER_TYPES = ["venue", "wholesaler"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const PARTNERSHIP_LEVELS = ["gold_partner", "gold_supply"] as const;
export type PartnershipLevel = (typeof PARTNERSHIP_LEVELS)[number] | null;

export const PUBLIC_PROFILES = ["listing", "partner"] as const;
export type PublicProfile = (typeof PUBLIC_PROFILES)[number] | null;

export type CustomerFacts = {
  id: string;
  type: CustomerType;
  partnershipLevel: PartnershipLevel;
  suppliedByCustomerId: string | null;
  suppliedByType: CustomerType | null;
  publicVisible: boolean;
  publicProfile: PublicProfile;
  slug: string | null;
};

export function customerInvariantError(customer: CustomerFacts): string | null {
  if (customer.suppliedByCustomerId === customer.id) {
    return "supplied_by_customer_id cannot reference itself";
  }
  if (customer.type === "wholesaler") {
    if (customer.publicProfile !== null || customer.publicVisible || customer.slug) {
      return "a wholesaler has no public venue page";
    }
    if (customer.suppliedByCustomerId) {
      return "supplied_by_customer_id is only for venues";
    }
    return null;
  }
  if (customer.suppliedByCustomerId && customer.suppliedByType !== "wholesaler") {
    return "supplied_by_customer_id must reference a wholesaler";
  }
  if (customer.publicProfile && !PUBLIC_PROFILES.includes(customer.publicProfile)) {
    return "invalid public_profile";
  }
  return null;
}

export function handoverRecipient(input: {
  customerId: string | null;
  customerName: string | null;
  companySnapshot: string;
}): { customerId: string; recipientCompany: string } | null {
  if (!input.customerId) return null;
  const snapshot = input.companySnapshot.trim() || input.customerName?.trim() || "";
  if (!snapshot) return null;
  return { customerId: input.customerId, recipientCompany: snapshot };
}
