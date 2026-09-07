import assert from "node:assert/strict";
import test from "node:test";
import { cartonLabelsDocument, lotLookupUrl, packageLabelsDocument } from "./labels.ts";
import { planPacking } from "./packing.ts";
import { snapshotProductVersion } from "./product-version.ts";

const snapshot = snapshotProductVersion({
  nameNo: "'Nduja & Mozzarella",
  nameEn: "'Nduja & Mozzarella",
  sku: "GOS-NDUJA",
  ingredientsNo: "ris, HVETE, MELK",
  allergensNo: "HVETE, MELK",
  prepNo: "Frityr: 170 °C / ca. 6 min",
  unitWeightG: 100,
  unitsPerPackage: 25,
  packagesPerCarton: 4,
  producerAddress: "Oslo",
});

test("product version snapshot is frozen and does not follow later live edits", () => {
  const frozen = snapshot.fingerprint;
  const later = snapshotProductVersion({
    ...snapshot,
    ingredientsNo: "ris, HVETE, MELK, ny olje",
  });
  assert.notEqual(frozen, later.fingerprint);
  assert.equal(snapshot.ingredientsNo.includes("ny olje"), false);
});

test("package labels print full food marking from the LOT snapshot", () => {
  const plan = planPacking({
    lotCode: "L-20260907-N-01",
    approvedQty: 25,
    unitsPerPackage: 25,
    packagesPerCarton: 4,
  });
  const html = packageLabelsDocument(
    { lotCode: "L-20260907-N-01", productionDate: "2026-09-07", snapshot },
    plan,
  );
  assert.match(html, /L-20260907-N-01/);
  assert.match(html, /P001/);
  assert.match(html, /DYPFRYST/);
  assert.match(html, /HVETE/);
  assert.match(html, /Bør ikke fryses på nytt/);
  assert.match(html, /2,5 kg/);
  assert.match(html, /06\.03\.2027/);
  assert.equal(html.includes("ny olje"), false);
  assert.match(html, new RegExp(lotLookupUrl("L-20260907-N-01").replaceAll("/", "\\/")));
});

test("carton labels stay short and name the carton under the LOT", () => {
  const plan = planPacking({
    lotCode: "L-20260907-N-01",
    approvedQty: 800,
    unitsPerPackage: 25,
    packagesPerCarton: 4,
  });
  const html = cartonLabelsDocument(
    { lotCode: "L-20260907-N-01", productionDate: "2026-09-07", snapshot },
    plan,
  );
  assert.match(html, /C003/);
  assert.match(html, /4 × 25 stk/);
  assert.match(html, /100 stk/);
  assert.doesNotMatch(html, /Ingredienser:/);
});
