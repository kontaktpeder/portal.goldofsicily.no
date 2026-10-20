import { PrimaryButton } from "@/components/field";
import { dnbInvoiceHref } from "@/lib/dnb-invoice";
import { useI18n } from "@/lib/i18n";
import { formatAgreedDelivery, type OrderInvoiceStep } from "@/lib/orders";
import { formatPriceNok } from "@/lib/slug";

export function InvoiceStepView({
  step,
  placement,
  commercial,
  busy,
  onPrepare,
  onTransfer,
}: {
  step: OrderInvoiceStep;
  placement: "primary" | "secondary";
  commercial: boolean;
  busy: boolean;
  onPrepare: () => void;
  onTransfer: (draftId: string) => void;
}) {
  const { t, lang } = useI18n();
  if (step.kind === "paid" || step.kind === "sent") {
    return <InvoiceFact step={step} />;
  }

  const label =
    step.kind === "transfer"
      ? t("dnb_transfer")
      : step.kind === "open_dnb"
        ? t("orders_open_dnb")
        : placement === "secondary"
          ? t("orders_invoice_delivered")
          : t("orders_prepare_invoice");

  if (step.kind === "open_dnb") {
    return (
      <a
        href={dnbInvoiceHref(step.invoiceId)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
      >
        {label}
      </a>
    );
  }

  if (!commercial) {
    return (
      <p className="text-sm font-semibold">
        {t("orders_invoice_heading")}: {label}
      </p>
    );
  }

  if (placement === "primary") {
    return (
      <PrimaryButton type="button" disabled={busy} onClick={() => act(step, onPrepare, onTransfer)}>
        {label}
      </PrimaryButton>
    );
  }

  return (
    <button
      type="button"
      className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
      disabled={busy}
      onClick={() => act(step, onPrepare, onTransfer)}
    >
      {label}
    </button>
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
