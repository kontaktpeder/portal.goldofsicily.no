export type AppRole = "admin" | "ops" | "venue";

/** Move product through the chain: produce, hand over, deliver, recall. */
export function canManageOperations(roles: readonly string[]): boolean {
  return roles.includes("admin") || roles.includes("ops");
}

/** Change who Gold does business with, and on what terms. */
export function canManageCommercial(roles: readonly string[]): boolean {
  return roles.includes("admin");
}

export function canSubmitVenueReport(roles: readonly string[]): boolean {
  return roles.includes("venue") || roles.includes("admin") || roles.includes("ops");
}
