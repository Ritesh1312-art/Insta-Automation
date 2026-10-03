import type { Prisma, PrismaClient } from '@/generated/prisma/client';

/**
 * PostgreSQL transaction-scoped advisory locks for Prisma.
 *
 * The lock function returns the PostgreSQL `void` type, which Prisma's
 * Rust-free client and driver adapters cannot deserialize. An uncast lock
 * query therefore fails at runtime with P2010 ("Failed to deserialize column
 * of type 'void'") and aborts whatever the caller was doing. The query below
 * casts the result to `text`, a supported type, while keeping the exact lock
 * semantics.
 *
 * This module is the ONLY place allowed to issue the lock query.
 * `src/lib/advisory-lock-usage.test.ts` scans the repository and fails if an
 * uncast or out-of-helper advisory-lock query is introduced anywhere else.
 */

export type TransactionClient = Prisma.TransactionClient;

type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

/**
 * Defaults for transactions that serialize on an advisory lock. Prisma's
 * stock `maxWait` (2s) is too tight for serverless cold starts where several
 * requests queue for the same small connection pool.
 */
export const ADVISORY_LOCK_TRANSACTION_OPTIONS: Readonly<Required<Pick<TransactionOptions, 'maxWait' | 'timeout'>>> = {
  maxWait: 10_000,
  timeout: 15_000,
};

export class AdvisoryLockUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdvisoryLockUsageError';
  }
}

/**
 * Blocks until the transaction holds the advisory lock for `lockKey`.
 *
 * The lock is released automatically when the surrounding transaction commits
 * or rolls back, so it must be taken with an interactive transaction client
 * (`tx`). The root client runs every statement in its own implicit
 * transaction, which would release the lock immediately and provide no mutual
 * exclusion, so it is rejected.
 */
export async function acquireTransactionAdvisoryLock(
  tx: Pick<TransactionClient, '$queryRaw'>,
  lockKey: string,
): Promise<void> {
  if (typeof lockKey !== 'string' || lockKey.trim() === '') {
    throw new AdvisoryLockUsageError('Advisory lock key must be a non-empty string');
  }
  if (typeof (tx as { $transaction?: unknown }).$transaction === 'function') {
    throw new AdvisoryLockUsageError(
      'Transaction advisory locks must be acquired with an interactive transaction client, not the root Prisma client',
    );
  }
  // The key is a bound parameter (never interpolated into SQL text);
  // hashtextextended maps it to the bigint lock id.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lockResult"`;
}

/**
 * Runs `work` inside one interactive transaction that first acquires the
 * advisory lock for `lockKey`. Everything `work` does with `tx` is serialized
 * against other callers using the same key until the transaction ends.
 */
export async function withTransactionAdvisoryLock<T>(
  client: Pick<PrismaClient, '$transaction'>,
  lockKey: string,
  work: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await acquireTransactionAdvisoryLock(tx, lockKey);
      return work(tx);
    },
    { ...ADVISORY_LOCK_TRANSACTION_OPTIONS, ...options },
  );
}

/** Lock keys are namespaced so unrelated features never contend. */
export const advisoryLockKeys = {
  quota: (userId: string) => `quota:${userId}`,
  automationLimit: (userId: string) => `automation-limit:${userId}`,
  analyticsReset: (userId: string) => `analytics-reset:${userId}`,
  adminSetup: () => 'admin-setup',
  // Unchanged legacy format so instances on the previous release still contend on the same key.
  rateLimit: (action: string, fingerprint: string) => `${action}:${fingerprint}`,
} as const;
