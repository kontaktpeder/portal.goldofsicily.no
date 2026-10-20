import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canCancelOrder,
  formatAgreedDelivery,
  fulfillmentBlock,
  orderDeliveryDraft,
  isOrderSchemaError,
  legacyInvoicePortions,
  orderInvoicePortions,
  deliveryErrorKind,
  linkableQuantity,
  orderListBucket,
  orderListRank,
  orderPartyLabel,
  orderPrimaryAction,
  orderProgress,
  productionNeed,
  deliveryNotice,
  followUpNotice,
  dnbDocumentKey,
  goodsInvoicePrepareLabel,
  invoiceReviewLines,
  orderGoodsReview,
  orderInvoiceSteps,
  waitingInvoiceOrders,
  remainingQuantity,
  suggestedDeliveryQuantity,
  visibleOrderNotices,
  type OrderInvoiceLine,
  type ActiveInvoiceSlice,
  type DeskDelivery,
  type DeskFulfillment,
} from "./orders.ts";

test("a confirmed order shows remaining quantity and partial delivery", () => {
  assert.equal(remainingQuantity(1000, 400), 600);
  assert.equal(orderProgress("confirmed", 1000, 0), "confirmed");
  assert.equal(orderProgress("confirmed", 1000, 400), "partially_delivered");
  assert.equal(orderProgress("confirmed", 1000, 1000), "delivered");
  assert.equal(orderProgress("draft", 1000, 0), "draft");
  assert.equal(canCancelOrder("confirmed", 400), false);
  assert.equal(canCancelOrder("confirmed", 0), true);
});

test("Villa's 1000 order invoices the delivered 400 once, at the frozen price", () => {
  const delivery: DeskDelivery = {
    deliveryLineId: "delivery-400",
    quantity: 400,
    unitPriceOre: null,
    commercialRoute: "via_wholesaler",
    billingLegalEntityId: "venue-entity",
  };
  const fulfillment: DeskFulfillment = {
    id: "fulfill-400",
    deliveryLineId: delivery.deliveryLineId,
    quantity: 400,
    unitPriceOre: 2500,
    billingLegalEntityId: "villa-entity",
  };

  const first = orderInvoicePortions([fulfillment], []);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.quantity, 400);
  assert.equal(first[0]?.unitPriceOre, 2500);
  assert.equal(first[0]?.billingLegalEntityId, "villa-entity");
  assert.deepEqual(legacyInvoicePortions([delivery], [fulfillment], []), []);

  const invoiced: ActiveInvoiceSlice[] = [
    { deliveryLineId: delivery.deliveryLineId, fulfillmentId: fulfillment.id, quantity: 400 },
  ];
  assert.deepEqual(orderInvoicePortions([fulfillment], invoiced), []);
  assert.deepEqual(legacyInvoicePortions([delivery], [fulfillment], invoiced), []);
});

test("a split delivery invoices each order portion and only the unordered remainder", () => {
  const delivery: DeskDelivery = {
    deliveryLineId: "delivery-400",
    quantity: 400,
    unitPriceOre: 1800,
    commercialRoute: "direct",
    billingLegalEntityId: "venue-entity",
  };
  const fulfillments: DeskFulfillment[] = [
    {
      id: "part-villa",
      deliveryLineId: delivery.deliveryLineId,
      quantity: 250,
      unitPriceOre: 2500,
      billingLegalEntityId: "villa-entity",
    },
    {
      id: "part-other",
      deliveryLineId: delivery.deliveryLineId,
      quantity: 100,
      unitPriceOre: 3000,
      billingLegalEntityId: "other-entity",
    },
  ];

  const orders = orderInvoicePortions(fulfillments, []);
  assert.deepEqual(
    orders.map((row) => [row.billingLegalEntityId, row.quantity, row.unitPriceOre]),
    [
      ["villa-entity", 250, 2500],
      ["other-entity", 100, 3000],
    ],
  );
  const legacy = legacyInvoicePortions([delivery], fulfillments, []);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]?.quantity, 50);
  assert.equal(legacy[0]?.unitPriceOre, 1800);
  assert.equal(legacy[0]?.billingLegalEntityId, "venue-entity");
});

test("an unordered direct delivery keeps today's invoice rule", () => {
  const portions = legacyInvoicePortions(
    [
      {
        deliveryLineId: "direct",
        quantity: 12,
        unitPriceOre: 900,
        commercialRoute: "direct",
        billingLegalEntityId: "gold-customer",
      },
      {
        deliveryLineId: "via",
        quantity: 12,
        unitPriceOre: 900,
        commercialRoute: "via_wholesaler",
        billingLegalEntityId: "gold-customer",
      },
    ],
    [],
    [],
  );
  assert.equal(portions.length, 1);
  assert.equal(portions[0]?.deliveryLineId, "direct");
  assert.equal(portions[0]?.quantity, 12);
});

test("two allocations cannot pass the ordered or delivered quantity", () => {
  assert.equal(
    fulfillmentBlock({
      orderStatus: "confirmed",
      ordered: 1000,
      alreadyFulfilled: 700,
      delivered: 400,
      alreadyOnDelivery: 0,
      legacyInvoiced: 0,
      quantity: 400,
      sameProduct: true,
      sameSite: true,
    }),
    "fulfillment exceeds ordered quantity",
  );
  assert.equal(
    fulfillmentBlock({
      orderStatus: "confirmed",
      ordered: 1000,
      alreadyFulfilled: 0,
      delivered: 400,
      alreadyOnDelivery: 250,
      legacyInvoiced: 0,
      quantity: 200,
      sameProduct: true,
      sameSite: true,
    }),
    "fulfillment exceeds delivered quantity",
  );
  assert.equal(
    fulfillmentBlock({
      orderStatus: "confirmed",
      ordered: 1000,
      alreadyFulfilled: 0,
      delivered: 400,
      alreadyOnDelivery: 0,
      legacyInvoiced: 400,
      quantity: 400,
      sameProduct: true,
      sameSite: true,
    }),
    "fulfillment overlaps an invoice",
  );
  assert.equal(
    fulfillmentBlock({
      orderStatus: "confirmed",
      ordered: 1000,
      alreadyFulfilled: 0,
      delivered: 400,
      alreadyOnDelivery: 0,
      legacyInvoiced: 0,
      quantity: 400,
      sameProduct: true,
      sameSite: true,
    }),
    null,
  );
});

test("production need is the confirmed remainder against stock on hand", () => {
  const rows = productionNeed(
    [
      { productId: "truffle", ordered: 1000, fulfilled: 400, confirmed: true },
      { productId: "truffle", ordered: 100, fulfilled: 0, confirmed: false },
      { productId: "pistachio", ordered: 80, fulfilled: 80, confirmed: true },
    ],
    [{ productId: "truffle", available: 200, atVilla: 50 }],
  );
  assert.deepEqual(rows, [{ productId: "truffle", remaining: 600, onHand: 250, shortfall: 350 }]);
});

test("Denis sees the orderer, and the delivery site only when it differs", () => {
  assert.deepEqual(
    orderPartyLabel({
      ordererName: "Villa Import",
      shipToName: "Villa Import",
      contactName: " Robert ",
    }),
    { contact: "Robert", site: null },
  );
  assert.deepEqual(
    orderPartyLabel({
      ordererName: "Villa Import",
      shipToName: "Oslo Bar & Bowling",
      contactName: "",
    }),
    { contact: null, site: "Oslo Bar & Bowling" },
  );
});

test("the role decides the one next action, and open orders come before history", () => {
  assert.equal(orderPrimaryAction(true), "approve");
  assert.equal(orderPrimaryAction(false), "submit");
  assert.equal(orderListBucket("pending_confirmation"), "queue");
  assert.equal(orderListBucket("confirmed"), "deliver");
  assert.equal(orderListBucket("partially_delivered"), "deliver");
  assert.equal(orderListBucket("changes_requested"), "working");
  assert.equal(orderListBucket("draft"), "working");
  assert.equal(orderListBucket("delivered"), "earlier");
  assert.ok(orderListRank("pending_confirmation") < orderListRank("draft"));
  assert.ok(orderListRank("partially_delivered") < orderListRank("delivered"));
  assert.equal(formatAgreedDelivery("2026-10-25", "no"), "25. oktober");
  assert.equal(orderProgress("changes_requested", 10, 0), "changes_requested");
});

test("two partial deliveries of 5 per flavor leave 10, then mark the order delivered", () => {
  const ordered = 10 + 10;
  const first = 5 + 5;
  assert.equal(remainingQuantity(ordered, first), 10);
  assert.equal(orderProgress("confirmed", ordered, first), "partially_delivered");
  assert.equal(orderListBucket("partially_delivered"), "deliver");
  assert.equal(orderProgress("confirmed", ordered, ordered), "delivered");
  assert.equal(orderListBucket("delivered"), "earlier");
  assert.equal(suggestedDeliveryQuantity(10, 8), 8);
  assert.equal(suggestedDeliveryQuantity(10, 0), 0);
  assert.equal(suggestedDeliveryQuantity(0, 5), 0);
  assert.equal(linkableQuantity(10, 4, 2), 4);
  assert.equal(
    fulfillmentBlock({
      orderStatus: "confirmed",
      ordered: 10,
      alreadyFulfilled: 0,
      delivered: 10,
      alreadyOnDelivery: 0,
      legacyInvoiced: 0,
      quantity: 10,
      sameProduct: true,
      sameSite: false,
    }),
    "delivery site does not match the order",
  );
});

test("stock, schema and a wrong recipient become understandable delivery errors", () => {
  assert.equal(deliveryErrorKind("Gold-LOT har ikke nok tilgjengelig beholdning"), "stock");
  assert.equal(
    deliveryErrorKind("Could not find the function public.register_order_delivery"),
    "schema",
  );
  assert.equal(deliveryErrorKind("delivery site does not match the order"), "site");
  assert.equal(deliveryErrorKind("fulfillment exceeds ordered quantity"), "quantity");
});

test("two partial fulfillments invoice the frozen price once each", () => {
  const portions: DeskFulfillment[] = [
    {
      id: "first-five",
      deliveryLineId: "delivery-a",
      quantity: 5,
      unitPriceOre: 2500,
      billingLegalEntityId: "villa-entity",
    },
    {
      id: "second-five",
      deliveryLineId: "delivery-b",
      quantity: 5,
      unitPriceOre: 2500,
      billingLegalEntityId: "villa-entity",
    },
  ];
  const open = orderInvoicePortions(portions, []);
  assert.equal(open.length, 2);
  assert.equal(
    open.reduce((sum, row) => sum + row.quantity * row.unitPriceOre, 0),
    25000,
  );
  const afterFirst: ActiveInvoiceSlice[] = [
    { deliveryLineId: "delivery-a", fulfillmentId: "first-five", quantity: 5 },
  ];
  const rest = orderInvoicePortions(portions, afterFirst);
  assert.deepEqual(
    rest.map((row) => row.id),
    ["second-five"],
  );
  assert.deepEqual(
    orderInvoicePortions(portions, [
      ...afterFirst,
      { deliveryLineId: "delivery-b", fulfillmentId: "second-five", quantity: 5 },
    ]),
    [],
  );
});

test("a delivery registered on the order keeps the site and the order lines", () => {
  const draft = orderDeliveryDraft({
    shipToCustomerId: "oslo",
    orderNumber: "O-0002",
    lines: [
      { orderLineId: "nduja-line", productId: "nduja", quantity: 10, goldLotId: "lot-a" },
      { orderLineId: "truffle-line", productId: "truffle", quantity: 0, goldLotId: "" },
    ],
  });
  assert.equal(draft.customerId, "oslo");
  assert.equal(draft.note, "O-0002");
  assert.equal(draft.quantity, 10);
  assert.deepEqual(
    draft.lines.map((line) => line.orderLineId),
    ["nduja-line"],
  );
});

test("approval is stored by the database and an employee cannot confirm", () => {
  const sql = readFileSync(new URL("../../sql/23_order_approval.sql", import.meta.url), "utf8");
  assert.match(sql, /only a production lead or admin can approve an order/);
  assert.match(sql, /only a production lead or admin can cancel this order/);
  assert.match(sql, /NEW\.approved_by := auth\.uid\(\)/);
  assert.match(sql, /NEW\.approved_at := now\(\)/);
  assert.match(sql, /approved_name_snapshot/);
  assert.match(sql, /return note is missing/);
  assert.match(sql, /an order waiting for approval keeps its lines/);
  assert.match(sql, /can_register_orders\(\)/);
  assert.match(sql, /role::text IN \('admin', 'ops'\)/);
  assert.match(sql, /role::text IN \('admin', 'ops', 'employee'\)/);
  assert.doesNotMatch(sql, /net\.http|unimicro|send.?mail/i);
  assert.equal(isOrderSchemaError("column approved_name_snapshot does not exist"), true);
});

test("delivery from an order is one transaction and an employee still cannot confirm", () => {
  const sql = readFileSync(new URL("../../sql/24_order_delivery.sql", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261019140000_order_delivery.sql", import.meta.url),
    "utf8",
  );
  assert.equal(
    sql.slice(sql.indexOf("ALTER TABLE")),
    migration.slice(migration.indexOf("ALTER TABLE")),
  );
  assert.match(sql, /only a production lead or admin can approve an order/);
  assert.match(sql, /NEW\.submitted_by := auth\.uid\(\)/);
  assert.match(sql, /NEW\.submitted_at := now\(\)/);
  assert.match(sql, /this order is already approved/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /sale\.ship_to_customer_id/);
  assert.match(sql, /INSERT INTO public\.order_delivery_requests/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.register_order_delivery/);
  assert.match(sql, /customers_supplied_by_customer_id_fkey not added/);
  assert.doesNotMatch(sql, /UPDATE public\.customers/);
  assert.doesNotMatch(sql, /net\.http|unimicro|send.?mail/i);
  assert.equal(isOrderSchemaError("function register_order_delivery does not exist"), true);
});

test("the database freezes the recipient and guards quantities", () => {
  const sql = readFileSync(new URL("../../sql/22_customer_orders.sql", import.meta.url), "utf8");
  assert.match(sql, /a confirmed order keeps its recipient, price and date/);
  assert.match(sql, /fulfillment exceeds ordered quantity/);
  assert.match(sql, /fulfillment exceeds delivered quantity/);
  assert.match(sql, /invoice quantity exceeds delivered quantity/);
  assert.match(sql, /delivery quantity is already on an order/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /order_line_fulfillment_id/);
  const orderBranch = sql.indexOf("IF NEW.order_line_fulfillment_id IS NOT NULL");
  assert.doesNotMatch(sql.slice(orderBranch, sql.indexOf("ELSE", orderBranch)), /commercial_route/);
});

function invoiceLine(
  over: Partial<OrderInvoiceLine> & { draftId: string; fulfillmentId: string },
): OrderInvoiceLine {
  return {
    status: "draft",
    transferStatus: "not_transferred",
    dnbStatus: null,
    accountingInvoiceId: null,
    invoiceNumber: null,
    dueOn: null,
    paidOn: null,
    quantity: 20,
    unitPriceOre: 2500,
    active: true,
    ...over,
  };
}

test("agreed delivery notices stop when nothing remains", () => {
  assert.equal(
    deliveryNotice({ agreedOn: "2026-10-18", today: "2026-10-20", remaining: 4 }),
    "late",
  );
  assert.equal(
    deliveryNotice({ agreedOn: "2026-10-20", today: "2026-10-20", remaining: 4 }),
    "today",
  );
  assert.equal(
    deliveryNotice({ agreedOn: "2026-10-22", today: "2026-10-20", remaining: 4 }),
    "approaching",
  );
  assert.equal(deliveryNotice({ agreedOn: "2026-10-25", today: "2026-10-20", remaining: 4 }), null);
  assert.equal(deliveryNotice({ agreedOn: "2026-10-18", today: "2026-10-20", remaining: 0 }), null);
  assert.equal(deliveryNotice({ agreedOn: null, today: "2026-10-20", remaining: 4 }), null);
  assert.equal(
    followUpNotice({ followUpOn: "2026-10-20", followUpNote: "  ", today: "2026-10-20" }),
    null,
  );
  assert.deepEqual(
    followUpNotice({
      followUpOn: "2026-10-20",
      followUpNote: "Avklar transport",
      today: "2026-10-20",
    }),
    { on: "2026-10-20", note: "Avklar transport", state: "today" },
  );
});

test("delivery notices go to the owner, and a lead sees every open order", () => {
  const orders = [
    {
      id: "o1",
      orderNumber: "O-1",
      customerName: "Villa",
      ownerId: "denis",
      agreedOn: "2026-10-20",
      remaining: 3,
      followUpOn: null,
      followUpNote: null,
    },
  ];
  assert.equal(
    visibleOrderNotices({ today: "2026-10-20", viewerId: "ashraf", viewerIsLead: false, orders })
      .deliveries.length,
    0,
  );
  assert.equal(
    visibleOrderNotices({ today: "2026-10-20", viewerId: "denis", viewerIsLead: false, orders })
      .deliveries.length,
    1,
  );
  assert.equal(
    visibleOrderNotices({ today: "2026-10-20", viewerId: "ashraf", viewerIsLead: true, orders })
      .deliveries[0]?.state,
    "today",
  );
});

test("the invoice button reuses an open basis instead of starting another", () => {
  const prepare = orderInvoiceSteps({ remaining: 0, fulfillmentIds: ["f1"], lines: [] });
  assert.equal(prepare.action?.kind, "prepare");
  assert.equal(prepare.placement, "primary");

  const transfer = orderInvoiceSteps({
    remaining: 0,
    fulfillmentIds: ["f1"],
    lines: [invoiceLine({ draftId: "d1", fulfillmentId: "f1" })],
  });
  assert.equal(transfer.action?.kind, "transfer");

  const partial = orderInvoiceSteps({ remaining: 10, fulfillmentIds: ["f1"], lines: [] });
  assert.equal(partial.placement, "secondary");
  assert.equal(partial.action?.kind, "prepare");

  const append = orderInvoiceSteps({
    remaining: 10,
    fulfillmentIds: ["f1", "f2"],
    lines: [invoiceLine({ draftId: "d1", fulfillmentId: "f1", quantity: 10 })],
  });
  assert.equal(append.action?.kind, "append");
  if (append.action?.kind === "append") assert.deepEqual([...append.action.fulfillmentIds], ["f2"]);

  const remote = orderInvoiceSteps({
    remaining: 0,
    fulfillmentIds: ["f1"],
    lines: [
      invoiceLine({
        draftId: "d1",
        fulfillmentId: "f1",
        transferStatus: "transferred",
        dnbStatus: "draft",
        accountingInvoiceId: "99",
      }),
    ],
  });
  assert.equal(remote.action?.kind, "open_dnb");
  if (remote.action?.kind === "open_dnb") assert.equal(remote.action.invoiceId, "99");

  const sent = orderInvoiceSteps({
    remaining: 0,
    fulfillmentIds: ["f1"],
    lines: [
      invoiceLine({
        draftId: "d1",
        fulfillmentId: "f1",
        status: "sent",
        transferStatus: "transferred",
        dnbStatus: "issued",
        invoiceNumber: "1001",
        dueOn: "2026-11-03",
        quantity: 20,
        unitPriceOre: 2500,
      }),
    ],
  });
  assert.equal(sent.action?.kind, "sent");
  if (sent.action?.kind === "sent") {
    assert.equal(sent.action.invoiceNumber, "1001");
    assert.equal(sent.action.amountOre, 50000);
    assert.equal(sent.action.dueOn, "2026-11-03");
  }

  const paid = orderInvoiceSteps({
    remaining: 0,
    fulfillmentIds: ["f1"],
    lines: [
      invoiceLine({
        draftId: "d1",
        fulfillmentId: "f1",
        transferStatus: "transferred",
        dnbStatus: "paid",
        invoiceNumber: "1001",
        paidOn: "2026-10-20",
      }),
    ],
  });
  assert.equal(paid.action?.kind, "paid");
  if (paid.action?.kind === "paid") assert.equal(paid.action.paidOn, "2026-10-20");

  const stillDelivering = orderInvoiceSteps({
    remaining: 5,
    fulfillmentIds: ["f1"],
    lines: [
      invoiceLine({
        draftId: "d1",
        fulfillmentId: "f1",
        transferStatus: "transferred",
        dnbStatus: "paid",
        paidOn: "2026-10-20",
      }),
    ],
  });
  assert.equal(stillDelivering.action, null);
  assert.equal(stillDelivering.earlier[0]?.kind, "paid");

  const deliveredWithoutAdvance = orderInvoiceSteps({
    remaining: 0,
    fulfillmentIds: ["f1", "f2"],
    lines: [],
  });
  assert.equal(deliveredWithoutAdvance.action?.kind, "prepare");
  assert.equal(
    goodsInvoicePrepareLabel({ remaining: 0, hasAdvanceClaim: false }),
    "orders_prepare_invoice",
  );
  assert.equal(
    goodsInvoicePrepareLabel({ remaining: 0, hasAdvanceClaim: true }),
    "orders_prepare_settlement",
  );
  assert.equal(
    goodsInvoicePrepareLabel({ remaining: 4, hasAdvanceClaim: false }),
    "orders_invoice_delivered",
  );

  const existingBasis = orderInvoiceSteps({
    remaining: 0,
    fulfillmentIds: ["f1"],
    lines: [invoiceLine({ draftId: "d1", fulfillmentId: "f1", transferStatus: "failed" })],
  });
  assert.equal(existingBasis.action?.kind, "transfer");
  if (existingBasis.action?.kind === "transfer") {
    assert.equal(existingBasis.action.transferStatus, "failed");
    assert.equal(dnbDocumentKey(null, existingBasis.action.transferStatus), "dnb_failed");
  }

  const inDnb = orderInvoiceSteps({
    remaining: 0,
    fulfillmentIds: ["f1"],
    lines: [
      invoiceLine({
        draftId: "d1",
        fulfillmentId: "f1",
        transferStatus: "transferred",
        dnbStatus: "draft",
        accountingInvoiceId: "99",
        invoiceNumber: "1008",
      }),
    ],
  });
  assert.equal(inDnb.action?.kind, "open_dnb");
  if (inDnb.action?.kind === "open_dnb") {
    assert.equal(
      dnbDocumentKey(inDnb.action.dnbStatus, inDnb.action.transferStatus),
      "dnb_waiting",
    );
    assert.equal(inDnb.action.invoiceNumber, "1008");
  }
});

test("the next-step sql requires who delivered and does not guess history", () => {
  const sql = readFileSync(new URL("../../sql/25_order_next.sql", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261020120000_order_next.sql", import.meta.url),
    "utf8",
  );
  assert.equal(
    sql.slice(sql.indexOf("ALTER TABLE")),
    migration.slice(migration.indexOf("ALTER TABLE")),
  );
  assert.match(
    sql,
    /DROP FUNCTION IF EXISTS public\.register_order_delivery\(UUID, DATE, UUID, JSONB\)/,
  );
  assert.match(sql, /p_delivered_by UUID/);
  assert.match(sql, /delivery driver is missing/);
  assert.match(sql, /NEW\.registered_by := auth\.uid\(\)/);
  assert.match(sql, /fulfillment exceeds ordered quantity/);
  assert.match(sql, /follow_up_on/);
  assert.match(sql, /WHEN p_dnb_status = 'paid' AND p_dnb_paid_on IS NOT NULL THEN p_dnb_paid_on/);
  assert.match(sql, /order_invoice_lines/);
  assert.doesNotMatch(sql, /UPDATE public\.deliveries/);
  assert.doesNotMatch(sql, /UPDATE public\.customers/);
  assert.doesNotMatch(sql, /UPDATE public\.customer_orders/);
  assert.doesNotMatch(sql, /\bdue_on\b/);
  assert.doesNotMatch(sql, /net\.http|unimicro|send.?mail/i);
  assert.equal(deliveryErrorKind("delivery driver is missing"), "driver");
  assert.equal(isOrderSchemaError("column follow_up_on does not exist"), true);
});

test("one order reviews 20 pieces at 25 kr and reuses the same basis", () => {
  const portions = [
    { quantity: 10, unitPriceOre: 2500 },
    { quantity: 10, unitPriceOre: 2500 },
  ];
  assert.deepEqual(orderGoodsReview(portions), { quantity: 20, amountOre: 50_000 });

  const fresh = invoiceReviewLines({
    fulfillmentIds: ["f1", "f2"],
    reuseDraftId: null,
    fulfillments: [
      { id: "f1", quantity: 10, unitPriceOre: 2500 },
      { id: "f2", quantity: 10, unitPriceOre: 2500 },
    ],
    invoiceLines: [],
  });
  assert.deepEqual(fresh, { quantity: 20, amountOre: 50_000 });

  const again = invoiceReviewLines({
    fulfillmentIds: ["f1", "f2"],
    reuseDraftId: "draft-1",
    fulfillments: [
      { id: "f1", quantity: 10, unitPriceOre: 2500 },
      { id: "f2", quantity: 10, unitPriceOre: 2500 },
    ],
    invoiceLines: [
      {
        draftId: "draft-1",
        fulfillmentId: "f1",
        quantity: 10,
        unitPriceOre: 2500,
        active: true,
      },
      {
        draftId: "draft-1",
        fulfillmentId: "f2",
        quantity: 10,
        unitPriceOre: 2500,
        active: true,
      },
      {
        draftId: "old",
        fulfillmentId: "legacy",
        quantity: 400,
        unitPriceOre: 2500,
        active: true,
      },
    ],
  });
  assert.deepEqual(again, { quantity: 20, amountOre: 50_000 });
  assert.equal(deliveryErrorKind("missing price snapshot"), "price");
  assert.equal(deliveryErrorKind("confirmed order price is missing"), "price");
});

test("fully delivered uninvoiced orders stay waiting and partial orders do not", () => {
  const rows = waitingInvoiceOrders([
    {
      orderId: "o2",
      orderNumber: "O-0002",
      customerName: "Villa Import",
      orderedQuantity: 20,
      fulfilledQuantity: 20,
      lines: [
        { productName: "Nduja", quantity: 10, unitPriceOre: 2500 },
        { productName: "Nduja", quantity: 10, unitPriceOre: 2500 },
      ],
    },
    {
      orderId: "o3",
      orderNumber: "O-0003",
      customerName: "Villa Grossista",
      orderedQuantity: 20,
      fulfilledQuantity: 10,
      lines: [{ productName: "Nduja", quantity: 10, unitPriceOre: 2500 }],
    },
    {
      orderId: "done",
      orderNumber: "O-0001",
      customerName: "Villa Import",
      orderedQuantity: 20,
      fulfilledQuantity: 20,
      lines: [],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.orderNumber, "O-0002");
  assert.equal(rows[0]?.customerName, "Villa Import");
  assert.equal(rows[0]?.quantity, 20);
  assert.equal(rows[0]?.amountOre, 50_000);
});

test("invoice review sql keeps the draft column and prices an order delivery from the order", () => {
  const sql = readFileSync(
    new URL("../../sql/28_order_invoice_review.sql", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261020200000_order_invoice_review.sql", import.meta.url),
    "utf8",
  );
  assert.equal(sql, migration);
  assert.match(sql, /#variable_conflict use_column/);
  assert.match(sql, /d\.transfer_status/);
  assert.match(sql, /gos\.order_delivery/);
  assert.match(sql, /confirmed order price is missing/);
  assert.match(sql, /missing price snapshot/);
  assert.match(sql, /unit_price_ore/);
  assert.doesNotMatch(sql, /UPDATE public\.deliveries/);
  assert.doesNotMatch(sql, /UPDATE public\.customers/);
  assert.doesNotMatch(sql, /INSERT INTO public\.invoice_draft_lines/);
  assert.doesNotMatch(sql, /vat_percent\s*=\s*0/);
  assert.doesNotMatch(sql, /net\.http|unimicro|send.?mail/i);

  const desk = readFileSync(
    new URL("../routes/_authenticated/admin.invoices.tsx", import.meta.url),
    "utf8",
  );
  assert.match(desk, /orders_invoice_waiting/);
  assert.match(desk, /orders_invoice_legacy/);
  assert.match(desk, /legacyChosen/);
  assert.doesNotMatch(desk, /groupSales/);
  assert.doesNotMatch(desk, /\[\.\.\.orderReady, \.\.\.ready\]/);

  const orderPage = readFileSync(
    new URL("../routes/_authenticated/admin.orders.$orderId.tsx", import.meta.url),
    "utf8",
  );
  assert.match(orderPage, /invoiceReviewLines/);
  assert.match(orderPage, /InvoiceReview/);
  assert.match(orderPage, /orders_invoice_fetch_failed"\)\} \$\{error\}/);
  assert.doesNotMatch(orderPage, /orders_invoice_sql28/);
  const review = readFileSync(
    new URL("../components/order-invoice-step.tsx", import.meta.url),
    "utf8",
  );
  assert.match(review, /orders_invoice_ex_vat/);
  assert.match(review, /orders_invoice_only_order/);
  assert.match(review, /orders_advance_agreed/);
});

test("the invoice line sql adds transfer_status and reads it without a name clash", () => {
  const sql = readFileSync(
    new URL("../../sql/29_invoice_lines_status.sql", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261020220000_invoice_lines_status.sql", import.meta.url),
    "utf8",
  );
  assert.equal(sql, migration);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS transfer_status/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.order_invoice_lines\(UUID\)/);
  assert.match(sql, /RETURN QUERY EXECUTE/);
  assert.doesNotMatch(sql, /UPDATE public\.deliveries/);
  assert.doesNotMatch(sql, /UPDATE public\.customers/);
  assert.doesNotMatch(sql, /UPDATE public\.invoice_drafts/);
});

test("the invoice due sql adds payment_due_on without rewriting drafts", () => {
  const sql = readFileSync(
    new URL("../../sql/30_invoice_payment_due.sql", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261020230000_invoice_payment_due.sql", import.meta.url),
    "utf8",
  );
  assert.equal(sql, migration);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS payment_due_on DATE/);
  assert.doesNotMatch(sql, /UPDATE public\.deliveries/);
  assert.doesNotMatch(sql, /UPDATE public\.customers/);
  assert.doesNotMatch(sql, /UPDATE public\.invoice_drafts/);
  assert.doesNotMatch(sql, /DROP FUNCTION/);
  assert.doesNotMatch(sql, /vat_percent/);
});
