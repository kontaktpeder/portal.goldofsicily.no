import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { searchBrreg, type BrregHit, type BrregKind } from "@/lib/brreg";
import { upsertBrregHit } from "@/lib/brreg-save";
import { TextField } from "@/components/field";

export function BrregSearch({
  onPicked,
}: {
  onPicked: (picked: { legalEntityId: string; hit: BrregHit }) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BrregHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [picked, setPicked] = useState<BrregHit | null>(null);

  async function search() {
    if (query.trim().length < 2) return;
    setBusy(true);
    setPicked(null);
    try {
      setHits(await searchBrreg(query));
      setSearched(true);
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
      setPicked(hit);
      setHits([]);
      toast.success(hit.legalName);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("brreg_failed"));
    } finally {
      setBusy(false);
    }
  }

  const groups: { kind: BrregKind; label: string }[] = [
    { kind: "hovedenhet", label: t("brreg_parent") },
    { kind: "underenhet", label: t("brreg_subunit") },
  ];

  return (
    <div
      className="space-y-3"
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        void search();
      }}
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField label={t("brreg_search")} value={query} onChange={setQuery} />
        </div>
        <button
          type="button"
          onClick={() => void search()}
          disabled={busy || query.trim().length < 2}
          className="h-13 shrink-0 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "…" : t("brreg_find")}
        </button>
      </div>
      {picked ? (
        <p className="text-sm text-muted-foreground">
          {t("brreg_picked")}: <span className="font-semibold text-foreground">{picked.legalName}</span>
          {" · "}
          {picked.organizationNumber}
        </p>
      ) : null}
      {searched && hits.length === 0 && !busy && !picked ? (
        <p className="text-sm text-muted-foreground">{t("brreg_empty")}</p>
      ) : null}
      {groups.map((group) => {
        const rows = hits.filter((hit) => hit.kind === group.kind);
        if (rows.length === 0) return null;
        return (
          <div key={group.kind}>
            <p className="eyebrow mb-2">{group.label}</p>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {rows.map((hit) => (
                <li key={`${hit.kind}-${hit.organizationNumber}`}>
                  <button
                    type="button"
                    onClick={() => void pick(hit)}
                    className="w-full rounded-2xl border border-border px-4 py-3 text-left hover:border-primary/60"
                  >
                    <span className="block font-semibold">{hit.legalName}</span>
                    <span className="text-xs text-muted-foreground">
                      {hit.organizationNumber}
                      {hit.organizationForm ? ` · ${hit.organizationForm}` : ""}
                      {hit.city ? ` · ${hit.city}` : ""}
                      {hit.vatRegistered ? ` · ${t("vat_registered")}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
