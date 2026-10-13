import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activationGaps,
  commercialReadyPatch,
  findDuplicateSite,
  matchesSalesFilter,
  newDeliverySiteRow,
  purchasingContactOwner,
  salesOverview,
  salesStatusPatch,
  withCommercialReady,
  withSalesStatus,
  type DeliverySiteState,
} from "./crm.ts";

const villaSite: DeliverySiteState = {
  active: true,
  partnershipLevel: null,
  suppliedByCustomerId: "villa",
  salesStatus: "interested",
  commercialReadyAt: null,
  hasPortalLogin: false,
  deliveryAddress: "Markveien 1",
  visitAddress: "Markveien 1",
  legalEntityId: null,
  billingLegalEntityId: null,
};

const directSite: DeliverySiteState = {
  ...villaSite,
  active: false,
  suppliedByCustomerId: null,
  salesStatus: "prospect",
  legalEntityId: "entity",
};

test("sales status does not move operations, agreement, channel, readiness or login", () => {
  const next = withSalesStatus(villaSite, "pilot_order");
  assert.equal(next.salesStatus, "pilot_order");
  assert.equal(next.active, true);
  assert.equal(next.partnershipLevel, null);
  assert.equal(next.suppliedByCustomerId, "villa");
  assert.equal(next.commercialReadyAt, null);
  assert.equal(next.hasPortalLogin, false);
  assert.deepEqual(Object.keys(salesStatusPatch("waiting")), ["sales_status"]);
});

test("activation follows the channel and never asks for login", () => {
  assert.deepEqual(activationGaps(villaSite), []);
  assert.deepEqual(activationGaps({ ...villaSite, deliveryAddress: "  ", visitAddress: null }), [
    "delivery_address",
  ]);
  assert.deepEqual(activationGaps(directSite), []);
  assert.deepEqual(
    activationGaps({ ...directSite, legalEntityId: null, billingLegalEntityId: null }),
    ["invoice_recipient"],
  );
  assert.deepEqual(
    activationGaps({ ...directSite, legalEntityId: null, billingLegalEntityId: "parent" }),
    [],
  );
  const ready = withCommercialReady(directSite, "2026-10-13T12:00:00.000Z");
  assert.equal("gaps" in ready, false);
  if (!("gaps" in ready)) {
    assert.equal(ready.salesStatus, "prospect");
    assert.equal(ready.active, false);
    assert.equal(ready.hasPortalLogin, false);
    assert.equal(ready.commercialReadyAt, "2026-10-13T12:00:00.000Z");
  }
  const blocked = withCommercialReady(
    { ...directSite, legalEntityId: null, deliveryAddress: null, visitAddress: null },
    "2026-10-13T12:00:00.000Z",
  );
  assert.deepEqual("gaps" in blocked ? blocked.gaps : [], [
    "delivery_address",
    "invoice_recipient",
  ]);
  assert.deepEqual(Object.keys(commercialReadyPatch(null)), ["commercial_ready_at"]);
});

test("a purchasing contact belongs to the group legal entity", () => {
  assert.deepEqual(
    purchasingContactOwner({ legalEntityId: "site-as", parentLegalEntityId: "group-as" }),
    { legalEntityId: "group-as" },
  );
  assert.deepEqual(
    purchasingContactOwner({ legalEntityId: "site-as", parentLegalEntityId: null }),
    { legalEntityId: "site-as" },
  );
  assert.deepEqual(purchasingContactOwner({ legalEntityId: null, parentLegalEntityId: null }), {
    gap: "legal_entity",
  });
});

test("duplicate check is the delivery site, and the same legal entity can have many sites", () => {
  const existing = [
    { id: "a", name: "Restaurant A", city: "Oslo" },
    { id: "b", name: "Restaurant A", city: "Bergen" },
  ];
  assert.equal(findDuplicateSite({ name: " restaurant   a ", city: "oslo" }, existing)?.id, "a");
  assert.equal(findDuplicateSite({ name: "Restaurant A", city: "Bergen" }, existing)?.id, "b");
  assert.equal(findDuplicateSite({ name: "Restaurant A", city: "Trondheim" }, existing), null);
});

test("pipeline counts leave waiting and not relevant out of active prospects", () => {
  const rows = [
    row("prospect", "2026-10-10", null),
    row("waiting", "2026-10-01", null),
    row("not_relevant", "2026-09-01", null),
    row("tasting", "2026-10-13", null),
    row("active_customer", null, "2026-10-02T08:00:00.000Z"),
    row("active_customer", null, "2026-09-30T08:00:00.000Z"),
  ];
  assert.deepEqual(salesOverview(rows, "2026-10-13", "2026-10"), {
    openProspects: 2,
    followUpsDue: 3,
    tastings: 1,
    newCustomersThisMonth: 1,
  });
  assert.equal(
    matchesSalesFilter(
      { ...rows[1]!, name: "Hotell B" },
      {
        query: "hotell",
        segment: "",
        status: "waiting",
        ownerId: "",
        followUp: "due",
        today: "2026-10-13",
      },
    ),
    true,
  );
});

test("a new prospect can already be in operation, and status stays prospect", () => {
  const created = newDeliverySiteRow({
    name: "Hotell B",
    segment: "hotel",
    city: "Oslo",
    deliveryAddress: "",
    active: true,
    salesOwnerId: "peder",
    nextFollowUpOn: "2026-10-16",
    legalEntityId: null,
  });
  assert.equal(created.sales_status, "prospect");
  assert.equal(created.active, true);
  assert.equal(created.partnership_level, null);
  assert.equal(created.supplied_by_customer_id, null);
  assert.equal(created.type, "venue");
});

test("the sales profile keeps status, readiness and login apart", () => {
  const profile = readFileSync(
    new URL("../routes/_authenticated/admin.sales.$customerId.tsx", import.meta.url),
    "utf8",
  );
  assert.match(profile, /update\(salesStatusPatch/);
  assert.match(profile, /update\(commercialReadyPatch/);
  assert.match(profile, /purchasingContactOwner/);
  assert.match(profile, /sales_login_separate/);
  assert.doesNotMatch(profile, /sales_status:[\s\S]{0,80}active:/);
});

test("the database refuses to couple sales status with operations or readiness", () => {
  const sql = readFileSync(new URL("../../sql/20_sales_crm.sql", import.meta.url), "utf8");
  assert.match(
    sql,
    /sales_status cannot change together with active, partnership, supply channel or commercial readiness/,
  );
  assert.match(sql, /customer_contacts_one_owner/);
  assert.match(sql, /legal_entity_id UUID REFERENCES public.legal_entities/);
  assert.doesNotMatch(sql, /CREATE TABLE public.companies/);
  assert.doesNotMatch(sql, /customer_accounts/);
});

function row(
  salesStatus: SalesListStatus,
  nextFollowUpOn: string | null,
  salesStatusChangedAt: string | null,
) {
  return {
    id: salesStatus + (nextFollowUpOn ?? "") + (salesStatusChangedAt ?? ""),
    salesStatus,
    segment: null,
    salesOwnerId: null,
    nextFollowUpOn,
    salesStatusChangedAt,
  };
}

type SalesListStatus = import("./crm.ts").SalesStatus;
