import { useI18n } from "@/lib/i18n";
import { staffPickerLine, type ProductionStaff } from "@/lib/lot-producers";

export function ProducerPicker({
  staff,
  selectedIds,
  onChange,
  disabled,
  legacy,
}: {
  staff: ProductionStaff[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  legacy?: string | null;
}) {
  const { t } = useI18n();
  const selected = new Set(selectedIds);

  function toggle(id: string) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  return (
    <fieldset className="block" disabled={disabled}>
      <legend className="eyebrow mb-2 block">{t("produced_by")}</legend>
      {legacy ? (
        <p className="mb-3 text-sm text-muted-foreground">
          {t("produced_by_legacy")}: <span className="font-medium text-foreground">{legacy}</span>
        </p>
      ) : null}
      {staff.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("no_production_staff")}</p>
      ) : (
        <ul className="space-y-2">
          {staff.map((person) => {
            const checked = selected.has(person.id);
            return (
              <li key={person.id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 ${
                    checked ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-primary"
                    checked={checked}
                    onChange={() => toggle(person.id)}
                  />
                  <span>
                    <span className="block font-semibold">{person.fullName || person.username}</span>
                    <span className="block text-sm text-muted-foreground">{staffPickerLine(person)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
