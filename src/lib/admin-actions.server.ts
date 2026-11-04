import type { SupabaseClient } from "@supabase/supabase-js";
import {
  issue,
  lotRemainingForAllocation,
  parseApproveDelivery,
  parseCorrectionLot,
  parseCreateDeliveryDraft,
  parseMarkLegacyDelivery,
  parseRegisterPricedDelivery,
  parseSetCustomerPrice,
  validationOf,
  type AdminActionType,
  type CorrectionLotInput,
  type DeliveryLineInput,
  type RegisterPricedDeliveryPayload,
  type SetCustomerPricePayload,
  type ValidationIssue,
  type ValidationResult,
} from "@/lib/admin-actions";

type Admin = SupabaseClient;

async function logEvent(
  admin: Admin,
  proposalId: string,
  eventType: string,
  actor: string,
  actorUserId: string | null,
  detail: Record<string, unknown> = {},
) {
  await admin.from("admin_action_events").insert({
    proposal_id: proposalId,
    event_type: eventType,
    actor,
    actor_user_id: actorUserId,
    detail,
  });
}

export async function listAccountingDiscrepancies(admin: Admin) {
  const { data, error } = await admin.from("ai_read.accounting_discrepancies" as never).select("*");
  // Schema-qualified views may need raw SQL via rpc; fall back to direct checks.
  if (!error && data) return data;

  const [missingLot, portalSum, accounting, unpriced] = await Promise.all([
    admin
      .from("delivery_lines")
      .select("quantity, gold_lot_id, deliveries!inner(legacy_without_lot)")
      .gt("quantity", 0)
      .is("gold_lot_id", null),
    admin.from("delivery_lines").select("quantity"),
    admin.from("accounting_revenue_periods").select("delivered_pcs").eq("active", true).limit(1),
    admin
      .from("delivery_lines")
      .select("quantity, unit_price_ore, deliveries!inner(commercial_route, legacy_without_lot)")
      .gt("quantity", 0)
      .is("unit_price_ore", null),
  ]);

  const unresolvedMissingLotQty = (missingLot.data ?? [])
    .filter((row) => {
      const delivery = Array.isArray(row.deliveries) ? row.deliveries[0] : row.deliveries;
      return !delivery?.legacy_without_lot;
    })
    .reduce((sum, row) => sum + row.quantity, 0);
  const legacyMissingLotQty = (missingLot.data ?? [])
    .filter((row) => {
      const delivery = Array.isArray(row.deliveries) ? row.deliveries[0] : row.deliveries;
      return Boolean(delivery?.legacy_without_lot);
    })
    .reduce((sum, row) => sum + row.quantity, 0);
  const portalPcs = (portalSum.data ?? []).reduce((sum, row) => sum + row.quantity, 0);
  const accountingPcs = accounting.data?.[0]?.delivered_pcs ?? 0;
  const unpricedDirect = (unpriced.data ?? [])
    .filter((row) => {
      const delivery = Array.isArray(row.deliveries) ? row.deliveries[0] : row.deliveries;
      return delivery?.commercial_route === "direct" && !delivery?.legacy_without_lot;
    })
    .reduce((sum, row) => sum + row.quantity, 0);

  return [
    unresolvedMissingLotQty > 0
      ? {
          code: "missing_lot_link",
          description: "Leveringslinjer uten gold_lot_id (ikke merket legacy)",
          quantity: unresolvedMissingLotQty,
          remediation:
            "Koble linjene til LOT, lag korrigerings-LOT, eller merk legacy med mark_legacy_delivery.",
        }
      : null,
    legacyMissingLotQty > 0
      ? {
          code: "legacy_without_lot",
          description: "Legacy-leveranser uten LOT (merket)",
          quantity: legacyMissingLotQty,
          remediation: "Informativt. Holdes utenfor ok_for_inventory.",
        }
      : null,
    accountingPcs - portalPcs !== 0
      ? {
          code: "portal_vs_accounting_delivered",
          description: "Faktisk levert (regnskap) minus portal-leveranser",
          quantity: accountingPcs - portalPcs,
          remediation: "Registrer manglende leveranser.",
        }
      : null,
    unpricedDirect > 0
      ? {
          code: "unpriced_direct_deliveries",
          description: "Direkte leveringslinjer uten unit_price_ore",
          quantity: unpricedDirect,
          remediation: "Sett kundepris (set_customer_price) før direkte levering.",
        }
      : null,
  ].filter(Boolean);
}

async function loadLotStock(admin: Admin, lotId: string) {
  const { data: lot, error } = await admin
    .from("gold_lots")
    .select(
      "id, product_id, produced_qty, approved_qty, status, lot_code, delivery_lines(quantity, source_handover_id), gold_lot_handovers(quantity, ownership_after_handover)",
    )
    .eq("id", lotId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lot) return null;
  const deliveredQty = (lot.delivery_lines ?? [])
    .filter((line) => line.source_handover_id == null)
    .reduce((sum, line) => sum + line.quantity, 0);
  const villaHandoverQty = (lot.gold_lot_handovers ?? [])
    .filter((row) => row.ownership_after_handover === "villa")
    .reduce((sum, row) => sum + row.quantity, 0);
  return {
    id: lot.id,
    productId: lot.product_id,
    lotCode: lot.lot_code,
    status: lot.status,
    remaining: lotRemainingForAllocation({
      producedQty: lot.produced_qty,
      approvedQty: lot.approved_qty,
      deliveredQty,
      villaHandoverQty,
    }),
  };
}

export async function validateRegisterPricedDelivery(
  admin: Admin,
  payload: RegisterPricedDeliveryPayload,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("id, name, type, supplied_by_customer_id, active")
    .eq("id", payload.customerId)
    .maybeSingle();
  if (customerError) throw new Error(customerError.message);
  if (!customer) issues.push(issue("customer_missing", "customer not found"));
  else if (!customer.active) issues.push(issue("customer_inactive", "customer is inactive"));

  const viaWholesaler = Boolean(customer?.supplied_by_customer_id);
  if (!viaWholesaler) {
    for (const line of payload.lines) {
      const ensure = payload.ensurePrices?.find((row) => row.productId === line.productId);
      const { data: price } = await admin
        .from("customer_product_prices")
        .select("id, price_ore, valid_from, valid_to")
        .eq("customer_id", payload.customerId)
        .eq("product_id", line.productId)
        .lte("valid_from", payload.deliveredOn)
        .or(`valid_to.is.null,valid_to.gte.${payload.deliveredOn}`)
        .order("valid_from", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!price && !ensure) {
        issues.push(
          issue(
            "missing_price",
            `No price for product ${line.productId} on ${payload.deliveredOn}. Add ensurePrices or set_customer_price first.`,
          ),
        );
      }
    }
  }

  const createLotsByProduct = new Map<string, number>();
  for (const lot of payload.createLots ?? []) {
    createLotsByProduct.set(
      lot.productId,
      (createLotsByProduct.get(lot.productId) ?? 0) + (lot.approvedQty ?? lot.producedQty),
    );
  }

  for (const line of payload.lines) {
    if (!line.goldLotId) {
      const createdQty = createLotsByProduct.get(line.productId) ?? 0;
      if (createdQty >= line.quantity) {
        createLotsByProduct.set(line.productId, createdQty - line.quantity);
        continue;
      }
      issues.push(
        issue(
          "missing_lot",
          "goldLotId is required on each line (or createLots must cover the quantity)",
        ),
      );
      continue;
    }
    const stock = await loadLotStock(admin, line.goldLotId);
    if (!stock) {
      issues.push(issue("lot_missing", `LOT ${line.goldLotId} not found`));
      continue;
    }
    if (stock.productId !== line.productId) {
      issues.push(issue("lot_product_mismatch", `LOT ${stock.lotCode} is another flavor`));
    }
    if (stock.status === "closed" || stock.status === "recalled") {
      issues.push(issue("lot_closed", `LOT ${stock.lotCode} is not open`));
    }
    if (line.quantity > stock.remaining) {
      issues.push(
        issue(
          "insufficient_stock",
          `LOT ${stock.lotCode} has ${stock.remaining} left, need ${line.quantity}`,
        ),
      );
    }
  }

  return validationOf(issues);
}

async function ensurePrices(
  admin: Admin,
  customerId: string,
  prices: { productId: string; priceOre: number; validFrom?: string }[],
) {
  const created: string[] = [];
  for (const price of prices) {
    const validFrom = price.validFrom ?? new Date().toISOString().slice(0, 10);
    const { data: existing } = await admin
      .from("customer_product_prices")
      .select("id")
      .eq("customer_id", customerId)
      .eq("product_id", price.productId)
      .eq("valid_from", validFrom)
      .maybeSingle();
    if (existing) continue;
    const { data, error } = await admin
      .from("customer_product_prices")
      .insert({
        customer_id: customerId,
        product_id: price.productId,
        price_ore: price.priceOre,
        valid_from: validFrom,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    created.push(data.id);
  }
  return created;
}

async function createCorrectionLot(admin: Admin, input: CorrectionLotInput) {
  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, lot_letter")
    .eq("id", input.productId)
    .maybeSingle();
  if (productError) throw new Error(productError.message);
  if (!product) throw new Error("product not found");

  const letter = (input.lotLetter ?? product.lot_letter ?? "X").slice(0, 1).toUpperCase();
  const { data: code, error: codeError } = await admin.rpc("next_gold_lot_code", {
    p_production_date: input.productionDate,
    p_lot_letter: letter,
  });
  if (codeError) throw new Error(codeError.message);

  const { data: lot, error } = await admin
    .from("gold_lots")
    .insert({
      lot_code: code,
      production_date: input.productionDate,
      product_id: input.productId,
      produced_qty: input.producedQty,
      approved_qty: input.approvedQty ?? input.producedQty,
      status: "produced",
      deviation_notes: input.note ?? "Korrigerings-LOT via admin action",
    })
    .select("id, lot_code")
    .single();
  if (error) throw new Error(error.message);
  return lot as { id: string; lot_code: string };
}

async function createDeliveryDraft(
  admin: Admin,
  input: {
    customerId: string;
    deliveredOn: string;
    note?: string;
    deliveredBy?: string | null;
    lines: DeliveryLineInput[];
    proposalId?: string | null;
  },
) {
  const { data: draft, error } = await admin
    .from("delivery_drafts")
    .insert({
      proposal_id: input.proposalId ?? null,
      customer_id: input.customerId,
      delivered_on: input.deliveredOn,
      note: input.note ?? null,
      delivered_by: input.deliveredBy ?? null,
      status: "ready",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const lines = input.lines.map((line) => ({
    draft_id: draft.id,
    product_id: line.productId,
    quantity: line.quantity,
    gold_lot_id: line.goldLotId ?? null,
    source_handover_id: line.sourceHandoverId ?? null,
  }));
  const { error: lineError } = await admin.from("delivery_draft_lines").insert(lines);
  if (lineError) {
    await admin.from("delivery_drafts").delete().eq("id", draft.id);
    throw new Error(lineError.message);
  }
  return draft.id as string;
}

async function commitDeliveryDraft(admin: Admin, draftId: string) {
  const { data: draft, error } = await admin
    .from("delivery_drafts")
    .select("*, delivery_draft_lines(*)")
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error("draft not found");
  if (draft.status === "committed" && draft.committed_delivery_id) {
    return draft.committed_delivery_id as string;
  }
  if (draft.status === "cancelled") throw new Error("draft is cancelled");

  const lines = (draft.delivery_draft_lines ?? []) as Array<{
    product_id: string;
    quantity: number;
    gold_lot_id: string | null;
    source_handover_id: string | null;
  }>;
  if (lines.length === 0) throw new Error("draft has no lines");
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);

  const { data: delivery, error: deliveryError } = await admin
    .from("deliveries")
    .insert({
      customer_id: draft.customer_id,
      quantity: total,
      delivered_at: draft.delivered_on,
      note: draft.note,
      delivered_by: draft.delivered_by,
    })
    .select("id")
    .single();
  if (deliveryError) throw new Error(deliveryError.message);

  const { error: linesError } = await admin.from("delivery_lines").insert(
    lines.map((line) => ({
      delivery_id: delivery.id,
      product_id: line.product_id,
      quantity: line.quantity,
      gold_lot_id: line.gold_lot_id,
      source_handover_id: line.source_handover_id,
    })),
  );
  if (linesError) {
    await admin.from("deliveries").delete().eq("id", delivery.id);
    throw new Error(linesError.message);
  }

  const { error: updateError } = await admin
    .from("delivery_drafts")
    .update({ status: "committed", committed_delivery_id: delivery.id })
    .eq("id", draftId);
  if (updateError) throw new Error(updateError.message);
  return delivery.id as string;
}

export async function validateProposal(
  admin: Admin,
  actionType: AdminActionType,
  payload: unknown,
): Promise<ValidationResult> {
  if (actionType === "list_accounting_discrepancies") {
    return validationOf([]);
  }
  if (actionType === "set_customer_price") {
    const parsed = parseSetCustomerPrice(payload);
    if (!parsed.data) return validationOf(parsed.issues);
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("id", parsed.data.customerId)
      .maybeSingle();
    const { data: product } = await admin
      .from("products")
      .select("id")
      .eq("id", parsed.data.productId)
      .maybeSingle();
    const issues = [...parsed.issues];
    if (!customer) issues.push(issue("customer_missing", "customer not found"));
    if (!product) issues.push(issue("product_missing", "product not found"));
    return validationOf(issues);
  }
  if (actionType === "create_correction_lot") {
    const parsed = parseCorrectionLot(payload);
    if (!parsed.data) return validationOf(parsed.issues);
    const { data: product } = await admin
      .from("products")
      .select("id")
      .eq("id", parsed.data.productId)
      .maybeSingle();
    const issues = [...parsed.issues];
    if (!product) issues.push(issue("product_missing", "product not found"));
    return validationOf(issues);
  }
  if (actionType === "create_delivery_draft" || actionType === "validate_delivery") {
    const parsed = parseCreateDeliveryDraft(payload);
    if (!parsed.data) return validationOf(parsed.issues);
    return validateRegisterPricedDelivery(admin, { ...parsed.data, ensurePrices: [], createLots: [] });
  }
  if (actionType === "approve_delivery") {
    const parsed = parseApproveDelivery(payload);
    if (!parsed.data) return validationOf(parsed.issues);
    const { data: draft } = await admin
      .from("delivery_drafts")
      .select("id, status, customer_id, delivered_on, delivery_draft_lines(*)")
      .eq("id", parsed.data.draftId)
      .maybeSingle();
    if (!draft) return validationOf([issue("draft_missing", "delivery draft not found")]);
    if (draft.status === "cancelled") {
      return validationOf([issue("draft_cancelled", "delivery draft is cancelled")]);
    }
    if (draft.status === "committed") return validationOf([]);
    const lines = ((draft.delivery_draft_lines ?? []) as Array<{
      product_id: string;
      quantity: number;
      gold_lot_id: string | null;
      source_handover_id: string | null;
    }>).map((line) => ({
      productId: line.product_id,
      quantity: line.quantity,
      goldLotId: line.gold_lot_id,
      sourceHandoverId: line.source_handover_id,
    }));
    if (lines.length === 0) {
      return validationOf([issue("draft_empty", "delivery draft has no lines")]);
    }
    return validateRegisterPricedDelivery(admin, {
      customerId: draft.customer_id,
      deliveredOn: draft.delivered_on,
      lines,
    });
  }
  if (actionType === "register_priced_delivery") {
    const parsed = parseRegisterPricedDelivery(payload);
    if (!parsed.data) return validationOf(parsed.issues);
    return validateRegisterPricedDelivery(admin, parsed.data);
  }
  if (actionType === "mark_legacy_delivery") {
    const parsed = parseMarkLegacyDelivery(payload);
    if (!parsed.data) return validationOf(parsed.issues);
    const { data: delivery, error } = await admin
      .from("deliveries")
      .select("id, note, legacy_without_lot, delivery_lines(quantity, gold_lot_id)")
      .eq("id", parsed.data.deliveryId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const issues = [...parsed.issues];
    if (!delivery) {
      issues.push(issue("delivery_missing", "delivery not found"));
      return validationOf(issues);
    }
    if (delivery.legacy_without_lot) {
      issues.push(issue("already_legacy", "delivery is already marked legacy_without_lot", false));
    }
    const lines = (delivery.delivery_lines ?? []) as Array<{
      quantity: number;
      gold_lot_id: string | null;
    }>;
    const missingLotLines = lines.filter((line) => line.quantity > 0 && line.gold_lot_id == null);
    if (missingLotLines.length === 0) {
      issues.push(
        issue("no_missing_lot_lines", "delivery has no lines without gold_lot_id to mark as legacy"),
      );
    }
    return validationOf(issues);
  }
  return validationOf([issue("unknown_action", `unsupported action ${actionType}`)]);
}

export async function executeProposal(
  admin: Admin,
  actionType: AdminActionType,
  payload: unknown,
  proposalId: string,
): Promise<Record<string, unknown>> {
  if (actionType === "list_accounting_discrepancies") {
    return { discrepancies: await listAccountingDiscrepancies(admin) };
  }
  if (actionType === "set_customer_price") {
    const parsed = parseSetCustomerPrice(payload);
    if (!parsed.data) throw new Error(parsed.issues[0]?.message ?? "invalid payload");
    const ids = await ensurePrices(admin, parsed.data.customerId, [
      {
        productId: parsed.data.productId,
        priceOre: parsed.data.priceOre,
        validFrom: parsed.data.validFrom,
      },
    ]);
    return { priceIds: ids, ...parsed.data };
  }
  if (actionType === "create_correction_lot") {
    const parsed = parseCorrectionLot(payload);
    if (!parsed.data) throw new Error(parsed.issues[0]?.message ?? "invalid payload");
    const lot = await createCorrectionLot(admin, parsed.data);
    return { lotId: lot.id, lotCode: lot.lot_code };
  }
  if (actionType === "create_delivery_draft") {
    const parsed = parseCreateDeliveryDraft(payload);
    if (!parsed.data) throw new Error(parsed.issues[0]?.message ?? "invalid payload");
    const draftId = await createDeliveryDraft(admin, { ...parsed.data, proposalId });
    return { draftId };
  }
  if (actionType === "approve_delivery") {
    const parsed = parseApproveDelivery(payload);
    if (!parsed.data) throw new Error(parsed.issues[0]?.message ?? "invalid payload");
    const deliveryId = await commitDeliveryDraft(admin, parsed.data.draftId);
    return { deliveryId };
  }
  if (actionType === "validate_delivery") {
    const validation = await validateProposal(admin, "validate_delivery", payload);
    return { validation };
  }
  if (actionType === "register_priced_delivery") {
    const parsed = parseRegisterPricedDelivery(payload);
    if (!parsed.data) throw new Error(parsed.issues[0]?.message ?? "invalid payload");
    const priceIds = await ensurePrices(
      admin,
      parsed.data.customerId,
      parsed.data.ensurePrices ?? [],
    );
    const createdLots: { id: string; lot_code: string; productId: string }[] = [];
    for (const lot of parsed.data.createLots ?? []) {
      const created = await createCorrectionLot(admin, lot);
      createdLots.push({ ...created, productId: lot.productId });
    }
    const lines = parsed.data.lines.map((line) => {
      if (line.goldLotId) return line;
      const created = createdLots.find((lot) => lot.productId === line.productId);
      return created ? { ...line, goldLotId: created.id } : line;
    });
    const draftId = await createDeliveryDraft(admin, {
      customerId: parsed.data.customerId,
      deliveredOn: parsed.data.deliveredOn,
      note: parsed.data.note,
      deliveredBy: parsed.data.deliveredBy,
      lines,
      proposalId,
    });
    const deliveryId = await commitDeliveryDraft(admin, draftId);
    return {
      priceIds,
      lots: createdLots,
      draftId,
      deliveryId,
    };
  }
  if (actionType === "mark_legacy_delivery") {
    const parsed = parseMarkLegacyDelivery(payload);
    if (!parsed.data) throw new Error(parsed.issues[0]?.message ?? "invalid payload");
    const { data: delivery, error: loadError } = await admin
      .from("deliveries")
      .select("id, note, legacy_without_lot, delivery_lines(quantity, gold_lot_id)")
      .eq("id", parsed.data.deliveryId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!delivery) throw new Error("delivery not found");
    if (delivery.legacy_without_lot) {
      return { deliveryId: delivery.id, alreadyMarked: true };
    }
    const missingPcs = ((delivery.delivery_lines ?? []) as Array<{
      quantity: number;
      gold_lot_id: string | null;
    }>)
      .filter((line) => line.quantity > 0 && line.gold_lot_id == null)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (missingPcs <= 0) throw new Error("delivery has no lines without gold_lot_id");

    const rationaleBlock = [
      parsed.data.rationale,
      parsed.data.documentation ? `Dokumentasjon: ${parsed.data.documentation}` : null,
      `Merket legacy_without_lot via admin action (${proposalId}).`,
    ]
      .filter(Boolean)
      .join("\n");
    const existingNote = typeof delivery.note === "string" ? delivery.note.trim() : "";
    const nextNote = existingNote.includes("Legacy levering før nytt LOT-/pakkesystem")
      ? existingNote
      : [existingNote, "Legacy levering før nytt LOT-/pakkesystem"].filter(Boolean).join("\n");

    const { error } = await admin
      .from("deliveries")
      .update({
        legacy_without_lot: true,
        legacy_marked_at: new Date().toISOString(),
        legacy_rationale: rationaleBlock,
        note: nextNote,
      })
      .eq("id", parsed.data.deliveryId);
    if (error) throw new Error(error.message);
    return {
      deliveryId: parsed.data.deliveryId,
      pcsMarkedLegacy: missingPcs,
      rationale: parsed.data.rationale,
    };
  }
  throw new Error(`unsupported action ${actionType}`);
}

export async function proposeAdminAction(
  admin: Admin,
  input: {
    actionType: AdminActionType;
    title: string;
    rationale?: string;
    payload: unknown;
    proposedBy?: string;
    proposedByUserId?: string | null;
  },
) {
  const validation = await validateProposal(admin, input.actionType, input.payload);
  const status = validation.ok ? "validated" : "proposed";
  const { data, error } = await admin
    .from("admin_action_proposals")
    .insert({
      action_type: input.actionType,
      title: input.title,
      rationale: input.rationale ?? null,
      payload: input.payload ?? {},
      status,
      validation,
      proposed_by: input.proposedBy ?? "grok",
      proposed_by_user_id: input.proposedByUserId ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await logEvent(admin, data.id, "proposed", input.proposedBy ?? "grok", input.proposedByUserId ?? null, {
    validation,
  });
  if (validation.ok) {
    await logEvent(admin, data.id, "validated", "system", null, { validation });
  }
  return data;
}

export async function approveAdminAction(
  admin: Admin,
  proposalId: string,
  approvedByUserId: string | null,
  actor = "human",
) {
  const { data: proposal, error } = await admin
    .from("admin_action_proposals")
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!proposal) throw new Error("proposal not found");
  if (proposal.status === "executed") return proposal;
  if (proposal.status === "rejected") throw new Error("proposal was rejected");

  const validation = await validateProposal(
    admin,
    proposal.action_type as AdminActionType,
    proposal.payload,
  );
  if (!validation.ok) {
    await admin
      .from("admin_action_proposals")
      .update({ status: "proposed", validation, error_message: "validation failed before approve" })
      .eq("id", proposalId);
    await logEvent(admin, proposalId, "validation_failed", actor, approvedByUserId, { validation });
    throw new Error(
      validation.issues.find((row) => row.blocking)?.message ?? "validation failed",
    );
  }

  await admin
    .from("admin_action_proposals")
    .update({
      status: "approved",
      validation,
      approved_by: approvedByUserId,
      approved_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", proposalId);
  await logEvent(admin, proposalId, "approved", actor, approvedByUserId, {});

  try {
    const result = await executeProposal(
      admin,
      proposal.action_type as AdminActionType,
      proposal.payload,
      proposalId,
    );
    const { data: executed, error: execError } = await admin
      .from("admin_action_proposals")
      .update({
        status: "executed",
        result,
        executed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", proposalId)
      .select("*")
      .single();
    if (execError) throw new Error(execError.message);
    await logEvent(admin, proposalId, "executed", actor, approvedByUserId, { result });
    return executed;
  } catch (err) {
    const message = err instanceof Error ? err.message : "execution failed";
    await admin
      .from("admin_action_proposals")
      .update({ status: "failed", error_message: message })
      .eq("id", proposalId);
    await logEvent(admin, proposalId, "failed", actor, approvedByUserId, { message });
    throw err;
  }
}

export async function rejectAdminAction(
  admin: Admin,
  proposalId: string,
  rejectedByUserId: string | null,
  reason?: string,
) {
  const { data, error } = await admin
    .from("admin_action_proposals")
    .update({
      status: "rejected",
      rejected_by: rejectedByUserId,
      rejected_at: new Date().toISOString(),
      reject_reason: reason ?? null,
    })
    .eq("id", proposalId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await logEvent(admin, proposalId, "rejected", "human", rejectedByUserId, { reason });
  return data;
}

export type { SetCustomerPricePayload };
