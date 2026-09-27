import assert from "node:assert/strict";
import test from "node:test";
import {
  billingLegalEntityId,
  commercialRouteAtConfirmation,
  isUninvoicedSale,
  legalEntityParentError,
  priceOreAt,
} from "./economy.ts";

test("a wholesaler delivery is a direct Gold sale", () => {
  assert.deepEqual(
    commercialRouteAtConfirmation({ type: "wholesaler", suppliedByCustomerId: null }),
    { commercialRoute: "direct", wholesalerCustomerId: null },
  );
});

test("a venue without a wholesaler is a direct Gold sale", () => {
  assert.deepEqual(
    commercialRouteAtConfirmation({ type: "venue", suppliedByCustomerId: null }),
    { commercialRoute: "direct", wholesalerCustomerId: null },
  );
});

test("a venue supplied by a wholesaler is frozen as via that wholesaler", () => {
  assert.deepEqual(
    commercialRouteAtConfirmation({ type: "venue", suppliedByCustomerId: "villa" }),
    { commercialRoute: "via_wholesaler", wholesalerCustomerId: "villa" },
  );
});

test("the stored route stays via Villa after the venue later buys direct", () => {
  const october = commercialRouteAtConfirmation({
    type: "venue",
    suppliedByCustomerId: "villa",
  });
  const januaryCustomer = commercialRouteAtConfirmation({
    type: "venue",
    suppliedByCustomerId: null,
  });
  assert.equal(october.commercialRoute, "via_wholesaler");
  assert.equal(januaryCustomer.commercialRoute, "direct");
  assert.equal(
    isUninvoicedSale({
      commercialRoute: october.commercialRoute,
      unitPriceOre: 2500,
      hasActiveAllocation: false,
    }),
    false,
  );
});

test("price is the agreement that covers the delivery date", () => {
  const prices = [
    {
      customerId: "oslo",
      productId: "nduja",
      priceOre: 2500,
      validFrom: "2026-01-01",
      validTo: "2026-10-31",
    },
    {
      customerId: "oslo",
      productId: "nduja",
      priceOre: 2700,
      validFrom: "2026-11-01",
      validTo: null,
    },
  ];
  assert.equal(priceOreAt(prices, "oslo", "nduja", "2026-10-20"), 2500);
  assert.equal(priceOreAt(prices, "oslo", "nduja", "2026-11-01"), 2700);
  assert.equal(priceOreAt(prices, "oslo", "truffle", "2026-10-20"), null);
});

test("a missing price is null, never zero", () => {
  assert.equal(priceOreAt([], "oslo", "nduja", "2026-10-20"), null);
  assert.equal(
    priceOreAt(
      [
        {
          customerId: "oslo",
          productId: "nduja",
          priceOre: 0,
          validFrom: "2026-01-01",
          validTo: null,
        },
      ],
      "oslo",
      "nduja",
      "2026-10-20",
    ),
    null,
  );
});

test("billing walks to the hovedenhet unless an override is set", () => {
  const entities = [
    { id: "as", parentLegalEntityId: null },
    { id: "unit", parentLegalEntityId: "as" },
  ];
  assert.equal(
    billingLegalEntityId({ legalEntityId: "unit", billingLegalEntityId: null }, entities),
    "as",
  );
  assert.equal(
    billingLegalEntityId({ legalEntityId: "as", billingLegalEntityId: null }, entities),
    "as",
  );
  assert.equal(
    billingLegalEntityId({ legalEntityId: "unit", billingLegalEntityId: "other" }, entities),
    "other",
  );
  assert.equal(
    billingLegalEntityId({ legalEntityId: null, billingLegalEntityId: null }, entities),
    null,
  );
});

test("uninvoiced means a priced direct sale with no active allocation", () => {
  assert.equal(
    isUninvoicedSale({ commercialRoute: "direct", unitPriceOre: 2500, hasActiveAllocation: false }),
    true,
  );
  assert.equal(
    isUninvoicedSale({ commercialRoute: "direct", unitPriceOre: null, hasActiveAllocation: false }),
    false,
  );
  assert.equal(
    isUninvoicedSale({ commercialRoute: "direct", unitPriceOre: 2500, hasActiveAllocation: true }),
    false,
  );
  assert.equal(
    isUninvoicedSale({
      commercialRoute: "via_wholesaler",
      unitPriceOre: 2500,
      hasActiveAllocation: false,
    }),
    false,
  );
});

test("a subunit points at a hovedenhet and a parent cannot become a subunit", () => {
  assert.equal(
    legalEntityParentError({ id: "as", parentId: null, parentIsSubunit: false, childCount: 2 }),
    null,
  );
  assert.equal(
    legalEntityParentError({ id: "unit", parentId: "unit", parentIsSubunit: false, childCount: 0 }),
    "parent_legal_entity_id cannot reference itself",
  );
  assert.match(
    legalEntityParentError({ id: "unit", parentId: "other-unit", parentIsSubunit: true, childCount: 0 }) ??
      "",
    /hovedenhet/,
  );
  assert.match(
    legalEntityParentError({ id: "as", parentId: "holding", parentIsSubunit: false, childCount: 1 }) ??
      "",
    /subunits/,
  );
});
