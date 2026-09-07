import assert from "node:assert/strict";
import test from "node:test";
import { canManageCommercial, canManageOperations } from "./access.ts";
import {
  canChangeStaffRole,
  canDemoteAdmin,
  isStaffRole,
  isStaffSchemaError,
  OPS_INCLUDE_KEYS,
  OWNER_INCLUDE_KEYS,
  portalHomePath,
  staffCreateSchema,
  staffRoleFromRoles,
  VENUE_INCLUDE_KEYS,
} from "./staff.ts";

test("staff create payload accepts eier and drift, not sted", () => {
  assert.equal(staffCreateSchema.parse({ username: "denis", password: "secret1", role: "ops" }).role, "ops");
  assert.equal(
    staffCreateSchema.parse({ username: "peder", password: "secret1", role: "admin" }).role,
    "admin",
  );
  assert.throws(() => staffCreateSchema.parse({ username: "bar", password: "secret1", role: "venue" }));
});

test("role cards list what each access level includes", () => {
  assert.equal(OWNER_INCLUDE_KEYS.length, 4);
  assert.equal(OPS_INCLUDE_KEYS.length, 4);
  assert.equal(VENUE_INCLUDE_KEYS.length, 1);
  assert.ok(OWNER_INCLUDE_KEYS.includes("role_owner_inc_access"));
  assert.ok(OPS_INCLUDE_KEYS.includes("role_ops_inc_lots"));
});

test("drift logs into ops home, sted into the shift report", () => {
  assert.equal(portalHomePath(["ops"]), "/admin");
  assert.equal(portalHomePath(["admin"]), "/admin");
  assert.equal(portalHomePath(["venue"]), "/report");
  assert.equal(canManageOperations(["ops"]), true);
  assert.equal(canManageCommercial(["ops"]), false);
});

test("the last eier cannot be demoted to drift", () => {
  assert.equal(canDemoteAdmin(1), false);
  assert.equal(canDemoteAdmin(2), true);
  assert.deepEqual(canChangeStaffRole({ currentRole: "admin", nextRole: "ops", adminCount: 1 }), {
    ok: false,
    reason: "last_admin",
  });
  assert.deepEqual(canChangeStaffRole({ currentRole: "admin", nextRole: "ops", adminCount: 2 }), {
    ok: true,
  });
});

test("staffRoleFromRoles prefers eier over drift", () => {
  assert.equal(staffRoleFromRoles(["ops", "admin"]), "admin");
  assert.equal(isStaffRole("venue"), false);
  assert.equal(isStaffRole("ops"), true);
});

test("missing ops enum is detected from postgres errors", () => {
  assert.equal(isStaffSchemaError('invalid input value for enum app_role: "ops"'), true);
  assert.equal(isStaffSchemaError("Username is already taken"), false);
});
