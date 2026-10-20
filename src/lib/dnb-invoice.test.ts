import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DNB_DRAFT_STATUS_CODE,
  dnbInvoiceHref,
  draftInvoiceBody,
  invoiceItemFromFrozenLine,
  nextTransferStep,
  noSendDistributionId,
  outcomeForRemote,
  transferReference,
} from "./dnb-invoice.ts";
import { transferBasis } from "./dnb-transfer.ts";
import {
  remoteInvoiceFromPayload,
  unimicroConfigFromEnv,
  unimicroGateway,
} from "./dnb-unimicro.ts";

const line = {
  deliveryLineId: "line-1",
  productName: "Nduja",
  venueName: "Bar",
  quantity: 10,
  unitPriceOre: 15000,
};

test("a frozen line keeps its ore price and does not read a price list", () => {
  const item = invoiceItemFromFrozenLine(line, 15);
  assert.equal(item.PriceExVat, 150);
  assert.equal(item.NumberOfItems, 10);
  assert.equal(item.SumTotalExVat, 1500);
  assert.equal(item.SumVat, 225);
  assert.equal(item.VatPercent, 15);
  assert.equal("ProductID" in item, false);
});

test("the portal reference is stable and the no-send plan is found by name", () => {
  assert.equal(transferReference("abc"), "gos-abc");
  assert.equal(
    noSendDistributionId([
      { id: 4, name: "Std. EHF" },
      { id: 15, name: "Ingen utsendelse" },
    ]),
    15,
  );
  assert.equal(noSendDistributionId([{ id: 5, name: "Std. e-post" }]), null);
});

test("an existing DNB invoice is adopted and a second one is not created", async () => {
  let created = 0;
  const outcome = await transferBasis(
    {
      reference: "gos-1",
      legalName: "Villa Import AS",
      organizationNumber: "999 999 999",
      invoiceDate: "2026-10-13",
      paymentDueOn: "2026-10-27",
      vatPercent: 15,
      lines: [line],
    },
    {
      findInvoiceByReference: async () => ({
        id: 44,
        statusCode: DNB_DRAFT_STATUS_CODE,
        invoiceNumber: null,
        credited: false,
        restAmount: null,
        totalAmount: null,
      }),
      findCustomersByOrg: async () => {
        throw new Error("should not look up a customer");
      },
      createCustomer: async () => {
        throw new Error("should not create a customer");
      },
      findNoSendPlans: async () => {
        throw new Error("should not look up distribution");
      },
      createDraft: async () => {
        created += 1;
        throw new Error("should not create");
      },
    },
  );
  assert.equal(created, 0);
  assert.equal(outcome.outcome, "adopted");
  assert.equal(outcome.externalInvoiceId, "44");
  assert.equal(outcome.transferStatus, "transferred");
  assert.equal(outcome.dnbStatus, "draft");
});

test("a lost response becomes needs review and the next try adopts the draft", async () => {
  const calls = { create: 0 };
  const gateway = {
    found: null as null | {
      id: number;
      statusCode: number;
      invoiceNumber: null;
      credited: false;
      restAmount: null;
      totalAmount: null;
    },
    async findInvoiceByReference() {
      return this.found;
    },
    async findCustomersByOrg() {
      return [{ id: 8 }];
    },
    async createCustomer() {
      throw new Error("customer exists");
    },
    async findNoSendPlans() {
      return [{ id: 15, name: "Ingen utsendelse" }];
    },
    async createDraft() {
      calls.create += 1;
      throw new Error("response lost");
    },
  };
  const basis = {
    reference: "gos-1",
    legalName: "Villa Import AS",
    organizationNumber: "999999999",
    invoiceDate: "2026-10-13",
    paymentDueOn: "2026-10-27",
    vatPercent: 15,
    lines: [line],
  };
  const first = await transferBasis(basis, gateway);
  assert.equal(first.outcome, "ambiguous");
  assert.equal(first.transferStatus, "needs_review");
  assert.equal(calls.create, 1);
  gateway.found = {
    id: 44,
    statusCode: DNB_DRAFT_STATUS_CODE,
    invoiceNumber: null,
    credited: false,
    restAmount: null,
    totalAmount: null,
  };
  const second = await transferBasis(basis, gateway);
  assert.equal(second.outcome, "adopted");
  assert.equal(calls.create, 1);
});

test("without a no-send plan nothing is created", async () => {
  let created = 0;
  const outcome = await transferBasis(
    {
      reference: "gos-1",
      legalName: "Villa Import AS",
      organizationNumber: "999999999",
      invoiceDate: "2026-10-13",
      paymentDueOn: "2026-10-27",
      vatPercent: 15,
      lines: [line],
    },
    {
      findInvoiceByReference: async () => null,
      findCustomersByOrg: async () => [{ id: 8 }],
      createCustomer: async () => ({ id: 8 }),
      findNoSendPlans: async () => [{ id: 5, name: "Std. e-post" }],
      createDraft: async () => {
        created += 1;
        return {
          id: 1,
          statusCode: DNB_DRAFT_STATUS_CODE,
          invoiceNumber: null,
          credited: false,
          restAmount: null,
          totalAmount: null,
        };
      },
    },
  );
  assert.equal(created, 0);
  assert.equal(outcome.detail, "no_distribution");
});

test("creating a draft posts the frozen prices and never issues the invoice", async () => {
  const posted: { path: string; body: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    posted.push({ path: url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/api/biz/invoices") && init?.method === "POST") {
      return new Response(
        JSON.stringify({ ID: 9, StatusCode: DNB_DRAFT_STATUS_CODE, InvoiceNumber: null }),
        {
          status: 200,
        },
      );
    }
    if (url.includes("/api/biz/invoices")) return new Response("[]", { status: 200 });
    if (url.includes("/api/biz/customers"))
      return new Response(JSON.stringify([{ ID: 3 }]), { status: 200 });
    if (url.includes("/api/biz/distributions")) {
      return new Response(JSON.stringify([{ ID: 15, Name: "Ingen utsendelse" }]), { status: 200 });
    }
    return new Response("missing", { status: 404 });
  };
  const config = unimicroConfigFromEnv({
    UNIMICRO_API_BASE: "https://test.example/api-root",
    UNIMICRO_ACCESS_TOKEN: "token",
    UNIMICRO_COMPANY_KEY: "company",
  });
  assert.ok(config);
  const outcome = await transferBasis(
    {
      reference: "gos-1",
      legalName: "Villa Import AS",
      organizationNumber: "999 999 999",
      invoiceDate: "2026-10-13",
      paymentDueOn: "2026-10-27",
      vatPercent: 15,
      lines: [line],
    },
    unimicroGateway(config, fetchImpl),
  );
  assert.equal(outcome.outcome, "created");
  assert.equal(outcome.dnbStatus, "draft");
  const create = posted.find((call) => call.path.endsWith("/api/biz/invoices") && call.body);
  assert.ok(create);
  assert.equal(create.path.includes("action=invoice"), false);
  const body = draftInvoiceBody({
    invoiceDate: "2026-10-13",
    paymentDueOn: "2026-10-27",
    reference: "gos-1",
    customerId: 3,
    customerName: "Villa Import AS",
    lines: [line],
    vatPercent: 15,
    distributionPlanId: 15,
  });
  assert.deepEqual(create.body, body);
  assert.equal(
    posted.some((call) => call.path.includes("action=invoice")),
    false,
  );
});

test("a non-draft create is kept and flagged for review", () => {
  const mapped = outcomeForRemote(
    {
      id: 1,
      statusCode: 42002,
      invoiceNumber: "1001",
      credited: false,
      restAmount: 100,
      totalAmount: 100,
    },
    true,
  );
  assert.equal(mapped.transferStatus, "needs_review");
  assert.equal(mapped.invoiceNumber, "1001");
});

test("remote payload and missing config stay explicit", () => {
  assert.equal(unimicroConfigFromEnv({}), null);
  assert.deepEqual(
    remoteInvoiceFromPayload({
      ID: 7,
      StatusCode: 42004,
      InvoiceNumber: "100",
      Credited: false,
      RestAmount: 0,
      TaxInclusiveAmount: 10,
    }),
    {
      id: 7,
      statusCode: 42004,
      invoiceNumber: "100",
      credited: false,
      restAmount: 0,
      totalAmount: 10,
    },
  );
  assert.equal(
    remoteInvoiceFromPayload({
      ID: 8,
      StatusCode: 42004,
      InvoiceNumber: "101",
      Credited: false,
      PaymentDate: "2026-10-20T00:00:00",
    })?.paidOn,
    "2026-10-20",
  );
  assert.equal(
    remoteInvoiceFromPayload({
      ID: 9,
      StatusCode: 42002,
      InvoiceNumber: "102",
      Credited: false,
      VatAmount: 19425,
    })?.vatOre,
    1_942_500,
  );
  assert.equal(
    remoteInvoiceFromPayload({
      ID: 10,
      StatusCode: 42002,
      InvoiceNumber: "103",
      Credited: false,
      TaxAmount: 19425,
    })?.vatOre,
    1_942_500,
  );
  assert.equal(dnbInvoiceHref("99"), "https://dnbregnskap.dnb.no/#/sales/invoices/99");
  assert.equal(dnbInvoiceHref(null), "https://dnbregnskap.dnb.no/");
  assert.equal(
    nextTransferStep({
      existing: null,
      customers: [{ id: 1 }, { id: 2 }],
      distributionPlanId: 15,
      organizationNumber: "999999999",
      lineCount: 1,
    }).action,
    "blocked",
  );
});

test("the transfer sql locks the basis and does not issue an invoice", () => {
  const sql = readFileSync(
    new URL("../../sql/20_dnb_invoice_transfer.sql", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261013120000_dnb_invoice_transfer.sql", import.meta.url),
    "utf8",
  );
  assert.equal(sql, migration);
  assert.match(sql, /transfer_reference/);
  assert.match(sql, /gos\.dnb_transfer/);
  assert.match(sql, /claim_dnb_transfer/);
  assert.equal(sql.includes("action=invoice"), false);
  const page = readFileSync(
    new URL("../routes/_authenticated/admin.invoices.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /dnb_transfer/);
  assert.match(page, /transferInvoiceDraft/);
  assert.equal(page.includes("action=invoice"), false);
});
