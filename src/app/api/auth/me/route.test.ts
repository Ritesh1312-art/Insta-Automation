/**
 * Regression tests for `GET /api/auth/me`.
 *
 * Production defect: the route validated the cookie signature only
 * (`getSessionUser()`), so a session that the database had already revoked —
 * including every token issued before a password reset bumped `sessionVersion`
 * — still received the account payload. The dashboard layout and the verify
 * page use `res.ok` from this endpoint to decide whether the visitor is signed
 * in, so the stale-session case has to be a 401.
 *
 * The route runs against the real session helper, the real quota reset path,
 * and an in-memory Prisma double; the session cookie is the only mocked input.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({
  db: null as unknown as FakePrismaType,
  cookies: vi.fn(),
}));

vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});
vi.mock('next/headers', () => ({ cookies: state.cookies }));

import { GET } from './route';
import { signToken } from '@/lib/auth';

const EMAIL = 'creator@example.test';

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

/** An otherwise valid session cookie that has already expired. */
async function expiredToken(userId: string, sessionVersion: number) {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
  return new SignJWT({ userId, email: EMAIL, role: 'USER', sessionVersion, purpose: 'session' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('instadm-auto')
    .setAudience('instadm-session')
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(secret);
}

function withSessionCookie(token: string | null) {
  state.cookies.mockResolvedValue({ get: () => (token ? { value: token } : undefined) });
}

function seedUser(overrides: Record<string, unknown> = {}) {
  return state.db.seed('user', {
    id: 'user-1',
    email: EMAIL,
    name: 'Creator',
    passwordHash: 'hash',
    role: 'USER',
    plan: 'PREMIUM',
    monthlyDmQuota: 750,
    dmsUsedThisMonth: 12,
    sessionVersion: 4,
    quotaResetAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  });
}

beforeEach(() => {
  state.db.reset();
  state.cookies.mockReset();
  withSessionCookie(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a session cookie', async () => {
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ user: null });
  });

  it('returns 401 for an expired session cookie', async () => {
    seedUser();
    withSessionCookie(await expiredToken('user-1', 4));

    const response = await GET();
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ user: null });
  });

  it('returns 401 for a token signed with the wrong secret or audience', async () => {
    seedUser();
    withSessionCookie('not-a-jwt');
    expect((await GET()).status).toBe(401);

    // A Meta OAuth state token is signed by this app but is not a session.
    const { createOAuthState } = await import('@/lib/auth');
    withSessionCookie(await createOAuthState('user-1'));
    expect((await GET()).status).toBe(401);
  });

  it('returns the current account for a valid, unrevoked session', async () => {
    seedUser({ email: 'current@example.test' });
    // The cookie still carries the email and role it was issued with.
    withSessionCookie(await signToken({ userId: 'user-1', email: 'old@example.test', role: 'USER', sessionVersion: 4 }));

    const response = await GET();
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.user).toMatchObject({
      id: 'user-1',
      email: 'current@example.test',
      name: 'Creator',
      role: 'USER',
      plan: 'PREMIUM',
      monthlyDmQuota: 750,
      dmsUsedThisMonth: 12,
    });
    expect(typeof body.user.planName).toBe('string');
    expect(typeof body.user.quotaLabel).toBe('string');
    // The endpoint aggregates account data only; no session material is echoed.
    expect(JSON.stringify(body)).not.toContain('sessionVersion');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a session the database has revoked through sessionVersion', async () => {
    seedUser({ sessionVersion: 5 });
    withSessionCookie(await signToken({ userId: 'user-1', email: EMAIL, role: 'USER', sessionVersion: 4 }));

    const response = await GET();
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ user: null });
  });

  it('rejects a session whose account no longer exists', async () => {
    withSessionCookie(await signToken({ userId: 'deleted-user', email: EMAIL, role: 'USER', sessionVersion: 0 }));

    const response = await GET();
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ user: null });
  });

  it('answers a database failure with a generic 500 instead of account data', async () => {
    seedUser();
    withSessionCookie(await signToken({ userId: 'user-1', email: EMAIL, role: 'USER', sessionVersion: 4 }));
    // First lookup belongs to requireSessionUser(); the second is the profile read.
    let userLookups = 0;
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'user' && entry.operation === 'findUnique') {
        userLookups += 1;
        if (userLookups === 2) throw new Error('database unavailable: postgresql://user:pw@db/internal');
      }
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET();
    const payload = await json(response);

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Unable to load account' });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('user:pw');
  });
});
