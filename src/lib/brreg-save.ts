import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { fetchBrregUnit, legalEntityWrite, type BrregHit } from "@/lib/brreg";

async function upsertRow(hit: BrregHit, parentLegalEntityId: string | null) {
  const row = legalEntityWrite(hit, parentLegalEntityId);
  const { data, error } = await supabase
    .from("legal_entities")
    .upsert({ ...row, brreg_data: hit.raw as Json }, { onConflict: "organization_number" })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save legal entity");
  return data.id;
}

export async function upsertBrregHit(hit: BrregHit) {
  let parentId: string | null = null;
  if (hit.parentOrganizationNumber) {
    const parent = await fetchBrregUnit(hit.parentOrganizationNumber, "hovedenhet");
    if (!parent) throw new Error("BRREG parent missing");
    parentId = await upsertRow(parent, null);
  }
  const legalEntityId = await upsertRow(hit, parentId);
  return { legalEntityId, parentLegalEntityId: parentId };
}
