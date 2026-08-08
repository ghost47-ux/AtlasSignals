/**
 * fakeDb.ts — in-memory fake Supabase client for route tests.
 *
 * Mirrors just enough of the supabase-js query builder shape for the routes
 * under test: signals (webhook ingestion), delivery_outbox, users (auth
 * lookup), payments (initialize), and `rpc` (access checks + Paystack
 * processors) with configurable handlers.
 */
import type { DbClient } from '../../src/db/supabase';

export interface FakeSignalRow {
  id: string;
  signal_id: string;
  idempotency_key: string;
  [key: string]: unknown;
}

export interface FakeUserRow {
  id: string;
  auth_id: string | null;
  email: string;
  role: string;
}

export interface FakePaymentRow {
  id: string;
  user_id: string;
  paystack_reference: string;
  amount: number | null;
  currency: string;
  status: string;
  [key: string]: unknown;
}

export interface FakeOutboxRow {
  id: string;
  signal_id: string;
  channel: string;
  status: string;
  attempts: number;
  [key: string]: unknown;
}

export interface FakeDbOptions {
  initialSignals?: FakeSignalRow[];
  initialUsers?: FakeUserRow[];
  initialOutbox?: FakeOutboxRow[];
  /** When true, the idempotency fast-path SELECT always misses (forces the unique-violation path). */
  selectMissesDuplicates?: boolean;
  /** Custom rpc handlers: name → (params) => { data, error? }. */
  rpcHandlers?: Record<
    string,
    (params: Record<string, unknown>) => { data: unknown; error?: unknown }
  >;
}

export function createFakeDb(options: FakeDbOptions = {}) {
  const signals: FakeSignalRow[] = [...(options.initialSignals ?? [])];
  const users: FakeUserRow[] = [...(options.initialUsers ?? [])];
  const payments: FakePaymentRow[] = [];
  const outboxRows: FakeOutboxRow[] = [...(options.initialOutbox ?? [])];
  const calls = {
    outboxInserts: 0,
    outboxUpdates: [] as Array<{ patch: Record<string, unknown>; col: string; val: unknown }>,
    rpcCalls: [] as Array<{ name: string; params: Record<string, unknown> }>,
    paymentInserts: 0,
    linkCodeInserts: 0,
  };
  const linkCodes: Array<Record<string, unknown>> = [];

  const handlers: Record<string, (params: Record<string, unknown>) => { data: unknown; error?: unknown }> = {
    ...(options.rpcHandlers ?? {}),
  };

  const db = {
    from(table: string) {
      if (table === 'signals') {
        const buildQuery = (selectMissesDuplicates: boolean) => {
          let filtered: FakeSignalRow[] = [...signals];
          const builder = {
            eq(col: string, val: unknown) {
              if (selectMissesDuplicates && col === 'idempotency_key') {
                filtered = []; // fast-path miss → forces the unique-violation path
              } else {
                filtered = filtered.filter((s) => s[col] === val);
              }
              return builder;
            },
            order(col: string, opts: { ascending?: boolean } = {}) {
              const asc = opts.ascending ?? true;
              filtered = [...filtered].sort((a, b) => {
                const av = a[col];
                const bv = b[col];
                if (av === bv) return 0;
                if (av == null) return 1;
                if (bv == null) return -1;
                const cmp = av < bv ? -1 : 1;
                return asc ? cmp : -cmp;
              });
              return builder;
            },
            limit(n: number) {
              filtered = filtered.slice(0, n);
              return builder;
            },
            range: async (from: number, to: number) => {
              filtered = filtered.slice(from, to + 1);
              return { data: filtered, error: null };
            },
            maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
            single: async () =>
              filtered.length === 1
                ? { data: filtered[0], error: null }
                : { data: null, error: { code: 'PGRST116', message: 'not found' } },
          };
          return builder;
        };
        return {
          select: () => buildQuery(!!options.selectMissesDuplicates),
          insert: (row: Record<string, unknown>) => {
            const duplicate = signals.some(
              (s) => s.idempotency_key === row.idempotency_key,
            );
            if (duplicate) {
              const dupError = { code: '23505', message: 'duplicate key value violates unique constraint', details: '', hint: '' };
              return {
                select: () => ({ single: async () => ({ data: null, error: dupError }) }),
              };
            }
            const stored: FakeSignalRow = {
              id: `row-${signals.length + 1}`,
              signal_id: String(row.signal_id),
              idempotency_key: String(row.idempotency_key),
              ...(row as object),
              inserted_at: new Date().toISOString(),
            };
            signals.push(stored);
            return {
              select: () => ({ single: async () => ({ data: stored, error: null }) }),
            };
          },
          update: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }
      if (table === 'users') {
        return {
          select: () => ({
            eq: (col: string, val: unknown) => ({
              maybeSingle: async () => {
                const found = users.find((u) => u[col as keyof FakeUserRow] === val) ?? null;
                return { data: found, error: null };
              },
            }),
          }),
          insert: async (row: Record<string, unknown>) => {
            const stored: FakeUserRow = {
              id: row.id as string ?? `user-${users.length + 1}`,
              auth_id: (row.auth_id as string | null) ?? null,
              email: String(row.email),
              role: String(row.role ?? 'free_trial'),
            };
            users.push(stored);
            return { data: stored, error: null };
          },
        };
      }
      if (table === 'payments') {
        return {
          insert: async (row: Record<string, unknown>) => {
            calls.paymentInserts += 1;
            const stored: FakePaymentRow = {
              id: `payment-${calls.paymentInserts}`,
              user_id: String(row.user_id),
              paystack_reference: String(row.paystack_reference),
              amount: (row.amount as number | null) ?? null,
              currency: String(row.currency),
              status: String(row.status),
              ...(row as object),
            };
            payments.push(stored);
            return { data: stored, error: null };
          },
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        };
      }
      if (table === 'telegram_link_codes') {
        return {
          insert: async (row: Record<string, unknown>) => {
            calls.linkCodeInserts += 1;
            const stored = { ...row, id: `link-${calls.linkCodeInserts}` };
            linkCodes.push(stored);
            return { data: stored, error: null };
          },
        };
      }
      if (table === 'delivery_outbox') {
        return {
          insert: async (row: Record<string, unknown>) => {
            calls.outboxInserts += 1;
            outboxRows.push({ ...row, id: `outbox-${calls.outboxInserts}` } as FakeOutboxRow);
            return { data: null, error: null };
          },
          select: () => {
            let filtered = [...outboxRows];
            const builder = {
              eq: (col: string, val: unknown) => {
                filtered = filtered.filter((r) => r[col] === val);
                return builder;
              },
              order: () => builder,
              limit: async (n: number) => {
                filtered = filtered.slice(0, n);
                return { data: filtered, error: null };
              },
            };
            return builder;
          },
          update: (patch: Record<string, unknown>) => ({
            eq: async (col: string, val: unknown) => {
              calls.outboxUpdates.push({ patch, col, val });
              const row = outboxRows.find((r) => r[col] === val);
              if (row) {
                Object.assign(row, patch);
                return { data: row, error: null };
              }
              return { data: null, error: null };
            },
          }),
        };
      }
      throw new Error(`fakeDb: unexpected table "${table}"`);
    },
    rpc: async (name: string, params: Record<string, unknown> = {}) => {
      calls.rpcCalls.push({ name, params });
      const handler = handlers[name];
      if (!handler) {
        return { data: null, error: null };
      }
      return handler(params);
    },
  };

  return {
    db: db as unknown as DbClient,
    signals,
    users,
    payments,
    outboxRows,
    linkCodes,
    calls,
  };
}
