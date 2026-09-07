import type { GoldLotStatus } from "./gold-lot.ts";

export const LOT_EVENT_TYPES = ["created", "packed", "handover", "closed", "recalled"] as const;
export type LotEventType = (typeof LOT_EVENT_TYPES)[number];

export type LotEventMetadata = {
  actor_name?: string | null;
  quantity?: number;
  cartons?: number;
  recipient_company?: string;
  approved_qty?: number;
  package_count?: number;
  carton_count?: number;
  recipients?: string[];
  legacy?: boolean;
};

export type LotEvent = {
  id: string;
  goldLotId: string;
  eventType: LotEventType;
  createdAt: string;
  createdBy: string | null;
  reason: string | null;
  metadata: LotEventMetadata;
};

export function isLotEventType(value: string): value is LotEventType {
  return (LOT_EVENT_TYPES as readonly string[]).includes(value);
}

export function statusAfterPacking(current: GoldLotStatus): GoldLotStatus {
  if (current === "recalled" || current === "closed" || current === "handed_over") return current;
  return "packed";
}

/** Handover records what moved. Status is where the LOT stands now. */
export function statusAfterHandover(current: GoldLotStatus, remainingAtGold: number): GoldLotStatus {
  if (current === "recalled" || current === "closed") return current;
  if (remainingAtGold <= 0) return "handed_over";
  if (current === "packed") return "packed";
  return "produced";
}

export function canCloseLot(status: GoldLotStatus): boolean {
  return status !== "recalled" && status !== "closed";
}

export function canRecallLot(status: GoldLotStatus): boolean {
  return status !== "recalled";
}

export function canRecordHandover(status: GoldLotStatus): boolean {
  return status !== "recalled" && status !== "closed";
}

export function isEventSchemaError(error: { message?: string } | null | undefined): boolean {
  const message = error?.message ?? "";
  return /gold_lot_events|gold_lot_event_type|recalled_at|recall_reason/i.test(message);
}

export function affectedRecallRecipients(input: {
  handovers: readonly { recipientCompany: string }[];
  venueDeliveries: readonly { venueName: string }[];
}): string[] {
  const names = new Set<string>();
  for (const row of input.handovers) {
    if (row.recipientCompany.trim()) names.add(row.recipientCompany.trim());
  }
  for (const row of input.venueDeliveries) {
    if (row.venueName.trim()) names.add(row.venueName.trim());
  }
  return [...names];
}

export function handoverEventText(meta: LotEventMetadata, lang: "no" | "en" = "no"): string {
  const to = (meta.recipient_company ?? "").trim() || "—";
  if (meta.cartons && meta.cartons > 0) {
    return lang === "en"
      ? `${meta.cartons} cartons handed over to ${to}`
      : `${meta.cartons} kartonger overlevert til ${to}`;
  }
  const qty = meta.quantity ?? 0;
  return lang === "en" ? `${qty} pcs handed over to ${to}` : `${qty} stk overlevert til ${to}`;
}

export function actorNameFromEvent(event: Pick<LotEvent, "metadata">): string | null {
  const name = event.metadata.actor_name?.trim();
  return name || null;
}

const EVENT_ACTION_NO: Record<Exclude<LotEventType, "handover">, string> = {
  created: "LOT opprettet",
  packed: "LOT pakket",
  closed: "LOT lukket",
  recalled: "Tilbakekalt",
};

/** Human history line: what happened · who. Status is stored separately. */
export function eventLine(event: LotEvent): string {
  const actor = actorNameFromEvent(event);
  const action =
    event.eventType === "handover" ? handoverEventText(event.metadata) : EVENT_ACTION_NO[event.eventType];
  return actor ? `${action} · ${actor}` : action;
}

export function formatLotEventWhen(iso: string, lang: "no" | "en" = "no"): string {
  return new Date(iso).toLocaleString(lang === "no" ? "nb-NO" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseEventMetadata(value: unknown): LotEventMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as LotEventMetadata;
}

export function eventFromRow(row: {
  id: string;
  gold_lot_id: string;
  event_type: string;
  created_at: string;
  created_by: string | null;
  reason: string | null;
  metadata: unknown;
}): LotEvent | null {
  if (!isLotEventType(row.event_type)) return null;
  return {
    id: row.id,
    goldLotId: row.gold_lot_id,
    eventType: row.event_type,
    createdAt: row.created_at,
    createdBy: row.created_by,
    reason: row.reason,
    metadata: parseEventMetadata(row.metadata),
  };
}
