import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  agreedAdvanceOre,
  goodsDnbFigures,
  offsetAmount,
  orderBasisOre,
  orderWorkActions,
  receivedAdvance,
  settlementView,
} from "./order-advance.ts";

const BASIS = 15_450_000;
const ADVANCE = 7_725_000;
const VAT = 1_942_500;
const TOTAL = 17_392_500;
const REMAINING = 9_667_500;

test("the Villa advance is half the ex-VAT basis and is not treated as paid", () => {
  assert.equal(agreedAdvanceOre(BASIS, 50), ADVANCE);
  assert.equal(orderBasisOre([{ quantity: 6180, unitPriceOre: 2500 }]), BASIS);
  assert.equal(orderBasisOre([{ quantity: 6180, unitPriceOre: null }]), null);
  assert.equal(agreedAdvanceOre(BASIS, 0), 0);
  assert.equal(agreedAdvanceOre(BASIS, 101), 0);

  const open = settlementView({
    percent: 50,
    basisOre: BASIS,
    agreedOre: ADVANCE,
    claimedOre: ADVANCE,
    payments: [],
    dnbReceivedOre: null,
    dnbRestOre: null,
    offsetOre: 0,
    vatOre: null,
    totalOre: null,
    remainingOre: null,
  });
  assert.equal(open.receivedOre, 0);
  assert.equal(open.receivedFrom, "none");
  assert.equal(open.outstandingOre, ADVANCE);
  assert.equal(open.claimedOre, ADVANCE);
  assert.equal(open.vatOre, null);
  assert.equal(open.totalOre, null);
  assert.equal(open.remainingOre, null);
});

test("payments arrive in several rows and a DNB balance is not added on top", () => {
  const received = receivedAdvance({
    payments: [
      { amountOre: 4_000_000, paidOn: "2026-09-20" },
      { amountOre: 3_725_000, paidOn: "2026-09-28" },
    ],
    dnbReceivedOre: ADVANCE,
  });
  assert.equal(received.amountOre, ADVANCE);
  assert.equal(received.from, "payments");

  const fromBalance = receivedAdvance({ payments: [], dnbReceivedOre: ADVANCE });
  assert.equal(fromBalance.amountOre, ADVANCE);
  assert.equal(fromBalance.from, "dnb");

  const settled = settlementView({
    percent: 50,
    basisOre: BASIS,
    agreedOre: ADVANCE,
    claimedOre: ADVANCE,
    payments: [],
    dnbReceivedOre: null,
    dnbRestOre: 0,
    offsetOre: ADVANCE,
    vatOre: VAT,
    totalOre: TOTAL,
    remainingOre: REMAINING,
  });
  assert.equal(settled.outstandingOre, 0);
  assert.equal(settled.vatOre, VAT);
  assert.equal(settled.totalOre, TOTAL);
  assert.equal(settled.remainingOre, REMAINING);
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

test("delivery stays available before the advance is paid, and partial invoicing stays available", () => {
  const confirmed = orderWorkActions({
    confirmed: true,
    remaining: 6180,
    ordered: 6180,
    hasAdvanceAgreement: true,
    claimPrepared: false,
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

  const unpaid = orderWorkActions({
    confirmed: true,
    remaining: 6180,
    ordered: 6180,
    hasAdvanceAgreement: true,
    claimPrepared: true,
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
    ...{
      confirmed: true,
      remaining: 0,
      ordered: 6180,
      hasAdvanceAgreement: true,
      claimPrepared: true,
      advanceInvoiceId: "dnb-1",
      advanceOutstandingOre: 0,
      uninvoicedDelivered: 0,
      settlementInDnb: true,
      settlementInvoiceId: "dnb-2",
    },
  });
  assert.equal(inDnb.final?.kind, "open_settlement");

  const plain = orderWorkActions({
    confirmed: true,
    remaining: 10,
    ordered: 20,
    hasAdvanceAgreement: false,
    claimPrepared: false,
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
