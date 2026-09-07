import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateFifo,
  canAllocate,
  deliveryLineRequiresLot,
  lotsWithFormReservation,
  newestCoveringLot,
  needsLotSplit,
  suggestLotId,
  toStockLots,
  validateDeliveryStock,
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
