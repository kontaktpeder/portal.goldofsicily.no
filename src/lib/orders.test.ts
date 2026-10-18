import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canCancelOrder,
  fulfillmentBlock,
  legacyInvoicePortions,
  orderInvoicePortions,
  orderProgress,
  productionNeed,
  remainingQuantity,
  type ActiveInvoiceSlice,
  type DeskDelivery,
  type DeskFulfillment,
} from "./orders.ts";

test("a confirmed order shows remaining quantity and partial delivery", () => {
  assert.equal(remainingQuantity(1000, 400), 600);
  assert.equal(orderProgress("confirmed", 1000, 0), "confirmed");
  assert.equal(orderProgress("confirmed", 1000, 400), "partially_delivered");
  assert.equal(orderProgress("confirmed", 1000, 1000), "delivered");
  assert.equal(orderProgress("draft", 1000, 0), "draft");
  assert.equal(canCancelOrder("confirmed", 400), false);
  assert.equal(canCancelOrder("confirmed", 0), true);
});

test("Villa's 1000 order invoices the delivered 400 once, at the frozen price", () => {
  const delivery: DeskDelivery = {
    deliveryLineId: "delivery-400",
    quantity: 400,
    unitPriceOre: null,
    commercialRoute: "via_wholesaler",
    billingLegalEntityId: "venue-entity",
  };
  const fulfillment: DeskFulfillment = {
    id: "fulfill-400",
    deliveryLineId: delivery.deliveryLineId,
    quantity: 400,
    unitPriceOre: 2500,
    billingLegalEntityId: "villa-entity",
  };

  const first = orderInvoicePortions([fulfillment], []);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.quantity, 400);
  assert.equal(first[0]?.unitPriceOre, 2500);
  assert.equal(first[0]?.billingLegalEntityId, "villa-entity");
  assert.deepEqual(legacyInvoicePortions([delivery], [fulfillment], []), []);

  const invoiced: ActiveInvoiceSlice[] = [
    { deliveryLineId: delivery.deliveryLineId, fulfillmentId: fulfillment.id, quantity: 400 },
  ];
  assert.deepEqual(orderInvoicePortions([fulfillment], invoiced), []);
  assert.deepEqual(legacyInvoicePortions([delivery], [fulfillment], invoiced), []);
});

test("a split delivery invoices each order portion and only the unordered remainder", () => {
  const delivery: DeskDelivery = {
    deliveryLineId: "delivery-400",
    quantity: 400,
    unitPriceOre: 1800,
    commercialRoute: "direct",
    billingLegalEntityId: "venue-entity",
  };
  const fulfillments: DeskFulfillment[] = [
    {
      id: "part-villa",
      deliveryLineId: delivery.deliveryLineId,
      quantity: 250,
      unitPriceOre: 2500,
      billingLegalEntityId: "villa-entity",
    },
    {
      id: "part-other",
      deliveryLineId: delivery.deliveryLineId,
      quantity: 100,
      unitPriceOre: 3000,
      billingLegalEntityId: "other-entity",
    },
  ];

  const orders = orderInvoicePortions(fulfillments, []);
  assert.deepEqual(
    orders.map((row) => [row.billingLegalEntityId, row.quantity, row.unitPriceOre]),
    [
      ["villa-entity", 250, 2500],
      ["other-entity", 100, 3000],
    ],
  );
  const legacy = legacyInvoicePortions([delivery], fulfillments, []);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]?.quantity, 50);
  assert.equal(legacy[0]?.unitPriceOre, 1800);
  assert.equal(legacy[0]?.billingLegalEntityId, "venue-entity");
});

test("an unordered direct delivery keeps today's invoice rule", () => {
  const portions = legacyInvoicePortions(
    [
      {
        deliveryLineId: "direct",
        quantity: 12,
        unitPriceOre: 900,
        commercialRoute: "direct",
        billingLegalEntityId: "gold-customer",
      },
      {
        deliveryLineId: "via",
        quantity: 12,
        unitPriceOre: 900,
        commercialRoute: "via_wholesaler",
        billingLegalEntityId: "gold-customer",
      },
    ],
    [],
    [],
  );
  assert.equal(portions.length, 1);
  assert.equal(portions[0]?.deliveryLineId, "direct");
  assert.equal(portions[0]?.quantity, 12);
});

test("two allocations cannot pass the ordered or delivered quantity", () => {
  assert.equal(
    fulfillmentBlock({
      orderStatus: "confirmed",
      ordered: 1000,
      alreadyFulfilled: 700,
      delivered: 400,
      alreadyOnDelivery: 0,
      legacyInvoiced: 0,
      quantity: 400,
      sameProduct: true,
      sameSite: true,
    }),
    "fulfillment exceeds ordered quantity",
  );
  assert.equal(
    fulfillmentBlock({
      orderStatus: "confirmed",
      ordered: 1000,
      alreadyFulfilled: 0,
      delivered: 400,
      alreadyOnDelivery: 250,
      legacyInvoiced: 0,
      quantity: 200,
      sameProduct: true,
      sameSite: true,
    }),
    "fulfillment exceeds delivered quantity",
  );
  assert.equal(
    fulfillmentBlock({
      orderStatus: "confirmed",
      ordered: 1000,
      alreadyFulfilled: 0,
      delivered: 400,
      alreadyOnDelivery: 0,
      legacyInvoiced: 400,
      quantity: 400,
      sameProduct: true,
      sameSite: true,
    }),
    "fulfillment overlaps an invoice",
  );
  assert.equal(
    fulfillmentBlock({
      orderStatus: "confirmed",
      ordered: 1000,
      alreadyFulfilled: 0,
      delivered: 400,
      alreadyOnDelivery: 0,
      legacyInvoiced: 0,
      quantity: 400,
      sameProduct: true,
      sameSite: true,
    }),
    null,
  );
});

test("production need is the confirmed remainder against stock on hand", () => {
  const rows = productionNeed(
    [
      { productId: "truffle", ordered: 1000, fulfilled: 400, confirmed: true },
      { productId: "truffle", ordered: 100, fulfilled: 0, confirmed: false },
      { productId: "pistachio", ordered: 80, fulfilled: 80, confirmed: true },
    ],
    [{ productId: "truffle", available: 200, atVilla: 50 }],
  );
  assert.deepEqual(rows, [{ productId: "truffle", remaining: 600, onHand: 250, shortfall: 350 }]);
});

test("the database freezes the recipient and guards quantities", () => {
  const sql = readFileSync(new URL("../../sql/22_customer_orders.sql", import.meta.url), "utf8");
  assert.match(sql, /a confirmed order keeps its recipient, price and date/);
  assert.match(sql, /fulfillment exceeds ordered quantity/);
  assert.match(sql, /fulfillment exceeds delivered quantity/);
  assert.match(sql, /invoice quantity exceeds delivered quantity/);
  assert.match(sql, /delivery quantity is already on an order/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /order_line_fulfillment_id/);
  const orderBranch = sql.indexOf("IF NEW.order_line_fulfillment_id IS NOT NULL");
  assert.doesNotMatch(sql.slice(orderBranch, sql.indexOf("ELSE", orderBranch)), /commercial_route/);
});
