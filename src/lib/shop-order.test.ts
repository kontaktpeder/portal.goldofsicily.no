import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptOfferDecision,
  approvalDecision,
  approvalLock,
  classifyShopOrder,
  confirmedMail,
  offerDecision,
  orderTotalOre,
  parseShopOrder,
  receivedMail,
  reservationCovers,
  staffActions,
} from "./shop-order.ts";
import { PRICE_FIFTY_ORE } from "./shop.ts";

const now = new Date("2026-10-25T20:00:00Z");

test("binding stays closed for the public, and delivery is never a priced shipment", () => {
  assert.equal(
    classifyShopOrder({ bindingOpen: false, fulfillment: "pickup", boxes: 1, boxesAvailable: 5 }),
    "quote",
  );
  assert.equal(
    classifyShopOrder({
      bindingOpen: true,
      fulfillment: "delivery_request",
      boxes: 1,
      boxesAvailable: 5,
    }),
    "quote",
  );
  assert.equal(
    classifyShopOrder({ bindingOpen: true, fulfillment: "pickup", boxes: 1, boxesAvailable: 5 }),
    "binding",
  );
  assert.equal(
    classifyShopOrder({ bindingOpen: true, fulfillment: "pickup", boxes: 2, boxesAvailable: 1 }),
    "short",
  );
  assert.equal(orderTotalOre(1), PRICE_FIFTY_ORE);
  const parsed = parseShopOrder({
    flavor: "truffle",
    boxes: 1,
    name: "Ashraf",
    email: "a@example.com",
    phone: "90000000",
    addressLine: "Bogstadveien 1",
    postalCode: "0355",
    city: "Oslo",
    orgNumber: "123 456 789",
    fulfillment: "pickup",
    lang: "no",
  });
  assert.equal(parsed?.orgNumber, "123456789");
  assert.equal(orderTotalOre(parsed?.boxes ?? 0), PRICE_FIFTY_ORE);
});

test("approval keeps one reservation and refuses an expired hold", () => {
  const live = {
    id: "r1",
    status: "held",
    pieces: 50,
    expiresAt: "2026-10-27T20:00:00Z",
  };
  assert.equal(reservationCovers(live, 50, now), true);
  assert.deepEqual(
    approvalDecision(
      {
        status: "received",
        binding: true,
        fulfillment: "pickup",
        pieces: 50,
        reservation: live,
        customerOrderId: null,
        customerId: null,
      },
      now,
    ),
    { action: "claim" },
  );
  assert.deepEqual(
    approvalDecision(
      {
        status: "received",
        binding: true,
        fulfillment: "pickup",
        pieces: 50,
        reservation: { ...live, expiresAt: "2026-10-25T19:00:00Z" },
        customerOrderId: null,
        customerId: null,
      },
      now,
    ),
    { action: "stop", reason: "stock" },
  );
  assert.deepEqual(
    approvalDecision(
      {
        status: "confirmed",
        binding: true,
        fulfillment: "pickup",
        pieces: 50,
        reservation: live,
        customerOrderId: "order-1",
        customerId: "cust-1",
      },
      now,
    ),
    { action: "already", customerOrderId: "order-1" },
  );
  assert.equal(
    approvalDecision(
      {
        status: "confirming",
        binding: true,
        fulfillment: "pickup",
        pieces: 50,
        reservation: live,
        customerOrderId: null,
        customerId: null,
      },
      now,
    ).action,
    "resume",
  );
});

test("a changed offer is not an order until the customer accepts it", () => {
  assert.deepEqual(offerDecision({ status: "received", boxes: 1, nextBoxes: 2 }), {
    action: "send",
  });
  assert.deepEqual(
    approvalDecision(
      {
        status: "offer",
        binding: true,
        fulfillment: "pickup",
        pieces: 50,
        reservation: null,
        customerOrderId: null,
        customerId: null,
      },
      now,
    ),
    { action: "stop", reason: "offer" },
  );
  assert.deepEqual(
    acceptOfferDecision({
      status: "offer",
      offerBoxes: 2,
      boxesAvailable: 1,
      fulfillment: "pickup",
      bindingOpen: true,
    }),
    { action: "stop", reason: "stock" },
  );
  assert.equal(
    acceptOfferDecision({
      status: "offer",
      offerBoxes: 1,
      boxesAvailable: 4,
      fulfillment: "pickup",
      bindingOpen: true,
    }).action,
    "accept",
  );
  assert.match(
    receivedMail({
      lang: "no",
      number: "N-0001",
      flavorName: "Trøffel",
      boxes: 1,
      totalOre: PRICE_FIFTY_ORE,
      kind: "quote",
      fulfillment: "delivery_request",
    }).text,
    /ikke en bestilling/,
  );
  assert.match(
    confirmedMail({
      lang: "no",
      number: "N-0001",
      flavorName: "Trøffel",
      boxes: 1,
      totalOre: PRICE_FIFTY_ORE,
    }).text,
    /ikke en faktura/,
  );
  assert.doesNotMatch(
    confirmedMail({
      lang: "no",
      number: "N-0001",
      flavorName: "Trøffel",
      boxes: 1,
      totalOre: PRICE_FIFTY_ORE,
    }).text,
    /frakt/,
  );
});

test("the approval card stays on one step and ignores a second click while the lock is fresh", () => {
  assert.equal(approvalLock({ token: null, updatedAt: "2026-10-25T19:59:50Z", now }), "take");
  assert.equal(approvalLock({ token: "lock", updatedAt: "2026-10-25T19:59:40Z", now }), "wait");
  assert.equal(approvalLock({ token: "lock", updatedAt: "2026-10-25T19:00:00Z", now }), "take");
  assert.equal(
    staffActions({ status: "received", fulfillment: "pickup", customerOrderId: null }).approve,
    true,
  );
  assert.equal(
    staffActions({ status: "quote", fulfillment: "delivery_request", customerOrderId: null })
      .approve,
    false,
  );
  assert.equal(
    staffActions({ status: "offer", fulfillment: "pickup", customerOrderId: null }).approve,
    false,
  );
  assert.equal(
    staffActions({ status: "expired", fulfillment: "pickup", customerOrderId: null }).decline,
    true,
  );
});
