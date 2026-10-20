import { useState } from "react";
import { PrimaryButton, TextField } from "@/components/field";
import { companySentence } from "@/lib/dnb-advance";
import { dnbInvoiceHref } from "@/lib/dnb-invoice";
import { useI18n, type TranslationKey } from "@/lib/i18n";
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
  companyName,
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
  companyName: string | null;
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
          <Fact label={t("orders_previously_invoiced")} value={money(view.previouslyInvoicedOre)} />
          <Fact label={t("orders_advance_received")} value={receivedText(view, t)} />
          <Fact label={t("orders_advance_planned")} value={money(view.plannedOre)} />
          <Fact label={t("orders_advance_confirmed")} value={confirmedText(view, t)} />
          <Fact label={t("orders_advance_outstanding")} value={outstandingText(view, t)} />
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
      {view && view.surplusOre != null && view.surplusOre > 0 ? (
        <p className="text-sm font-semibold">
          {t("orders_advance_surplus")}: {money(view.surplusOre)}
        </p>
      ) : null}
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
      {view ? (
        <div className="space-y-2">
          <a
            href={dnbInvoiceHref(documentId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
          >
            {t("orders_open_dnb")}
          </a>
          <p className="text-sm text-muted-foreground">
            {companySentence(companyName, t("orders_dnb_company_unknown"), t("orders_dnb_company"))}
          </p>
        </div>
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

function receivedText(view: SettlementView, t: (key: TranslationKey) => string): string {
  if (!view.paymentChecked || view.receivedOre == null) return t("orders_payment_unchecked");
  return money(view.receivedOre);
}

function outstandingText(view: SettlementView, t: (key: TranslationKey) => string): string {
  if (!view.paymentChecked || view.outstandingOre == null) return t("orders_payment_unchecked");
  return money(view.outstandingOre);
}

function confirmedText(view: SettlementView, t: (key: TranslationKey) => string): string {
  if (view.confirmedOre == null) return t("orders_advance_unconfirmed");
  if (view.confirmedOre === 0) return t("orders_advance_not_applied");
  return money(view.confirmedOre);
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
