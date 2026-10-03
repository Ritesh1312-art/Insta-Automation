import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType }));
vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});
// Real bcrypt (cost 12) is slow and irrelevant to the locking behaviour under test.
vi.mock('bcryptjs', () => ({ default: { hash: async (password: string) => `bcrypt:${password.length}` } }));

import { POST } from './route';

const PASSWORD = 'Str0ng!Pass';

function setup(body: Record<string, unknown>, address = '203.0.113.7') {
  return POST(new NextRequest('https://app.example.test/api/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
    body: JSON.stringify({ token: 'setup-token-0123', password: PASSWORD, ...body }),
  }));
}

const admins = () => state.db.rows('user').filter((user) => user.role === 'ADMIN');

beforeEach(() => {
  state.db.reset();
  vi.stubEnv('SETUP_TOKEN', 'setup-token-0123');
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/auth/setup', () => {
  it('re-checks and creates the first admin inside a transaction holding the cast setup lock', async () => {
    const response = await setup({ email: '  Owner@Example.TEST ' });
    expect(response.status).toBe(201);
    expect(admins()).toEqual([expect.objectContaining({ email: 'owner@example.test', passwordHash: 'bcrypt:11', role: 'ADMIN' })]);

    const setupLock = state.db.rawQueries.find((query) => query.values[0] === 'admin-setup')!;
    expect(setupLock.sql).toContain('pg_advisory_xact_lock(hashtextextended($?, 0))::text AS "lockResult"');
    const lockedOperations = state.db.operations.filter((entry) => entry.transactionId === setupLock.transactionId);
    expect(lockedOperations.map((entry) => `${entry.model}.${entry.operation}`)).toEqual(['user.count', 'user.create']);
    // The rate limiter's own lock is also cast and transaction-scoped.
    expect(state.db.rawQueries.every((query) => query.transactionId !== null && query.sql.includes('::text'))).toBe(true);
  });

  it('creates exactly one admin when setup requests race', async () => {
    const responses = await Promise.all(['a', 'b', 'c'].map((name, index) => setup({ email: `${name}@example.test` }, `198.51.100.${index}`)));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409]);
    expect(admins()).toHaveLength(1);
    const conflict = responses.find((response) => response.status === 409)!;
    await expect(conflict.json()).resolves.toEqual({ error: 'Setup is already complete' });
  });

  it('refuses once an admin exists, and rejects bad tokens and weak passwords', async () => {
    state.db.seed('user', { email: 'existing@example.test', passwordHash: 'x', role: 'ADMIN' });
    expect((await setup({ email: 'new@example.test' })).status).toBe(409);
    expect(state.db.rawQueries.some((query) => query.values[0] === 'admin-setup')).toBe(false);

    state.db.reset();
    expect((await setup({ email: 'new@example.test', token: 'wrong-token-0000' })).status).toBe(401);
    expect((await setup({ email: 'new@example.test', password: 'weak' })).status).toBe(400);
    expect(admins()).toHaveLength(0);
  });

  it('rate-limits repeated attempts from one client', async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await setup({ email: 'same@example.test', token: 'wrong-token-0000' })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });
});
