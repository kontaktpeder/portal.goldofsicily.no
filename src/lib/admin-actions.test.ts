import assert from "node:assert/strict";
import test from "node:test";
import {
  isAdminActionType,
  parseMarkLegacyDelivery,
  parseRegisterPricedDelivery,
  parseSetCustomerPrice,
  lotRemainingForAllocation,
  nextActionStatusAfterValidation,
} from "./admin-actions.ts";

test("action type guard", () => {
  assert.equal(isAdminActionType("register_priced_delivery"), true);
  assert.equal(isAdminActionType("mark_legacy_delivery"), true);
  assert.equal(isAdminActionType("drop_table"), false);
});

test("parse mark_legacy_delivery", () => {
  const parsed = parseMarkLegacyDelivery({
    delivery_id: "58be52bb-517e-44a2-8480-89cf46fc49f4",
    rationale: "Legacy levering før LOT-system",
    documentation: "Bekreftet: 136 T + 144 N = 280",
  });
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.data?.deliveryId, "58be52bb-517e-44a2-8480-89cf46fc49f4");
});

test("parse set_customer_price", () => {
  const parsed = parseSetCustomerPrice({
    customer_id: "74289937-90e7-41fd-bf1b-3f0bce80ef1a",
    product_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    price_ore: 2500,
    valid_from: "2026-09-01",
  });
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.data?.priceOre, 2500);
});

test("parse register_priced_delivery requires LOT on each line", () => {
  const parsed = parseRegisterPricedDelivery({
    customerId: "74289937-90e7-41fd-bf1b-3f0bce80ef1a",
    deliveredOn: "2026-09-30",
    ensurePrices: [
      {
        productId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        priceOre: 2500,
      },
    ],
    lines: [
      {
        productId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        quantity: 100,
      },
    ],
  });
  assert.ok(parsed.issues.some((row) => row.code === "missing_lot"));
});

test("parse register_priced_delivery allows LOT via createLots", () => {
  const productId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const parsed = parseRegisterPricedDelivery({
    customerId: "74289937-90e7-41fd-bf1b-3f0bce80ef1a",
    deliveredOn: "2026-09-30",
    ensurePrices: [{ productId, priceOre: 2500 }],
    createLots: [
      {
        productId,
        productionDate: "2026-09-30",
        producedQty: 50,
      },
    ],
    lines: [{ productId, quantity: 50 }],
  });
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.data?.lines[0]?.goldLotId ?? null, null);
  assert.equal(parsed.data?.createLots?.length, 1);
});

test("lot remaining uses approved basis", () => {
  assert.equal(
    lotRemainingForAllocation({
      producedQty: 200,
      approvedQty: 50,
      deliveredQty: 0,
      villaHandoverQty: 0,
    }),
    50,
  );
});

test("validation status mapping", () => {
  assert.equal(nextActionStatusAfterValidation("proposed", true), "validated");
  assert.equal(nextActionStatusAfterValidation("proposed", false), "proposed");
  assert.equal(nextActionStatusAfterValidation("executed", false), "executed");
});
