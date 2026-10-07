import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  allocateFifo,
  canAllocate,
  deliveryLineRequiresLot,
  goldAvailableQty,
  isOpenLot,
  lotFlowTotals,
  lotsWithFormReservation,
  newestCoveringLot,
  needsLotSplit,
  suggestLotId,
  suggestVillaHandover,
  toStockLots,
  validateDeliveryStock,
  validateVillaStock,
  villaAvailableQty,
  type StockLot,
} from "./lot-stock.ts";

const lots: StockLot[] = [
  {
    id: "old",
    lotCode: "L-20260907-T-01",
    productId: "truffle",
    producedQty: 40,
    deliveredQty: 0,
    remaining: 40,
    status: "produced",
  },
  {
    id: "new",
    lotCode: "L-20260908-T-01",
    productId: "truffle",
    producedQty: 200,
    deliveredQty: 0,
    remaining: 200,
    status: "produced",
  },
];

test("newest covering LOT is chosen when it can fill the whole delivery", () => {
  assert.equal(newestCoveringLot(lots, "truffle", 120)?.id, "new");
  assert.equal(needsLotSplit(lots, "truffle", 120), false);
  assert.equal(suggestLotId(lots, "truffle", 120, ""), "new");
});

test("keeps the current LOT when it still covers the quantity", () => {
  assert.equal(suggestLotId(lots, "truffle", 40, "old"), "old");
});

test("split uses oldest remaining first when no single LOT covers the quantity", () => {
  assert.equal(needsLotSplit(lots, "truffle", 220), true);
  assert.deepEqual(allocateFifo(lots, "truffle", 220), [
    { lotId: "old", lotCode: "L-20260907-T-01", quantity: 40 },
    { lotId: "new", lotCode: "L-20260908-T-01", quantity: 180 },
  ]);
});

test("delivery lines with quantity cannot omit gold_lot_id", () => {
  assert.equal(deliveryLineRequiresLot(120, ""), false);
  assert.equal(deliveryLineRequiresLot(120, "old"), true);
  assert.equal(deliveryLineRequiresLot(0, ""), true);
  assert.deepEqual(validateDeliveryStock([{ productId: "truffle", quantity: 120, goldLotId: "" }], lots), {
    ok: false,
    reason: "missing_lot",
  });
  assert.deepEqual(
    validateDeliveryStock([{ productId: "truffle", quantity: 250, goldLotId: "new" }], lots),
    { ok: false, reason: "insufficient" },
  );
  assert.equal(canAllocate(lots, "truffle", 240), true);
  assert.equal(canAllocate(lots, "truffle", 241), false);
});

test("form reservation reduces remaining on other lines of the same LOT", () => {
  const reserved = lotsWithFormReservation(
    lots,
    [
      { productId: "truffle", quantity: 40, goldLotId: "old" },
      { productId: "truffle", quantity: 80, goldLotId: "new" },
    ],
    1,
  );
  assert.equal(reserved.find((lot) => lot.id === "old")?.remaining, 0);
  assert.equal(reserved.find((lot) => lot.id === "new")?.remaining, 200);
});

test("toStockLots subtracts venue deliveries from produced qty", () => {
  const [lot] = toStockLots([
    {
      id: "old",
      lot_code: "L-20260907-T-01",
      product_id: "truffle",
      produced_qty: 40,
      status: "produced",
      delivery_lines: [{ quantity: 10 }, { quantity: 5 }],
    },
  ]);
  assert.equal(lot?.deliveredQty, 15);
  assert.equal(lot?.remaining, 25);
});

test("packed lots stay open for stock until closed or recalled", () => {
  assert.equal(isOpenLot("packed"), true);
  assert.equal(isOpenLot("produced"), true);
  assert.equal(isOpenLot("closed"), false);
});

test("Gold stock uses approved quantity and ignores Villa-sourced deliveries", () => {
  assert.equal(
    goldAvailableQty({
      producedQty: 400,
      approvedQty: 380,
      villaHandoverQty: 100,
      directDeliveredQty: 50,
    }),
    230,
  );
  assert.equal(villaAvailableQty(100, 40), 60);
  assert.deepEqual(
    lotFlowTotals({
      producedQty: 400,
      approvedQty: 380,
      villaHandoverQty: 100,
      directDeliveredQty: 50,
      villaDeliveredQty: 40,
    }),
    { atGold: 230, atVilla: 60, deliveredToCustomers: 90, totalLeft: 290 },
  );
});

test("Villa suggestion keeps the confirmed handover and shows its LOT", () => {
  const withVilla: StockLot[] = [
    {
      ...lots[1],
      villaHandovers: [
        {
          id: "hand-old",
          lotId: "new",
          lotCode: "L-20260908-T-01",
          productId: "truffle",
          recipient: "Villa Import",
          remaining: 80,
        },
      ],
    },
  ];
  assert.deepEqual(suggestVillaHandover(withVilla, "truffle", 20, "hand-old", "old"), {
    handoverId: "hand-old",
    lotId: "new",
  });
  assert.deepEqual(
    validateVillaStock(
      [{ productId: "truffle", quantity: 90, goldLotId: "new", sourceHandoverId: "hand-old" }],
      withVilla,
    ),
    { ok: false, reason: "insufficient" },
  );
});

test("villa stock sql does not restore the historical gold-lot check", () => {
  const sql = readFileSync(new URL("../../sql/19_villa_stock_source.sql", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261007140000_villa_stock_source.sql", import.meta.url),
    "utf8",
  );
  assert.equal(sql, migration);
  assert.match(sql, /source_handover_id/);
  assert.match(sql, /COALESCE\(approved, produced\)/);
  assert.match(sql, /ownership_after_handover = 'villa'/);
  assert.equal(sql.includes("ADD CONSTRAINT delivery_lines_quantity_requires_gold_lot"), false);
});
