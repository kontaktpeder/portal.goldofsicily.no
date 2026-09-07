import { addCalendarDays, formatNetWeight, netWeightGrams, type PackingPlan, type PlannedCarton, type PlannedPackage } from "./packing.ts";
import type { ProductLabelFields } from "./product-version.ts";

export const LABEL_PAGE_MM = { width: 100, height: 150 } as const;
export const LOT_PUBLIC_PATH = "portal.goldofsicily.no/lot";

export type LabelLotContext = {
  lotCode: string;
  productionDate: string;
  snapshot: ProductLabelFields;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function lines(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

export function lotLookupUrl(lotCode: string): string {
  return `https://${LOT_PUBLIC_PATH}/${lotCode}`;
}

export function bestBeforeDate(productionDate: string, shelfLifeDays: number): string {
  return addCalendarDays(productionDate, shelfLifeDays);
}

function formatDateNo(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

function documentShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: ${LABEL_PAGE_MM.width}mm ${LABEL_PAGE_MM.height}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111; }
    body { font-family: Helvetica, Arial, sans-serif; }
    .label {
      width: ${LABEL_PAGE_MM.width}mm;
      height: ${LABEL_PAGE_MM.height}mm;
      box-sizing: border-box;
      padding: 6mm;
      page-break-after: always;
      overflow: hidden;
    }
    .brand { font-size: 9pt; letter-spacing: 0.18em; font-weight: 700; }
    h1 { font-size: 14pt; margin: 4mm 0 2mm; line-height: 1.15; }
    .meta { font-size: 10pt; margin: 1.5mm 0; }
    .lot { font-family: ui-monospace, Menlo, monospace; font-size: 12pt; font-weight: 700; }
    .block { font-size: 8pt; line-height: 1.35; margin-top: 2.5mm; }
    .small { font-size: 7.5pt; line-height: 1.3; margin-top: 2mm; }
    .url { font-family: ui-monospace, Menlo, monospace; font-size: 7pt; margin-top: 3mm; word-break: break-all; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function packageLabelInnerHtml(ctx: LabelLotContext, pack: PlannedPackage): string {
  const { snapshot, lotCode, productionDate } = ctx;
  const best = formatDateNo(bestBeforeDate(productionDate, snapshot.shelfLifeDays));
  const net = formatNetWeight(netWeightGrams(snapshot.unitWeightG, pack.quantity));
  return `<section class="label">
    <div class="brand">GOLD OF SICILY</div>
    <h1>${escapeHtml(snapshot.legalDesignationNo)}</h1>
    <div class="meta">${pack.quantity} stk.${net ? ` / Netto: ${escapeHtml(net)}` : ""}</div>
    <div class="meta lot">LOT ${escapeHtml(lotCode)}</div>
    <div class="meta">Pose ${escapeHtml(pack.shortCode)}</div>
    <div class="meta">Best før: ${best}</div>
    <div class="block">${escapeHtml(snapshot.storageNo)}</div>
    <div class="block">${escapeHtml(snapshot.doNotRefreezeNo)}</div>
    ${snapshot.ingredientsNo ? `<div class="block"><strong>Ingredienser:</strong> ${lines(snapshot.ingredientsNo)}</div>` : ""}
    ${snapshot.allergensNo ? `<div class="block"><strong>Allergener:</strong> ${lines(snapshot.allergensNo)}</div>` : ""}
    ${snapshot.nutritionNo ? `<div class="small">${lines(snapshot.nutritionNo)}</div>` : ""}
    ${snapshot.prepNo ? `<div class="block"><strong>Tilberedning:</strong><br>${lines(snapshot.prepNo)}</div>` : ""}
    <div class="block">Produsert av:<br>${escapeHtml(snapshot.producerName)}${snapshot.producerAddress ? `<br>${lines(snapshot.producerAddress)}` : ""}</div>
    <div class="url">${escapeHtml(lotLookupUrl(lotCode))}</div>
  </section>`;
}

export function cartonLabelInnerHtml(
  ctx: LabelLotContext,
  carton: PlannedCarton,
  packages: PlannedPackage[],
): string {
  const bags = carton.packageSeqs
    .map((seq) => packages.find((row) => row.seq === seq))
    .filter((row): row is PlannedPackage => Boolean(row));
  const sizes = [...new Set(bags.map((row) => row.quantity))];
  const packLine =
    sizes.length === 1
      ? `${bags.length} × ${sizes[0]} stk`
      : bags.map((row) => `${row.shortCode} ${row.quantity} stk`).join(", ");
  return `<section class="label">
    <div class="brand">GOLD OF SICILY</div>
    <h1>${escapeHtml(ctx.snapshot.nameNo.toUpperCase())}<br>DYPFRYST</h1>
    <div class="meta lot">LOT<br>${escapeHtml(ctx.lotCode)}</div>
    <div class="meta lot">KARTONG<br>${escapeHtml(carton.shortCode)}</div>
    <div class="meta">${escapeHtml(packLine)}</div>
    <div class="meta">${carton.quantity} stk</div>
    <div class="url">${escapeHtml(lotLookupUrl(ctx.lotCode))}</div>
  </section>`;
}

export function packageLabelsDocument(ctx: LabelLotContext, plan: PackingPlan): string {
  const body = plan.packages.map((pack) => packageLabelInnerHtml(ctx, pack)).join("");
  return documentShell(`Produktetiketter ${ctx.lotCode}`, body);
}

export function cartonLabelsDocument(ctx: LabelLotContext, plan: PackingPlan): string {
  const body = plan.cartons.map((carton) => cartonLabelInnerHtml(ctx, carton, plan.packages)).join("");
  return documentShell(`Kartongetiketter ${ctx.lotCode}`, body);
}

export function openLabelPrintWindow(html: string): void {
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.onload = () => popup.print();
  setTimeout(() => popup.print(), 250);
}
