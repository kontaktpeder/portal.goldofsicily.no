export type ProductionStaff = {
  id: string;
  fullName: string;
  username: string;
  employeeNumber: string | null;
};

export type LotProducer = {
  userId: string;
  fullNameSnapshot: string;
  employeeNumberSnapshot: string | null;
};

export function snapshotProducerName(staff: ProductionStaff): string {
  return staff.fullName.trim() || staff.username;
}

export function staffPickerLine(staff: ProductionStaff): string {
  const number = staff.employeeNumber?.trim();
  return number ? `${staff.username} · ${number}` : staff.username;
}

export function formatProducedByCompat(names: readonly string[]): string | null {
  const cleaned = names.map((name) => name.trim()).filter((name) => name.length > 0);
  return cleaned.length > 0 ? cleaned.join(", ") : null;
}

export function displayProducedBy(
  producers: readonly LotProducer[],
  legacy: string | null | undefined,
): { names: string[]; legacy: string | null } {
  if (producers.length > 0) {
    return {
      names: producers.map((row) => row.fullNameSnapshot.trim()).filter(Boolean),
      legacy: null,
    };
  }
  const text = (legacy ?? "").trim();
  return { names: [], legacy: text || null };
}

export function producerInsertRows(lotId: string, staff: readonly ProductionStaff[]) {
  return staff.map((person) => ({
    gold_lot_id: lotId,
    user_id: person.id,
    full_name_snapshot: snapshotProducerName(person),
    employee_number_snapshot: person.employeeNumber?.trim() || null,
  }));
}

export function selectedProductionStaff(
  staff: readonly ProductionStaff[],
  selectedIds: readonly string[],
): ProductionStaff[] {
  const chosen = new Set(selectedIds);
  return staff.filter((person) => chosen.has(person.id));
}

export function isProducerSchemaError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "42703" ||
    /gold_lot_producers|full_name|employee_number/i.test(message)
  );
}

export function producersFromQuery(
  rows:
    | {
        user_id: string;
        full_name_snapshot: string;
        employee_number_snapshot: string | null;
      }[]
    | null
    | undefined,
): LotProducer[] {
  return (rows ?? []).map((row) => ({
    userId: row.user_id,
    fullNameSnapshot: row.full_name_snapshot,
    employeeNumberSnapshot: row.employee_number_snapshot,
  }));
}

