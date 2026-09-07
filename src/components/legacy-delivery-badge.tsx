import { useI18n } from "@/lib/i18n";
import { extraDeliveryNote, isLegacyDeliveryNote, LEGACY_DELIVERY_NOTE } from "@/lib/legacy-delivery";

export function LegacyDeliveryMark({ note }: { note: string | null | undefined }) {
  const { t } = useI18n();
  const legacy = isLegacyDeliveryNote(note);
  const extra = extraDeliveryNote(note);
  if (!legacy && !extra) return null;
  return (
    <div className="mt-2 space-y-1">
      {legacy ? (
        <p>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold tracking-wide uppercase text-muted-foreground">
            {t("legacy_delivery")}
          </span>
        </p>
      ) : null}
      {legacy ? <p className="text-xs text-muted-foreground">{LEGACY_DELIVERY_NOTE}</p> : null}
      {extra ? <p className="text-xs text-muted-foreground">{extra}</p> : null}
    </div>
  );
}
