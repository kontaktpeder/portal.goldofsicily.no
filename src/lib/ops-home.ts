import { isOpenLot } from "./lot-stock.ts";
import { remainingAtGold, sumQuantities } from "./gold-lot.ts";

export type OpsHandover = {
  quantity: number;
  ownership: "gold" | "villa";
};

export type OpsLot = {
  id: string;
  productId: string;
  producedQty: number;
  status: string;
  deliveredQty: number;
  handovers: OpsHandover[];
};

export type OpsProduct = {
  id: string;
  nameNo: string;
  nameEn: string;
};

export type FlavorStock = {
  productId: string;
  nameNo: string;
  nameEn: string;
  produced: number;
  atVilla: number;
  delivered: number;
  available: number;
};

export type NextNeedItem = {
  id: string;
  source: "venue" | "villa";
  title: string;
  quantity: number;
  flavorName?: string;
};

export type VenueNeedReport = {
  venueId: string;
  venueName: string;
  createdAt: string;
  nextRequired: number | null;
  lines: Array<{
    productId: string;
    nameNo: string;
    nameEn: string;
    nextNeed: number;
  }>;
};

function activeLots(lots: OpsLot[]): OpsLot[] {
  return lots.filter((lot) => lot.status !== "recalled");
}

export function handedQty(lot: OpsLot, ownership?: OpsHandover["ownership"]): number {
  const rows =
    ownership == null ? lot.handovers : lot.handovers.filter((row) => row.ownership === ownership);
  return sumQuantities(rows.map((row) => row.quantity));
}

export function goldRemainingOnLot(lot: OpsLot): number {
  return remainingAtGold(lot.producedQty, handedQty(lot));
}

/** Lots still physically at Gold, ready to hand to Villa. */
export function lotsReadyForHandover(lots: OpsLot[]): OpsLot[] {
  return lots.filter((lot) => isOpenLot(lot.status) && goldRemainingOnLot(lot) > 0);
}

export function flavorStock(products: OpsProduct[], lots: OpsLot[]): FlavorStock[] {
  return products.map((product) => {
    const rows = activeLots(lots).filter((lot) => lot.productId === product.id);
    const produced = sumQuantities(rows.map((lot) => lot.producedQty));
    const delivered = sumQuantities(rows.map((lot) => lot.deliveredQty));
    const handedAll = sumQuantities(rows.map((lot) => handedQty(lot)));
    const handedVilla = sumQuantities(rows.map((lot) => handedQty(lot, "villa")));
    return {
      productId: product.id,
      nameNo: product.nameNo,
      nameEn: product.nameEn,
      produced,
      delivered,
      available: remainingAtGold(produced, handedAll),
      atVilla: Math.max(0, handedVilla - delivered),
    };
  });
}

export type HomeTaskId =
  "approve" | "produce" | "label" | "handover" | "due" | "deliver" | "followup" | "invoice";

export type HomeLotRef = {
  id: string;
  lotCode: string;
  nameNo: string;
  nameEn: string;
};

export type HomeDatedOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  state: "late" | "today";
  note?: string;
};

export type HomeInvoiceDraft = {
  id: string;
  name: string;
};

export type HomeTaskTarget =
  | { to: "/admin/orders" }
  | { to: "/admin/orders/$orderId"; orderId: string }
  | { to: "/admin/lots"; tab: "production" | "active" }
  | { to: "/admin/lots/$lotId"; lotId: string }
  | { to: "/admin/deliveries"; lot: "" }
  | { to: "/admin/invoices" };

export type HomeTask = {
  id: HomeTaskId;
  count: number;
  target: HomeTaskTarget;
};

/** Late or due today. Approaching stays on the order. */
export function isUrgentDay(
  state: "late" | "today" | "approaching" | null,
): state is "late" | "today" {
  return state === "late" || state === "today";
}

function byUrgency(a: { state: "late" | "today" }, b: { state: "late" | "today" }) {
  if (a.state === b.state) return 0;
  return a.state === "late" ? -1 : 1;
}

/** Jobs that are actually waiting. Empty work stays off the list. */
export function homeTasks(input: {
  approvals: readonly { id: string }[];
  productionShortfall: number;
  lotsAtGold: readonly HomeLotRef[];
  openDeliveries: readonly { id: string }[];
  dueDeliveries: readonly HomeDatedOrder[];
  followUps: readonly HomeDatedOrder[];
  invoiceDrafts: readonly HomeInvoiceDraft[];
}): HomeTask[] {
  const tasks: HomeTask[] = [];
  const approval = input.approvals[0];
  if (input.approvals.length === 1 && approval) {
    tasks.push({
      id: "approve",
      count: 1,
      target: { to: "/admin/orders/$orderId", orderId: approval.id },
    });
  } else if (input.approvals.length > 1) {
    tasks.push({
      id: "approve",
      count: input.approvals.length,
      target: { to: "/admin/orders" },
    });
  }
  if (input.productionShortfall > 0) {
    tasks.push({
      id: "produce",
      count: input.productionShortfall,
      target: { to: "/admin/lots", tab: "production" },
    });
  }
  const lots = input.lotsAtGold;
  const lot = lots[0];
  if (lots.length === 1 && lot) {
    tasks.push({
      id: "label",
      count: 1,
      target: { to: "/admin/lots/$lotId", lotId: lot.id },
    });
  } else if (lots.length > 1) {
    tasks.push({
      id: "label",
      count: lots.length,
      target: { to: "/admin/lots", tab: "active" },
    });
  }
  const due = [...input.dueDeliveries].sort(byUrgency);
  const dueOne = due[0];
  if (due.length === 1 && dueOne) {
    tasks.push({
      id: "due",
      count: 1,
      target: { to: "/admin/orders/$orderId", orderId: dueOne.id },
    });
  } else if (due.length > 1) {
    tasks.push({ id: "due", count: due.length, target: { to: "/admin/orders" } });
  }
  const delivery = input.openDeliveries[0];
  if (input.openDeliveries.length === 1 && delivery) {
    tasks.push({
      id: "deliver",
      count: 1,
      target: { to: "/admin/orders/$orderId", orderId: delivery.id },
    });
  } else if (input.openDeliveries.length > 1) {
    tasks.push({
      id: "deliver",
      count: input.openDeliveries.length,
      target: { to: "/admin/deliveries", lot: "" },
    });
  }
  const followUps = [...input.followUps].sort(byUrgency);
  const follow = followUps[0];
  if (followUps.length === 1 && follow) {
    tasks.push({
      id: "followup",
      count: 1,
      target: { to: "/admin/orders/$orderId", orderId: follow.id },
    });
  } else if (followUps.length > 1) {
    tasks.push({ id: "followup", count: followUps.length, target: { to: "/admin/orders" } });
  }
  if (input.invoiceDrafts.length > 0) {
    tasks.push({
      id: "invoice",
      count: input.invoiceDrafts.length,
      target: { to: "/admin/invoices" },
    });
  }
  return tasks;
}

/** Count on Hjem: something is late or due today. The rest of the list stays quiet. */
export function homeUrgentCount(tasks: readonly HomeTask[]): number {
  return tasks.reduce((sum, task) => {
    if (task.id === "due" || task.id === "followup") return sum + task.count;
    return sum;
  }, 0);
}

export function buildNextNeed(
  reports: VenueNeedReport[],
  stock: FlavorStock[],
  lang: "no" | "en",
): NextNeedItem[] {
  const latestByVenue = new Map<string, VenueNeedReport>();
  for (const report of reports) {
    const current = latestByVenue.get(report.venueId);
    if (!current || report.createdAt > current.createdAt) latestByVenue.set(report.venueId, report);
  }

  const venueItems: NextNeedItem[] = [];
  for (const report of latestByVenue.values()) {
    const flavorLines = report.lines.filter((line) => line.nextNeed > 0);
    if (flavorLines.length > 0) {
      for (const line of flavorLines) {
        venueItems.push({
          id: `${report.venueId}:${line.productId}`,
          source: "venue",
          title: report.venueName,
          quantity: line.nextNeed,
          flavorName: lang === "en" ? line.nameEn : line.nameNo,
        });
      }
      continue;
    }
    if ((report.nextRequired ?? 0) > 0) {
      venueItems.push({
        id: report.venueId,
        source: "venue",
        title: report.venueName,
        quantity: report.nextRequired ?? 0,
      });
    }
  }

  const villaItems = stock
    .filter((row) => row.atVilla > 0)
    .map((row) => ({
      id: `villa:${row.productId}`,
      source: "villa" as const,
      title: "Villa",
      quantity: row.atVilla,
      flavorName: lang === "en" ? row.nameEn : row.nameNo,
    }));

  return [...venueItems, ...villaItems];
}
