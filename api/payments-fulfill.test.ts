import { describe, it, expect, beforeEach, vi } from "vitest";
import * as schema from "@db/schema";

/* B7 — drive the shared payment fulfillment (api/lib/payments/fulfill.ts)
 * without MySQL: only ../queries/connection is mocked, with an in-memory
 * table store that evaluates the drizzle WHERE conditions the fulfillment
 * path emits. Everything else (fulfill itself, renewMembership,
 * upgradeMembership, activateMembership, createInvoiceFromPayment, the ticket
 * registration transaction) runs for real against the store. */

type Row = Record<string, unknown>;

/* The fake lives in vi.hoisted so it exists before the mocked module factory
 * runs. Table identity is the drizzle table object, so assertions in the test
 * body key off schema.* directly. */
const h = vi.hoisted(() => {
  const tables = new Map<unknown, Map<number, Row>>();
  let nextId = 1;
  let failUpdatesFor: unknown = null;
  const updates: { table: unknown; values: Row }[] = [];
  const inserts: { table: unknown; values: Row }[] = [];

  function rowsOf(table: unknown): Map<number, Row> {
    let t = tables.get(table);
    if (!t) {
      t = new Map();
      tables.set(table, t);
    }
    return t;
  }

  /* ---- minimal evaluator for the drizzle conditions this path emits ---- */
  type Tok = { col?: string; lit?: unknown; raw?: string };

  function flatten(node: unknown, out: Tok[]): void {
    if (node == null) return;
    const qc = (node as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(qc)) {
      for (const c of qc) flatten(c, out);
      return;
    }
    const val = (node as { value?: unknown[] }).value;
    if (Array.isArray(val)) {
      const raw = val.join("");
      if (raw) out.push({ raw });
      return;
    }
    // Bound parameters arrive as Param { value } objects (drizzle wraps values
    // interpolated next to real columns); unwrap them to the literal value.
    if (val !== undefined && "encoder" in (node as object)) {
      out.push({ lit: val });
      return;
    }
    const name = (node as { name?: unknown }).name;
    if (typeof name === "string") {
      out.push({ col: name });
      return;
    }
    out.push({ lit: node });
  }

  /** Strip paren pairs that wrap the ENTIRE token list (and() wraps its whole
   *  condition tree in one outer pair). */
  function stripOuter(tokens: Tok[]): Tok[] {
    let t = tokens;
    for (;;) {
      if (t.length < 2 || t[0].raw !== "(" || t[t.length - 1].raw !== ")")
        return t;
      let depth = 0;
      let wrapsAll = true;
      for (let i = 0; i < t.length; i++) {
        if (t[i].raw === "(") depth++;
        if (t[i].raw === ")") depth--;
        if (depth === 0 && i < t.length - 1) {
          wrapsAll = false;
          break;
        }
      }
      if (!wrapsAll) return t;
      t = t.slice(1, -1);
    }
  }

  function topLevelIndexOf(tokens: Tok[], keyword: string): number {
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.raw === "(") depth++;
      else if (t.raw === ")") depth--;
      else if (depth === 0 && t.raw?.trim() === keyword) return i;
    }
    return -1;
  }

  function compare(a: unknown, b: unknown): number {
    if (a instanceof Date || b instanceof Date) {
      return (
        new Date(a as string | Date).getTime() -
        new Date(b as string | Date).getTime()
      );
    }
    if (typeof a === "number" && typeof b === "number") return a - b;
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  function evalLeaf(tokens: Tok[], row: Row): boolean {
    const t = stripOuter(tokens);
    if (!t.length) return true;
    const col = t.find(x => x.col !== undefined)?.col;
    if (col === undefined) return true;
    const raw = t.find(x => x.raw !== undefined && x.raw.trim() !== "")?.raw
      ?.trim();
    const lit = t.find(x => x.lit !== undefined)?.lit;
    const value = row[col];
    const op = raw ?? "=";
    if (op === "is null") return value == null;
    if (op === "is not null") return value != null;
    if (op.startsWith("in")) {
      const m = op.match(/in\s*\(([^)]*)\)/i);
      const list = m
        ? [...m[1].matchAll(/'([^']*)'/g)].map(x => String(x[1]))
        : [];
      return list.includes(String(value));
    }
    switch (op) {
      case "=":
        return compare(value, lit) === 0;
      case "!=":
      case "<>":
        return compare(value, lit) !== 0;
      case ">":
        return compare(value, lit) > 0;
      case ">=":
        return compare(value, lit) >= 0;
      case "<":
        return compare(value, lit) < 0;
      case "<=":
        return compare(value, lit) <= 0;
      default:
        return true; // unknown fragment — stay permissive
    }
  }

  function evalTokens(tokens: Tok[], row: Row): boolean {
    const t = stripOuter(tokens);
    const orIdx = topLevelIndexOf(t, "or");
    if (orIdx >= 0) {
      return (
        evalTokens(t.slice(0, orIdx), row) || evalTokens(t.slice(orIdx + 1), row)
      );
    }
    const andIdx = topLevelIndexOf(t, "and");
    if (andIdx >= 0) {
      return (
        evalTokens(t.slice(0, andIdx), row) &&
        evalTokens(t.slice(andIdx + 1), row)
      );
    }
    return evalLeaf(t, row);
  }

  function evalCond(cond: unknown, row: Row): boolean {
    if (cond == null) return true;
    const out: Tok[] = [];
    flatten(cond, out);
    return evalTokens(out, row);
  }

  /* ---- the fake connection ---- */
  type Chain = PromiseLike<Row[]> & Record<string, unknown>;

  function selectChain(table: unknown, projection: unknown): Chain {
    let rows = [...rowsOf(table).values()];
    const chain: Record<string, unknown> = {};
    const hasChunks = (v: unknown): boolean =>
      v != null && typeof v === "object" && "queryChunks" in (v as object);
    // count(*) projections resolve to a single { n } row; other aggregate
    // projections (score sums) resolve empty so reductions see no rows; plain
    // column lists and full-row selects resolve to the (filtered) rows.
    const resolveRows = (): Row[] => {
      if (projection == null || typeof projection !== "object") return rows;
      const entries = Object.entries(projection as Record<string, unknown>);
      if (entries.length === 1 && entries[0][0] === "n" && hasChunks(entries[0][1]))
        return [{ n: rows.length }];
      if (entries.some(([, v]) => hasChunks(v))) return [];
      return rows;
    };
    chain.where = (cond: unknown) => {
      rows = rows.filter(r => evalCond(cond, r));
      return chain;
    };
    chain.orderBy = () => chain;
    chain.groupBy = () => chain;
    chain.innerJoin = () => chain;
    chain.leftJoin = () => chain;
    chain.limit = (n: number) => {
      rows = rows.slice(0, n);
      return chain;
    };
    chain.offset = () => chain;
    chain.for = () => chain;
    return Object.assign(chain, {
      then: (onF: (v: Row[]) => unknown, onR: (e: unknown) => unknown) =>
        Promise.resolve(resolveRows()).then(onF, onR),
    }) as Chain;
  }

  const fakeDb = {
    select: (...args: unknown[]) => ({
      from: (table: unknown) => selectChain(table, args[0]),
    }),
    insert: (table: unknown) => ({
      values: (values: Row) => {
        const row = { ...values, id: (values.id as number) ?? nextId++ };
        rowsOf(table).set(row.id, row);
        inserts.push({ table, values });
        const res = [{ insertId: row.id }, []];
        const p = Promise.resolve(res) as Promise<unknown> & {
          onDuplicateKeyUpdate: () => Promise<unknown>;
        };
        /* Model INSERT ... ON DUPLICATE KEY UPDATE for invoice_counters
         * (the only upsert on this path): undo the optimistic insert, then
         * bump the pre-existing counter row for the prefix/date. */
        p.onDuplicateKeyUpdate = () => {
          if ("prefix" in values && "date" in values) {
            rowsOf(table).delete(row.id);
            const existing = [...rowsOf(table).values()].find(
              r => r.prefix === values.prefix && r.date === values.date
            );
            if (existing) existing.sequence = Number(existing.sequence) + 1;
            else rowsOf(table).set(row.id, { ...row });
          }
          return Promise.resolve(res);
        };
        return p;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: async (cond: unknown) => {
          updates.push({ table, values });
          if (failUpdatesFor === table) {
            throw new Error("injected update failure");
          }
          let affected = 0;
          for (const [, row] of rowsOf(table)) {
            if (evalCond(cond, row)) {
              Object.assign(row, values);
              affected++;
            }
          }
          return [{ affectedRows: affected }, []];
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        let affected = 0;
        for (const [id, row] of rowsOf(table)) {
          if (evalCond(cond, row)) {
            rowsOf(table).delete(id);
            affected++;
          }
        }
        return [{ affectedRows: affected }, []];
      },
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snap = new Map<unknown, Map<number, Row>>();
      for (const [k, v] of tables) {
        snap.set(k, new Map(JSON.parse(JSON.stringify([...v])) as [number, Row][]));
      }
      try {
        return await fn(fakeDb);
      } catch (err) {
        tables.clear();
        for (const [k, v] of snap) tables.set(k, v);
        throw err;
      }
    },
    execute: async () => [{}],
  };

  return {
    fakeDb,
    updates(table: unknown): { table: unknown; values: Row }[] {
      return updates.filter(u => u.table === table);
    },
    inserts(table: unknown): { table: unknown; values: Row }[] {
      return inserts.filter(i => i.table === table);
    },
    seed(table: unknown, values: Row): Row {
      const row = { ...values, id: (values.id as number) ?? nextId++ };
      rowsOf(table).set(row.id, row);
      return row;
    },
    rows(table: unknown): Row[] {
      return [...rowsOf(table).values()];
    },
    setFailUpdatesFor(table: unknown | null): void {
      failUpdatesFor = table;
    },
    reset(): void {
      tables.clear();
      nextId = 1;
      failUpdatesFor = null;
      updates.length = 0;
      inserts.length = 0;
    },
  };
});

vi.mock("./queries/connection", () => ({ getDb: () => h.fakeDb }));

import { fulfillPayment } from "./lib/payments/fulfill";

const USER_ID = 101;

function seedPendingRecord(overrides: Row = {}): Row {
  return h.seed(schema.paymentRecords, {
    userId: USER_ID,
    provider: "stripe",
    providerRef: "cs_test_123",
    purpose: "membership",
    tier: "ascent",
    amount: 75000,
    currency: "aed",
    status: "pending",
    paidAt: null,
    eventId: null,
    note: null,
    idempotencyKey: null,
    refundedAmount: 0,
    ...overrides,
  });
}

function seedMember(overrides: Row = {}): Row {
  return h.seed(schema.members, {
    userId: USER_ID,
    tier: "ascent",
    status: "active",
    lifecycleState: "active",
    homeChapterId: null,
    renewalAt: new Date("2027-03-15T08:00:00.000Z"),
    ...overrides,
  });
}

function seedPayer(): void {
  h.seed(schema.users, { id: USER_ID, name: "Test Member", email: "member@example.com" });
}

beforeEach(() => h.reset());

describe("fulfillPayment (B7 shared fulfillment)", () => {
  it("renewal: extends renewalAt by one year, issues a paid invoice, sends analytics", async () => {
    seedPayer();
    seedMember();
    const record = seedPendingRecord({ purpose: "renewal", tier: "ascent" });

    const result = await fulfillPayment(record as never);

    expect(result.duplicate).toBe(false);
    expect(result.invoiceNumber).toMatch(/^INV-\d{8}-\d{4}$/);
    // renewalAt extended by exactly one year from the existing future date.
    const renewalUpdate = h
      .updates(schema.members)
      .filter(u => "renewalAt" in u.values)
      .map(u => u.values.renewalAt as unknown);
    expect(renewalUpdate).toHaveLength(1);
    expect(new Date(renewalUpdate[0] as string).toISOString()).toBe(
      "2028-03-15T08:00:00.000Z"
    );
    // The payment record is paid with a settlement timestamp.
    const paid = h.rows(schema.paymentRecords).find(r => r.id === record.id);
    expect(paid?.status).toBe("paid");
    expect(paid?.paidAt).toBeInstanceOf(Date);
    // Exactly one paid invoice for the record.
    const invoices = h
      .inserts(schema.invoices)
      .filter(i => i.values.paymentRecordId === record.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].values.status).toBe("paid");
    expect(invoices[0].values.amount).toBe(75000);
    // Lifecycle event + success analytics recorded.
    expect(
      h.inserts(schema.membershipEvents).some(e => e.values.type === "renew")
    ).toBe(true);
    expect(
      h.inserts(schema.analyticsEvents).some(
        e => e.values.event === "payment_succeeded"
      )
    ).toBe(true);
  });

  it("is idempotent: a second call for the same record grants nothing", async () => {
    seedPayer();
    seedMember();
    const record = seedPendingRecord({ purpose: "renewal" });

    const first = await fulfillPayment(record as never);
    const invoiceCount = h.inserts(schema.invoices).length;
    const renewalUpdates = h
      .updates(schema.members)
      .filter(u => "renewalAt" in u.values).length;

    const second = await fulfillPayment(record as never);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.invoiceNumber).toBeNull();
    expect(h.inserts(schema.invoices)).toHaveLength(invoiceCount);
    expect(
      h.updates(schema.members).filter(u => "renewalAt" in u.values)
    ).toHaveLength(renewalUpdates);
  });

  it("upgrade: applies the higher tier and starts a fresh year on it", async () => {
    seedPayer();
    seedMember({ tier: "ascent" });
    const record = seedPendingRecord({
      purpose: "upgrade",
      tier: "vanguard",
      amount: 42000,
    });

    await fulfillPayment(record as never);

    const tierUpdates = h
      .updates(schema.members)
      .filter(u => "tier" in u.values);
    expect(tierUpdates).toHaveLength(1);
    expect(tierUpdates[0].values.tier).toBe("vanguard");
    const newRenewal = new Date(tierUpdates[0].values.renewalAt as string);
    const expected = new Date();
    expected.setFullYear(expected.getFullYear() + 1);
    expect(newRenewal.getUTCFullYear()).toBe(expected.getUTCFullYear());
    expect(newRenewal.getUTCMonth()).toBe(expected.getUTCMonth());
    expect(newRenewal.getUTCDate()).toBe(expected.getUTCDate());
    expect(
      h.inserts(schema.membershipEvents).some(e => e.values.type === "upgrade")
    ).toBe(true);
    const invoice = h
      .inserts(schema.invoices)
      .find(i => i.values.paymentRecordId === record.id);
    expect(invoice?.values.amount).toBe(42000);
  });

  it("membership (join): activates a new member for one year", async () => {
    seedPayer();
    const record = seedPendingRecord({ purpose: "membership", tier: "horizon" });

    await fulfillPayment(record as never);

    const members = h.inserts(schema.members);
    expect(members).toHaveLength(1);
    expect(members[0].values.tier).toBe("horizon");
    expect(members[0].values.status).toBe("active");
    expect(members[0].values.lifecycleState).toBe("onboarding");
    const renewal = new Date(members[0].values.renewalAt as string);
    expect(renewal.getTime()).toBeGreaterThan(Date.now() + 360 * 24 * 3600 * 1000);
    expect(
      h.inserts(schema.membershipEvents).some(e => e.values.type === "approved")
    ).toBe(true);
  });

  it("activation purpose: invoices without touching membership lifecycle", async () => {
    seedPayer();
    seedMember();
    const record = seedPendingRecord({
      purpose: "activation",
      tier: null,
      amount: 49900,
    });

    await fulfillPayment(record as never);

    // No tier on the record → no renewal/upgrade/activation side effects.
    expect(h.updates(schema.members)).toHaveLength(0);
    expect(h.inserts(schema.members)).toHaveLength(0);
    // …but the invoice is still issued.
    expect(
      h.inserts(schema.invoices).some(i => i.values.paymentRecordId === record.id)
    ).toBe(true);
  });

  it("event_ticket: registers the seat once payment settles", async () => {
    seedPayer();
    const member = h.seed(schema.members, {
      id: 7,
      userId: USER_ID,
      tier: "ascent",
      status: "active",
      lifecycleState: "active",
    });
    const event = h.seed(schema.events, {
      id: 9,
      capacity: 50,
      deletedAt: null,
      startsAt: new Date(Date.now() + 86400_000),
    });
    const record = seedPendingRecord({
      purpose: "event_ticket",
      eventId: 9,
      amount: 15000,
    });

    await fulfillPayment(record as never);

    const regs = h
      .inserts(schema.eventRegs)
      .filter(i => i.values.eventId === event.id);
    expect(regs).toHaveLength(1);
    expect(regs[0].values.memberId).toBe(member.id);
    expect(regs[0].values.paymentRecordId).toBe(record.id);
    expect(String(regs[0].values.checkinCode)).toMatch(/.+/);
    expect(
      h.inserts(schema.notifications).some(n =>
        String(n.values.text).includes("ticket is confirmed")
      )
    ).toBe(true);
  });

  it("event_ticket: a sold-out event does not register the seat and notifies the payer", async () => {
    seedPayer();
    h.seed(schema.members, {
      id: 7,
      userId: USER_ID,
      tier: "ascent",
      status: "active",
      lifecycleState: "active",
    });
    const event = h.seed(schema.events, {
      id: 9,
      capacity: 1,
      deletedAt: null,
    });
    // Another member already holds the only seat.
    h.seed(schema.eventRegs, {
      eventId: 9,
      memberId: 8,
      status: "registered",
      checkinCode: "OTHER01",
      paymentRecordId: null,
    });
    const record = seedPendingRecord({
      purpose: "event_ticket",
      eventId: 9,
      amount: 15000,
    });

    await fulfillPayment(record as never);

    // No seat was written for our member…
    const regsForMember = h
      .inserts(schema.eventRegs)
      .filter(i => i.values.eventId === event.id && i.values.memberId === 7);
    expect(regsForMember).toHaveLength(0);
    // …and the payer is told the event sold out (auto-refund is attempted; in
    // this test environment the gateway is unconfigured, so refundPayment
    // throws and is logged — the notification still goes out, as in production
    // code order).
    expect(
      h.inserts(schema.notifications).some(n =>
        String(n.values.text).includes("sold out")
      )
    ).toBe(true);
  });

  it("fulfillment failure: the record ends failed, not paid-with-nothing-delivered", async () => {
    seedPayer();
    seedMember();
    const record = seedPendingRecord({ purpose: "renewal" });
    // Inject a failure in the entitlement-delivery phase (membership write).
    h.setFailUpdatesFor(schema.members);

    await expect(fulfillPayment(record as never)).rejects.toThrow(
      "injected update failure"
    );

    const row = h.rows(schema.paymentRecords).find(r => r.id === record.id);
    expect(row?.status).toBe("failed");
    // The invoice from the CAS transaction was already committed before the
    // delivery failure — finance can see what was settled.
    expect(
      h.inserts(schema.invoices).some(i => i.values.paymentRecordId === record.id)
    ).toBe(true);
  });
});
