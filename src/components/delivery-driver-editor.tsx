import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  deliveryDriverPatch,
  driverOptionLabel,
  isDeliveryDriverSchemaError,
} from "@/lib/delivery-driver";
import type { ProductionStaff } from "@/lib/lot-producers";

export function DeliveryDriverEditor({
  deliveryId,
  deliveredBy,
  deliveredByName,
  staff,
}: {
  deliveryId: string;
  deliveredBy: string | null;
  deliveredByName: string | null;
  staff: readonly ProductionStaff[];
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const saved = deliveredBy ?? "";
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(deliveredBy ?? "");
  }, [deliveryId, deliveredBy]);

  const dirty = value !== saved;

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("deliveries")
      .update(deliveryDriverPatch(value))
      .eq("id", deliveryId);
    setBusy(false);
    if (error) {
      if (isDeliveryDriverSchemaError(error.message)) toast.warning(t("delivered_by_pending_sql"));
      else toast.error(error.message);
      return;
    }
    toast.success(t("delivery_updated"));
    await queryClient.invalidateQueries();
  }

  function ask() {
    toast(t("delivery_driver_confirm"), {
      id: `delivery-driver-${deliveryId}`,
      duration: Infinity,
      action: {
        label: t("delivery_edit_yes"),
        onClick: () => {
          void save();
        },
      },
      cancel: {
        label: t("cancel"),
        onClick: () => {},
      },
    });
  }

  return (
    <div className="mt-3">
      <DriverSelect
        label={t("delivered_by")}
        value={value}
        staff={staff}
        emptyLabel={t("delivered_by_none")}
        extra={deliveredBy && deliveredByName ? { id: deliveredBy, label: deliveredByName } : null}
        onChange={setValue}
      />
      {dirty ? (
        <button
          type="button"
          onClick={ask}
          disabled={busy}
          className="mt-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "…" : t("save")}
        </button>
      ) : null}
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
