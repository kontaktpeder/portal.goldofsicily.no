import assert from "node:assert/strict";
import test from "node:test";
import { distanceMeters, FREIGHT_KM5_ORE, HANDOVER_POINT, zoneForMeters } from "./delivery-zone.ts";

test("delivery price steps at 5, 10 and 15 kilometres", () => {
  assert.deepEqual(zoneForMeters(5_000), { zone: "km5", freightOre: 6_000 });
  assert.equal(zoneForMeters(5_001).zone, "km10");
  assert.equal(zoneForMeters(10_000).freightOre, 17_900);
  assert.equal(zoneForMeters(10_001).zone, "km15");
  assert.equal(zoneForMeters(15_000).freightOre, 34_900);
  assert.deepEqual(zoneForMeters(15_001), { zone: "outside", freightOre: null });
});

test("Sorgenfrigata 4 is inside the 60 kr zone from Smalgangen", () => {
  const meters = distanceMeters(HANDOVER_POINT, {
    lat: 59.92699319555878,
    lon: 10.716837838885956,
  });
  assert.ok(meters > 2_000 && meters < 4_000);
  assert.equal(zoneForMeters(meters).freightOre, FREIGHT_KM5_ORE);
});
