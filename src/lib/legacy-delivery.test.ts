import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyLegacyDeliveryNote,
  deliveriesNeedingLegacyStamp,
  extraDeliveryNote,
  isLegacyDeliveryNote,
  LEGACY_DELIVERY_NOTE,
  oldestDeliveries,
} from "./legacy-delivery.ts";

test("legacy note is the Mattilsynet audit phrase and is not duplicated", () => {
  assert.equal(LEGACY_DELIVERY_NOTE, "Legacy levering før nytt LOT-/pakkesystem");
  assert.equal(isLegacyDeliveryNote(null), false);
  assert.equal(isLegacyDeliveryNote("Kveldskjøring"), false);
  assert.equal(isLegacyDeliveryNote(LEGACY_DELIVERY_NOTE), true);
  assert.equal(applyLegacyDeliveryNote(null), LEGACY_DELIVERY_NOTE);
  assert.equal(applyLegacyDeliveryNote("  "), LEGACY_DELIVERY_NOTE);
  assert.equal(applyLegacyDeliveryNote(LEGACY_DELIVERY_NOTE), LEGACY_DELIVERY_NOTE);
  assert.equal(
    applyLegacyDeliveryNote("Kveldskjøring"),
    `Kveldskjøring\n${LEGACY_DELIVERY_NOTE}`,
  );
  assert.equal(extraDeliveryNote(LEGACY_DELIVERY_NOTE), null);
  assert.equal(extraDeliveryNote(`Kveldskjøring\n${LEGACY_DELIVERY_NOTE}`), "Kveldskjøring");
});

test("only the three oldest deliveries are stamped, without inventing packing", () => {
  const rows = [
    { id: "new-1", deliveredAt: "2026-09-07", createdAt: "2026-09-07T20:00:00Z", note: null },
    { id: "old-2", deliveredAt: "2026-09-05", createdAt: "2026-09-05T12:00:00Z", note: "Kveld" },
    { id: "old-1", deliveredAt: "2026-09-04", createdAt: "2026-09-04T09:00:00Z", note: null },
    { id: "old-3", deliveredAt: "2026-09-06", createdAt: "2026-09-06T08:00:00Z", note: null },
    { id: "new-2", deliveredAt: "2026-09-08", createdAt: "2026-09-08T10:00:00Z", note: null },
  ];
  assert.deepEqual(
    oldestDeliveries(rows).map((row) => row.id),
    ["old-1", "old-2", "old-3"],
  );
  const already = rows.map((row) =>
    row.id === "old-1" ? { ...row, note: LEGACY_DELIVERY_NOTE } : row,
  );
  assert.deepEqual(
    deliveriesNeedingLegacyStamp(already).map((row) => row.id),
    ["old-2", "old-3"],
  );
  assert.deepEqual(deliveriesNeedingLegacyStamp(already.map((row) => ({
    ...row,
    note: applyLegacyDeliveryNote(row.note),
  }))), []);
});

test("legacy SQL stamps notes on the three oldest deliveries and does not invent P/C or supplier lots", () => {
  const sql = readFileSync(new URL("../../sql/15_legacy_deliveries.sql", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260907233000_legacy_deliveries.sql", import.meta.url),
    "utf8",
  );
  const deliveriesPage = readFileSync(
    new URL("../routes/_authenticated/admin.deliveries.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(sql, migration);
  assert.match(sql, /Legacy levering før nytt LOT-\/pakkesystem/);
  assert.match(sql, /LIMIT 3/);
  assert.match(sql, /UPDATE public\.deliveries/);
  assert.doesNotMatch(sql, /gold_lot_packages/);
  assert.doesNotMatch(sql, /gold_lot_cartons/);
  assert.doesNotMatch(sql, /gold_lot_ingredients/);
  assert.doesNotMatch(sql, /INSERT INTO/);
  assert.match(deliveriesPage, /deliveriesNeedingLegacyStamp/);
  assert.match(deliveriesPage, /applyLegacyDeliveryNote/);
});
