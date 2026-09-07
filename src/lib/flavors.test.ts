import assert from "node:assert/strict";
import test from "node:test";
import { deliveryLinesPayload } from "./flavors.ts";

test("delivery lines carry the Gold-LOT master ID", () => {
  const lines = deliveryLinesPayload("delivery-1", [
    {
      productId: "truffle",
      nameNo: "Trøffel",
      nameEn: "Truffle",
      quantity: 120,
      goldLotId: "lot-uuid",
    },
    {
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
