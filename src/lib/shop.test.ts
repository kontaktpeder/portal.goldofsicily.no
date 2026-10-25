import assert from "node:assert/strict";
import test from "node:test";
import {
  PACK_FIFTY,
  PRICE_FIFTY_ORE,
  PRICE_SIX_ORE,
  activeReservedPieces,
  boxesFromPieces,
  emptyPublicShop,
  flavorSlug,
  parseWaitlist,
  physicalPiecesByProduct,
  canOpenCheckout,
  publicShop,
  reservationDecision,
  restockMessage,
  saleNeedsInvoice,
  shopFlavors,
  subscribersToNotify,
} from "./shop.ts";

test("prices stay locked and payment stays off", () => {
  const shop = emptyPublicShop(true);
  assert.equal(shop.paymentOpen, false);
  assert.equal(shop.packs.six.priceOre, PRICE_SIX_ORE);
  assert.equal(shop.packs.six.priceOre, 16900);
  assert.equal(shop.packs.six.purchasable, false);
  assert.equal(shop.packs.six.status, "coming_soon");
  assert.equal(shop.packs.fifty.priceOre, PRICE_FIFTY_ORE);
  assert.equal(shop.packs.fifty.priceOre, 125000);
  assert.equal(shop.packs.fifty.purchasable, false);
  assert.equal(shop.vatIncluded, true);
});

test("fifty boxes share the piece count, and a short remainder cannot fill a box", () => {
  assert.equal(boxesFromPieces(349, PACK_FIFTY), 6);
  assert.equal(boxesFromPieces(49, PACK_FIFTY), 0);
  assert.equal(boxesFromPieces(50, PACK_FIFTY), 1);
  assert.equal(boxesFromPieces(0, PACK_FIFTY), 0);
});

test("closed stock still counts, recalled stock does not", () => {
  const pieces = physicalPiecesByProduct([
    { productId: "nduja", status: "closed", remaining: 50 },
    { productId: "nduja", status: "recalled", remaining: 100 },
    { productId: "truffle", status: "produced", remaining: 20 },
  ]);
  assert.equal(pieces.get("nduja"), 50);
  assert.equal(pieces.get("truffle"), 20);
});

test("flavor stock sums by slug or lot letter", () => {
  const flavors = shopFlavors(
    [
      { id: "p1", slug: "nduja-mozzarella", lotLetter: "N", active: true },
      { id: "p2", slug: "truffle", lotLetter: "T", active: true },
      { id: "p3", slug: "other", lotLetter: null, active: true },
    ],
    new Map([
      ["p1", 100],
      ["p2", 40],
      ["p3", 500],
    ]),
  );
  assert.equal(flavorSlug({ slug: "nduja", lotLetter: null }), "nduja");
  assert.deepEqual(
    flavors.map((flavor) => [flavor.slug, flavor.boxes50, flavor.nameNo]),
    [
      ["nduja", 2, "’Nduja"],
      ["truffle", 0, "Trøffel"],
    ],
  );
  const published = publicShop(flavors, true);
  const first = published.flavors[0];
  assert.ok(first);
  assert.equal("pieces" in first, false);
});

test("one hold of the last fifty blocks the next buyer, and an expired hold does not", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const rows = [
    { productId: "nduja", pieces: 50, status: "held", expiresAt: "2026-10-24T12:10:00Z" },
    { productId: "nduja", pieces: 50, status: "held", expiresAt: "2026-10-24T11:00:00Z" },
    { productId: "nduja", pieces: 50, status: "released", expiresAt: "2026-10-24T13:00:00Z" },
  ];
  const held = activeReservedPieces(rows, "nduja", now);
  assert.equal(held, 50);
  assert.deepEqual(reservationDecision(50, held, 50), { ok: false, reason: "short" });
  assert.deepEqual(reservationDecision(100, held, 50), { ok: true });
  assert.deepEqual(reservationDecision(50, 0, 50), { ok: true });
});

test("stripe sales are not invoiced again", () => {
  assert.equal(saleNeedsInvoice("stripe"), false);
  assert.equal(saleNeedsInvoice("invoice"), true);
});

test("waitlist mail goes only to people still waiting on a flavor that has a box", () => {
  const pending = subscribersToNotify(
    [
      { id: "1", email: "a@example.com", flavorSlug: "nduja", lang: "no", notifiedAt: null },
      { id: "2", email: "b@example.com", flavorSlug: "truffle", lang: "en", notifiedAt: null },
      {
        id: "3",
        email: "c@example.com",
        flavorSlug: "nduja",
        lang: "no",
        notifiedAt: "2026-10-01",
      },
    ],
    new Map([
      ["nduja", 1],
      ["truffle", 0],
    ]),
  );
  assert.deepEqual(
    pending.map((row) => row.id),
    ["1"],
  );
  assert.match(restockMessage("no", "’Nduja").text, /goldofsicily\.no\/kjop/);
  assert.doesNotMatch(restockMessage("no", "’Nduja").text, /@/);
});

test("product text stays unverified, so checkout cannot open on a payment flag alone", () => {
  const written = {
    ingredients: "ris",
    allergens: "melk",
    storage: "fryst",
    prep: "ovn",
  };
  assert.equal(canOpenCheckout(true, { verified: false, ...written }), false);
  assert.equal(canOpenCheckout(false, { verified: true, ...written }), false);
  assert.equal(canOpenCheckout(true, { verified: true, ...written, allergens: " " }), false);
  assert.equal(canOpenCheckout(true, { verified: true, ...written }), true);
  const shop = publicShop(
    shopFlavors(
      [
        { id: "p1", slug: "nduja", lotLetter: "N", active: true, facts: written },
        { id: "p2", slug: "truffle", lotLetter: "T", active: true },
      ],
      new Map([["p1", 50]]),
    ),
    true,
  );
  assert.equal(shop.purchaseGate.open, false);
  assert.equal(shop.paymentOpen, false);
  assert.equal(shop.flavors[0]?.facts.verified, false);
  assert.equal(shop.flavors[0]?.facts.ingredients, "ris");
  assert.ok(shop.purchaseGate.missing.includes("nduja:allergens"));
  assert.ok(shop.purchaseGate.missing.includes("truffle:storage"));

  const confirmed = publicShop(
    shopFlavors(
      [
        {
          id: "p1",
          slug: "nduja",
          lotLetter: "N",
          active: true,
          facts: { verified: true, ...written, ingredientsEn: "rice" },
        },
        {
          id: "p2",
          slug: "truffle",
          lotLetter: "T",
          active: true,
          facts: { verified: true, ...written },
        },
      ],
      new Map(),
    ),
    true,
  );
  assert.equal(confirmed.paymentOpen, false);
  assert.equal(confirmed.purchaseGate.open, false);
  assert.equal(confirmed.flavors[0]?.facts.verified, true);
  assert.equal(confirmed.flavors[0]?.facts.ingredientsEn, "rice");
  assert.equal(confirmed.purchaseGate.missing.length, 0);
  assert.equal(
    publicShop(
      shopFlavors(
        [
          {
            id: "p1",
            slug: "nduja",
            lotLetter: "N",
            active: true,
            facts: { verified: true, ...written, allergens: " " },
          },
        ],
        new Map(),
      ),
      true,
    ).flavors[0]?.facts.verified,
    false,
  );
});

test("waitlist input keeps newsletter consent separate and rejects a missing choice", () => {
  const parsed = parseWaitlist({
    email: " Ada@Example.com ",
    flavor: "truffle",
    lang: "en",
    discovery: "instagram",
    newsletterConsent: false,
  });
  assert.equal(parsed?.email, "ada@example.com");
  assert.equal(parsed?.newsletterConsent, false);
  assert.equal(parsed?.launchNotice, false);
  assert.equal(parsed?.restockNotice, true);
  const launchOnly = parseWaitlist({
    email: "ada@example.com",
    flavor: "nduja",
    lang: "no",
    discovery: "friends",
    newsletterConsent: true,
    launchNotice: true,
    restockNotice: false,
  });
  assert.equal(launchOnly?.launchNotice, true);
  assert.equal(launchOnly?.restockNotice, false);
  const quiet = parseWaitlist({
    email: "ada@example.com",
    flavor: "nduja",
    lang: "no",
    newsletterConsent: false,
    launchNotice: true,
    restockNotice: false,
  });
  assert.equal(quiet?.discovery, null);
  assert.equal(
    parseWaitlist({
      email: "ada@example.com",
      flavor: "nduja",
      lang: "no",
      discovery: "billboard",
      newsletterConsent: false,
      launchNotice: true,
      restockNotice: false,
    }),
    null,
  );
  assert.equal(
    parseWaitlist({
      email: "ada@example.com",
      flavor: "nduja",
      lang: "no",
      discovery: "friends",
      newsletterConsent: false,
      launchNotice: false,
      restockNotice: false,
    }),
    null,
  );
  assert.equal(
    parseWaitlist({
      email: "ada@example.com",
      flavor: "truffle",
      lang: "en",
      discovery: "instagram",
    }),
    null,
  );
  assert.equal(
    parseWaitlist({
      email: "ada@example.com",
      flavor: "pistachio",
      lang: "no",
      discovery: "friends",
      newsletterConsent: true,
    }),
    null,
  );
});
