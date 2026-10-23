import { bestBeforeDate } from "./labels.ts";
import { DEFAULT_SHELF_LIFE_DAYS } from "./product-version.ts";

/**
 * Festklar box label, 150 × 100 mm landscape.
 *
 * Printed through the browser dialog (`window.print`) for a Zebra ZD220
 * installed as a normal printer. Chrome should use paper 100 × 150 mm, landscape,
 * 100% scale and no margins. This file does not write lots, deliveries,
 * handovers, or stock, and pack size is chosen per print — it is not stored on the product.
 * Dialog-free printing can be added later with Zebra Browser Print or QZ Tray
 * if operators need to skip the system dialog.
 *
 * The order QR is a static image. Swap `FESTKLAR_QR_PATH` when the final
 * ordering URL exists — do not bake the code into the layout as a flat label.
 */

export const FESTKLAR_PAGE_MM = { width: 150, height: 100 } as const;
export const FESTKLAR_QR_PATH = "/labels/goldofsicily-qr.png";
export const FESTKLAR_MAX_COPIES = 200;

export const FESTKLAR_VARIANT_IDS = ["truffle", "nduja", "mix"] as const;
export type FestklarVariantId = (typeof FESTKLAR_VARIANT_IDS)[number];

export const FESTKLAR_PACK_SIZES = [6, 50] as const;
export type FestklarPackSize = (typeof FESTKLAR_PACK_SIZES)[number];

export const FESTKLAR_ISSUES = ["lot", "variant", "pack", "bestBefore", "copies"] as const;
export type FestklarIssue = (typeof FESTKLAR_ISSUES)[number];

type FestklarVariant = {
  id: FestklarVariantId;
  displayName: string;
  slugs: readonly string[];
  lotLetters: readonly string[];
  nameIncludes: readonly string[];
};

/**
 * Display names and pack lines live here only. Mix in a six-pack is labelled
 * `3 + 3` because the portal has no separate mix product or 3+3 field.
 */
export const FESTKLAR_CATALOG: {
  variants: readonly FestklarVariant[];
  packLines: Record<FestklarVariantId, Record<FestklarPackSize, string>>;
} = {
  variants: [
    {
      id: "truffle",
      displayName: "Trøffel & sjampinjong",
      slugs: ["truffle"],
      lotLetters: ["T"],
      nameIncludes: ["truffle", "trøffel", "troffel", "sjampinjong"],
    },
    {
      id: "nduja",
      displayName: "’Nduja & mozzarella",
      slugs: ["nduja"],
      lotLetters: ["N"],
      nameIncludes: ["nduja"],
    },
    {
      id: "mix",
      displayName: "Mix",
      slugs: ["mix"],
      lotLetters: [],
      nameIncludes: ["mix"],
    },
  ],
  packLines: {
    truffle: { 6: "6 stk", 50: "50 stk" },
    nduja: { 6: "6 stk", 50: "50 stk" },
    mix: { 6: "3 + 3", 50: "50 stk" },
  },
};

export const FESTKLAR_COPY = {
  brand: "Festklar.",
  orderCaption: "Bestill mer her",
  storage: "HOLDES FRYST −18 °C",
  prepTitle: "Fra frys til fest.",
  warmed: "VARMES FRA FRYST",
  airfryerLabel: "AIRFRYER",
  airfryerDetail: "180 °C · kontroller fra 7 min",
  ovenLabel: "KONVEKSJONSOVN",
  ovenDetail: "210 °C · vifte 4 · tørr varme · ingen damp",
  ovenCheck: "Kontroller fra 8 min",
  done: "FERDIG VED MINST 70 °C KJERNE",
} as const;

export type FestklarProductHint = {
  slug?: string | null;
  lotLetter?: string | null;
  nameNo?: string | null;
  nameEn?: string | null;
};

export type FestklarPrintInput = {
  lotCode: string;
  bestBeforeIso: string;
  variantId: string;
  packSize: number | null;
  copies: number;
};

export type FestklarLabelContent = {
  lotCode: string;
  bestBefore: string;
  variantId: FestklarVariantId;
  displayName: string;
  packSize: FestklarPackSize;
  packLine: string;
};

export type ResolvedFestklar =
  | { ok: true; label: FestklarLabelContent; copies: number }
  | { ok: false; issues: FestklarIssue[] };

export function isFestklarVariantId(value: string): value is FestklarVariantId {
  return (FESTKLAR_VARIANT_IDS as readonly string[]).includes(value);
}

export function isFestklarPackSize(value: number | null | undefined): value is FestklarPackSize {
  return value === 6 || value === 50;
}

export function festklarVariant(id: FestklarVariantId): FestklarVariant {
  const variant = FESTKLAR_CATALOG.variants.find((row) => row.id === id);
  if (!variant) throw new Error(`unknown festklar variant ${id}`);
  return variant;
}

export function festklarPackLine(variantId: FestklarVariantId, packSize: FestklarPackSize): string {
  return FESTKLAR_CATALOG.packLines[variantId][packSize];
}

function fold(value: string): string {
  return value.trim().toLowerCase();
}

function nameMatches(variant: FestklarVariant, name: string): boolean {
  if (!name) return false;
  if (variant.id === "mix") return name === "mix";
  return variant.nameIncludes.some((hint) => name.includes(fold(hint)));
}

export function inferFestklarVariant(product: FestklarProductHint | null | undefined): FestklarVariantId | null {
  if (!product) return null;
  const slug = fold(product.slug ?? "");
  const letter = (product.lotLetter ?? "").trim().toUpperCase();
  const names = [product.nameNo, product.nameEn].map((value) => fold(value ?? "")).filter(Boolean);
  const hits = FESTKLAR_CATALOG.variants.filter((variant) => {
    if (slug && variant.slugs.some((item) => item === slug)) return true;
    if (letter && variant.lotLetters.some((item) => item === letter)) return true;
    return names.some((name) => nameMatches(variant, name));
  });
  if (hits.length !== 1) return null;
  return hits[0].id;
}

export function formatFestklarDate(isoDate: string): string | null {
  const day = isoDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

export function suggestFestklarBestBefore(productionDate: string, shelfLifeDays: number | null | undefined): string | null {
  const days =
    shelfLifeDays != null && Number.isFinite(shelfLifeDays) && shelfLifeDays >= 1
      ? Math.trunc(shelfLifeDays)
      : DEFAULT_SHELF_LIFE_DAYS;
  try {
    return bestBeforeDate(productionDate, days);
  } catch {
    return null;
  }
}

export function parseFestklarCopies(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const copies = Number.parseInt(trimmed, 10);
  if (copies < 1 || copies > FESTKLAR_MAX_COPIES) return null;
  return copies;
}

export function resolveFestklarPrint(input: FestklarPrintInput): ResolvedFestklar {
  const issues: FestklarIssue[] = [];
  const lotCode = input.lotCode.trim();
  if (!lotCode) issues.push("lot");
  if (!isFestklarVariantId(input.variantId)) issues.push("variant");
  if (!isFestklarPackSize(input.packSize)) issues.push("pack");
  const bestBefore = formatFestklarDate(input.bestBeforeIso);
  if (!bestBefore) issues.push("bestBefore");
  if (!Number.isInteger(input.copies) || input.copies < 1 || input.copies > FESTKLAR_MAX_COPIES) {
    issues.push("copies");
  }
  if (issues.length > 0 || !bestBefore || !isFestklarVariantId(input.variantId) || !isFestklarPackSize(input.packSize)) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    copies: input.copies,
    label: {
      lotCode,
      bestBefore,
      variantId: input.variantId,
      displayName: festklarVariant(input.variantId).displayName,
      packSize: input.packSize,
      packLine: festklarPackLine(input.variantId, input.packSize),
    },
  };
}

/** Obvious sample. Callers may print it; nothing here is written to the database. */
export function festklarTestPrintInput(): FestklarPrintInput {
  return {
    lotCode: "L-TEST",
    bestBeforeIso: "2099-12-31",
    variantId: "truffle",
    packSize: 6,
    copies: 1,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function assetUrl(assetBase: string, path: string): string {
  return `${assetBase.replace(/\/$/, "")}${path}`;
}

function festklarCss(assetBase: string): string {
  const roman = assetUrl(assetBase, "/fonts/fraunces-latin.woff2");
  const italic = assetUrl(assetBase, "/fonts/fraunces-latin-italic.woff2");
  const sans = assetUrl(assetBase, "/fonts/inter-latin.woff2");
  const page = FESTKLAR_PAGE_MM;
  return `
@font-face {
  font-family: "Fraunces";
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
  src: url("${roman}") format("woff2");
}
@font-face {
  font-family: "Fraunces";
  font-style: italic;
  font-weight: 100 900;
  font-display: block;
  src: url("${italic}") format("woff2");
}
@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
  src: url("${sans}") format("woff2");
}
@page { size: 150mm 100mm; margin: 0; }
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #000;
}
body {
  font-synthesis: none;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.sheet {
  position: relative;
  width: ${page.width}mm;
  height: ${page.height}mm;
  overflow: hidden;
  background: #fff;
  color: #000;
  break-after: page;
  page-break-after: always;
  break-inside: avoid;
  page-break-inside: avoid;
}
.sheet:last-child {
  break-after: auto;
  page-break-after: auto;
}
h1, p { margin: 0; }
.brand {
  position: absolute;
  left: 8.6mm;
  top: 6.6mm;
  font-family: "Fraunces", "Iowan Old Style", Palatino, serif;
  font-weight: 700;
  font-size: 17.2mm;
  line-height: 0.8;
  letter-spacing: -0.03em;
  white-space: nowrap;
}
.qr-card {
  position: absolute;
  top: 8.2mm;
  right: 8.2mm;
  width: 30.2mm;
  height: 37.8mm;
  border: 0.45mm solid #000;
  border-radius: 3.4mm;
  padding: 2.5mm 2.2mm 2.6mm;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 1.5mm;
  background: #fff;
}
.qr-card img {
  width: 23.6mm;
  height: 23.6mm;
  object-fit: contain;
  display: block;
}
.qr-card p {
  font-family: "Fraunces", "Iowan Old Style", Palatino, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 3.45mm;
  line-height: 1;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.capsule {
  position: absolute;
  left: 8.4mm;
  top: 29.8mm;
  width: 73.2mm;
  height: 26.8mm;
  border: 0.48mm solid #000;
  border-radius: 13.4mm;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.15mm;
  padding: 2mm 5mm 2.2mm;
  background: #fff;
}
.capsule .name {
  font-family: "Fraunces", "Iowan Old Style", Palatino, serif;
  font-weight: 650;
  font-size: 6.35mm;
  line-height: 1.02;
  letter-spacing: -0.022em;
  text-align: center;
  white-space: nowrap;
}
.capsule .count {
  font-family: "Fraunces", "Iowan Old Style", Palatino, serif;
  font-weight: 700;
  font-size: 9mm;
  line-height: 0.9;
  letter-spacing: -0.025em;
  text-align: center;
  white-space: nowrap;
}
.foot {
  position: absolute;
  left: 9mm;
  right: 8.2mm;
  bottom: 6.4mm;
  display: grid;
  grid-template-columns: 58mm 1fr;
  column-gap: 8mm;
  align-items: end;
}
.trace p {
  font-family: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-weight: 700;
  font-size: 3.05mm;
  line-height: 1.15;
  letter-spacing: 0.035em;
  margin-bottom: 2.15mm;
}
.trace p:last-child { margin-bottom: 0; }
.prep-title {
  font-family: "Fraunces", "Iowan Old Style", Palatino, serif;
  font-style: italic;
  font-weight: 560;
  font-size: 5.35mm;
  line-height: 1;
  letter-spacing: -0.02em;
  margin-bottom: 1.7mm;
}
.kicker {
  font-family: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-weight: 600;
  font-size: 2.25mm;
  line-height: 1.1;
  letter-spacing: 0.16em;
  margin-bottom: 1.35mm;
}
.line, .method, .done {
  font-family: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-weight: 500;
  font-size: 2.65mm;
  line-height: 1.2;
}
.air {
  display: flex;
  align-items: baseline;
  gap: 2.4mm;
}
.air strong, .method, .done {
  font-weight: 700;
  letter-spacing: 0.045em;
}
.method { margin-top: 1.45mm; }
.oven-detail { margin-top: 0.35mm; }
.check { margin-top: 0.45mm; }
.done {
  margin-top: 1.35mm;
  font-size: 2.5mm;
  letter-spacing: 0.03em;
}
`;
}

export function festklarSheetHtml(label: FestklarLabelContent, assetBase: string): string {
  const qr = assetUrl(assetBase, FESTKLAR_QR_PATH);
  return `<section class="sheet">
  <h1 class="brand">${escapeHtml(FESTKLAR_COPY.brand)}</h1>
  <aside class="qr-card">
    <img src="${escapeHtml(qr)}" alt="QR-kode: ${escapeHtml(FESTKLAR_COPY.orderCaption)}" width="240" height="240">
    <p>${escapeHtml(FESTKLAR_COPY.orderCaption)}</p>
  </aside>
  <div class="capsule">
    <p class="name">${escapeHtml(label.displayName)}</p>
    <p class="count">${escapeHtml(label.packLine)}</p>
  </div>
  <footer class="foot">
    <div class="trace">
      <p>LOT ${escapeHtml(label.lotCode)}</p>
      <p>BEST FØR ${escapeHtml(label.bestBefore)}</p>
      <p>${escapeHtml(FESTKLAR_COPY.storage)}</p>
    </div>
    <div class="prep">
      <p class="prep-title">${escapeHtml(FESTKLAR_COPY.prepTitle)}</p>
      <p class="kicker">${escapeHtml(FESTKLAR_COPY.warmed)}</p>
      <p class="line air"><strong>${escapeHtml(FESTKLAR_COPY.airfryerLabel)}</strong><span>${escapeHtml(FESTKLAR_COPY.airfryerDetail)}</span></p>
      <p class="method">${escapeHtml(FESTKLAR_COPY.ovenLabel)}</p>
      <p class="line oven-detail">${escapeHtml(FESTKLAR_COPY.ovenDetail)}</p>
      <p class="line check">${escapeHtml(FESTKLAR_COPY.ovenCheck)}</p>
      <p class="done">${escapeHtml(FESTKLAR_COPY.done)}</p>
    </div>
  </footer>
</section>`;
}

function documentShell(title: string, assetBase: string, body: string): string {
  return `<!doctype html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>${festklarCss(assetBase)}</style>
</head>
<body>${body}</body>
</html>`;
}

export function festklarLabelsDocument(input: FestklarPrintInput, assetBase: string): string {
  const resolved = resolveFestklarPrint(input);
  if (!resolved.ok) {
    throw new Error(`festklar label incomplete: ${resolved.issues.join(",")}`);
  }
  const body = Array.from({ length: resolved.copies }, () => festklarSheetHtml(resolved.label, assetBase)).join("");
  return documentShell(`Festklar ${resolved.label.lotCode}`, assetBase, body);
}

export function festklarPreviewDocument(input: FestklarPrintInput, assetBase: string): string | null {
  const resolved = resolveFestklarPrint({ ...input, copies: 1 });
  if (!resolved.ok) return null;
  return festklarLabelsDocument({ ...input, copies: 1 }, assetBase);
}

export type FestklarPrintResult = "opened" | "blocked" | "assets-failed";

export function openFestklarPrintWindow(html: string): Promise<FestklarPrintResult> {
  const popup = window.open("", "_blank");
  if (!popup) return Promise.resolve("blocked");
  popup.document.open();
  popup.document.write(html);
  popup.document.close();

  return new Promise((resolve) => {
    const printWhenReady = () => {
      const images = Array.from(popup.document.images);
      const imageReady = Promise.all(
        images.map(
          (img) =>
            new Promise<void>((done) => {
              if (img.complete) {
                done();
                return;
              }
              img.addEventListener("load", () => done(), { once: true });
              img.addEventListener("error", () => done(), { once: true });
            }),
        ),
      );
      const fontsReady = popup.document.fonts?.ready ?? Promise.resolve();
      void Promise.all([fontsReady, imageReady])
        .then(() => {
          const missingImage = images.some((img) => img.naturalWidth === 0);
          if (missingImage) {
            resolve("assets-failed");
            return;
          }
          popup.focus();
          popup.print();
          resolve("opened");
        })
        .catch(() => resolve("assets-failed"));
    };

    if (popup.document.readyState === "complete") printWhenReady();
    else popup.addEventListener("load", printWhenReady, { once: true });
  });
}
