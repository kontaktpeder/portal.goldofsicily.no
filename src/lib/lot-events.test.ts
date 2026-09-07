import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  affectedRecallRecipients,
  canCloseLot,
  canRecallLot,
  canRecordHandover,
  eventLine,
  handoverEventText,
  statusAfterHandover,
  statusAfterPacking,
} from "./lot-events.ts";

test("packing and handover derive status; recall can override closed", () => {
  assert.equal(statusAfterPacking("produced"), "packed");
  assert.equal(statusAfterPacking("recalled"), "recalled");
  assert.equal(statusAfterHandover("packed", 40), "packed");
  assert.equal(statusAfterHandover("packed", 0), "handed_over");
  assert.equal(statusAfterHandover("produced", 10), "produced");
  assert.equal(statusAfterHandover("closed", 0), "closed");
  assert.equal(statusAfterHandover("recalled", 0), "recalled");
  assert.equal(canCloseLot("packed"), true);
  assert.equal(canCloseLot("recalled"), false);
  assert.equal(canRecallLot("closed"), true);
  assert.equal(canRecallLot("recalled"), false);
  assert.equal(canRecordHandover("closed"), false);
});

test("handover event text names cartons and recipient without changing status by itself", () => {
  assert.equal(
    handoverEventText({ cartons: 4, quantity: 100, recipient_company: "Villa" }),
    "4 kartonger overlevert til Villa",
  );
  assert.equal(handoverEventText({ quantity: 80, recipient_company: "Oslo Bar" }), "80 stk overlevert til Oslo Bar");
  assert.deepEqual(
    affectedRecallRecipients({
      handovers: [{ recipientCompany: "Villa" }],
      venueDeliveries: [{ venueName: "Oslo Bar" }, { venueName: "Villa" }],
    }),
    ["Villa", "Oslo Bar"],
  );
  assert.equal(
    eventLine({
      id: "1",
      goldLotId: "lot",
      eventType: "created",
      createdAt: "2026-09-08T00:41:00.000Z",
      createdBy: "u1",
      reason: null,
      metadata: { actor_name: "Denis Rossi" },
    }),
    "LOT opprettet · Denis Rossi",
  );
  assert.equal(
    eventLine({
      id: "2",
      goldLotId: "lot",
      eventType: "handover",
      createdAt: "2026-09-08T09:03:00.000Z",
      createdBy: "u1",
      reason: null,
      metadata: { actor_name: "Denis Rossi", cartons: 4, quantity: 100, recipient_company: "Villa" },
    }),
    "4 kartonger overlevert til Villa · Denis Rossi",
  );
});

test("lot events SQL is append-only and does not invent packing history", () => {
  const sql = readFileSync(new URL("../../sql/15_lot_events.sql", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260907240000_lot_events.sql", import.meta.url),
    "utf8",
  );
  const page = readFileSync(
    new URL("../routes/_authenticated/admin.lots.$lotId.tsx", import.meta.url),
    "utf8",
  );
  const index = readFileSync(
    new URL("../routes/_authenticated/admin.lots.index.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(sql, migration);
  assert.match(sql, /gold_lot_events/);
  assert.match(sql, /recalled_at/);
  assert.match(sql, /recall_reason/);
  assert.doesNotMatch(sql, /FOR UPDATE/);
  assert.doesNotMatch(sql, /FOR DELETE/);
  assert.match(sql, /event_type = 'created'/);
  assert.doesNotMatch(page, /<option value="recalled">/);
  assert.doesNotMatch(page, /<option value="produced">/);
  assert.match(page, /lot_recall_start/);
  assert.match(page, /lot_close/);
  assert.match(page, /statusAfterHandover/);
  assert.match(index, /eventType: "created"/);
});
