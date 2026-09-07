import assert from "node:assert/strict";
import test from "node:test";
import { deliveryLinesPayload, initialDeliveryQtys } from "./flavors.ts";

test("delivery lines carry the Gold-LOT master ID and skip zero qty", () => {
  const lines = deliveryLinesPayload("delivery-1", [
    {
      rowId: "truffle::lot-uuid",
      productId: "truffle",
      nameNo: "Trøffel",
      nameEn: "Truffle",
      quantity: 120,
      goldLotId: "lot-uuid",
    },
    {
      rowId: "nduja",
      productId: "nduja",
      nameNo: "Nduja",
      nameEn: "Nduja",
      quantity: 0,
      goldLotId: "",
    },
  ]);
  assert.deepEqual(lines, [
    {
      delivery_id: "delivery-1",
      product_id: "truffle",
      quantity: 120,
      gold_lot_id: "lot-uuid",
    },
  ]);
});

test("payload refuses quantity without gold_lot_id", () => {
  assert.throws(
    () =>
      deliveryLinesPayload("delivery-1", [
        {
          rowId: "truffle",
          productId: "truffle",
          nameNo: "Trøffel",
          nameEn: "Truffle",
          quantity: 40,
          goldLotId: "",
        },
      ]),
    /requires gold_lot_id/,
  );
});

test("initial delivery rows are one per flavor", () => {
  const rows = initialDeliveryQtys([
    { id: "t", name_no: "Trøffel", name_en: "Truffle", slug: "truffle", lot_letter: "T" },
  ]);
  assert.equal(rows[0]?.rowId, "t");
  assert.equal(rows[0]?.goldLotId, "");
});
