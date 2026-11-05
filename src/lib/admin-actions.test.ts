import assert from "node:assert/strict";
import test from "node:test";
import {
  actionAccess,
  isAdminActionType,
  isOwnerActionType,
  parseCreateCustomer,
  parseMarkLegacyDelivery,
  parseRegisterPricedDelivery,
  parseSetCustomerPrice,
  lotRemainingForAllocation,
  nextActionStatusAfterValidation,
} from "./admin-actions.ts";

test("action type guard", () => {
  assert.equal(isAdminActionType("register_priced_delivery"), true);
  assert.equal(isAdminActionType("mark_legacy_delivery"), true);
  assert.equal(isAdminActionType("create_customer"), true);
  assert.equal(isOwnerActionType("create_customer"), true);
  assert.equal(isOwnerActionType("mark_legacy_delivery"), false);
  assert.equal(isAdminActionType("drop_table"), false);
});

test("the actions token is owner until a separate owner token is set", () => {
  assert.equal(
    actionAccess({
      authorizationHeader: "Bearer grok-token",
      actionsToken: "grok-token",
    }),
    "owner",
  );
  assert.equal(
    actionAccess({
      authorizationHeader: "Bearer grok-token",
      actionsToken: "grok-token",
      ownerToken: "owner-token",
    }),
    "propose",
  );
  assert.equal(
    actionAccess({
      authorizationHeader: "Bearer owner-token",
      actionsToken: "grok-token",
      ownerToken: "owner-token",
    }),
    "owner",
  );
  assert.equal(
    actionAccess({ authorizationHeader: "Bearer other", actionsToken: "grok-token" }),
    "none",
  );
});

test("parse create_customer", () => {
  const parsed = parseCreateCustomer({
    name: "Antonietta",
    city: "Oslo",
    segment: "restaurant",
    contact_name: "Antonietta",
    email: "hei@example.com",
    active: false,
  });
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.data?.name, "Antonietta");
  assert.equal(parsed.data?.segment, "restaurant");
  assert.equal(parsed.data?.confirmDuplicate, false);
  assert.equal(parseCreateCustomer({ name: " " }).data, undefined);
  assert.ok(
    parseCreateCustomer({ name: "Bar", segment: "kiosk" }).issues.some(
      (row) => row.code === "invalid_segment",
    ),
  );
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
