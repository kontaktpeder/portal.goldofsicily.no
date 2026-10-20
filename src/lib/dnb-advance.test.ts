import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dnbInvoiceHref } from "./dnb-invoice.ts";
import {
  advanceSettlementChain,
  companySentence,
  collectAdvancePayments,
  companyNameFromPayload,
  confirmedAdvanceUse,
  interpretAdvanceCheck,
  invoiceMoneyFromPayload,
  readSettlementConfirmation,
  type AdvanceGateway,
  type InvoiceMoney,
} from "./dnb-advance.ts";

const ADVANCE = 7_725_000;
const PARTIAL = 10_000_000;
const FINAL = 5_450_000;
const SURPLUS = 2_275_000;
const ADVANCE_ID = "101";
const SETTLEMENT_ID = "202";

const lines = [
  { fulfillmentId: "partial", quantity: 4000, unitPriceOre: 2500, active: true },
  { fulfillmentId: "final", quantity: 2180, unitPriceOre: 2500, active: true },
] as const;

function gateway(read: AdvanceGateway["readInvoice"]): AdvanceGateway {
  return { readInvoice: read };
}

test("a failed DNB read stays unchecked and does not become zero", async () => {
  const failed = await collectAdvancePayments(
    gateway(() => {
      throw new Error("timeout");
    }),
    ADVANCE_ID,
  );
  assert.equal(failed.checked, false);
  assert.equal(failed.dnbReceivedOre, null);
  assert.equal(failed.useBalance, false);

  const missing = interpretAdvanceCheck(invoiceMoneyFromPayload({ ID: 101, InvoiceNumber: "F-1" }));
  assert.equal(missing.checked, false);
  assert.equal(missing.payments.length, 0);

  const knownUnpaid = interpretAdvanceCheck(
    invoiceMoneyFromPayload({
      ID: 101,
      TaxInclusiveAmount: 77250,
      RestAmount: 77250,
      Payments: [],
    }),
  );
  assert.equal(knownUnpaid.checked, true);
  assert.equal(knownUnpaid.useBalance, true);
  assert.equal(knownUnpaid.dnbReceivedOre, 0);
  assert.equal(knownUnpaid.externalPayments.length, 0);
});

test("two payments, a partial invoice and a capped final settlement stay in one chain", async () => {
  const unchecked = advanceSettlementChain({
    claimedOre: ADVANCE,
    paymentChecked: false,
    payments: [],
    dnbReceivedOre: null,
    dnbRestOre: null,
    lines,
    finalFulfillmentIds: ["final"],
    alreadyPlannedOre: 0,
    storedSurplusOre: null,
    confirmedOre: null,
    settlementTotalOre: null,
    settlementRestOre: null,
    settlementVatOre: null,
  });
  assert.equal(unchecked.receivedOre, null);
  assert.equal(unchecked.outstandingOre, null);
  assert.equal(unchecked.plannedOre, null);
  assert.equal(unchecked.previouslyInvoicedOre, PARTIAL);

  const checked = await collectAdvancePayments(
    gateway(async () =>
      invoiceMoneyFromPayload({
        ID: 101,
        TaxInclusiveAmount: 77250,
        RestAmount: 0,
        Payments: [
          { ID: 1, Amount: 40000, PaymentDate: "2026-09-20", AmountCurrency: 40000 },
          { ID: 2, Amount: 37250, PaymentDate: "2026-09-28" },
        ],
      }),
    ),
    ADVANCE_ID,
  );
  assert.equal(checked.checked, true);
  assert.equal(checked.useBalance, false);
  assert.equal(checked.dnbReceivedOre, null);
  assert.equal(
    checked.payments.reduce((sum, payment) => sum + payment.amountOre, 0),
    ADVANCE,
  );

  const settlement = advanceSettlementChain({
    claimedOre: ADVANCE,
    paymentChecked: true,
    payments: checked.payments,
    dnbReceivedOre: ADVANCE,
    dnbRestOre: 0,
    lines,
    finalFulfillmentIds: ["final"],
    alreadyPlannedOre: 0,
    storedSurplusOre: null,
    confirmedOre: null,
    settlementTotalOre: null,
    settlementRestOre: null,
    settlementVatOre: null,
  });
  assert.equal(settlement.receivedOre, ADVANCE);
  assert.equal(settlement.receivedFrom, "payments");
  assert.equal(settlement.previouslyInvoicedOre, PARTIAL);
  assert.equal(settlement.plannedOre, FINAL);
  assert.equal(settlement.surplusOre, SURPLUS);
  assert.equal(settlement.confirmedOre, null);
  assert.equal(settlement.outstandingOre, 0);

  const advanceInvoice = invoiceMoneyFromPayload({
    ID: 101,
    TaxInclusiveAmount: 77250,
    RestAmount: 0,
    Payments: [
      { ID: 1, Amount: 40000, PaymentDate: "2026-09-20" },
      { ID: 2, Amount: 37250, PaymentDate: "2026-09-28" },
    ],
  });
  assert.ok(advanceInvoice);

  const unrelated = await readSettlementConfirmation(
    gateway(async () =>
      invoiceMoneyFromPayload({
        ID: 202,
        TaxInclusiveAmount: 54500,
        RestAmount: 54500,
        Payments: [{ ID: 9, Amount: 1000, PaymentDate: "2026-10-01" }],
      }),
    ),
    { settlementInvoiceId: SETTLEMENT_ID, advanceInvoiceId: ADVANCE_ID, plannedOre: FINAL },
  );
  assert.equal(unrelated, 0);

  const notRead = await readSettlementConfirmation(
    gateway(async () =>
      invoiceMoneyFromPayload({
        ID: 202,
        TaxInclusiveAmount: 54500,
        RestAmount: 54500,
      }),
    ),
    { settlementInvoiceId: SETTLEMENT_ID, advanceInvoiceId: ADVANCE_ID, plannedOre: FINAL },
  );
  assert.equal(notRead, null);

  const confirmed = await readSettlementConfirmation(
    gateway(async () =>
      invoiceMoneyFromPayload({
        ID: 202,
        TaxInclusiveAmount: 54500,
        RestAmount: 0,
        Payments: [
          { ID: 9, Amount: 1000, PaymentDate: "2026-10-01" },
          {
            ID: 10,
            Amount: 90000,
            PaymentDate: "2026-10-02",
            SourceCustomerInvoiceID: 101,
          },
        ],
      }),
    ),
    { settlementInvoiceId: SETTLEMENT_ID, advanceInvoiceId: ADVANCE_ID, plannedOre: FINAL },
  );
  assert.equal(confirmed, FINAL);
  assert.equal(
    confirmedAdvanceUse({
      settlement: invoiceMoneyFromPayload({
        ID: 202,
        Payments: [{ ID: 10, Amount: 54500, PrepaidInvoiceID: "101" }],
      }),
      advanceInvoiceId: ADVANCE_ID,
      plannedOre: FINAL,
    }),
    FINAL,
  );

  const second = advanceSettlementChain({
    claimedOre: ADVANCE,
    paymentChecked: true,
    payments: checked.payments,
    dnbReceivedOre: null,
    dnbRestOre: 0,
    lines,
    finalFulfillmentIds: ["other"],
    alreadyPlannedOre: FINAL,
    storedSurplusOre: SURPLUS,
    confirmedOre: FINAL,
    settlementTotalOre: 1_000_000,
    settlementRestOre: 0,
    settlementVatOre: null,
  });
  assert.equal(second.plannedOre, 0);
  assert.equal(second.surplusOre, SURPLUS);
  assert.equal(second.confirmedOre, FINAL);
  assert.equal(second.previouslyInvoicedOre, PARTIAL + FINAL);
});

test("the DNB shortcut names the company and still opens only the document", () => {
  const name = companyNameFromPayload({
    CompanyName: " Gold of Sicily AS ",
    CompanyKey: "secret-key",
    Name: "Other",
  });
  assert.equal(name, "Gold of Sicily AS");
  assert.equal(
    companySentence("Gold of Sicily AS", "ukjent selskap", "Åpne selskapet {name} i DNB."),
    "Åpne selskapet Gold of Sicily AS i DNB.",
  );
  assert.equal(
    companySentence(null, "ukjent selskap", "Åpne selskapet {name} i DNB."),
    "ukjent selskap",
  );
  assert.equal(companyNameFromPayload({ CompanyKey: "secret-key" }), null);
  assert.equal(companyNameFromPayload({ LegalName: "Villa Import AS" }), "Villa Import AS");

  const href = dnbInvoiceHref(ADVANCE_ID);
  assert.equal(href, "https://dnbregnskap.dnb.no/#/sales/invoices/101");
  assert.equal(href.includes("secret-key"), false);
  assert.equal(href.includes("CompanyKey"), false);
  assert.equal(dnbInvoiceHref(null), "https://dnbregnskap.dnb.no/");

  const source = readFileSync(new URL("./dnb-advance.ts", import.meta.url), "utf8");
  assert.match(source, /CompanyName/);
  assert.doesNotMatch(source, /return record\["CompanyKey"\]/);
});

test("invoice money keeps a missing payment list distinct from an empty one", () => {
  const absent = invoiceMoneyFromPayload({ ID: 5, RestAmount: 10, TaxInclusiveAmount: 10 });
  assert.equal(absent?.payments, null);
  const empty = invoiceMoneyFromPayload({
    ID: 5,
    RestAmount: 10,
    TaxInclusiveAmount: 10,
    Payments: [],
  });
  assert.deepEqual(empty?.payments, []);
  const parsed: InvoiceMoney | null = invoiceMoneyFromPayload([
    {
      ID: 5,
      Payments: [
        {
          ID: "7",
          AmountCurrency: 12.5,
          AdvanceInvoiceID: 101,
          PaymentDate: "2026-10-20T00:00:00",
        },
      ],
    },
  ]);
  assert.equal(parsed?.payments?.[0]?.amountOre, 1250);
  assert.equal(parsed?.payments?.[0]?.sourceInvoiceId, "101");
  assert.equal(parsed?.payments?.[0]?.paidOn, "2026-10-20");
});
