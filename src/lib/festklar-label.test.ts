import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FESTKLAR_CATALOG,
  FESTKLAR_COPY,
  FESTKLAR_QR_PATH,
  festklarLabelsDocument,
  festklarPackLine,
  festklarPreviewDocument,
  festklarTestPrintInput,
  formatFestklarDate,
  inferFestklarVariant,
  resolveFestklarPrint,
  suggestFestklarBestBefore,
} from "./festklar-label.ts";

const assetBase = "https://portal.example";

function readyInput(overrides: Partial<Parameters<typeof resolveFestklarPrint>[0]> = {}) {
  return {
    lotCode: "L-20261023-T-01",
    bestBeforeIso: "2027-04-21",
    variantId: "truffle",
    packSize: 6 as number | null,
    copies: 1,
    ...overrides,
  };
}

test("variant display names and pack lines come from one catalog", () => {
  assert.deepEqual(
    FESTKLAR_CATALOG.variants.map((row) => row.displayName),
    ["Trøffel & sjampinjong", "’Nduja & mozzarella", "Mix"],
  );
  assert.equal(festklarPackLine("truffle", 6), "6 stk");
  assert.equal(festklarPackLine("truffle", 50), "50 stk");
  assert.equal(festklarPackLine("nduja", 6), "6 stk");
  assert.equal(festklarPackLine("nduja", 50), "50 stk");
  assert.equal(festklarPackLine("mix", 6), "3 + 3");
  assert.equal(festklarPackLine("mix", 50), "50 stk");
});

test("variant follows the product on the lot and stays empty when it does not", () => {
  assert.equal(inferFestklarVariant({ slug: "truffle", lotLetter: "T", nameNo: "Truffle Arancini" }), "truffle");
  assert.equal(inferFestklarVariant({ slug: "nduja", nameEn: "Nduja Arancini" }), "nduja");
  assert.equal(inferFestklarVariant({ lotLetter: "T" }), "truffle");
  assert.equal(inferFestklarVariant({ nameNo: "Trøffel og sopp" }), "truffle");
  assert.equal(inferFestklarVariant({ slug: "mix", nameNo: "Mix" }), "mix");
  assert.equal(inferFestklarVariant({ slug: "seasonal", lotLetter: "S", nameNo: "Sesong" }), null);
  assert.equal(inferFestklarVariant({ slug: "nduja", lotLetter: "T" }), null);
  assert.equal(inferFestklarVariant(null), null);
});

test("best before uses the lot production date and shelf life, in dd.mm.yyyy", () => {
  assert.equal(suggestFestklarBestBefore("2026-09-07", 180), "2027-03-06");
  assert.equal(formatFestklarDate("2027-03-06"), "06.03.2027");
  assert.equal(formatFestklarDate("2026-02-31"), null);
  assert.equal(suggestFestklarBestBefore("not-a-date", 180), null);
});

test("pack size is the box contents, not the produced quantity", () => {
  const printed = resolveFestklarPrint(readyInput({ packSize: 50, copies: 12 }));
  assert.equal(printed.ok, true);
  if (!printed.ok) return;
  assert.equal(printed.label.packLine, "50 stk");
  assert.equal(printed.label.lotCode, "L-20261023-T-01");
  assert.equal(printed.label.bestBefore, "21.04.2027");
  assert.equal(printed.copies, 12);
});

test("print stays blocked until lot, variant, pack, best before and copies exist", () => {
  const missing = resolveFestklarPrint({
    lotCode: "  ",
    bestBeforeIso: "",
    variantId: "",
    packSize: null,
    copies: 0,
  });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.deepEqual(missing.issues, ["lot", "variant", "pack", "bestBefore", "copies"]);
  assert.equal(festklarPreviewDocument(readyInput({ packSize: null }), assetBase), null);
});

test("every variant and pack size renders inside a 150 × 100 mm sheet", () => {
  for (const variant of FESTKLAR_CATALOG.variants) {
    for (const packSize of [6, 50] as const) {
      const html = festklarLabelsDocument(
        readyInput({ variantId: variant.id, packSize, lotCode: "L-20261023-T-01", bestBeforeIso: "2027-04-21" }),
        assetBase,
      );
      assert.match(html, new RegExp(variant.displayName.replace("&", "&amp;")));
      assert.match(html, new RegExp(festklarPackLine(variant.id, packSize).replace("+", "\\+")));
      assert.match(html, /L-20261023-T-01/);
      assert.match(html, /21\.04\.2027/);
      assert.match(html, /@page \{ size: 150mm 100mm; margin: 0; \}/);
      assert.match(html, /width: 150mm/);
      assert.match(html, /height: 100mm/);
      assert.match(html, /class="sheet"/);
      assert.match(html, new RegExp(FESTKLAR_QR_PATH.replaceAll("/", "\\/")));
      assert.match(html, new RegExp(FESTKLAR_COPY.storage));
      assert.equal(html.includes("transform:"), false);
      assert.doesNotMatch(html, /blad|leaf|logo/i);
    }
  }
  const mixSix = festklarLabelsDocument(readyInput({ variantId: "mix", packSize: 6 }), assetBase);
  assert.match(mixSix, /3 \+ 3/);
  assert.equal(mixSix.includes("6 stk"), false);
});

test("one and several labels produce that many sheets and no forced trailing page", () => {
  const one = festklarLabelsDocument(readyInput({ copies: 1 }), assetBase);
  const three = festklarLabelsDocument(readyInput({ copies: 3 }), assetBase);
  assert.equal(one.match(/<section class="sheet">/g)?.length, 1);
  assert.equal(three.match(/<section class="sheet">/g)?.length, 3);
  assert.match(one, /\.sheet:last-child \{[^}]*break-after:\s*auto/);
  assert.match(one, /fraunces-latin\.woff2/);
  assert.match(one, /document does not|Festklar/);
});

test("lot text is escaped and the test sample is not a production lot code", () => {
  const html = festklarLabelsDocument(readyInput({ lotCode: "L-1 <test>" }), assetBase);
  assert.match(html, /L-1 &lt;test&gt;/);
  assert.equal(html.includes("<test>"), false);
  const sample = festklarTestPrintInput();
  assert.equal(sample.lotCode, "L-TEST");
  assert.equal(sample.copies, 1);
  assert.equal(resolveFestklarPrint(sample).ok, true);
});

test("label printing has no delivery, handover or stock writes", () => {
  const lib = readFileSync(new URL("./festklar-label.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/festklar-label-panel.tsx", import.meta.url), "utf8");
  const forbidden = /supabase|\.insert\(|\.update\(|\.delete\(|gold_lot_handovers|delivery_lines|gold_lot_events/;
  assert.doesNotMatch(lib, forbidden);
  assert.doesNotMatch(panel, forbidden);
  assert.match(lib, /Zebra Browser Print or QZ Tray/);
  assert.match(lib, /document\.fonts/);
  assert.match(panel, /openFestklarPrintWindow/);
  assert.doesNotMatch(panel, /units_per_package|packages_per_carton/);
  const page = readFileSync(new URL("../routes/_authenticated/admin.lots.$lotId.tsx", import.meta.url), "utf8");
  const packingAt = page.indexOf("function LotPackingSection");
  const panelAt = page.indexOf("<LotFestklarPanel", packingAt);
  const bagsAt = page.indexOf("regulatory_labels", packingAt);
  assert.ok(packingAt > 0 && panelAt > packingAt && bagsAt > panelAt);
  const i18n = readFileSync(new URL("./i18n.tsx", import.meta.url), "utf8");
  assert.match(i18n, /Skriv ut produktetiketter/);
});
