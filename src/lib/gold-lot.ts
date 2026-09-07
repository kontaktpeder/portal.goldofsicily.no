/** Gold-LOT master ID: L-YYYYMMDD-<letter>-NN */

export const GOLD_LOT_PATTERN = /^L-(\d{8})-([A-Z])-(\d{2,})$/;
export const GOLD_LOT_SHORT_PATTERN = /^L-(\d{6})-([A-Z])-(\d{2,})$/;

export type GoldLotStatus = "produced" | "handed_over" | "closed" | "recalled";
export type HandoverOwnership = "gold" | "villa";

export type ParsedGoldLot = {
  productionDate: string;
  letter: string;
  seq: number;
  canonical: string;
};

export function compactProductionDate(isoDate: string): string {
  return isoDate.slice(0, 10).replaceAll("-", "");
}

export function normalizeLotLetter(value: string | null | undefined): string {
  const match = (value ?? "").trim().toUpperCase().match(/[A-Z]/);
  return match?.[0] ?? "";
}

export function formatGoldLotCode(productionDate: string, letter: string, seq: number): string {
  const day = productionDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("production date must be YYYY-MM-DD");
  }
  const lotLetter = normalizeLotLetter(letter);
  if (!lotLetter) throw new Error("lot letter required");
  const n = Math.trunc(seq);
  if (!Number.isFinite(n) || n < 1) throw new Error("sequence must be >= 1");
  return `L-${compactProductionDate(day)}-${lotLetter}-${String(n).padStart(2, "0")}`;
}

export function parseGoldLotCode(code: string): ParsedGoldLot | null {
  const raw = code.trim().toUpperCase();
  const eight = raw.match(GOLD_LOT_PATTERN);
  if (eight) {
    const ymd = eight[1];
    const productionDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    const letter = eight[2];
    const seq = Number.parseInt(eight[3], 10);
    return { productionDate, letter, seq, canonical: formatGoldLotCode(productionDate, letter, seq) };
  }
  const six = raw.match(GOLD_LOT_SHORT_PATTERN);
  if (six) {
    const ddmmyy = six[1];
    const productionDate = `20${ddmmyy.slice(4, 6)}-${ddmmyy.slice(2, 4)}-${ddmmyy.slice(0, 2)}`;
    const letter = six[2];
    const seq = Number.parseInt(six[3], 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) return null;
    return { productionDate, letter, seq, canonical: formatGoldLotCode(productionDate, letter, seq) };
  }
  return null;
}

export function nextLotSequence(
  existingCodes: string[],
  productionDate: string,
  letter: string,
): number {
  const prefix = `L-${compactProductionDate(productionDate)}-${normalizeLotLetter(letter)}-`;
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const seq = Number.parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return max + 1;
}

export function remainingAtGold(producedQty: number, handedOverQty: number): number {
  return Math.max(0, producedQty - handedOverQty);
}

export function sumQuantities(values: Array<number | null | undefined>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function classifyRecallQuery(query: string): {
  kind: "gold_lot" | "supplier_lot";
  normalized: string;
} {
  const trimmed = query.trim();
  if (!trimmed) return { kind: "supplier_lot", normalized: "" };
  const parsed = parseGoldLotCode(trimmed);
  if (parsed) return { kind: "gold_lot", normalized: parsed.canonical };
  if (/^L-/i.test(trimmed)) return { kind: "gold_lot", normalized: trimmed.toUpperCase() };
  return { kind: "supplier_lot", normalized: trimmed };
}

export function todayOsloDate(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(at);
}

export function nowOsloDateTimeLocal(at = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
