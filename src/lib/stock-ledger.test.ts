import assert from "node:assert/strict";
import test from "node:test";
import { buildStockLedger } from "./stock-ledger.ts";

const now = new Date("2026-10-25T18:00:00Z");

test("the buy page counts open Gold stock only, in whole boxes of 50", () => {
  const rows = buildStockLedger({
    lang: "no",
    now,
    holds: [
      {
        productId: "p-n",
        pieces: 50,
        status: "held",
        expiresAt: "2026-10-25T18:10:00Z",
      },
    ],
    products: [
      { id: "p-n", slug: "nduja", lotLetter: "N", nameNo: "’Nduja", nameEn: "’Nduja" },
      { id: "p-t", slug: "truffle", lotLetter: "T", nameNo: "Trøffel", nameEn: "Truffle" },
      { id: "p-o", slug: "other", lotLetter: null, nameNo: "Annen", nameEn: "Other" },
    ],
    lots: [
      {
        id: "open",
        lotCode: "L-20261020-N-01",
        productId: "p-n",
        status: "packed",
        atGold: 250,
        atVilla: 40,
        approvedQty: 250,
        previousStatus: null,
      },
      {
        id: "closed",
        lotCode: "L-20261001-N-01",
        productId: "p-n",
        status: "closed",
        atGold: 300,
        atVilla: 0,
        approvedQty: 300,
        previousStatus: "packed",
      },
      {
        id: "recalled",
        lotCode: "L-20260901-N-01",
        productId: "p-n",
        status: "recalled",
        atGold: 100,
        atVilla: 0,
        approvedQty: 100,
        previousStatus: null,
      },
      {
        id: "truffle",
        lotCode: "L-20261020-T-01",
        productId: "p-t",
        status: "produced",
        atGold: 70,
        atVilla: 0,
        approvedQty: null,
        previousStatus: null,
      },
    ],
  });

  const nduja = rows.find((row) => row.key === "nduja");
  assert.ok(nduja);
  assert.equal(nduja.openAtGold, 250);
  assert.equal(nduja.openAtVilla, 40);
  assert.equal(nduja.closedAtGold, 300);
  assert.equal(nduja.recalledAtGold, 100);
  assert.equal(nduja.heldPieces, 50);
  assert.equal(nduja.websiteBoxes, 4);
  assert.equal(nduja.websiteRemainder, 0);
  assert.equal(nduja.lots[0]?.bucket, "open");
  assert.equal(nduja.lots.find((lot) => lot.id === "closed")?.restoreTo, "packed");
  assert.equal(nduja.lots.find((lot) => lot.id === "recalled")?.restoreTo, null);

  const truffle = rows.find((row) => row.key === "truffle");
  assert.equal(truffle?.websiteBoxes, 1);
  assert.equal(truffle?.websiteRemainder, 20);
  assert.equal(
    rows.some((row) => row.key === "p-o"),
    false,
  );
});
