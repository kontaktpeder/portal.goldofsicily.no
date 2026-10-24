import { useI18n } from "@/lib/i18n";

export function LotCloseButton({
  armed,
  busy,
  onArm,
  onConfirm,
  onCancel,
}: {
  armed: boolean;
  busy: boolean;
  onArm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  if (!armed) {
    return (
      <button
        type="button"
        onClick={onArm}
        className="rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold whitespace-nowrap shadow-[var(--shadow-card)]"
      >
        {t("lot_close")}
      </button>
    );
  }
  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="rounded-full bg-primary px-3 py-2 text-sm font-semibold whitespace-nowrap text-primary-foreground disabled:opacity-60"
      >
        {busy ? "…" : t("lot_close_confirm")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="text-sm font-semibold text-muted-foreground"
      >
        {t("lot_close_cancel")}
      </button>
    </div>
  );
}
