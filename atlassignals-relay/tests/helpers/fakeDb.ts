/**
 * fakeDb.ts — in-memory fake Supabase client for route tests.
 *
 * Mirrors just enough of the supabase-js query builder shape for the webhook
 * route: eq/maybeSingle lookups, insert → select → single, and the outbox.
 */
import type { DbClient } from '../../src/db/supabase';

export interface FakeSignalRow {
  id: string;
  signal_id: string;
  idempotency_key: string;
  [key: string]: unknown;
}

export interface FakeDbOptions {
  initialSignals?: FakeSignalRow[];
  /** When true, the idempotency fast-path SELECT always misses (forces the unique-violation path). */
  selectMissesDuplicates?: boolean;
}

export function createFakeDb(options: FakeDbOptions = {}) {
  const signals: FakeSignalRow[] = [...(options.initialSignals ?? [])];
  const outboxRows: Array<Record<string, unknown>> = [];
  const calls = { outboxInserts: 0 };

  const db = {
    from(table: string) {
      if (table === 'signals') {
        return {
          select: () => ({
            eq: (col: string, val: unknown) => ({
              maybeSingle: async () => {
                if (options.selectMissesDuplicates && col === 'idempotency_key') {
                  return { data: null, error: null };
                }
                const found = signals.find((s) => s[col] === val) ?? null;
                return { data: found, error: null };
              },
            }),
            order: () => ({
              limit: async () => ({ data: signals.slice(0, 1), error: null }),
            }),
            limit: async () => ({ data: signals.slice(0, 1), error: null }),
          }),
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
      if (table === 'delivery_outbox') {
        return {
          insert: async (row: Record<string, unknown>) => {
            calls.outboxInserts += 1;
            outboxRows.push({ ...row, id: `outbox-${calls.outboxInserts}` });
            return { data: null, error: null };
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }
      throw new Error(`fakeDb: unexpected table "${table}"`);
    },
  };

  return {
    db: db as unknown as DbClient,
    signals,
    outboxRows,
    calls,
  };
}
