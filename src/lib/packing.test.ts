import assert from "node:assert/strict";
import test from "node:test";
import {
  cartonInsertRows,
  derivedCartonCount,
  formatCartonCode,
  formatNetWeight,
  formatPackageCode,
  packageInsertRows,
  packingPlanFromStored,
  planPacking,
} from "./packing.ts";

test("remainder bags get a real package ID, not a leftover note", () => {
  const plan = planPacking({
    lotCode: "L-20260907-N-01",
    approvedQty: 792,
    unitsPerPackage: 25,
    packagesPerCarton: 4,
  });
  assert.equal(plan.fullPackages, 31);
  assert.equal(plan.remainderQuantity, 17);
  assert.equal(plan.packages.length, 32);
  assert.deepEqual(plan.packages[0], {
    seq: 1,
    shortCode: "P001",
    code: "L-20260907-N-01-P001",
    quantity: 25,
  });
  assert.deepEqual(plan.packages.at(-1), {
    seq: 32,
    shortCode: "P032",
    code: "L-20260907-N-01-P032",
    quantity: 17,
  });
});

test("cartons contain specific packages, last carton may be short", () => {
  const plan = planPacking({
    lotCode: "L-20260907-N-01",
    approvedQty: 792,
    unitsPerPackage: 25,
    packagesPerCarton: 4,
  });
  assert.equal(derivedCartonCount(plan.cartons), 8);
  assert.deepEqual(plan.cartons[0]?.packageSeqs, [1, 2, 3, 4]);
  assert.equal(plan.cartons[0]?.quantity, 100);
  assert.equal(plan.cartons[0]?.code, "L-20260907-N-01-C001");
  assert.deepEqual(plan.cartons[7]?.packageSeqs, [29, 30, 31, 32]);
  assert.equal(plan.cartons[7]?.quantity, 92);
  assert.equal(plan.cartons[7]?.shortCode, "C008");
});

test("800 pieces fill eight even cartons of 100", () => {
  const plan = planPacking({
    lotCode: "L-20260907-N-01",
    approvedQty: 800,
    unitsPerPackage: 25,
    packagesPerCarton: 4,
  });
  assert.equal(plan.packages.length, 32);
  assert.equal(plan.remainderQuantity, 0);
  assert.equal(plan.cartons.length, 8);
  assert.ok(plan.cartons.every((carton) => carton.quantity === 100));
});

test("unit codes stay under the LOT, never as a parallel system", () => {
  assert.equal(formatPackageCode("L-20260907-N-01", 1), "L-20260907-N-01-P001");
  assert.equal(formatCartonCode("L-20260907-N-01", 3), "L-20260907-N-01-C003");
  assert.throws(() =>
    planPacking({
      lotCode: "L-20260907-N-01",
      approvedQty: 0,
      unitsPerPackage: 25,
      packagesPerCarton: 4,
    }),
  );
});

test("net weight follows units in the bag", () => {
  assert.equal(formatNetWeight(2500), "2,5 kg");
  assert.equal(formatNetWeight(2000), "2 kg");
  assert.equal(formatNetWeight(100), "100 g");
});

test("stored cartons keep specific package IDs, including the remainder bag", () => {
  const plan = planPacking({
    lotCode: "L-20260907-N-01",
    approvedQty: 792,
    unitsPerPackage: 25,
    packagesPerCarton: 4,
  });
  const cartonIds = new Map(plan.cartons.map((carton) => [carton.seq, `carton-${carton.seq}`]));
  const storedCartons = cartonInsertRows("lot-1", plan).map((row) => ({
    id: cartonIds.get(row.carton_seq)!,
    carton_seq: row.carton_seq,
    carton_code: row.carton_code,
  }));
  const storedPackages = packageInsertRows("lot-1", plan, cartonIds);
  assert.equal(storedPackages.at(-1)?.quantity, 17);
  assert.equal(storedPackages.at(-1)?.carton_id, "carton-8");
  assert.equal(storedPackages.at(-1)?.package_code, "L-20260907-N-01-P032");
  const restored = packingPlanFromStored({
    packages: storedPackages,
    cartons: storedCartons,
  });
  assert.deepEqual(restored.cartons[0]?.packageSeqs, [1, 2, 3, 4]);
  assert.deepEqual(restored.cartons[7]?.packageSeqs, [29, 30, 31, 32]);
  assert.equal(restored.cartons[7]?.quantity, 92);
  assert.equal(derivedCartonCount(restored.cartons), 8);
});
