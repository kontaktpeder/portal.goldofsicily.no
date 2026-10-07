export function suggestedDeliveredBy(
  staffIds: readonly string[],
  currentUserId: string | null,
): string {
  if (currentUserId && staffIds.includes(currentUserId)) return currentUserId;
  return "";
}

export function driverOptionLabel(staff: {
  fullName: string;
  username: string;
  employeeNumber: string | null;
}): string {
  const name = staff.fullName.trim() || staff.username;
  const number = staff.employeeNumber?.trim();
  return number ? `${name} · ${number}` : name;
}

export type DeliverySettingsPatch = {
  delivered_at: string;
  note: string | null;
};

/** Date and note only. The driver is a separate edit so a date change cannot clear who delivered. */
export function deliverySettingsPatch(input: {
  deliveredAt: string;
  note: string;
}): DeliverySettingsPatch {
  return {
    delivered_at: input.deliveredAt,
    note: input.note.trim() || null,
  };
}

/** After-the-fact change of who delivered. Customer, route, prices, date, and note stay as they are. */
export function deliveryDriverPatch(deliveredBy: string): { delivered_by: string | null } {
  return { delivered_by: deliveredBy || null };
}

export type DeliveryEditPatch = {
  delivered_at?: string;
  note?: string | null;
  delivered_by?: string | null;
};

export type DeliveryEditConfirm = "none" | "settings" | "driver" | "both";

function deliveryDateKey(value: string): string {
  return value.slice(0, 10);
}

/** Only the fields that differ. A date change never sends the driver, and the reverse. */
export function deliveryEditPatch(
  saved: { deliveredAt: string; note: string | null; deliveredBy: string | null },
  next: { deliveredAt: string; note: string; deliveredBy: string },
): DeliveryEditPatch {
  const patch: DeliveryEditPatch = {};
  const deliveredAt = deliveryDateKey(next.deliveredAt);
  if (deliveredAt !== deliveryDateKey(saved.deliveredAt)) patch.delivered_at = deliveredAt;
  const note = next.note.trim() || null;
  if (note !== (saved.note?.trim() || null)) patch.note = note;
  const deliveredBy = next.deliveredBy || null;
  if (deliveredBy !== (saved.deliveredBy || null)) patch.delivered_by = deliveredBy;
  return patch;
}

/** One confirmation. A driver change is called out on its own or together with the other fields. */
export function deliveryEditConfirm(patch: DeliveryEditPatch): DeliveryEditConfirm {
  const driver = Object.hasOwn(patch, "delivered_by");
  const settings = Object.hasOwn(patch, "delivered_at") || Object.hasOwn(patch, "note");
  if (driver && settings) return "both";
  if (driver) return "driver";
  if (settings) return "settings";
  return "none";
}

export function isDeliveryDriverSchemaError(message: string): boolean {
  return /delivered_by/.test(message);
}
