import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  isEventSchemaError,
  type LotEventMetadata,
  type LotEventType,
  type RestorableLotStatus,
} from "./lot-events.ts";

export async function currentLotActor(): Promise<{ userId: string | null; name: string | null }> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id ?? null;
  if (!userId) return { userId: null, name: null };
  const profile = await supabase
    .from("profiles")
    .select("full_name, username")
    .eq("id", userId)
    .maybeSingle();
  const name = profile.data?.full_name?.trim() || profile.data?.username?.trim() || null;
  return { userId, name };
}

export async function recordLotEvent(input: {
  lotId: string;
  eventType: LotEventType;
  reason?: string | null;
  metadata?: LotEventMetadata;
}): Promise<{ ok: true } | { ok: false; schemaMissing: boolean; message: string }> {
  const actor = await currentLotActor();
  const inserted = await supabase.from("gold_lot_events").insert({
    gold_lot_id: input.lotId,
    event_type: input.eventType,
    created_by: actor.userId,
    reason: input.reason?.trim() || null,
    metadata: {
      ...(input.metadata ?? {}),
      actor_name: actor.name,
    } as Json,
  });
  if (!inserted.error) return { ok: true };
  return {
    ok: false,
    schemaMissing: isEventSchemaError(inserted.error),
    message: inserted.error.message,
  };
}

/** Puts a closed LOT back. The status change stands even if the event log is missing the new value. */
export async function reopenClosedLot(input: {
  lotId: string;
  status: RestorableLotStatus;
}): Promise<
  | { ok: true; logged: true }
  | { ok: true; logged: false; schemaMissing: boolean; message: string }
  | { ok: false; reason: "failed" | "not_closed"; message: string }
> {
  const updated = await supabase
    .from("gold_lots")
    .update({ status: input.status })
    .eq("id", input.lotId)
    .eq("status", "closed")
    .select("id");
  if (updated.error) return { ok: false, reason: "failed", message: updated.error.message };
  if (!updated.data?.length) return { ok: false, reason: "not_closed", message: "" };
  const logged = await recordLotEvent({
    lotId: input.lotId,
    eventType: "reopened",
    metadata: { previous_status: "closed", restored_status: input.status },
  });
  if (!logged.ok) {
    return {
      ok: true,
      logged: false,
      schemaMissing: logged.schemaMissing,
      message: logged.message,
    };
  }
  return { ok: true, logged: true };
}
