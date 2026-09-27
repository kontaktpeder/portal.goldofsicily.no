import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { searchBrreg, type BrregHit } from "@/lib/brreg";
import { upsertBrregHit } from "@/lib/brreg-save";
import { PrimaryButton, TextField } from "@/components/field";

export function BrregSearch({
  onPicked,
}: {
  onPicked: (picked: { legalEntityId: string; hit: BrregHit }) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BrregHit[]>([]);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    try {
      setHits(await searchBrreg(query));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("brreg_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function pick(hit: BrregHit) {
    setBusy(true);
    try {
      const saved = await upsertBrregHit(hit);
      onPicked({ legalEntityId: saved.legalEntityId, hit });
      toast.success(hit.legalName);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("brreg_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField label={t("brreg_search")} value={query} onChange={setQuery} />
        </div>
        <PrimaryButton type="button" onClick={() => void search()} disabled={busy || query.trim().length < 2}>
          {busy ? "…" : t("brreg_find")}
        </PrimaryButton>
      </div>
      {hits.length > 0 ? (
        <ul className="space-y-2">
          {hits.map((hit) => (
            <li key={`${hit.kind}-${hit.organizationNumber}`}>
              <button
                type="button"
                onClick={() => void pick(hit)}
                className="w-full rounded-2xl border border-border px-4 py-3 text-left"
              >
                <span className="block font-semibold">{hit.legalName}</span>
                <span className="text-xs text-muted-foreground">
                  {hit.organizationNumber}
                  {hit.organizationForm ? ` · ${hit.organizationForm}` : ""}
                  {hit.city ? ` · ${hit.city}` : ""}
                  {hit.vatRegistered ? ` · ${t("vat_registered")}` : ""}
                  {hit.kind === "underenhet" ? ` · ${t("brreg_subunit")}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
