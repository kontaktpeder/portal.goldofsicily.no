export const PACK_SIX = 6;
export const PACK_FIFTY = 50;
export const PRICE_SIX_ORE = 16_900;
export const PRICE_FIFTY_ORE = 125_000;
export const RESERVATION_MINUTES = 20;

export const SHOP_FLAVOR_SLUGS = ["nduja", "truffle"] as const;
export type ShopFlavorSlug = (typeof SHOP_FLAVOR_SLUGS)[number];

export const DISCOVERY_SOURCES = ["friends", "instagram", "venue", "search", "other"] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export type PaymentKind = "stripe" | "invoice";

const FLAVOR_LABEL: Record<ShopFlavorSlug, { nameNo: string; nameEn: string }> = {
  nduja: { nameNo: "’Nduja", nameEn: "’Nduja" },
  truffle: { nameNo: "Trøffel", nameEn: "Truffle" },
};

export const CONSUMER_FACT_KEYS = ["ingredients", "allergens", "storage", "prep"] as const;
export type ConsumerFactKey = (typeof CONSUMER_FACT_KEYS)[number];

export type FlavorFacts = {
  verified: boolean;
  ingredients: string | null;
  allergens: string | null;
  storage: string | null;
  prep: string | null;
  ingredientsEn: string | null;
  allergensEn: string | null;
  storageEn: string | null;
  prepEn: string | null;
};

export type FactText = {
  verified?: boolean;
  ingredients: string | null;
  allergens: string | null;
  storage: string | null;
  prep: string | null;
  ingredientsEn?: string | null;
  allergensEn?: string | null;
  storageEn?: string | null;
  prepEn?: string | null;
};

function blankFacts(): FlavorFacts {
  return {
    verified: false,
    ingredients: null,
    allergens: null,
    storage: null,
    prep: null,
    ingredientsEn: null,
    allergensEn: null,
    storageEn: null,
    prepEn: null,
  };
}

function publishFacts(incoming: FactText): FlavorFacts {
  const ingredients = filledFact(incoming.ingredients);
  const allergens = filledFact(incoming.allergens);
  const storage = filledFact(incoming.storage);
  const prep = filledFact(incoming.prep);
  return {
    verified: incoming.verified === true && Boolean(ingredients && allergens && storage && prep),
    ingredients,
    allergens,
    storage,
    prep,
    ingredientsEn: filledFact(incoming.ingredientsEn),
    allergensEn: filledFact(incoming.allergensEn),
    storageEn: filledFact(incoming.storageEn),
    prepEn: filledFact(incoming.prepEn),
  };
}

function filledFact(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

export function consumerFactGaps(
  slug: string,
  facts: {
    verified: boolean;
    ingredients: string | null;
    allergens: string | null;
    storage: string | null;
    prep: string | null;
  },
): string[] {
  const gaps: string[] = [];
  for (const key of CONSUMER_FACT_KEYS) {
    if (!facts.verified || !facts[key]?.trim()) gaps.push(`${slug}:${key}`);
  }
  return gaps;
}

/** A later payment flag is not enough. Mandatory facts must be verified and filled in. */
export function canOpenCheckout(
  paymentRequested: boolean,
  facts: {
    verified: boolean;
    ingredients: string | null;
    allergens: string | null;
    storage: string | null;
    prep: string | null;
  },
): boolean {
  if (!paymentRequested || !facts.verified) return false;
  return CONSUMER_FACT_KEYS.every((key) => Boolean(facts[key]?.trim()));
}

/** Stripe is already paid. Invoice still follows the existing invoice flow. */
export function saleNeedsInvoice(kind: PaymentKind): boolean {
  return kind === "invoice";
}

export function boxesFromPieces(pieces: number, pack: number): number {
  if (!Number.isFinite(pieces) || !Number.isFinite(pack) || pack <= 0) return 0;
  return Math.max(0, Math.floor(pieces / pack));
}

export function sellablePieces(physicalPieces: number, reservedPieces: number): number {
  const physical = Number.isFinite(physicalPieces) ? Math.max(0, Math.floor(physicalPieces)) : 0;
  const reserved = Number.isFinite(reservedPieces) ? Math.max(0, Math.floor(reservedPieces)) : 0;
  return Math.max(0, physical - reserved);
}

export type ReservationRow = {
  productId: string;
  pieces: number;
  status: string;
  expiresAt: string;
};

export function activeReservedPieces(
  rows: readonly ReservationRow[],
  productId: string,
  now: Date,
): number {
  const nowMs = now.getTime();
  return rows.reduce((sum, row) => {
    if (row.productId !== productId || row.status !== "held") return sum;
    const expires = new Date(row.expiresAt).getTime();
    if (!Number.isFinite(expires) || expires <= nowMs) return sum;
    return sum + Math.max(0, Math.floor(row.pieces));
  }, 0);
}

/** The second buyer of the last box sees the first hold and cannot take it. */
export function reservationDecision(
  physicalPieces: number,
  alreadyHeld: number,
  requested: number,
): { ok: true } | { ok: false; reason: "none" | "short" } {
  if (!Number.isFinite(requested) || requested <= 0) return { ok: false, reason: "none" };
  if (requested > sellablePieces(physicalPieces, alreadyHeld))
    return { ok: false, reason: "short" };
  return { ok: true };
}

export type ShopLotPiece = {
  productId: string;
  status: string;
  remaining: number;
};

export function physicalPiecesByProduct(lots: readonly ShopLotPiece[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const lot of lots) {
    if (lot.status === "recalled") continue;
    const pieces = Math.max(0, Math.floor(lot.remaining));
    totals.set(lot.productId, (totals.get(lot.productId) ?? 0) + pieces);
  }
  return totals;
}

export type ShopProduct = {
  id: string;
  slug: string;
  lotLetter: string | null;
  active: boolean;
  facts?: FactText;
};

export function flavorSlug(product: {
  slug: string;
  lotLetter: string | null;
}): ShopFlavorSlug | null {
  const slug = product.slug.trim().toLowerCase();
  if (slug === "nduja" || product.lotLetter?.trim().toUpperCase() === "N") return "nduja";
  if (slug === "truffle" || product.lotLetter?.trim().toUpperCase() === "T") return "truffle";
  return null;
}

export type ShopFlavorView = {
  slug: ShopFlavorSlug;
  nameNo: string;
  nameEn: string;
  pieces: number;
  boxes50: number;
  facts: FlavorFacts;
};

export function shopFlavors(
  products: readonly ShopProduct[],
  piecesByProduct: ReadonlyMap<string, number>,
): ShopFlavorView[] {
  const pieces = new Map<ShopFlavorSlug, number>(SHOP_FLAVOR_SLUGS.map((slug) => [slug, 0]));
  const texts = new Map<ShopFlavorSlug, FlavorFacts>(
    SHOP_FLAVOR_SLUGS.map((slug) => [slug, blankFacts()]),
  );
  for (const product of products) {
    if (!product.active) continue;
    const slug = flavorSlug(product);
    if (!slug) continue;
    pieces.set(slug, (pieces.get(slug) ?? 0) + (piecesByProduct.get(product.id) ?? 0));
    const incoming = product.facts;
    if (!incoming) continue;
    const next = publishFacts(incoming);
    const current = texts.get(slug) ?? blankFacts();
    if (next.verified) {
      texts.set(slug, next);
      continue;
    }
    if (current.verified) continue;
    texts.set(slug, {
      verified: false,
      ingredients: current.ingredients ?? next.ingredients,
      allergens: current.allergens ?? next.allergens,
      storage: current.storage ?? next.storage,
      prep: current.prep ?? next.prep,
      ingredientsEn: current.ingredientsEn ?? next.ingredientsEn,
      allergensEn: current.allergensEn ?? next.allergensEn,
      storageEn: current.storageEn ?? next.storageEn,
      prepEn: current.prepEn ?? next.prepEn,
    });
  }
  return SHOP_FLAVOR_SLUGS.map((slug) => {
    const count = pieces.get(slug) ?? 0;
    const text = texts.get(slug) ?? blankFacts();
    return {
      slug,
      nameNo: FLAVOR_LABEL[slug].nameNo,
      nameEn: FLAVOR_LABEL[slug].nameEn,
      pieces: count,
      boxes50: boxesFromPieces(count, PACK_FIFTY),
      facts: text,
    };
  });
}

export type PublicShop = {
  paymentOpen: false;
  stockKnown: boolean;
  currency: "NOK";
  vatIncluded: true;
  flavors: Array<Omit<ShopFlavorView, "pieces">>;
  purchaseGate: { open: false; missing: string[] };
  packs: {
    six: { size: 6; priceOre: typeof PRICE_SIX_ORE; purchasable: false; status: "coming_soon" };
    fifty: { size: 50; priceOre: typeof PRICE_FIFTY_ORE; purchasable: false; status: "stock" };
  };
};

export function publicShop(flavors: readonly ShopFlavorView[], stockKnown: boolean): PublicShop {
  const published = flavors.map(({ slug, nameNo, nameEn, boxes50, facts }) => ({
    slug,
    nameNo,
    nameEn,
    boxes50,
    facts,
  }));
  return {
    paymentOpen: false,
    stockKnown,
    currency: "NOK",
    vatIncluded: true,
    flavors: published,
    purchaseGate: {
      open: false,
      missing: published.flatMap((flavor) => consumerFactGaps(flavor.slug, flavor.facts)),
    },
    packs: {
      six: { size: 6, priceOre: PRICE_SIX_ORE, purchasable: false, status: "coming_soon" },
      fifty: { size: 50, priceOre: PRICE_FIFTY_ORE, purchasable: false, status: "stock" },
    },
  };
}

export function emptyPublicShop(stockKnown: boolean): PublicShop {
  return publicShop(shopFlavors([], new Map()), stockKnown);
}

export type WaitlistSubscriber = {
  id: string;
  email: string;
  flavorSlug: string;
  lang: "no" | "en";
  notifiedAt: string | null;
};

export function subscribersToNotify(
  subscribers: readonly WaitlistSubscriber[],
  boxes50BySlug: ReadonlyMap<string, number>,
): WaitlistSubscriber[] {
  return subscribers.filter(
    (row) => row.notifiedAt == null && (boxes50BySlug.get(row.flavorSlug) ?? 0) > 0,
  );
}

export function restockMessage(
  lang: "no" | "en",
  flavorName: string,
): { subject: string; text: string } {
  if (lang === "en") {
    return {
      subject: `${flavorName} is back at Gold of Sicily`,
      text: `${flavorName} is available again.\n\nhttps://goldofsicily.no/en/buy\n`,
    };
  }
  return {
    subject: `${flavorName} er tilbake hos Gold of Sicily`,
    text: `${flavorName} er tilgjengelig igjen.\n\nhttps://goldofsicily.no/kjop\n`,
  };
}

export type WaitlistInput = {
  email: string;
  flavor: ShopFlavorSlug;
  lang: "no" | "en";
  discovery: DiscoverySource | null;
  newsletterConsent: boolean;
  launchNotice: boolean;
  restockNotice: boolean;
};

function readDiscovery(value: unknown): DiscoverySource | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  return (DISCOVERY_SOURCES as readonly string[]).includes(value)
    ? (value as DiscoverySource)
    : undefined;
}

/** Older clients omit the flags and stay on the flavor waitlist only. */
export function noticeFlags(
  launchRaw: unknown,
  restockRaw: unknown,
): { launchNotice: boolean; restockNotice: boolean } | null {
  const hasLaunch = typeof launchRaw === "boolean";
  const hasRestock = typeof restockRaw === "boolean";
  const launchNotice = hasLaunch ? launchRaw : false;
  const restockNotice = hasRestock ? restockRaw : !hasLaunch;
  if (!launchNotice && !restockNotice) return null;
  return { launchNotice, restockNotice };
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 255) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function parseWaitlist(body: unknown): WaitlistInput | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const emailRaw = row["email"];
  const flavorRaw = row["flavor"];
  const discoveryRaw = row["discovery"];
  const consentRaw = row["newsletterConsent"];
  const langRaw = row["lang"];
  if (typeof emailRaw !== "string" || typeof flavorRaw !== "string") return null;
  if (typeof consentRaw !== "boolean") return null;
  const email = normalizeEmail(emailRaw);
  const flavor = (SHOP_FLAVOR_SLUGS as readonly string[]).includes(flavorRaw)
    ? (flavorRaw as ShopFlavorSlug)
    : null;
  const lang = langRaw === "en" || langRaw === "no" ? langRaw : null;
  const discovery = readDiscovery(discoveryRaw);
  const notices = noticeFlags(row["launchNotice"], row["restockNotice"]);
  if (!email || !flavor || !lang || discovery === undefined || !notices) return null;
  return {
    email,
    flavor,
    lang,
    discovery,
    newsletterConsent: consentRaw,
    launchNotice: notices.launchNotice,
    restockNotice: notices.restockNotice,
  };
}

export function isShopSchemaError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "42703" ||
    /shop_waitlist|shop_launch_notices|shop_reservations|reserve_shop_pieces|schema cache/i.test(
      message,
    )
  );
}
