import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PrimaryButton, TextField } from "@/components/field";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  deliveryEditConfirm,
  deliveryEditPatch,
  driverOptionLabel,
  isDeliveryDriverSchemaError,
  type DeliveryEditPatch,
} from "@/lib/delivery-driver";
import type { ProductionStaff } from "@/lib/lot-producers";

export function DeliveryRecordEditor({
  deliveryId,
  deliveredAt,
  note,
  deliveredBy,
  deliveredByName,
  staff,
}: {
  deliveryId: string;
  deliveredAt: string;
  note: string | null;
  deliveredBy: string | null;
  deliveredByName: string | null;
  staff: readonly ProductionStaff[];
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(deliveredAt.slice(0, 10));
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [driver, setDriver] = useState(deliveredBy ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setDate(deliveredAt.slice(0, 10));
    setDraftNote(note ?? "");
    setDriver(deliveredBy ?? "");
  }, [deliveryId, deliveredAt, note, deliveredBy, open]);

  const patch = deliveryEditPatch(
    { deliveredAt, note, deliveredBy },
    { deliveredAt: date, note: draftNote, deliveredBy: driver },
  );
  const confirmKind = deliveryEditConfirm(patch);

  async function save(next: DeliveryEditPatch) {
    setBusy(true);
    let driverSkipped = false;
    let { error } = await supabase.from("deliveries").update(next).eq("id", deliveryId);
    if (error && next.delivered_by !== undefined && isDeliveryDriverSchemaError(error.message)) {
      driverSkipped = true;
      const { delivered_by: _driver, ...rest } = next;
      if (Object.keys(rest).length === 0) {
        setBusy(false);
        toast.warning(t("delivered_by_pending_sql"));
        return;
      }
      const retry = await supabase.from("deliveries").update(rest).eq("id", deliveryId);
      error = retry.error;
    }
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (driverSkipped) toast.warning(t("delivered_by_pending_sql"));
    else toast.success(t("delivery_updated"));
    setOpen(false);
    await queryClient.invalidateQueries();
  }

  function ask() {
    if (confirmKind === "none" || !date) return;
    const message =
      confirmKind === "driver"
        ? t("delivery_driver_confirm")
        : confirmKind === "both"
          ? t("delivery_edit_with_driver")
          : t("delivery_edit_confirm");
    toast(message, {
      id: `delivery-edit-${deliveryId}`,
      duration: Infinity,
      action: {
        label: t("delivery_edit_yes"),
        onClick: () => {
          void save(patch);
        },
      },
      cancel: {
        label: t("cancel"),
        onClick: () => {},
      },
    });
  }

  if (!open) {
    return (
      <div className="mt-3">
        <p className="text-sm text-muted-foreground">
          {t("delivered_by")}: {deliveredByName ?? t("delivered_by_missing")}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 text-sm font-semibold text-primary"
        >
          {t("delivery_edit")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <p className="eyebrow">{t("delivery_edit")}</p>
      <TextField label={t("date")} value={date} onChange={setDate} type="date" />
      <DriverSelect
        label={t("delivered_by")}
        value={driver}
        staff={staff}
        emptyLabel={t("delivered_by_none")}
        extra={deliveredBy && deliveredByName ? { id: deliveredBy, label: deliveredByName } : null}
        onChange={setDriver}
      />
      <TextField label={t("note")} value={draftNote} onChange={setDraftNote} />
      <PrimaryButton onClick={ask} disabled={busy || confirmKind === "none" || !date}>
        {busy ? "…" : t("save")}
      </PrimaryButton>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full py-2 text-sm font-semibold text-muted-foreground"
      >
        {t("cancel")}
      </button>
    </div>
  );
}

export function DriverSelect({
  label,
  value,
  staff,
  emptyLabel,
  extra,
  onChange,
}: {
  label: string;
  value: string;
  staff: readonly ProductionStaff[];
  emptyLabel: string;
  extra?: { id: string; label: string } | null;
  onChange: (value: string) => void;
}) {
  const known = staff.some((person) => person.id === value);
  return (
    <label className="block">
      <span className="eyebrow mb-2 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
      >
        <option value="">{emptyLabel}</option>
        {extra && !known ? <option value={extra.id}>{extra.label}</option> : null}
        {staff.map((person) => (
          <option key={person.id} value={person.id}>
            {driverOptionLabel(person)}
          </option>
        ))}
      </select>
    </label>
  );
}
