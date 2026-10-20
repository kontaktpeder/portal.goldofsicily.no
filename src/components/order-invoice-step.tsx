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
  prepareLabel,
  companyName,
}: {
  step: OrderInvoiceStep;
  placement: "primary" | "secondary";
  commercial: boolean;
  busy: boolean;
  onPrepare: () => void;
  onTransfer: (draftId: string) => void;
  prepareLabel?: string;
  companyName: string | null;
}) {
  const { t } = useI18n();
  if (step.kind === "paid" || step.kind === "sent") {
    return <InvoiceFact step={step} />;
  }

  const preparing = step.kind === "prepare" || step.kind === "append";
  const label =
    step.kind === "transfer"
      ? t("dnb_transfer")
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
          onClick={() => act(step, onPrepare, onTransfer)}
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
        onClick={() => act(step, onPrepare, onTransfer)}
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

function act(step: OrderInvoiceStep, onPrepare: () => void, onTransfer: (draftId: string) => void) {
  if (step.kind === "prepare" || step.kind === "append") onPrepare();
  if (step.kind === "transfer") onTransfer(step.draftId);
}
