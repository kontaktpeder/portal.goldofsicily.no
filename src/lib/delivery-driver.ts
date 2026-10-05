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

export function isDeliveryDriverSchemaError(message: string): boolean {
  return /delivered_by/.test(message);
}
