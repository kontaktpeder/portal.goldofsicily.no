/** Controlled admin actions for AI/MCP. Grok with the actions token is eier. */

const CUSTOMER_SEGMENTS = ["restaurant", "hotel", "event", "bar"] as const;
type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const ADMIN_ACTION_TYPES = [
  "create_delivery_draft",
  "validate_delivery",
  "create_correction_lot",
  "set_customer_price",
  "approve_delivery",
  "register_priced_delivery",
  "list_accounting_discrepancies",
  "mark_legacy_delivery",
  "create_customer",
] as const;

export type AdminActionType = (typeof ADMIN_ACTION_TYPES)[number];

/** Commercial writes. Drift can approve the other actions; these stay eier. */
export const OWNER_ACTION_TYPES = ["create_customer"] as const;

export function isOwnerActionType(value: string): boolean {
  return (OWNER_ACTION_TYPES as readonly string[]).includes(value);
}

export type ActionAccess = "none" | "propose" | "owner";

/**
 * The actions token is eier unless a separate owner token is configured.
 * Then the actions token can only propose, and the owner token can execute.
 */
export function actionAccess(input: {
  authorizationHeader: string | null;
  actionsToken?: string;
  ownerToken?: string;
}): ActionAccess {
  const header = input.authorizationHeader ?? "";
  if (!header.startsWith("Bearer ")) return "none";
  const token = header.slice("Bearer ".length);
  if (!token) return "none";
  const ownerToken = input.ownerToken?.trim() || undefined;
  const actionsToken = input.actionsToken?.trim() || undefined;
  if (ownerToken && token === ownerToken) return "owner";
  if (actionsToken && token === actionsToken) return ownerToken ? "propose" : "owner";
  return "none";
}

export type AdminActionStatus =
  "proposed" | "validated" | "rejected" | "approved" | "executed" | "failed";

export type ValidationIssue = {
  code: string;
  message: string;
  blocking: boolean;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

export type DeliveryLineInput = {
  productId: string;
  quantity: number;
  goldLotId?: string | null;
  sourceHandoverId?: string | null;
};

export type EnsurePriceInput = {
  productId: string;
  priceOre: number;
  validFrom?: string;
};

export type CorrectionLotInput = {
  productId: string;
  productionDate: string;
  producedQty: number;
  approvedQty?: number;
  lotLetter?: string;
  note?: string;
};

export type RegisterPricedDeliveryPayload = {
  customerId: string;
  deliveredOn: string;
  note?: string;
  deliveredBy?: string | null;
  ensurePrices?: EnsurePriceInput[];
  createLots?: CorrectionLotInput[];
  lines: DeliveryLineInput[];
};

export type SetCustomerPricePayload = {
  customerId: string;
  productId: string;
  priceOre: number;
  validFrom: string;
  validTo?: string | null;
};

export type CreateCorrectionLotPayload = CorrectionLotInput & {
  rationale?: string;
};

export type ApproveDeliveryPayload = {
  draftId: string;
};

export type CreateDeliveryDraftPayload = {
  customerId: string;
  deliveredOn: string;
  note?: string;
  deliveredBy?: string | null;
  lines: DeliveryLineInput[];
};

export type MarkLegacyDeliveryPayload = {
  deliveryId: string;
  rationale: string;
  documentation?: string;
};

export type CreateCustomerPayload = {
  name: string;
  city: string | null;
  segment: CustomerSegment | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  nextFollowUpOn: string | null;
  legalEntityId: string | null;
  notes: string | null;
  confirmDuplicate: boolean;
};

export function isAdminActionType(value: string): value is AdminActionType {
  return (ADMIN_ACTION_TYPES as readonly string[]).includes(value);
}

export function issue(code: string, message: string, blocking = true): ValidationIssue {
  return { code, message, blocking };
}

export function validationOf(issues: ValidationIssue[]): ValidationResult {
  return { ok: !issues.some((row) => row.blocking), issues };
}

export function requireUuid(value: unknown, field: string): ValidationIssue | null {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    return issue("invalid_uuid", `${field} must be a uuid`);
  }
  return null;
}

export function requireDate(value: unknown, field: string): ValidationIssue | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return issue("invalid_date", `${field} must be YYYY-MM-DD`);
  }
  return null;
}

export function requirePositiveInt(value: unknown, field: string): ValidationIssue | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return issue("invalid_quantity", `${field} must be a positive integer`);
  }
  return null;
}

export function parseRegisterPricedDelivery(payload: unknown): {
  data?: RegisterPricedDeliveryPayload;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (!payload || typeof payload !== "object") {
    return { issues: [issue("invalid_payload", "payload must be an object")] };
  }
  const row = payload as Record<string, unknown>;
  const customerId = row.customerId ?? row.customer_id;
  const deliveredOn = row.deliveredOn ?? row.delivered_on;
  const note = typeof row.note === "string" ? row.note : undefined;
  const deliveredBy = (row.deliveredBy ?? row.delivered_by) as string | null | undefined;
  const customerIssue = requireUuid(customerId, "customerId");
  if (customerIssue) issues.push(customerIssue);
  const dateIssue = requireDate(deliveredOn, "deliveredOn");
  if (dateIssue) issues.push(dateIssue);

  const ensurePricesRaw = row.ensurePrices ?? row.ensure_prices;
  const ensurePrices: EnsurePriceInput[] = [];
  if (ensurePricesRaw != null) {
    if (!Array.isArray(ensurePricesRaw)) {
      issues.push(issue("invalid_prices", "ensurePrices must be an array"));
    } else {
      for (const entry of ensurePricesRaw) {
        if (!entry || typeof entry !== "object") {
          issues.push(issue("invalid_prices", "ensurePrices entries must be objects"));
          continue;
        }
        const price = entry as Record<string, unknown>;
        const productId = price.productId ?? price.product_id;
        const priceOre = price.priceOre ?? price.price_ore;
        const validFrom = price.validFrom ?? price.valid_from ?? deliveredOn;
        const pIssue = requireUuid(productId, "ensurePrices.productId");
        if (pIssue) issues.push(pIssue);
        if (typeof priceOre !== "number" || !Number.isInteger(priceOre) || priceOre <= 0) {
          issues.push(issue("invalid_price", "ensurePrices.priceOre must be positive øre"));
        }
        const dIssue = requireDate(validFrom, "ensurePrices.validFrom");
        if (dIssue) issues.push(dIssue);
        if (!pIssue && !dIssue && typeof priceOre === "number" && priceOre > 0) {
          ensurePrices.push({
            productId: String(productId),
            priceOre,
            validFrom: String(validFrom),
          });
        }
      }
    }
  }

  const createLotsRaw = row.createLots ?? row.create_lots;
  const createLots: CorrectionLotInput[] = [];
  if (createLotsRaw != null) {
    if (!Array.isArray(createLotsRaw)) {
      issues.push(issue("invalid_lots", "createLots must be an array"));
    } else {
      for (const entry of createLotsRaw) {
        const parsed = parseCorrectionLot(entry);
        issues.push(...parsed.issues);
        if (parsed.data) createLots.push(parsed.data);
      }
    }
  }

  const createLotProductIds = new Set(createLots.map((lot) => lot.productId));
  const linesRaw = row.lines;
  const lines: DeliveryLineInput[] = [];
  if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
    issues.push(issue("missing_lines", "lines are required"));
  } else {
    for (const entry of linesRaw) {
      if (!entry || typeof entry !== "object") {
        issues.push(issue("invalid_line", "each line must be an object"));
        continue;
      }
      const line = entry as Record<string, unknown>;
      const productId = line.productId ?? line.product_id;
      const quantity = line.quantity;
      const goldLotId = line.goldLotId ?? line.gold_lot_id;
      const sourceHandoverId = line.sourceHandoverId ?? line.source_handover_id;
      const pIssue = requireUuid(productId, "lines.productId");
      if (pIssue) issues.push(pIssue);
      const qIssue = requirePositiveInt(quantity, "lines.quantity");
      if (qIssue) issues.push(qIssue);
      const hasLot = goldLotId != null && goldLotId !== "";
      if (hasLot) {
        const lIssue = requireUuid(goldLotId, "lines.goldLotId");
        if (lIssue) issues.push(lIssue);
      } else if (typeof productId !== "string" || !createLotProductIds.has(productId)) {
        issues.push(
          issue(
            "missing_lot",
            "each delivery line requires goldLotId (or a matching createLots entry)",
          ),
        );
      }
      if (!pIssue && !qIssue && typeof productId === "string" && typeof quantity === "number") {
        lines.push({
          productId,
          quantity,
          goldLotId: hasLot && typeof goldLotId === "string" ? goldLotId : null,
          sourceHandoverId:
            typeof sourceHandoverId === "string" && sourceHandoverId ? sourceHandoverId : null,
        });
      }
    }
  }

  if (issues.some((row) => row.blocking)) return { issues };
  return {
    issues,
    data: {
      customerId: String(customerId),
      deliveredOn: String(deliveredOn),
      note,
      deliveredBy: deliveredBy ?? null,
      ensurePrices,
      createLots,
      lines,
    },
  };
}

export function parseSetCustomerPrice(payload: unknown): {
  data?: SetCustomerPricePayload;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (!payload || typeof payload !== "object") {
    return { issues: [issue("invalid_payload", "payload must be an object")] };
  }
  const row = payload as Record<string, unknown>;
  const customerId = row.customerId ?? row.customer_id;
  const productId = row.productId ?? row.product_id;
  const priceOre = row.priceOre ?? row.price_ore;
  const validFrom = row.validFrom ?? row.valid_from;
  const validTo = row.validTo ?? row.valid_to ?? null;
  for (const check of [
    requireUuid(customerId, "customerId"),
    requireUuid(productId, "productId"),
    requireDate(validFrom, "validFrom"),
  ]) {
    if (check) issues.push(check);
  }
  if (typeof priceOre !== "number" || !Number.isInteger(priceOre) || priceOre <= 0) {
    issues.push(issue("invalid_price", "priceOre must be positive øre"));
  }
  if (validTo != null && validTo !== "") {
    const toIssue = requireDate(validTo, "validTo");
    if (toIssue) issues.push(toIssue);
  }
  if (issues.length) return { issues };
  return {
    issues,
    data: {
      customerId: String(customerId),
      productId: String(productId),
      priceOre: Number(priceOre),
      validFrom: String(validFrom),
      validTo: validTo ? String(validTo) : null,
    },
  };
}

export function parseCorrectionLot(payload: unknown): {
  data?: CorrectionLotInput;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (!payload || typeof payload !== "object") {
    return { issues: [issue("invalid_payload", "lot payload must be an object")] };
  }
  const row = payload as Record<string, unknown>;
  const productId = row.productId ?? row.product_id;
  const productionDate = row.productionDate ?? row.production_date;
  const producedQty = row.producedQty ?? row.produced_qty;
  const approvedQty = row.approvedQty ?? row.approved_qty ?? producedQty;
  const lotLetter = row.lotLetter ?? row.lot_letter;
  const note = typeof row.note === "string" ? row.note : undefined;
  const pIssue = requireUuid(productId, "productId");
  if (pIssue) issues.push(pIssue);
  const dIssue = requireDate(productionDate, "productionDate");
  if (dIssue) issues.push(dIssue);
  const qIssue = requirePositiveInt(producedQty, "producedQty");
  if (qIssue) issues.push(qIssue);
  if (approvedQty != null) {
    const aIssue = requirePositiveInt(approvedQty, "approvedQty");
    if (aIssue) issues.push(aIssue);
    else if (typeof producedQty === "number" && Number(approvedQty) > producedQty) {
      issues.push(issue("approved_gt_produced", "approvedQty cannot exceed producedQty"));
    }
  }
  if (issues.length) return { issues };
  return {
    issues,
    data: {
      productId: String(productId),
      productionDate: String(productionDate),
      producedQty: Number(producedQty),
      approvedQty: Number(approvedQty ?? producedQty),
      lotLetter: typeof lotLetter === "string" ? lotLetter : undefined,
      note,
    },
  };
}

export function parseCreateDeliveryDraft(payload: unknown): {
  data?: CreateDeliveryDraftPayload;
  issues: ValidationIssue[];
} {
  const parsed = parseRegisterPricedDelivery(payload);
  if (!parsed.data) return { issues: parsed.issues };
  return {
    issues: parsed.issues,
    data: {
      customerId: parsed.data.customerId,
      deliveredOn: parsed.data.deliveredOn,
      note: parsed.data.note,
      deliveredBy: parsed.data.deliveredBy,
      lines: parsed.data.lines,
    },
  };
}

export function parseApproveDelivery(payload: unknown): {
  data?: ApproveDeliveryPayload;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (!payload || typeof payload !== "object") {
    return { issues: [issue("invalid_payload", "payload must be an object")] };
  }
  const draftId =
    (payload as Record<string, unknown>).draftId ?? (payload as Record<string, unknown>).draft_id;
  const idIssue = requireUuid(draftId, "draftId");
  if (idIssue) issues.push(idIssue);
  if (issues.length) return { issues };
  return { issues, data: { draftId: String(draftId) } };
}

export function parseMarkLegacyDelivery(payload: unknown): {
  data?: MarkLegacyDeliveryPayload;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (!payload || typeof payload !== "object") {
    return { issues: [issue("invalid_payload", "payload must be an object")] };
  }
  const row = payload as Record<string, unknown>;
  const deliveryId = row.deliveryId ?? row.delivery_id;
  const rationale = row.rationale ?? row.reason;
  const documentation =
    typeof row.documentation === "string"
      ? row.documentation
      : typeof row.evidence === "string"
        ? row.evidence
        : undefined;
  const idIssue = requireUuid(deliveryId, "deliveryId");
  if (idIssue) issues.push(idIssue);
  if (typeof rationale !== "string" || rationale.trim().length < 8) {
    issues.push(issue("invalid_rationale", "rationale must be at least 8 characters"));
  }
  if (issues.length) return { issues };
  return {
    issues,
    data: {
      deliveryId: String(deliveryId),
      rationale: String(rationale).trim(),
      documentation: documentation?.trim() || undefined,
    },
  };
}

function optionalText(
  row: Record<string, unknown>,
  keys: string[],
  field: string,
  issues: ValidationIssue[],
): string | null {
  const key = keys.find((candidate) => row[candidate] != null && row[candidate] !== "");
  if (!key) return null;
  const value = row[key];
  if (typeof value !== "string") {
    issues.push(issue("invalid_field", `${field} must be text`));
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseCreateCustomer(payload: unknown): {
  data?: CreateCustomerPayload;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  if (!payload || typeof payload !== "object") {
    return { issues: [issue("invalid_payload", "payload must be an object")] };
  }
  const row = payload as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name || name.length > 160) {
    issues.push(issue("invalid_name", "name is required"));
  }
  const city = optionalText(row, ["city"], "city", issues);
  let segment: CustomerSegment | null = null;
  if (row.segment != null && row.segment !== "") {
    if (
      typeof row.segment !== "string" ||
      !(CUSTOMER_SEGMENTS as readonly string[]).includes(row.segment)
    ) {
      issues.push(issue("invalid_segment", "segment must be restaurant, hotel, event or bar"));
    } else {
      segment = row.segment as CustomerSegment;
    }
  }
  const contactName = optionalText(row, ["contactName", "contact_name"], "contactName", issues);
  const phone = optionalText(row, ["phone"], "phone", issues);
  const email = optionalText(row, ["email"], "email", issues);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push(issue("invalid_email", "email must look like an email address"));
  }
  let active = false;
  if (row.active != null) {
    if (typeof row.active !== "boolean") {
      issues.push(issue("invalid_active", "active must be true or false"));
    } else {
      active = row.active;
    }
  }
  const followRaw = row.nextFollowUpOn ?? row.next_follow_up_on;
  let nextFollowUpOn: string | null = null;
  if (followRaw != null && followRaw !== "") {
    const dateIssue = requireDate(followRaw, "nextFollowUpOn");
    if (dateIssue) issues.push(dateIssue);
    else nextFollowUpOn = String(followRaw);
  }
  const legalRaw = row.legalEntityId ?? row.legal_entity_id;
  let legalEntityId: string | null = null;
  if (legalRaw != null && legalRaw !== "") {
    const idIssue = requireUuid(legalRaw, "legalEntityId");
    if (idIssue) issues.push(idIssue);
    else legalEntityId = String(legalRaw);
  }
  const notes = optionalText(row, ["notes"], "notes", issues);
  const confirmRaw = row.confirmDuplicate ?? row.confirm_duplicate ?? false;
  if (typeof confirmRaw !== "boolean") {
    issues.push(issue("invalid_confirm", "confirmDuplicate must be true or false"));
  }
  if (issues.some((item) => item.blocking)) return { issues };
  return {
    issues,
    data: {
      name,
      city,
      segment,
      contactName,
      phone,
      email,
      active,
      nextFollowUpOn,
      legalEntityId,
      notes,
      confirmDuplicate: confirmRaw === true,
    },
  };
}

/** Remaining on a lot after handovers and linked deliveries (approved basis). */
export function lotRemainingForAllocation(input: {
  producedQty: number;
  approvedQty: number | null;
  deliveredQty: number;
  villaHandoverQty: number;
}): number {
  const base = input.approvedQty == null ? input.producedQty : input.approvedQty;
  return Math.max(0, base - input.villaHandoverQty - input.deliveredQty);
}

export function nextActionStatusAfterValidation(
  current: AdminActionStatus,
  ok: boolean,
): AdminActionStatus {
  if (current === "rejected" || current === "executed" || current === "approved") return current;
  return ok ? "validated" : "proposed";
}
