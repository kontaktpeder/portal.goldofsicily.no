import { supabase } from "@/integrations/supabase/client";
import {
  formatProducedByCompat,
  producerInsertRows,
  snapshotProducerName,
  type ProductionStaff,
} from "@/lib/lot-producers";

export async function replaceLotProducers(lotId: string, staff: readonly ProductionStaff[]) {
  const remove = await supabase.from("gold_lot_producers").delete().eq("gold_lot_id", lotId);
  if (remove.error) return { error: remove.error };
  if (staff.length > 0) {
    const inserted = await supabase.from("gold_lot_producers").insert(producerInsertRows(lotId, staff));
    if (inserted.error) return { error: inserted.error };
  }
  const compat = await supabase
    .from("gold_lots")
    .update({ produced_by: formatProducedByCompat(staff.map(snapshotProducerName)) })
    .eq("id", lotId);
  if (compat.error) return { error: compat.error };
  return { error: null };
}
