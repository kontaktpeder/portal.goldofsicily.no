import assert from "node:assert/strict";
import test from "node:test";
import { approveAdminAction } from "./admin-actions.server.ts";

type Step = {
  table: string;
  terminal: "maybeSingle" | "single" | "then";
  data?: unknown;
  error?: { message: string } | null;
  assert?: (query: Query) => void;
};

class Query {
  action = "select";
  payload: unknown;
  filters: Array<{ op: string; args: unknown[] }> = [];

  constructor(
    private readonly admin: MockAdmin,
    readonly table: string,
  ) {}

  select(_columns?: string) {
    return this;
  }

  order(...args: unknown[]) {
    this.filters.push({ op: "order", args });
    return this;
  }

  limit(...args: unknown[]) {
    this.filters.push({ op: "limit", args });
    return this;
  }

  eq(...args: unknown[]) {
    this.filters.push({ op: "eq", args });
    return this;
  }

  in(...args: unknown[]) {
    this.filters.push({ op: "in", args });
    return this;
  }

  is(...args: unknown[]) {
    this.filters.push({ op: "is", args });
    return this;
  }

  gt(...args: unknown[]) {
    this.filters.push({ op: "gt", args });
    return this;
  }

  lte(...args: unknown[]) {
    this.filters.push({ op: "lte", args });
    return this;
  }

  or(...args: unknown[]) {
    this.filters.push({ op: "or", args });
    return this;
  }

  update(payload: unknown) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  insert(payload: unknown) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  maybeSingle() {
    return this.admin.consume(this, "maybeSingle");
  }

  single() {
    return this.admin.consume(this, "single");
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.admin.consume(this, "then")).then(onfulfilled, onrejected);
  }
}

class MockAdmin {
  readonly queries: Query[] = [];

  constructor(private readonly steps: Step[]) {}

  from(table: string) {
    return new Query(this, table);
  }

  consume(query: Query, terminal: Step["terminal"]) {
    this.queries.push(query);
    const step = this.steps.shift();
    assert.ok(step, `unexpected ${terminal} query on ${query.table}`);
    assert.equal(query.table, step.table);
    assert.equal(terminal, step.terminal);
    step.assert?.(query);
    return { data: step.data ?? null, error: step.error ?? null };
  }

  assertDone() {
    assert.deepEqual(this.steps, []);
  }
}

test("approveAdminAction does not execute a proposal already being approved", async () => {
  const proposal = {
    id: "11111111-1111-4111-8111-111111111111",
    action_type: "list_accounting_discrepancies",
    payload: {},
    status: "approved",
  };
  const admin = new MockAdmin([
    { table: "admin_action_proposals", terminal: "maybeSingle", data: proposal },
    { table: "admin_action_proposals", terminal: "maybeSingle", data: null },
    { table: "admin_action_proposals", terminal: "maybeSingle", data: proposal },
  ]);

  await assert.rejects(
    () => approveAdminAction(admin as never, proposal.id, null),
    /already being approved/,
  );
  assert.equal(
    admin.queries.some((query) => query.table === "admin_action_events"),
    false,
  );
  admin.assertDone();
});

test("approveAdminAction stops before inserting a delivery when draft commit claim is lost", async () => {
  const proposalId = "11111111-1111-4111-8111-111111111111";
  const draftId = "22222222-2222-4222-8222-222222222222";
  const customerId = "33333333-3333-4333-8333-333333333333";
  const productId = "44444444-4444-4444-8444-444444444444";
  const lotId = "55555555-5555-4555-8555-555555555555";
  const proposal = {
    id: proposalId,
    action_type: "approve_delivery",
    payload: { draftId },
    status: "validated",
  };
  const draft = {
    id: draftId,
    status: "ready",
    customer_id: customerId,
    delivered_on: "2026-11-24",
    delivery_draft_lines: [
      {
        product_id: productId,
        quantity: 10,
        gold_lot_id: lotId,
        source_handover_id: null,
      },
    ],
  };
  const admin = new MockAdmin([
    { table: "admin_action_proposals", terminal: "maybeSingle", data: proposal },
    { table: "delivery_drafts", terminal: "maybeSingle", data: draft },
    {
      table: "customers",
      terminal: "maybeSingle",
      data: { id: customerId, active: true, supplied_by_customer_id: customerId },
    },
    {
      table: "gold_lots",
      terminal: "maybeSingle",
      data: {
        id: lotId,
        product_id: productId,
        produced_qty: 20,
        approved_qty: null,
        status: "produced",
        lot_code: "A",
        delivery_lines: [],
        gold_lot_handovers: [],
      },
    },
    { table: "admin_action_proposals", terminal: "maybeSingle", data: proposal },
    { table: "admin_action_events", terminal: "then" },
    { table: "delivery_drafts", terminal: "maybeSingle", data: draft },
    {
      table: "delivery_drafts",
      terminal: "maybeSingle",
      data: null,
      assert: (query) => {
        assert.equal(query.action, "update");
        assert.deepEqual(query.payload, { status: "committed" });
      },
    },
    {
      table: "delivery_drafts",
      terminal: "maybeSingle",
      data: { status: "committed", committed_delivery_id: null },
    },
    { table: "admin_action_proposals", terminal: "then" },
    { table: "admin_action_events", terminal: "then" },
  ]);

  await assert.rejects(
    () => approveAdminAction(admin as never, proposalId, null),
    /draft is already being committed/,
  );
  assert.equal(
    admin.queries.some((query) => query.table === "deliveries"),
    false,
  );
  admin.assertDone();
});
