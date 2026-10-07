import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deliveryDriverPatch,
  deliveryEditConfirm,
  deliveryEditPatch,
  deliverySettingsPatch,
  driverOptionLabel,
  isDeliveryDriverSchemaError,
  suggestedDeliveredBy,
} from "./delivery-driver.ts";

test("registration suggests the signed-in staff member and nobody else", () => {
  const staff = ["user-peder", "user-denis"];
  assert.equal(suggestedDeliveredBy(staff, "user-denis"), "user-denis");
  assert.equal(suggestedDeliveredBy(staff, "user-venue"), "");
  assert.equal(suggestedDeliveredBy(staff, null), "");
  assert.equal(suggestedDeliveredBy([], "user-denis"), "");
});

test("driver option shows the frozen-style name and employee number", () => {
  assert.equal(
    driverOptionLabel({ fullName: "Denis Rossi", username: "denis", employeeNumber: "GOS-004" }),
    "Denis Rossi · GOS-004",
  );
  assert.equal(
    driverOptionLabel({ fullName: "  ", username: "peder", employeeNumber: null }),
    "peder",
  );
});

test("delivery settings edit date and note, and the driver is a separate patch", () => {
  assert.deepEqual(deliverySettingsPatch({ deliveredAt: "2026-10-04", note: "  bakdør " }), {
    delivered_at: "2026-10-04",
    note: "bakdør",
  });
  assert.deepEqual(deliverySettingsPatch({ deliveredAt: "2026-10-04", note: "  " }), {
    delivered_at: "2026-10-04",
    note: null,
  });
  assert.deepEqual(deliveryDriverPatch("user-denis"), { delivered_by: "user-denis" });
  assert.deepEqual(deliveryDriverPatch(""), { delivered_by: null });
  assert.deepEqual(Object.keys(deliveryDriverPatch("user-denis")), ["delivered_by"]);
});

test("a missing driver column is retried, a staff rule is not", () => {
  assert.equal(
    isDeliveryDriverSchemaError("Could not find the 'delivered_by' column of 'deliveries' in the schema cache"),
    true,
  );
  assert.equal(isDeliveryDriverSchemaError("delivery driver must be staff"), false);
  assert.equal(isDeliveryDriverSchemaError("missing price snapshot"), false);
});

test("driver sql freezes the name and leaves commerce columns alone", () => {
  const sql = readFileSync(new URL("../../sql/18_delivery_driver.sql", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261004120000_delivery_driver.sql", import.meta.url),
    "utf8",
  );
  assert.equal(sql, migration);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF delivered_by/);
  assert.match(sql, /NEW\.delivered_by_name := person_name/);
  assert.equal(sql.includes("commercial_route"), false);
  assert.equal(sql.includes("unit_price_ore"), false);
});

test("an edit writes only the fields that changed", () => {
  const saved = {
    deliveredAt: "2026-10-04T12:00:00.000Z",
    note: "bakdør",
    deliveredBy: "user-denis",
  };
  assert.deepEqual(
    deliveryEditPatch(saved, { deliveredAt: "2026-10-05", note: "bakdør", deliveredBy: "user-denis" }),
    { delivered_at: "2026-10-05" },
  );
  assert.deepEqual(
    deliveryEditPatch(saved, { deliveredAt: "2026-10-04", note: "  ", deliveredBy: "user-denis" }),
    { note: null },
  );
  assert.deepEqual(
    deliveryEditPatch(saved, { deliveredAt: "2026-10-04", note: "bakdør", deliveredBy: "" }),
    { delivered_by: null },
  );
  assert.deepEqual(
    deliveryEditPatch(saved, { deliveredAt: "2026-10-04", note: " bakdør ", deliveredBy: "user-denis" }),
    {},
  );
  assert.deepEqual(
    deliveryEditPatch(saved, { deliveredAt: "2026-10-06", note: "kveld", deliveredBy: "user-peder" }),
    { delivered_at: "2026-10-06", note: "kveld", delivered_by: "user-peder" },
  );
  assert.equal(
    deliveryEditConfirm(
      deliveryEditPatch(saved, { deliveredAt: "2026-10-05", note: "bakdør", deliveredBy: "user-denis" }),
    ),
    "settings",
  );
  assert.equal(
    deliveryEditConfirm(
      deliveryEditPatch(saved, { deliveredAt: "2026-10-04", note: "bakdør", deliveredBy: "user-peder" }),
    ),
    "driver",
  );
  assert.equal(
    deliveryEditConfirm(
      deliveryEditPatch(saved, { deliveredAt: "2026-10-05", note: "kveld", deliveredBy: "user-peder" }),
    ),
    "both",
  );
  assert.equal(deliveryEditConfirm({}), "none");
});

test("the delivery screen confirms one edit and suggests the signed-in driver", () => {
  const page = readFileSync(
    new URL("../routes/_authenticated/admin.deliveries.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /suggestedDeliveredBy/);
  assert.match(page, /deliveryNeedsStockSourceChoice/);
  assert.match(page, /DeliveryRecordEditor/);
  assert.doesNotMatch(page, /DeliveryDriverEditor/);
  assert.doesNotMatch(page, /\.update\(\{[^}]*customer_id/);
  assert.doesNotMatch(page, /\.update\(\{[^}]*commercial_route/);

  const editor = readFileSync(
    new URL("../components/delivery-driver-editor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(editor, /deliveryEditPatch/);
  assert.match(editor, /deliveryEditConfirm/);
  assert.match(editor, /delivery_edit_with_driver/);
  assert.match(editor, /duration: Infinity/);
  assert.equal(editor.match(/toast\(/g)?.length, 1);

  const venue = readFileSync(
    new URL("../routes/_authenticated/admin.venues.$venueId.tsx", import.meta.url),
    "utf8",
  );
  assert.match(venue, /DeliveryRecordEditor/);
  assert.doesNotMatch(venue, /DeliveryDriverEditor/);

  const link = readFileSync(new URL("../components/delivery-lot-link.tsx", import.meta.url), "utf8");
  assert.match(link, /missingLot \? t\("link_lot"\) : t\("change_lot"\)/);

  const lotPage = readFileSync(
    new URL("../routes/_authenticated/admin.lots.$lotId.tsx", import.meta.url),
    "utf8",
  );
  assert.match(lotPage, /deliver_direct/);
  assert.match(lotPage, /showVillaStockMetrics/);
  assert.doesNotMatch(lotPage, /ops_handover_villa/);
});
