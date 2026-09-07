import assert from "node:assert/strict";
import test from "node:test";
import { canManageCommercial, canManageOperations, canSubmitVenueReport } from "./access.ts";

test("admin can run operations and commercial today", () => {
  assert.equal(canManageOperations(["admin"]), true);
  assert.equal(canManageCommercial(["admin"]), true);
  assert.equal(canSubmitVenueReport(["admin"]), true);
});

test("ops can run the chain but not commercial terms", () => {
  assert.equal(canManageOperations(["ops"]), true);
  assert.equal(canManageCommercial(["ops"]), false);
  assert.equal(canSubmitVenueReport(["ops"]), true);
});

test("venue can only submit the shift report", () => {
  assert.equal(canManageOperations(["venue"]), false);
  assert.equal(canManageCommercial(["venue"]), false);
  assert.equal(canSubmitVenueReport(["venue"]), true);
});
