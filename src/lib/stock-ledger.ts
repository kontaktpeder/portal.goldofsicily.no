import type { RestorableLotStatus } from "./lot-events.ts";
import { statusToRestore } from "./lot-events.ts";
import {
  activeReservedPieces,
  boxesFromPieces,
  flavorSlug,
  PACK_FIFTY,
  sellablePieces,
  SHOP_FLAVOR_SLUGS,
  type ReservationRow,
  type ShopFlavorSlug,
} from "./shop.ts";

export type LedgerBucket = "open" | "closed" | "recalled";

export type LedgerLot = {
  id: string;
  lotCode: string;
  productId: string;
  status: string;
  atGold: number;
  atVilla: number;
  approvedQty: number | null;
  previousStatus: string | null;
};

export type LedgerProduct = {
  id: string;
  slug: string;
  lotLetter: string | null;
  nameNo: string;
  nameEn: string;
};

export type StockLotLine = {
  id: string;
  lotCode: string;
  bucket: LedgerBucket;
  rawStatus: string;
  atGold: number;
  atVilla: number;
  restoreTo: RestorableLotStatus | null;
};

export type StockFlavorRow = {
  key: string;
  name: string;
  shopFlavor: boolean;
  openAtGold: number;
  openAtVilla: number;
  closedAtGold: number;
  closedAtVilla: number;
  recalledAtGold: number;
  recalledAtVilla: number;
  heldPieces: number;
  /** Whole 50-boxes the buy page will show. Null when the product is not sold there. */
  websiteBoxes: number | null;
  websiteRemainder: number;
  lots: StockLotLine[];
};

const SHOP_NAME: Record<ShopFlavorSlug, { no: string; en: string }> = {
  nduja: { no: "’Nduja", en: "’Nduja" },
  truffle: { no: "Trøffel", en: "Truffle" },
};

const BUCKET_ORDER: Record<LedgerBucket, number> = { open: 0, closed: 1, recalled: 2 };

export function lotBucket(status: string): LedgerBucket {
  if (status === "closed") return "closed";
  if (status === "recalled") return "recalled";
  return "open";
}

function pieces(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function buildStockLedger(input: {
  products: readonly LedgerProduct[];
  lots: readonly LedgerLot[];
  holds: readonly ReservationRow[];
  now: Date;
  lang: "no" | "en";
}): StockFlavorRow[] {
  type Group = {
    key: string;
    nameNo: string;
    nameEn: string;
    shopFlavor: boolean;
    productIds: Set<string>;
    lots: LedgerLot[];
  };

  const groups = new Map<string, Group>();
  const productGroup = new Map<string, string>();

  for (const slug of SHOP_FLAVOR_SLUGS) {
    groups.set(slug, {
      key: slug,
      nameNo: SHOP_NAME[slug].no,
      nameEn: SHOP_NAME[slug].en,
      shopFlavor: true,
      productIds: new Set(),
      lots: [],
    });
  }

  for (const product of input.products) {
    const slug = flavorSlug(product);
    if (slug) {
      groups.get(slug)?.productIds.add(product.id);
      productGroup.set(product.id, slug);
      continue;
    }
    groups.set(product.id, {
      key: product.id,
      nameNo: product.nameNo,
      nameEn: product.nameEn,
      shopFlavor: false,
      productIds: new Set([product.id]),
      lots: [],
    });
    productGroup.set(product.id, product.id);
  }

  for (const lot of input.lots) {
    const key = productGroup.get(lot.productId) ?? lot.productId;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        nameNo: lot.lotCode,
        nameEn: lot.lotCode,
        shopFlavor: false,
        productIds: new Set([lot.productId]),
        lots: [],
      });
    }
    groups.get(key)?.lots.push(lot);
  }

  const rows = [...groups.values()].map((group) => {
    let openAtGold = 0;
    let openAtVilla = 0;
    let closedAtGold = 0;
    let closedAtVilla = 0;
    let recalledAtGold = 0;
    let recalledAtVilla = 0;
    const lines: StockLotLine[] = group.lots.map((lot) => {
      const bucket = lotBucket(lot.status);
      const atGold = pieces(lot.atGold);
      const atVilla = pieces(lot.atVilla);
      if (bucket === "open") {
        openAtGold += atGold;
        openAtVilla += atVilla;
      } else if (bucket === "closed") {
        closedAtGold += atGold;
        closedAtVilla += atVilla;
      } else {
        recalledAtGold += atGold;
        recalledAtVilla += atVilla;
      }
      return {
        id: lot.id,
        lotCode: lot.lotCode,
        bucket,
        rawStatus: lot.status,
        atGold,
        atVilla,
        restoreTo:
          bucket === "closed"
            ? statusToRestore({
                previousStatus: lot.previousStatus,
                approvedQty: lot.approvedQty,
                remainingAtGold: atGold,
              })
            : null,
      };
    });
    lines.sort((a, b) => {
      const bucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
      if (bucket !== 0) return bucket;
      return b.lotCode.localeCompare(a.lotCode);
    });
    const heldPieces = [...group.productIds].reduce(
      (sum, productId) => sum + activeReservedPieces(input.holds, productId, input.now),
      0,
    );
    const sellable = group.shopFlavor ? sellablePieces(openAtGold, heldPieces) : 0;
    const websiteBoxes = group.shopFlavor ? boxesFromPieces(sellable, PACK_FIFTY) : null;
    return {
      key: group.key,
      name: input.lang === "en" ? group.nameEn : group.nameNo,
      shopFlavor: group.shopFlavor,
      openAtGold,
      openAtVilla,
      closedAtGold,
      closedAtVilla,
      recalledAtGold,
      recalledAtVilla,
      heldPieces,
      websiteBoxes,
      websiteRemainder: group.shopFlavor ? sellable - (websiteBoxes ?? 0) * PACK_FIFTY : 0,
      lots: lines,
    };
  });

  const shopRows = SHOP_FLAVOR_SLUGS.map((slug) => rows.find((row) => row.key === slug)).filter(
    (row): row is StockFlavorRow => row != null,
  );
  const otherRows = rows
    .filter((row) => !row.shopFlavor && (row.lots.length > 0 || row.openAtGold > 0))
    .sort((a, b) => a.name.localeCompare(b.name, input.lang === "en" ? "en" : "nb"));
  return [...shopRows, ...otherRows];
}
