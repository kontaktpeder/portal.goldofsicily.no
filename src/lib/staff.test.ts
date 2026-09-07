import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canManageCommercial, canManageOperations } from "./access.ts";
import {
  canChangeStaffRole,
  canDemoteAdmin,
  classifyExistingAccount,
  existingUsernameAction,
  isStaffRole,
  isStaffSchemaError,
  OPS_INCLUDE_KEYS,
  OWNER_INCLUDE_KEYS,
  portalHomePath,
  staffCreateNeedsPassword,
  staffCreateSchema,
  staffRoleFromRoles,
  VENUE_INCLUDE_KEYS,
} from "./staff.ts";

test("staff create payload accepts eier and drift, not sted", () => {
  assert.equal(
    staffCreateSchema.parse({
      fullName: "Denis Rossi",
      username: "denis",
      password: "secret1",
      role: "ops",
      employeeNumber: "GOS-004",
    }).employeeNumber,
    "GOS-004",
  );
  assert.equal(
    staffCreateSchema.parse({ fullName: "Peder Holm", username: "peder", password: "secret1", role: "admin" })
      .role,
    "admin",
  );
  assert.equal(
    staffCreateSchema.parse({ fullName: "Denis Rossi", username: "denis", role: "ops" }).password,
    "",
  );
  assert.throws(() => staffCreateSchema.parse({ username: "bar", password: "secret1", role: "venue" }));
  assert.throws(() =>
    staffCreateSchema.parse({ fullName: "   ", username: "denis", password: "secret1", role: "ops" }),
  );
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

test("production staff lookup is separate from staff admin listing", () => {
  const src = readFileSync(new URL("./admin.functions.ts", import.meta.url), "utf8");
  assert.match(src, /export const listProductionStaff/);
  assert.match(src, /export const listStaffAccounts/);
  const lookup = src.split("export const listProductionStaff")[1]?.split("export const")[0] ?? "";
  assert.match(lookup, /assertOperations/);
  assert.doesNotMatch(lookup, /preferred_language|role: role\.role|password/);
  assert.match(lookup, /full_name/);
  assert.match(lookup, /employee_number/);
});

test("staff page imports login identifier helpers before using them", () => {
  const page = readFileSync(
    new URL("../routes/_authenticated/admin.staff.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /import \{ isValidUsername, parseLoginIdentifier \} from "@\/lib\/username"/);
  assert.match(page, /parseLoginIdentifier\(username\)/);
  assert.match(page, /isValidUsername\(username\)/);
});

test("existing Gold staff get a name on their row instead of username taken", () => {
  assert.equal(classifyExistingAccount({ exists: false }), "none");
  assert.equal(classifyExistingAccount({ exists: true, roles: ["admin"] }), "staff");
  assert.equal(classifyExistingAccount({ exists: true, roles: ["ops"] }), "staff");
  assert.equal(classifyExistingAccount({ exists: true, roles: ["venue"] }), "other");
  assert.equal(existingUsernameAction("none"), "create");
  assert.equal(existingUsernameAction("staff"), "add_name");
  assert.equal(existingUsernameAction("other"), "taken");
  assert.equal(staffCreateNeedsPassword("create"), true);
  assert.equal(staffCreateNeedsPassword("add_name"), false);
  const create = readFileSync(new URL("./admin.functions.ts", import.meta.url), "utf8");
  const handler = create.split("export const createStaffAccount")[1]?.split("export const")[0] ?? "";
  assert.match(handler, /existingUsernameAction/);
  assert.match(handler, /full_name: data\.fullName/);
  assert.match(handler, /existing: true/);
  const page = readFileSync(
    new URL("../routes/_authenticated/admin.staff.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /staff_add_name/);
  assert.match(page, /staff_name_saved_existing/);
  assert.doesNotMatch(page, /if \(!username\.trim\(\) \|\| password\.length < 6\)/);
});
