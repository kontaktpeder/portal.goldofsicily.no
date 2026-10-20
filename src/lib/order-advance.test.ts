import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  agreedAdvanceOre,
  finalOffsetPlan,
  goodsDnbFigures,
  offsetAmount,
  orderBasisOre,
  orderWorkActions,
  receivedAdvance,
  settlementClaims,
  settlementView,
  type SettlementView,
} from "./order-advance.ts";

const BASIS = 15_450_000;
const ADVANCE = 7_725_000;
const VAT = 1_942_500;
const TOTAL = 17_392_500;
const REMAINING = 9_667_500;
const PARTIAL = 10_000_000;
const FINAL = 5_450_000;

function view(overrides: Partial<Parameters<typeof settlementView>[0]> = {}): SettlementView {
  return settlementView({
    percent: 50,
    basisOre: BASIS,
    agreedOre: ADVANCE,
    claimedOre: ADVANCE,
    paymentChecked: false,
    payments: [],
    dnbReceivedOre: null,
    dnbRestOre: null,
    finalClaimOre: null,
    alreadyPlannedOre: 0,
    storedSurplusOre: null,
    confirmedOre: null,
    previouslyInvoicedOre: 0,
    vatOre: null,
    totalOre: null,
    remainingOre: null,
    ...overrides,
  });
}

test("an unchecked advance is unknown, not unpaid", () => {
  assert.equal(agreedAdvanceOre(BASIS, 50), ADVANCE);
  assert.equal(orderBasisOre([{ quantity: 6180, unitPriceOre: 2500 }]), BASIS);
  assert.equal(orderBasisOre([{ quantity: 6180, unitPriceOre: null }]), null);
  assert.equal(agreedAdvanceOre(BASIS, 0), 0);
  assert.equal(agreedAdvanceOre(BASIS, 101), 0);

  const open = view();
  assert.equal(open.receivedOre, null);
  assert.equal(open.receivedFrom, "unchecked");
  assert.equal(open.outstandingOre, null);
  assert.equal(open.plannedOre, null);
  assert.equal(open.claimedOre, ADVANCE);
  assert.equal(open.vatOre, null);
  assert.equal(open.totalOre, null);
  assert.equal(open.remainingOre, null);
});

test("zero is only used after DNB has reported a number", () => {
  const unpaid = view({
    paymentChecked: true,
    dnbReceivedOre: 0,
    dnbRestOre: ADVANCE,
  });
  assert.equal(unpaid.receivedOre, 0);
  assert.equal(unpaid.receivedFrom, "dnb");
  assert.equal(unpaid.outstandingOre, ADVANCE);

  const settled = view({
    paymentChecked: true,
    dnbReceivedOre: ADVANCE,
    dnbRestOre: 0,
    finalClaimOre: FINAL,
    vatOre: VAT,
    totalOre: TOTAL,
    remainingOre: REMAINING,
  });
  assert.equal(settled.outstandingOre, 0);
  assert.equal(settled.receivedOre, ADVANCE);
  assert.equal(settled.plannedOre, FINAL);
  assert.equal(settled.surplusOre, ADVANCE - FINAL);
  assert.equal(settled.vatOre, VAT);
  assert.equal(settled.totalOre, TOTAL);
  assert.equal(settled.remainingOre, REMAINING);
});

test("payments arrive in several rows and a DNB balance is not added on top", () => {
  const received = receivedAdvance({
    paymentChecked: true,
    payments: [
      { amountOre: 4_000_000, paidOn: "2026-09-20" },
      { amountOre: 3_725_000, paidOn: "2026-09-28" },
    ],
    dnbReceivedOre: ADVANCE,
  });
  assert.equal(received.amountOre, ADVANCE);
  assert.equal(received.from, "payments");

  const fromBalance = receivedAdvance({
    paymentChecked: true,
    payments: [],
    dnbReceivedOre: ADVANCE,
  });
  assert.equal(fromBalance.amountOre, ADVANCE);
  assert.equal(fromBalance.from, "dnb");

  const unchecked = receivedAdvance({
    paymentChecked: false,
    payments: [],
    dnbReceivedOre: 0,
  });
  assert.equal(unchecked.amountOre, null);
  assert.equal(unchecked.from, "unchecked");

  assert.deepEqual(goodsDnbFigures([]), { vatOre: null, totalOre: null, remainingOre: null });
  assert.deepEqual(goodsDnbFigures([{ dnbVatOre: VAT, dnbTotalOre: null, dnbRestOre: null }]), {
    vatOre: VAT,
    totalOre: null,
    remainingOre: null,
  });
  assert.deepEqual(
    goodsDnbFigures([
      { draftId: "new", dnbVatOre: null, dnbTotalOre: null, dnbRestOre: null },
      { draftId: "old", dnbVatOre: VAT, dnbTotalOre: TOTAL, dnbRestOre: REMAINING },
    ]),
    { vatOre: null, totalOre: null, remainingOre: null },
  );
});

test("a final settlement keeps earlier goods out and does not spend the surplus twice", () => {
  const lines = [
    { fulfillmentId: "partial", quantity: 4000, unitPriceOre: 2500, active: true },
    { fulfillmentId: "final", quantity: 2180, unitPriceOre: 2500, active: true },
  ];
  const claims = settlementClaims(lines, ["final"]);
  assert.equal(claims.previouslyInvoicedOre, PARTIAL);
  assert.equal(claims.finalClaimOre, FINAL);

  const first = finalOffsetPlan({
    paymentChecked: true,
    receivedOre: ADVANCE,
    finalClaimOre: claims.finalClaimOre,
    alreadyPlannedOre: 0,
    storedSurplusOre: null,
  });
  assert.equal(first.plannedOre, FINAL);
  assert.equal(first.surplusOre, 2_275_000);

  const again = finalOffsetPlan({
    paymentChecked: true,
    receivedOre: ADVANCE,
    finalClaimOre: FINAL,
    alreadyPlannedOre: FINAL,
    storedSurplusOre: 2_275_000,
  });
  assert.equal(again.plannedOre, 0);
  assert.equal(again.surplusOre, 2_275_000);

  const beforeFinal = finalOffsetPlan({
    paymentChecked: true,
    receivedOre: ADVANCE,
    finalClaimOre: null,
    alreadyPlannedOre: 0,
    storedSurplusOre: null,
  });
  assert.equal(beforeFinal.plannedOre, null);
  assert.equal(beforeFinal.surplusOre, null);
});

test("an offset cannot use a claim that has not been paid, and cannot be applied twice", () => {
  assert.equal(
    offsetAmount({ receivedOre: ADVANCE, alreadyOffsetOre: 0, settlementHasOffset: false }),
    ADVANCE,
  );
  assert.equal(
    offsetAmount({ receivedOre: ADVANCE, alreadyOffsetOre: ADVANCE, settlementHasOffset: false }),
    0,
  );
  assert.equal(
    offsetAmount({ receivedOre: ADVANCE, alreadyOffsetOre: 0, settlementHasOffset: true }),
    0,
  );
  assert.equal(
    offsetAmount({ receivedOre: 0, alreadyOffsetOre: 0, settlementHasOffset: false }),
    0,
  );
});

test("delivery stays available before the advance is checked, and partial invoicing stays available", () => {
  const confirmed = orderWorkActions({
    confirmed: true,
    remaining: 6180,
    ordered: 6180,
    hasAdvanceAgreement: true,
    claimPrepared: false,
    paymentChecked: false,
    advanceInvoiceId: null,
    advanceOutstandingOre: null,
    uninvoicedDelivered: 0,
    settlementInDnb: false,
    settlementInvoiceId: null,
  });
  assert.equal(confirmed.advance?.kind, "prepare_advance");
  assert.equal(confirmed.goods?.kind, "register_delivery");
  assert.equal(confirmed.final, null);
  assert.equal(confirmed.partial, null);

  const unknown = orderWorkActions({
    confirmed: true,
    remaining: 6180,
    ordered: 6180,
    hasAdvanceAgreement: true,
    claimPrepared: true,
    paymentChecked: false,
    advanceInvoiceId: "dnb-1",
    advanceOutstandingOre: null,
    uninvoicedDelivered: 400,
    settlementInDnb: false,
    settlementInvoiceId: null,
  });
  assert.equal(unknown.advance?.kind, "check_advance");
  assert.equal(unknown.goods?.kind, "register_delivery");
  assert.equal(unknown.partial?.kind, "invoice_delivered");

  const unpaid = orderWorkActions({
    confirmed: true,
    remaining: 6180,
    ordered: 6180,
    hasAdvanceAgreement: true,
    claimPrepared: true,
    paymentChecked: true,
    advanceInvoiceId: "dnb-1",
    advanceOutstandingOre: ADVANCE,
    uninvoicedDelivered: 400,
    settlementInDnb: false,
    settlementInvoiceId: null,
  });
  assert.equal(unpaid.advance?.kind, "open_advance");
  assert.equal(unpaid.goods?.kind, "register_delivery");
  assert.equal(unpaid.partial?.kind, "invoice_delivered");

  const done = orderWorkActions({
    confirmed: true,
    remaining: 0,
    ordered: 6180,
    hasAdvanceAgreement: true,
    claimPrepared: true,
    paymentChecked: true,
    advanceInvoiceId: "dnb-1",
    advanceOutstandingOre: 0,
    uninvoicedDelivered: 6180,
    settlementInDnb: false,
    settlementInvoiceId: null,
  });
  assert.equal(done.goods, null);
  assert.equal(done.final?.kind, "prepare_settlement");
  assert.equal(done.partial, null);

  const inDnb = orderWorkActions({
    confirmed: true,
    remaining: 0,
    ordered: 6180,
    hasAdvanceAgreement: true,
    claimPrepared: true,
    paymentChecked: true,
    advanceInvoiceId: "dnb-1",
    advanceOutstandingOre: 0,
    uninvoicedDelivered: 0,
    settlementInDnb: true,
    settlementInvoiceId: "dnb-2",
  });
  assert.equal(inDnb.final?.kind, "open_settlement");

  const plain = orderWorkActions({
    confirmed: true,
    remaining: 10,
    ordered: 20,
    hasAdvanceAgreement: false,
    claimPrepared: false,
    paymentChecked: false,
    advanceInvoiceId: null,
    advanceOutstandingOre: null,
    uninvoicedDelivered: 10,
    settlementInDnb: false,
    settlementInvoiceId: null,
  });
  assert.equal(plain.advance, null);
  assert.equal(plain.goods?.kind, "register_delivery");
  assert.equal(plain.partial?.kind, "invoice_delivered");
  assert.equal(plain.final, null);
});

test("the advance sql keeps the claim off the goods lines and caps the offset", () => {
  const sql = readFileSync(new URL("../../sql/26_order_advance.sql", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261020160000_order_advance.sql", import.meta.url),
    "utf8",
  );
  assert.equal(
    sql.slice(sql.indexOf("ALTER TABLE")),
    migration.slice(migration.indexOf("ALTER TABLE")),
  );
  assert.match(sql, /prepare_order_advance/);
  assert.match(sql, /this order already has an advance/);
  assert.match(sql, /advance offset exceeds amount received/);
  assert.match(sql, /ROUND\(p_basis_ore \* p_percent \/ 100\.0\)/);
  assert.match(
    sql,
    /DROP FUNCTION IF EXISTS public\.record_dnb_transfer\(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE\)/,
  );
  assert.match(sql, /COALESCE\(p_dnb_rest_ore, dnb_rest_ore\)/);
  assert.match(sql, /advance_received_ore/);
  assert.doesNotMatch(sql, /INSERT INTO public\.invoice_draft_lines/);
  assert.doesNotMatch(sql, /vat_percent\s*=\s*0/);
  assert.doesNotMatch(sql, /UPDATE public\.customers/);
  assert.doesNotMatch(sql, /UPDATE public\.deliveries/);
  assert.doesNotMatch(sql, /net\.http|unimicro|send.?mail/i);
});

test("the check sql treats an unread payment as unknown and keeps surplus out of a later draft", () => {
  const sql = readFileSync(new URL("../../sql/27_advance_dnb_check.sql", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261020180000_advance_dnb_check.sql", import.meta.url),
    "utf8",
  );
  assert.equal(
    sql.slice(sql.indexOf("ALTER TABLE")),
    migration.slice(migration.indexOf("ALTER TABLE")),
  );
  assert.match(sql, /payments_checked_at/);
  assert.match(sql, /surplus_ore/);
  assert.match(sql, /confirmed_ore/);
  assert.match(sql, /advance payment is not checked/);
  assert.match(sql, /LEAST\(room, p_ceiling_ore\)/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.record_advance_offset\(UUID, UUID\)/);
  assert.match(sql, /already \+ NEW\.amount_ore \+ surplus > received/);
  assert.doesNotMatch(sql, /INSERT INTO public\.invoice_draft_lines/);
  assert.doesNotMatch(sql, /vat_percent\s*=\s*0/);
  assert.doesNotMatch(sql, /UPDATE public\.customers/);
  assert.doesNotMatch(sql, /UPDATE public\.deliveries/);
  assert.doesNotMatch(sql, /net\.http|unimicro|send.?mail/i);
});
