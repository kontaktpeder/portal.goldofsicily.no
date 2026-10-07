import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { productName, type StoredDeliveryLine } from "@/lib/flavors";
import { isVillaStockSchemaError, villaOptions, type StockLot, type StockSource } from "@/lib/lot-stock";

export function DeliveryLotLink({
  lines,
  lots,
}: {
  lines: StoredDeliveryLine[] | null | undefined;
  lots: StockLot[];
}) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const items = (lines ?? []).filter((line) => line.quantity > 0 && line.id);
  const missingLot = items.some((line) => !line.gold_lot_id);
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? missingLot;
  const [busyId, setBusyId] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function save(line: StoredDeliveryLine, goldLotId: string, handoverId: string) {
    if (!line.id || !goldLotId) return;
    setBusyId(line.id);
    const patch = {
      gold_lot_id: goldLotId,
      source_handover_id: handoverId || null,
    };
    const { error } = await supabase.from("delivery_lines").update(patch).eq("id", line.id);
    setBusyId(null);
    if (error) {
      if (isVillaStockSchemaError(error.message)) toast.warning(t("villa_stock_pending_sql"));
      else toast.error(error.message);
      return;
    }
    toast.success(t("link_lot_saved"));
    await queryClient.invalidateQueries();
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setManualOpen((value) => !(value ?? missingLot))}
        className="text-sm font-semibold text-primary"
      >
        {t("link_lot")}
      </button>
      {open ? (
        <ul className="mt-3 space-y-3">
          {items.map((line) => (
            <LineLink
              key={line.id}
              line={line}
              lots={lots}
              busy={busyId === line.id}
              label={line.products ? productName(line.products, lang) : t("flavors")}
              onSave={save}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LineLink({
  line,
  lots,
  busy,
  label,
  onSave,
}: {
  line: StoredDeliveryLine;
  lots: StockLot[];
  busy: boolean;
  label: string;
  onSave: (line: StoredDeliveryLine, goldLotId: string, handoverId: string) => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<StockSource>(line.source_handover_id ? "villa" : "gold");
  const [lotId, setLotId] = useState(line.gold_lot_id ?? "");
  const [handoverId, setHandoverId] = useState(line.source_handover_id ?? "");
  const productLots = lots.filter((lot) => lot.productId === line.product_id);
  const handovers = villaOptions(productLots, line.product_id);
  const dirty =
    lotId !== (line.gold_lot_id ?? "") || handoverId !== (line.source_handover_id ?? "");

  return (
    <li className="rounded-2xl border border-border p-3">
      <p className="text-sm font-medium">
        {line.quantity} × {label}
      </p>
      <div className="mt-2 flex gap-2">
        {(["gold", "villa"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setSource(value);
              setLotId("");
              setHandoverId("");
            }}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              source === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {value === "gold" ? t("stock_from_gold") : t("stock_from_villa")}
          </button>
        ))}
      </div>
      {source === "gold" ? (
        <select
          value={lotId}
          onChange={(event) => {
            setLotId(event.target.value);
            setHandoverId("");
          }}
          className="mt-2 h-12 w-full rounded-2xl border-2 border-border bg-card px-4 text-sm outline-none focus:border-primary"
        >
          <option value="">—</option>
          {productLots.map((lot) => (
            <option key={lot.id} value={lot.id}>
              {lot.lotCode} · {lot.remaining} {t("lot_available")}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={handoverId}
          onChange={(event) => {
            const picked = handovers.find((row) => row.id === event.target.value);
            setHandoverId(picked?.id ?? "");
            setLotId(picked?.lotId ?? "");
          }}
          className="mt-2 h-12 w-full rounded-2xl border-2 border-border bg-card px-4 text-sm outline-none focus:border-primary"
        >
          <option value="">—</option>
          {handovers.map((row) => (
            <option key={row.id} value={row.id}>
              {row.lotCode} · {row.recipient} · {row.remaining} {t("lot_available")}
            </option>
          ))}
        </select>
      )}
      {dirty ? (
        <button
          type="button"
          disabled={busy || !lotId}
          onClick={() => onSave(line, lotId, source === "villa" ? handoverId : "")}
          className="mt-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "…" : t("save")}
        </button>
      ) : null}
    </li>
  );
}
