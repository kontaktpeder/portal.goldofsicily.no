import { useState } from "react";
import { PrimaryButton, TextField } from "@/components/field";
import { dnbInvoiceHref } from "@/lib/dnb-invoice";
import { useI18n } from "@/lib/i18n";
import { agreedAdvanceOre, type AdvancePayment, type SettlementView } from "@/lib/order-advance";
import { formatAgreedDelivery } from "@/lib/orders";
import { formatPriceNok } from "@/lib/slug";

function money(ore: number | null): string {
  if (ore == null) return "—";
  const text = formatPriceNok(ore);
  return text == null ? "—" : `${text} kr`;
}

export function OrderSettlementPanel({
  view,
  payments,
  documentId,
  documentNumber,
  commercial,
  busy,
  basisOre,
  onPrepare,
  onAttach,
}: {
  view: SettlementView | null;
  payments: readonly AdvancePayment[];
  documentId: string | null;
  documentNumber: string | null;
  commercial: boolean;
  busy: boolean;
  basisOre: number | null;
  onPrepare: (percent: number) => void;
  onAttach: (invoiceId: string, invoiceNumber: string) => void;
}) {
  const { t, lang } = useI18n();
  const [percent, setPercent] = useState("");
  const [invoiceId, setInvoiceId] = useState(documentId ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(documentNumber ?? "");
  const parsed = Number(percent.trim().replace(",", "."));
  const percentOk = percent.trim().length > 0 && parsed > 0 && parsed <= 100;
  const preview = percentOk && basisOre != null ? agreedAdvanceOre(basisOre, parsed) : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("orders_advance_hint")}</p>
      {view ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Fact
            label={t("orders_advance_percent")}
            value={`${String(view.percent).replace(".", ",")} %`}
          />
          <Fact label={t("orders_advance_basis")} value={money(view.basisOre)} />
          <Fact label={t("orders_advance_agreed")} value={money(view.agreedOre)} />
          <Fact label={t("orders_advance_claimed")} value={money(view.claimedOre)} />
          <Fact
            label={t("orders_advance_received")}
            value={view.receivedFrom === "none" ? "—" : money(view.receivedOre)}
          />
          <Fact
            label={t("orders_advance_offset")}
            value={view.offsetOre > 0 ? money(view.offsetOre) : "—"}
          />
          <Fact label={t("orders_advance_outstanding")} value={money(view.outstandingOre)} />
          <Fact label={t("orders_advance_total_dnb")} value={money(view.totalOre)} />
          <Fact label={t("orders_advance_vat_dnb")} value={money(view.vatOre)} />
          <Fact label={t("orders_remaining_payment")} value={money(view.remainingOre)} />
        </dl>
      ) : commercial ? (
        <div className="space-y-3">
          <TextField label={t("orders_advance_percent")} value={percent} onChange={setPercent} />
          <p className="text-sm">
            {t("orders_advance_basis")}: {money(basisOre)}
          </p>
          {basisOre == null ? (
            <p className="text-sm text-muted-foreground">{t("orders_price_missing")}</p>
          ) : null}
          {preview != null && preview > 0 ? (
            <p className="text-sm">
              {t("orders_advance_agreed")}: {money(preview)}
            </p>
          ) : null}
          <PrimaryButton
            type="button"
            disabled={busy || !percentOk || basisOre == null || preview == null || preview <= 0}
            onClick={() => onPrepare(parsed)}
          >
            {t("orders_prepare_advance")}
          </PrimaryButton>
        </div>
      ) : (
        <p className="text-sm">{t("orders_no_advance")}</p>
      )}
      {view && view.receivedFrom === "payments" ? (
        <ul className="text-sm">
          {payments.map((payment, index) => (
            <li key={`${payment.paidOn ?? "open"}-${payment.amountOre}-${index}`}>
              {payment.paidOn ? `${formatAgreedDelivery(payment.paidOn, lang)} · ` : ""}
              {money(payment.amountOre)}
            </li>
          ))}
        </ul>
      ) : null}
      {view && (view.vatOre == null || view.totalOre == null || view.remainingOre == null) ? (
        <p className="text-sm text-muted-foreground">{t("orders_advance_dnb_pending")}</p>
      ) : null}
      {view ? (
        <p className="text-sm">
          {t("orders_dnb_document")}: {documentNumber || documentId || "—"}
        </p>
      ) : null}
      {view && view.outstandingOre != null && view.outstandingOre > 0 ? (
        <a
          href={dnbInvoiceHref(documentId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
        >
          {t("orders_open_dnb")}
        </a>
      ) : null}
      {view && commercial ? (
        <div className="space-y-3">
          <TextField label={t("orders_dnb_document")} value={invoiceId} onChange={setInvoiceId} />
          <TextField
            label={t("invoice_number")}
            value={invoiceNumber}
            onChange={setInvoiceNumber}
          />
          <button
            type="button"
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
            disabled={busy || invoiceId.trim().length === 0}
            onClick={() => onAttach(invoiceId.trim(), invoiceNumber.trim())}
          >
            {t("orders_advance_save_document")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
