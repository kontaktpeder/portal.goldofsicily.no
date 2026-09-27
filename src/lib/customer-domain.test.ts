import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  customerInvariantError,
  handoverRecipient,
  type CustomerFacts,
} from "./customer-domain.ts";

const oslo: CustomerFacts = {
  id: "oslo",
  type: "venue",
  partnershipLevel: "gold_partner",
  suppliedByCustomerId: null,
  suppliedByType: null,
  publicVisible: false,
  publicProfile: "listing",
  slug: "oslo-bar",
};

test("partnership level is independent of customer type", () => {
  assert.equal(customerInvariantError(oslo), null);
  assert.equal(
    customerInvariantError({ ...oslo, partnershipLevel: "gold_supply", publicProfile: null }),
    null,
  );
  assert.equal(
    customerInvariantError({
      id: "villa",
      type: "wholesaler",
      partnershipLevel: "gold_partner",
      suppliedByCustomerId: null,
      suppliedByType: null,
      publicVisible: false,
      publicProfile: null,
      slug: null,
    }),
    null,
  );
  assert.equal(customerInvariantError({ ...oslo, partnershipLevel: null }), null);
});

test("supply channel is only venue to wholesaler", () => {
  assert.equal(
    customerInvariantError({
      ...oslo,
      suppliedByCustomerId: "villa",
      suppliedByType: "wholesaler",
    }),
    null,
  );
  assert.equal(
    customerInvariantError({
      ...oslo,
      suppliedByCustomerId: "oslo",
      suppliedByType: "venue",
    }),
    "supplied_by_customer_id cannot reference itself",
  );
  assert.equal(
    customerInvariantError({
      ...oslo,
      suppliedByCustomerId: "other-bar",
      suppliedByType: "venue",
    }),
    "supplied_by_customer_id must reference a wholesaler",
  );
  assert.equal(
    customerInvariantError({
      id: "villa",
      type: "wholesaler",
      partnershipLevel: "gold_supply",
      suppliedByCustomerId: "other",
      suppliedByType: "wholesaler",
      publicVisible: false,
      publicProfile: null,
      slug: null,
    }),
    "supplied_by_customer_id is only for venues",
  );
});

test("public profile is not derived from partnership level", () => {
  assert.equal(
    customerInvariantError({
      ...oslo,
      partnershipLevel: "gold_partner",
      publicVisible: false,
      publicProfile: "listing",
    }),
    null,
  );
  assert.equal(
    customerInvariantError({
      ...oslo,
      partnershipLevel: null,
      publicVisible: true,
      publicProfile: "partner",
    }),
    null,
  );
  assert.equal(
    customerInvariantError({
      id: "villa",
      type: "wholesaler",
      partnershipLevel: "gold_supply",
      suppliedByCustomerId: null,
      suppliedByType: null,
      publicVisible: true,
      publicProfile: "partner",
      slug: "villa",
    }),
    "a wholesaler has no public venue page",
  );
});

test("handover identity is the customer and company is a snapshot", () => {
  assert.equal(handoverRecipient({ customerId: null, customerName: "Villa", companySnapshot: "" }), null);
  assert.deepEqual(
    handoverRecipient({
      customerId: "villa",
      customerName: "Villa Import",
      companySnapshot: "Villa Import AS",
    }),
    { customerId: "villa", recipientCompany: "Villa Import AS" },
  );
  assert.deepEqual(
    handoverRecipient({ customerId: "villa", customerName: "Villa Import", companySnapshot: "  " }),
    { customerId: "villa", recipientCompany: "Villa Import" },
  );
});

test("a wholesaler form asks for its own name and the BRREG search stays beside the field", () => {
  const index = readFileSync(
    new URL("../routes/_authenticated/admin.wholesalers.index.tsx", import.meta.url),
    "utf8",
  );
  const detail = readFileSync(
    new URL("../routes/_authenticated/admin.wholesalers.$customerId.tsx", import.meta.url),
    "utf8",
  );
  const search = readFileSync(new URL("../components/brreg-search.tsx", import.meta.url), "utf8");
  assert.match(index, /wholesaler_name/);
  assert.match(detail, /wholesaler_name/);
  assert.doesNotMatch(index, /customer_name/);
  assert.doesNotMatch(detail, /customer_name/);
  assert.match(search, /shrink-0/);
  assert.doesNotMatch(search, /PrimaryButton/);
  assert.match(search, /event.preventDefault\(\)/);
});
