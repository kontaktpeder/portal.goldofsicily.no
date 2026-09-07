import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRecallSearchResult, contactTargets } from "./recall.ts";

const truffleLot = {
  id: "lot-truffle",
  lotCode: "L-20260907-T-01",
  productNameNo: "Trøffel og sjampinjong",
  productNameEn: "Truffle & mushroom",
  productionDate: "2026-09-07",
  producedQty: 420,
  cartonCount: 21,
  producedBy: "Denis",
  status: "handed_over",
  deviationNotes: null,
  ingredients: [
    {
      ingredientName: "Carnaroli",
      supplierName: "Leverandør X",
      supplierLotCode: "R123",
      quantity: 12,
      quantityUnit: "kg",
      bestBefore: null,
    },
    {
      ingredientName: "Trøffelkrem",
      supplierName: "Leverandør Y",
      supplierLotCode: "TK882",
      quantity: 2,
      quantityUnit: "kg",
      bestBefore: null,
    },
  ],
  handovers: [
    {
      quantity: 300,
      cartons: 15,
      handedOverAt: "2026-09-07T16:34:00.000Z",
      recipientCompany: "Villa Grossista",
      recipientPerson: "Henrik",
      storageLocation: "Frys A / Hylle 3",
      ownership: "villa" as const,
    },
  ],
  venueDeliveries: [
    {
      venueName: "Oslo Bar & Bowling",
      quantity: 120,
      deliveredAt: "2026-09-07",
    },
  ],
};

const ndujaLot = {
  ...truffleLot,
  lotCode: "L-20260908-N-01",
  productNameNo: "Nduja-arancini",
  productNameEn: "'Nduja arancini",
  productionDate: "2026-09-08",
  ingredients: [
    {
      ingredientName: "Nduja",
      supplierName: "Leverandør X",
      supplierLotCode: "ND-4268",
      quantity: 3,
      quantityUnit: "kg",
      bestBefore: null,
    },
  ],
  venueDeliveries: [{ venueName: "Oslo Bar & Bowling", quantity: 50, deliveredAt: "2026-09-08" }],
};

test("recall prefers structured producer snapshots over legacy produced_by text", () => {
  const result = buildRecallSearchResult("L-20260907-T-01", [
    {
      ...truffleLot,
      producedBy: "Denis",
      producerNames: ["Denis Rossi", "Peder Holm"],
      legacyProducedBy: null,
    },
  ]);
  assert.deepEqual(result.lots[0]?.producerNames, ["Denis Rossi", "Peder Holm"]);
  assert.equal(result.lots[0]?.legacyProducedBy, null);
  const legacy = buildRecallSearchResult("L-20260907-T-01", [truffleLot]);
  assert.equal(legacy.lots[0]?.producedBy, "Denis");
  assert.deepEqual(legacy.lots[0]?.producerNames, []);
});

test("Gold-LOT recall card keeps one-up ingredients and one-down recipients", () => {
  const result = buildRecallSearchResult("L-20260907-T-01", [truffleLot]);
  assert.equal(result.kind, "gold_lot");
  assert.equal(result.lots[0]?.lotCode, "L-20260907-T-01");
  assert.equal(result.lots[0]?.remainingQty, 120);
  assert.equal(result.lots[0]?.ingredients[1]?.matched, false);
  assert.deepEqual(contactTargets(result.lots[0]!), ["Villa Grossista", "Oslo Bar & Bowling"]);
});

test("supplier LOT recall marks the matching ingredient and lists Gold-LOTs", () => {
  const result = buildRecallSearchResult("TK882", [truffleLot, ndujaLot]);
  assert.equal(result.kind, "supplier_lot");
  assert.equal(result.matchedSupplierLot, "TK882");
  assert.equal(result.lots[0]?.ingredients.find((row) => row.supplierLotCode === "TK882")?.matched, true);
  assert.equal(result.lots[1]?.ingredients[0]?.matched, false);
});

test("recall lives under LOT and delivery lines keep Gold-LOT as the master ID", () => {
  const recallPage = readFileSync(
    new URL("../routes/_authenticated/admin.recall.tsx", import.meta.url),
    "utf8",
  );
  const recallSearch = readFileSync(new URL("../components/recall-search.tsx", import.meta.url), "utf8");
  const deliveries = readFileSync(
    new URL("../routes/_authenticated/admin.deliveries.tsx", import.meta.url),
    "utf8",
  );
  const lots = readFileSync(new URL("../routes/_authenticated/admin.lots.tsx", import.meta.url), "utf8");
  const flavorLines = readFileSync(new URL("../components/flavor-lines.tsx", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../../sql/11_delivery_lot_required.sql", import.meta.url), "utf8");
  assert.match(recallPage, /tab: "recall"/);
  assert.match(recallSearch, /classifyRecallQuery/);
  assert.match(recallSearch, /supplier_lot_code/);
  assert.match(deliveries, /gold_lot_id/);
  assert.match(deliveries, /validateDeliveryStock/);
  assert.match(lots, /formatGoldLotCode/);
  assert.doesNotMatch(flavorLines, /delivery_lot_none/);
  assert.match(sql, /quantity = 0 OR gold_lot_id IS NOT NULL/);
});
