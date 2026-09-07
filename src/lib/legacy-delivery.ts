export const LEGACY_DELIVERY_NOTE = "Legacy levering før nytt LOT-/pakkesystem";
export const LEGACY_DELIVERY_LIMIT = 3;

export type LegacyStampRow = {
  id: string;
  deliveredAt: string;
  createdAt: string;
  note: string | null;
};

export function isLegacyDeliveryNote(note: string | null | undefined): boolean {
  return (note ?? "").includes(LEGACY_DELIVERY_NOTE);
}

export function applyLegacyDeliveryNote(existing: string | null | undefined): string {
  const current = (existing ?? "").trim();
  if (isLegacyDeliveryNote(current)) return current || LEGACY_DELIVERY_NOTE;
  return current ? `${current}\n${LEGACY_DELIVERY_NOTE}` : LEGACY_DELIVERY_NOTE;
}

export function extraDeliveryNote(note: string | null | undefined): string | null {
  const leftover = (note ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== LEGACY_DELIVERY_NOTE)
    .join("\n")
    .trim();
  return leftover || null;
}

export function oldestDeliveries(rows: readonly LegacyStampRow[], limit = LEGACY_DELIVERY_LIMIT): LegacyStampRow[] {
  return [...rows]
    .sort((a, b) => {
      const byDate = a.deliveredAt.localeCompare(b.deliveredAt);
      if (byDate !== 0) return byDate;
      return a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, limit);
}

export function deliveriesNeedingLegacyStamp(
  rows: readonly LegacyStampRow[],
  limit = LEGACY_DELIVERY_LIMIT,
): LegacyStampRow[] {
  return oldestDeliveries(rows, limit).filter((row) => !isLegacyDeliveryNote(row.note));
}
