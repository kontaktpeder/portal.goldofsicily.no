import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRecallQuery,
  formatGoldLotCode,
  nextLotSequence,
  parseGoldLotCode,
  remainingAtGold,
} from "./gold-lot.ts";

test("Gold-LOT uses YYYYMMDD so codes sort chronologically", () => {
  assert.equal(formatGoldLotCode("2026-09-07", "t", 1), "L-20260907-T-01");
  assert.equal(formatGoldLotCode("2026-09-08", "T", 1), "L-20260908-T-01");
  assert.ok("L-20260907-T-01" < "L-20260908-T-01");
  assert.ok("L-20260908-T-01" < "L-20261001-T-01");
  assert.ok("L-20261001-T-01" < "L-20270103-T-01");
});

test("short DDMMYY codes still parse to the canonical Gold-LOT", () => {
  const parsed = parseGoldLotCode("l-070926-t-01");
  assert.deepEqual(parsed, {
    productionDate: "2026-09-07",
    letter: "T",
    seq: 1,
    canonical: "L-20260907-T-01",
  });
});

test("sequence increments per date and flavor letter", () => {
  assert.equal(nextLotSequence(["L-20260907-T-01", "L-20260907-N-01"], "2026-09-07", "T"), 2);
  assert.equal(nextLotSequence(["L-20260907-T-01", "L-20260907-T-02"], "2026-09-07", "T"), 3);
  assert.equal(nextLotSequence([], "2026-09-07", "N"), 1);
});

test("recall search treats Gold-LOT and supplier LOT as different lookups", () => {
  assert.deepEqual(classifyRecallQuery("L-20260907-T-01"), {
    kind: "gold_lot",
    normalized: "L-20260907-T-01",
  });
  assert.deepEqual(classifyRecallQuery("TK882"), {
    kind: "supplier_lot",
    normalized: "TK882",
  });
  assert.deepEqual(classifyRecallQuery("L-070926-T-01"), {
    kind: "gold_lot",
    normalized: "L-20260907-T-01",
  });
});

test("remaining at Gold is produced minus handed over", () => {
  assert.equal(remainingAtGold(420, 300), 120);
  assert.equal(remainingAtGold(100, 140), 0);
});
