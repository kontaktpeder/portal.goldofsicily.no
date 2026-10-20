import { PrimaryButton } from "@/components/field";
import { companySentence } from "@/lib/dnb-advance";
import { dnbInvoiceHref } from "@/lib/dnb-invoice";
import { useI18n } from "@/lib/i18n";
import { dnbDocumentKey, formatAgreedDelivery, type OrderInvoiceStep } from "@/lib/orders";
import { formatPriceNok } from "@/lib/slug";

export function InvoiceStepView({
  step,
  placement,
  commercial,
  busy,
  onPrepare,
  onTransfer,
  onReview,
  prepareLabel,
  companyName,
}: {
  step: OrderInvoiceStep;
  placement: "primary" | "secondary";
  commercial: boolean;
  busy: boolean;
  onPrepare: () => void;
  onTransfer: (draftId: string) => void;
  onReview?: () => void;
  prepareLabel?: string;
  companyName: string | null;
}) {
  const { t } = useI18n();
  if (step.kind === "paid" || step.kind === "sent") {
    return <InvoiceFact step={step} />;
  }

  const preparing = step.kind === "prepare" || step.kind === "append";
  const opensReview = Boolean(onReview) && (preparing || step.kind === "transfer");
  const label =
    step.kind === "transfer"
      ? onReview
        ? t("orders_invoice_open_basis")
        : t("dnb_transfer")
      : step.kind === "open_dnb"
        ? t("orders_open_dnb")
        : preparing && prepareLabel
          ? prepareLabel
          : placement === "secondary"
            ? t("orders_invoice_delivered")
            : t("orders_prepare_invoice");

  if (step.kind === "open_dnb") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold">
          {t(dnbDocumentKey(step.dnbStatus, step.transferStatus))}
          {step.invoiceNumber ? ` · ${step.invoiceNumber}` : ""}
        </p>
        <a
          href={dnbInvoiceHref(step.invoiceId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
        >
          {label}
        </a>
        <p className="text-sm text-muted-foreground">
          {companySentence(companyName, t("orders_dnb_company_unknown"), t("orders_dnb_company"))}
        </p>
      </div>
    );
  }

  const transferProblem =
    step.kind === "transfer" && step.transferStatus !== "not_transferred"
      ? t(dnbDocumentKey(null, step.transferStatus))
      : null;

  if (!commercial) {
    return (
      <div className="space-y-2">
        {transferProblem ? <p className="text-sm font-semibold">{transferProblem}</p> : null}
        <p className="text-sm font-semibold">
          {t("orders_invoice_heading")}: {label}
        </p>
      </div>
    );
  }

  if (placement === "primary") {
    return (
      <div className="space-y-2">
        {transferProblem ? <p className="text-sm font-semibold">{transferProblem}</p> : null}
        <PrimaryButton
          type="button"
          disabled={busy}
          onClick={() => openOrAct(step, opensReview, onReview, onPrepare, onTransfer)}
        >
          {label}
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {transferProblem ? <p className="text-sm font-semibold">{transferProblem}</p> : null}
      <button
        type="button"
        className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
        disabled={busy}
        onClick={() => openOrAct(step, opensReview, onReview, onPrepare, onTransfer)}
      >
        {label}
      </button>
    </div>
  );
}

export function InvoiceFact({ step }: { step: OrderInvoiceStep }) {
  const { t, lang } = useI18n();
  if (step.kind === "paid") {
    return (
      <p className="text-sm font-semibold">
        ✓ {t("dnb_paid")}
        {step.paidOn ? ` · ${formatAgreedDelivery(step.paidOn, lang)}` : ""}
        {step.invoiceNumber ? ` · ${step.invoiceNumber}` : ""}
        {step.amountOre ? ` · ${formatPriceNok(step.amountOre)} kr` : ""}
      </p>
    );
  }
  if (step.kind !== "sent") return null;
  return (
    <p className="text-sm">
      {step.invoiceNumber
        ? `${t("invoice_number")} ${step.invoiceNumber}`
        : t("orders_invoice_heading")}
      {step.amountOre ? ` · ${formatPriceNok(step.amountOre)} kr` : ""}
      {step.dueOn ? ` · ${t("dnb_due")} ${formatAgreedDelivery(step.dueOn, lang)}` : ""}
    </p>
  );
}

function openOrAct(
  step: OrderInvoiceStep,
  opensReview: boolean,
  onReview: (() => void) | undefined,
  onPrepare: () => void,
  onTransfer: (draftId: string) => void,
) {
  if (opensReview && onReview) {
    onReview();
    return;
  }
  if (step.kind === "prepare" || step.kind === "append") onPrepare();
  if (step.kind === "transfer") onTransfer(step.draftId);
}

export function InvoiceReview({
  customerName,
  orderNumber,
  quantity,
  amountOre,
  advanceOre,
  busy,
  canCreate,
  canTransfer,
  transferStatus,
  onCreate,
  onTransfer,
}: {
  customerName: string;
  orderNumber: string;
  quantity: number;
  amountOre: number;
  advanceOre: number | null;
  busy: boolean;
  canCreate: boolean;
  canTransfer: boolean;
  transferStatus: string | null;
  onCreate: () => void;
  onTransfer: () => void;
}) {
  const { t } = useI18n();
  if (quantity <= 0) {
    return <p className="text-sm font-semibold">{t("orders_price_missing")}</p>;
  }
  const transferProblem =
    canTransfer && transferStatus && transferStatus !== "not_transferred"
      ? t(dnbDocumentKey(null, transferStatus))
      : null;
  return (
    <div className="space-y-2 rounded-2xl border border-border px-4 py-4">
      <p className="text-sm font-semibold">
        {customerName} · {orderNumber} · {quantity} {t("pcs")} · {formatPriceNok(amountOre)} kr{" "}
        {t("orders_invoice_ex_vat")}
      </p>
      <p className="text-sm text-muted-foreground">{t("orders_invoice_only_order")}</p>
      {advanceOre != null ? (
        <p className="text-sm">
          {t("orders_advance_agreed")}: {formatPriceNok(advanceOre)} kr
        </p>
      ) : null}
      {transferProblem ? <p className="text-sm font-semibold">{transferProblem}</p> : null}
      {canCreate ? (
        <PrimaryButton type="button" disabled={busy || quantity <= 0} onClick={onCreate}>
          {t("create_invoice_draft")}
        </PrimaryButton>
      ) : null}
      {canTransfer ? (
        <button
          type="button"
          className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
          disabled={busy}
          onClick={onTransfer}
        >
          {t("dnb_transfer")}
        </button>
      ) : null}
    </div>
  );
}
