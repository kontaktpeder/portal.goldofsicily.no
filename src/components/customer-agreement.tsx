import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { PartnershipLevel } from "@/lib/customer-domain";
import { PrimaryButton } from "@/components/field";

const LEVELS = ["gold_partner", "gold_supply", ""] as const;

export function partnershipLabel(
  level: PartnershipLevel,
  t: (key: TranslationKey) => string,
): string | null {
  if (level === "gold_partner") return t("partnership_gold_partner");
  if (level === "gold_supply") return t("partnership_gold_supply");
  return null;
}

export function CustomerAgreementCard({
  customerId,
  partnershipLevel,
  suppliedByCustomerId,
  wholesalers,
  onChanged,
}: {
  customerId: string;
  partnershipLevel: PartnershipLevel;
  suppliedByCustomerId: string | null;
  wholesalers: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [level, setLevel] = useState(partnershipLevel ?? "");
  const [suppliedBy, setSuppliedBy] = useState(suppliedByCustomerId ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLevel(partnershipLevel ?? "");
    setSuppliedBy(suppliedByCustomerId ?? "");
  }, [partnershipLevel, suppliedByCustomerId]);

  const dirty = level !== (partnershipLevel ?? "") || suppliedBy !== (suppliedByCustomerId ?? "");

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("customers")
      .update({
        partnership_level: level === "gold_partner" || level === "gold_supply" ? level : null,
        supplied_by_customer_id: suppliedBy || null,
      })
      .eq("id", customerId)
      .eq("type", "venue");
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("save"));
    onChanged();
  }

  return (
    <section className="surface-card space-y-4 p-5">
      <div>
        <span className="eyebrow mb-2 block">{t("partnership_level")}</span>
        <p className="mb-3 text-sm text-muted-foreground">{t("partnership_level_hint")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {LEVELS.map((option) => (
            <button
              key={option || "none"}
              type="button"
              onClick={() => setLevel(option)}
              className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold ${
                level === option
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground"
              }`}
            >
              {option === ""
                ? t("partnership_none")
                : option === "gold_partner"
                  ? t("partnership_gold_partner")
                  : t("partnership_gold_supply")}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("supplied_by")}</span>
        <p className="mb-3 text-sm text-muted-foreground">{t("supplied_by_hint")}</p>
        <select
          value={suppliedBy}
          onChange={(event) => setSuppliedBy(event.target.value)}
          className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
        >
          <option value="">{t("supplied_direct")}</option>
          {wholesalers.map((wholesaler) => (
            <option key={wholesaler.id} value={wholesaler.id}>
              {wholesaler.name}
            </option>
          ))}
        </select>
      </label>
      {dirty ? (
        <PrimaryButton onClick={save} disabled={busy}>
          {busy ? "…" : t("save")}
        </PrimaryButton>
      ) : null}
    </section>
  );
}
