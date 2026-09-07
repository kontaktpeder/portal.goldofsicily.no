import { z } from "zod";
import { canManageOperations } from "./access.ts";

export const STAFF_ROLES = ["admin", "ops"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const staffCreateSchema = z.object({
  fullName: z.string().trim().min(1),
  username: z.string().trim().min(3),
  password: z.string().optional().default(""),
  role: z.enum(STAFF_ROLES),
  language: z.enum(["no", "en"]).default("no"),
  employeeNumber: z
    .union([z.string(), z.null(), z.undefined()])
    .optional()
    .transform((value) => {
      const text = (value ?? "").trim();
      return text.length > 0 ? text : null;
    }),
});

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const OWNER_INCLUDE_KEYS = [
  "role_owner_inc_partners",
  "role_owner_inc_terms",
  "role_owner_inc_access",
  "role_owner_inc_ops",
] as const;

export const OPS_INCLUDE_KEYS = [
  "role_ops_inc_lots",
  "role_ops_inc_villa",
  "role_ops_inc_delivery",
  "role_ops_inc_venues",
] as const;

export const VENUE_INCLUDE_KEYS = ["role_venue_inc_report"] as const;

export function isStaffRole(role: string): role is StaffRole {
  return role === "admin" || role === "ops";
}

export type ExistingAccountKind = "none" | "staff" | "other";
export type ExistingUsernameAction = "create" | "add_name" | "taken";

export function classifyExistingAccount(input: {
  exists: boolean;
  roles?: readonly string[] | null;
}): ExistingAccountKind {
  if (!input.exists) return "none";
  return staffRoleFromRoles(input.roles ?? []) ? "staff" : "other";
}

export function existingUsernameAction(kind: ExistingAccountKind): ExistingUsernameAction {
  if (kind === "none") return "create";
  if (kind === "staff") return "add_name";
  return "taken";
}

export function staffCreateNeedsPassword(action: ExistingUsernameAction): boolean {
  return action === "create";
}

export function staffRoleFromRoles(roles: readonly string[]): StaffRole | null {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("ops")) return "ops";
  return null;
}

export function portalHomePath(roles: readonly string[]): "/admin" | "/report" {
  return canManageOperations(roles) ? "/admin" : "/report";
}

export function canDemoteAdmin(adminCount: number): boolean {
  return adminCount > 1;
}

export function canChangeStaffRole(input: {
  currentRole: StaffRole;
  nextRole: StaffRole;
  adminCount: number;
}): { ok: true } | { ok: false; reason: "last_admin" } {
  if (input.currentRole === input.nextRole) return { ok: true };
  if (input.currentRole === "admin" && input.nextRole !== "admin" && input.adminCount <= 1) {
    return { ok: false, reason: "last_admin" };
  }
  return { ok: true };
}

export function isStaffSchemaError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid input value for enum") ||
    lower.includes("app_role") ||
    (lower.includes("ops") && lower.includes("enum"))
  );
}
