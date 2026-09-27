import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { fetchBrregUnit } from "@/lib/brreg";
import { upsertBrregHit } from "@/lib/brreg-save";
import { billingLegalEntityId } from "@/lib/economy";
import { BrregSearch } from "@/components/brreg-search";
import { PrimaryButton } from "@/components/field";

export function LegalEntityCard({ customerId }: { customerId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [billingChoice, setBillingChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const customer = useQuery({
    queryKey: ["customer-legal", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, legal_entity_id, billing_legal_entity_id")
        .eq("id", customerId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const entities = useQuery({
    queryKey: ["legal-entities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, legal_name, organization_number, organization_form, parent_legal_entity_id, business_address, vat_registered, brreg_synced_at")
        .order("legal_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const row = customer.data;
  const links = (entities.data ?? []).map((entity) => ({
    id: entity.id,
    parentLegalEntityId: entity.parent_legal_entity_id,
  }));
  const resolved = row
    ? billingLegalEntityId(
        {
          legalEntityId: row.legal_entity_id,
          billingLegalEntityId: billingChoice === null ? row.billing_legal_entity_id : billingChoice || null,
        },
        links,
      )
    : null;
  const linked = entities.data?.find((entity) => entity.id === row?.legal_entity_id) ?? null;
  const parent = entities.data?.find((entity) => entity.id === linked?.parent_legal_entity_id) ?? null;
  const recipient = entities.data?.find((entity) => entity.id === resolved) ?? null;

  async function link(legalEntityId: string) {
    const { error } = await supabase.from("customers").update({ legal_entity_id: legalEntityId }).eq("id", customerId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["customer-legal", customerId] });
    await queryClient.invalidateQueries({ queryKey: ["legal-entities"] });
  }

  async function saveBilling() {
    setBusy(true);
    const { error } = await supabase
      .from("customers")
      .update({ billing_legal_entity_id: billingChoice || null })
      .eq("id", customerId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBillingChoice(null);
    toast.success(t("save"));
    await customer.refetch();
  }

  async function refresh() {
    if (!linked) return;
    setBusy(true);
    try {
      const kind = linked.parent_legal_entity_id ? "underenhet" : "hovedenhet";
      const hit = await fetchBrregUnit(linked.organization_number, kind);
      if (!hit) throw new Error(t("brreg_failed"));
      await upsertBrregHit(hit);
      toast.success(t("brreg_refreshed"));
      await entities.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("brreg_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card space-y-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">{t("legal_entity")}</h2>
        <p className="text-sm text-muted-foreground">{t("legal_entity_hint")}</p>
      </div>
      {linked ? (
        <div className="text-sm">
          <p className="font-semibold">{linked.legal_name}</p>
          <p className="text-muted-foreground">
            {linked.organization_number}
            {linked.organization_form ? ` · ${linked.organization_form}` : ""}
            {linked.vat_registered ? ` · ${t("vat_registered")}` : ""}
          </p>
          {linked.business_address ? <p className="text-muted-foreground">{linked.business_address}</p> : null}
          {parent ? (
            <p className="mt-2 text-muted-foreground">
              {t("brreg_parent")}: {parent.legal_name} · {parent.organization_number}
            </p>
          ) : null}
          <p className="mt-2">
            {t("invoice_recipient")}: {recipient?.legal_name ?? t("invoice_recipient_missing")}
          </p>
          <PrimaryButton type="button" onClick={() => void refresh()} disabled={busy}>
            {t("brreg_refresh")}
          </PrimaryButton>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("legal_entity_missing")}</p>
      )}
      <BrregSearch
        onPicked={({ legalEntityId }) => {
          void link(legalEntityId);
        }}
      />
      <label className="block">
        <span className="eyebrow mb-2 block">{t("billing_override")}</span>
        <select
          value={billingChoice ?? row?.billing_legal_entity_id ?? ""}
          onChange={(event) => setBillingChoice(event.target.value)}
          className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
        >
          <option value="">{t("billing_override_none")}</option>
          {entities.data?.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.legal_name}
            </option>
          ))}
        </select>
      </label>
      <PrimaryButton type="button" onClick={() => void saveBilling()} disabled={busy || billingChoice === null}>
        {t("save")}
      </PrimaryButton>
    </section>
  );
}
