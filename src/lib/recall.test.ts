import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRecallSearchResult, contactTargets, traceLotDistribution } from "./recall.ts";

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
  assert.equal(
    result.lots[0]?.ingredients.find((row) => row.supplierLotCode === "TK882")?.matched,
    true,
  );
  assert.equal(result.lots[1]?.ingredients[0]?.matched, false);
});

test("villa stock stays untraced until a delivery line names the end recipient and the handover", () => {
  const open = traceLotDistribution(
    [
      {
        id: "handover-villa",
        quantity: 300,
        cartons: 15,
        handedOverAt: "2026-09-07T16:34:00.000Z",
        recipientCompany: "Villa Grossista",
        customerId: "villa",
        recipientPerson: null,
        storageLocation: null,
        ownership: "villa",
      },
    ],
    [],
  );
  assert.equal(open.heldAtWholesaler[0]?.remaining, 300);
  assert.equal(open.endRecipients.length, 0);

  const traced = traceLotDistribution(
    [
      {
        id: "handover-villa",
        quantity: 300,
        cartons: 15,
        handedOverAt: "2026-09-07T16:34:00.000Z",
        recipientCompany: "Villa Grossista",
        customerId: "villa",
        recipientPerson: null,
        storageLocation: null,
        ownership: "villa",
      },
    ],
    [
      {
        venueName: "Restaurant A",
        customerId: "restaurant-a",
        quantity: 200,
        deliveredAt: "2026-09-09",
        commercialRoute: "via_wholesaler",
        wholesalerName: "Villa Grossista",
        sourceHandoverId: "handover-villa",
        lotRecorded: true,
      },
      {
        venueName: "Restaurant B",
        customerId: "restaurant-b",
        quantity: 40,
        deliveredAt: "2026-09-10",
        commercialRoute: "via_wholesaler",
        wholesalerName: "Villa Grossista",
        sourceHandoverId: null,
        lotRecorded: false,
      },
    ],
  );
  assert.equal(traced.endRecipients[0]?.customerName, "Restaurant A");
  assert.equal(traced.endRecipients[0]?.wholesalerName, "Villa Grossista");
  assert.equal(traced.endRecipients[0]?.handoverLinked, true);
  assert.equal(traced.endRecipients[1]?.handoverLinked, false);
  assert.equal(traced.endRecipients[1]?.lotRecorded, false);
  assert.equal(traced.missingLot[0]?.quantity, 40);
  assert.equal(traced.heldAtWholesaler[0]?.tracedToRecipients, 200);
  assert.equal(traced.heldAtWholesaler[0]?.remaining, 100);
  const card = buildRecallSearchResult("L-20260907-T-01", [
    {
      ...truffleLot,
      handovers: [
        {
          ...truffleLot.handovers[0]!,
          id: "handover-villa",
          customerId: "villa",
        },
      ],
      venueDeliveries: traced.endRecipients.map((row) => ({
        venueName: row.customerName,
        customerId: row.customerId,
        quantity: row.quantity,
        deliveredAt: row.deliveredAt,
        commercialRoute: "via_wholesaler" as const,
        wholesalerName: row.wholesalerName,
        sourceHandoverId: row.handoverLinked ? "handover-villa" : null,
        lotRecorded: row.lotRecorded,
      })),
    },
  ]);
  assert.deepEqual(contactTargets(card.lots[0]!), [
    "Villa Grossista",
    "Restaurant A",
    "Restaurant B",
  ]);
});

test("recall lives under LOT and delivery lines keep Gold-LOT as the master ID", () => {
  const recallPage = readFileSync(
    new URL("../routes/_authenticated/admin.recall.tsx", import.meta.url),
    "utf8",
  );
  const recallSearch = readFileSync(
    new URL("../components/recall-search.tsx", import.meta.url),
    "utf8",
  );
  const deliveries = readFileSync(
    new URL("../routes/_authenticated/admin.deliveries.tsx", import.meta.url),
    "utf8",
  );
  const lots = readFileSync(
    new URL("../routes/_authenticated/admin.lots.index.tsx", import.meta.url),
    "utf8",
  );
  const flavorLines = readFileSync(
    new URL("../components/flavor-lines.tsx", import.meta.url),
    "utf8",
  );
  const sql = readFileSync(
    new URL("../../sql/11_delivery_lot_required.sql", import.meta.url),
    "utf8",
  );
  assert.match(recallPage, /tab: "recall"/);
  assert.match(recallSearch, /classifyRecallQuery/);
  assert.match(recallSearch, /supplier_lot_code/);
  assert.match(recallSearch, /source_handover_id/);
  assert.match(recallSearch, /recall_end_recipients/);
  assert.match(recallSearch, /recall_held_wholesaler/);
  assert.match(recallSearch, /gold_lot_id", null/);
  assert.match(deliveries, /gold_lot_id/);
  assert.match(deliveries, /validateDeliveryStock/);
  assert.match(lots, /formatGoldLotCode/);
  assert.doesNotMatch(flavorLines, /delivery_lot_none/);
  assert.match(sql, /quantity = 0 OR gold_lot_id IS NOT NULL/);
});

test("LOT detail is a sibling of the list so clicking an active LOT opens the page", () => {
  const list = readFileSync(
    new URL("../routes/_authenticated/admin.lots.index.tsx", import.meta.url),
    "utf8",
  );
  const detail = readFileSync(
    new URL("../routes/_authenticated/admin.lots.$lotId.tsx", import.meta.url),
    "utf8",
  );
  const tree = readFileSync(new URL("../routeTree.gen.ts", import.meta.url), "utf8");
  assert.match(list, /createFileRoute\("\/_authenticated\/admin\/lots\/"\)/);
  assert.match(detail, /createFileRoute\("\/_authenticated\/admin\/lots\/\$lotId"\)/);
  assert.match(list, /to="\/admin\/lots\/\$lotId"/);
  assert.doesNotMatch(list, /<Outlet/);
  assert.match(tree, /id: '\/lots\/\$lotId'/);
  assert.match(tree, /getParentRoute: \(\) => AuthenticatedAdminRoute/);
  assert.doesNotMatch(tree, /AuthenticatedAdminLotsRouteWithChildren/);
});
