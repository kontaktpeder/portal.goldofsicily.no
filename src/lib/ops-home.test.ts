import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNextNeed,
  flavorStock,
  homeTasks,
  lotsReadyForHandover,
  type OpsLot,
} from "./ops-home.ts";

const lots: OpsLot[] = [
  {
    id: "t1",
    productId: "truffle",
    producedQty: 420,
    status: "produced",
    deliveredQty: 80,
    handovers: [{ quantity: 380, ownership: "villa" }],
  },
  {
    id: "n1",
    productId: "nduja",
    producedQty: 360,
    status: "handed_over",
    deliveredQty: 80,
    handovers: [{ quantity: 320, ownership: "villa" }],
  },
];

const products = [
  { id: "truffle", nameNo: "Trøffel", nameEn: "Truffle" },
  { id: "nduja", nameNo: "'Nduja", nameEn: "'Nduja" },
];

test("flavor stock follows Gold → Villa → venue", () => {
  const stock = flavorStock(products, lots);
  assert.deepEqual(
    stock.find((row) => row.productId === "truffle"),
    {
      productId: "truffle",
      nameNo: "Trøffel",
      nameEn: "Truffle",
      produced: 420,
      atVilla: 300,
      delivered: 80,
      available: 40,
    },
  );
  assert.deepEqual(
    stock.find((row) => row.productId === "nduja"),
    {
      productId: "nduja",
      nameNo: "'Nduja",
      nameEn: "'Nduja",
      produced: 360,
      atVilla: 240,
      delivered: 80,
      available: 40,
    },
  );
});

test("lots with remaining at Gold are ready for Villa handover", () => {
  assert.deepEqual(
    lotsReadyForHandover(lots).map((lot) => lot.id),
    ["t1", "n1"],
  );
  assert.equal(
    lotsReadyForHandover([
      {
        id: "done",
        productId: "truffle",
        producedQty: 100,
        status: "handed_over",
        deliveredQty: 100,
        handovers: [{ quantity: 100, ownership: "villa" }],
      },
    ]).length,
    0,
  );
});

test("next need lists venue demand and Villa remaining", () => {
  const stock = flavorStock(products, lots);
  const items = buildNextNeed(
    [
      {
        venueId: "oslo",
        venueName: "Oslo Bar & Bowling",
        createdAt: "2026-09-07T10:00:00.000Z",
        nextRequired: 120,
        lines: [
          {
            productId: "truffle",
            nameNo: "Trøffel",
            nameEn: "Truffle",
            nextNeed: 120,
          },
        ],
      },
    ],
    stock,
    "no",
  );
  assert.deepEqual(items[0], {
    id: "oslo:truffle",
    source: "venue",
    title: "Oslo Bar & Bowling",
    quantity: 120,
    flavorName: "Trøffel",
  });
  assert.equal(items.find((item) => item.id === "villa:nduja")?.quantity, 240);
  assert.equal(items.find((item) => item.id === "villa:truffle")?.quantity, 300);
});

test("the home list keeps only jobs that are waiting and opens the single job", () => {
  assert.deepEqual(
    homeTasks({
      approvals: [{ id: "order-1" }],
      productionShortfall: 0,
      lotsAtGold: [{ id: "lot-1" }],
      openDeliveries: [],
    }).map((task) => ({ id: task.id, count: task.count, target: task.target })),
    [
      { id: "approve", count: 1, target: { to: "/admin/orders/$orderId", orderId: "order-1" } },
      { id: "label", count: 1, target: { to: "/admin/lots/$lotId", lotId: "lot-1" } },
      { id: "handover", count: 1, target: { to: "/admin/lots/$lotId", lotId: "lot-1" } },
    ],
  );
});

test("several waiting jobs open the list instead of one record", () => {
  const tasks = homeTasks({
    approvals: [{ id: "a" }, { id: "b" }],
    productionShortfall: 12,
    lotsAtGold: [{ id: "lot-1" }, { id: "lot-2" }],
    openDeliveries: [{ id: "d1" }, { id: "d2" }],
  });
  assert.deepEqual(
    tasks.map((task) => task.target),
    [
      { to: "/admin/orders" },
      { to: "/admin/lots", tab: "production" },
      { to: "/admin/lots", tab: "active" },
      { to: "/admin/lots", tab: "active" },
      { to: "/admin/deliveries", lot: "" },
    ],
  );
  assert.deepEqual(
    tasks.map((task) => task.count),
    [2, 12, 2, 2, 2],
  );
});

test("an empty day has an empty home list", () => {
  assert.deepEqual(
    homeTasks({ approvals: [], productionShortfall: 0, lotsAtGold: [], openDeliveries: [] }),
    [],
  );
});
