import assert from "node:assert/strict";
import test from "node:test";
import {
  displayProducedBy,
  formatProducedByCompat,
  producerInsertRows,
  selectedProductionStaff,
  snapshotProducerName,
  staffPickerLine,
  type ProductionStaff,
} from "./lot-producers.ts";

const denis: ProductionStaff = {
  id: "user-denis",
  fullName: "Denis Rossi",
  username: "denis",
  employeeNumber: "GOS-004",
};
const peder: ProductionStaff = {
  id: "user-peder",
  fullName: "Peder Holm",
  username: "peder",
  employeeNumber: null,
};

test("produced_by compat string is joined snapshot names, not usernames", () => {
  assert.equal(formatProducedByCompat(["Denis Rossi", "Peder Holm"]), "Denis Rossi, Peder Holm");
  assert.equal(snapshotProducerName(denis), "Denis Rossi");
  assert.equal(staffPickerLine(denis), "denis · GOS-004");
  assert.equal(staffPickerLine(peder), "peder");
});

test("producer rows keep the user id and freeze name plus optional employee number", () => {
  const rows = producerInsertRows("lot-1", [denis, peder]);
  assert.deepEqual(rows[0], {
    gold_lot_id: "lot-1",
    user_id: "user-denis",
    full_name_snapshot: "Denis Rossi",
    employee_number_snapshot: "GOS-004",
  });
  assert.equal(rows[1]?.user_id, "user-peder");
  assert.equal(rows[1]?.employee_number_snapshot, null);
});

test("structured producers win over a legacy free-text produced_by value", () => {
  const shown = displayProducedBy(
    [
      { userId: "user-denis", fullNameSnapshot: "Denis Rossi", employeeNumberSnapshot: "GOS-004" },
      { userId: "user-peder", fullNameSnapshot: "Peder Holm", employeeNumberSnapshot: null },
    ],
    "Denis",
  );
  assert.deepEqual(shown.names, ["Denis Rossi", "Peder Holm"]);
  assert.equal(shown.legacy, null);
});

test("old LOT text is shown as legacy and is not guessed as a user", () => {
  const shown = displayProducedBy([], "Denis");
  assert.deepEqual(shown.names, []);
  assert.equal(shown.legacy, "Denis");
  assert.equal(selectedProductionStaff([denis, peder], []).length, 0);
  assert.deepEqual(
    selectedProductionStaff([denis, peder], ["user-denis"]).map((row) => row.id),
    ["user-denis"],
  );
});
