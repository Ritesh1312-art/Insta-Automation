/**
 * Regression tests for `POST /api/auth/reset` (the SETUP_TOKEN password reset).
 *
 * Production defect: this route rewrote `passwordHash` without touching
 * `sessionVersion`, so every session token issued for the old password kept
 * working. The rest of the app treats `sessionVersion` as the central session
 * authority (`requireSessionUser()` compares it against the database), and the
 * OTP recovery flow in `/api/auth/forgot` already increments it — this route
 * now does the same, which these tests pin down.
 *
 * The route is exercised against a real in-memory Prisma double, real bcrypt,
 * the real rate limiter, and the real session helper, so the assertions are
 * about behaviour (an old token stops working) rather than about internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
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

import { POST } from './route';
import { requireSessionUser, signToken } from '@/lib/auth';

const SETUP_TOKEN = 'setup-token-for-tests';
const OLD_PASSWORD = 'OldPassword#123';
const NEW_PASSWORD = 'NewPassword#456';
const EMAIL = 'creator@example.test';

function resetRequest(body: unknown) {
  return new NextRequest('https://app.example.test/api/auth/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedUser(overrides: Record<string, unknown> = {}) {
  return state.db.seed('user', {
    id: 'user-1',
    email: EMAIL,
    passwordHash: '$2b$12$placeholder',
    sessionVersion: 2,
    role: 'USER',
    ...overrides,
  });
}

/** Makes the current session cookie whatever `token` is (or no cookie at all). */
function withSessionCookie(token: string | null) {
  state.cookies.mockResolvedValue({ get: () => (token ? { value: token } : undefined) });
}

beforeEach(() => {
  state.db.reset();
  state.cookies.mockReset();
  vi.stubEnv('SETUP_TOKEN', SETUP_TOKEN);
  withSessionCookie(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('password reset API', () => {
  it('rotates the password hash and revokes sessions issued before the reset', async () => {
    seedUser({ passwordHash: await bcrypt.hash(OLD_PASSWORD, 4) });
    const previousSession = await signToken({ userId: 'user-1', email: EMAIL, role: 'USER', sessionVersion: 2 });

    withSessionCookie(previousSession);
    await expect(requireSessionUser()).resolves.toMatchObject({ userId: 'user-1' });

    const response = await POST(resetRequest({ email: '  CREATOR@Example.test ', password: NEW_PASSWORD, token: SETUP_TOKEN }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });

    const stored = state.db.row('user', { id: 'user-1' })!;
    expect(stored.sessionVersion).toBe(3);
    expect(await bcrypt.compare(NEW_PASSWORD, stored.passwordHash as string)).toBe(true);
    expect(await bcrypt.compare(OLD_PASSWORD, stored.passwordHash as string)).toBe(false);

    // The token that was valid a moment ago must no longer identify the user.
    withSessionCookie(previousSession);
    await expect(requireSessionUser()).rejects.toMatchObject({ message: 'UNAUTHORIZED' });

    // A session issued after the reset (as /api/auth/login does) works again.
    const freshSession = await signToken({ userId: 'user-1', email: EMAIL, role: 'USER', sessionVersion: 3 });
    withSessionCookie(freshSession);
    await expect(requireSessionUser()).resolves.toMatchObject({ userId: 'user-1', sessionVersion: 3 });
  });

  it('rejects a wrong or missing setup token without touching the account', async () => {
    seedUser({ passwordHash: await bcrypt.hash(OLD_PASSWORD, 4) });

    const wrong = await POST(resetRequest({ email: EMAIL, password: NEW_PASSWORD, token: 'not-the-setup-token' }));
    const missing = await POST(resetRequest({ email: EMAIL, password: NEW_PASSWORD }));

    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: 'Invalid setup token' });
    const stored = state.db.row('user', { id: 'user-1' })!;
    expect(stored.sessionVersion).toBe(2);
    expect(await bcrypt.compare(OLD_PASSWORD, stored.passwordHash as string)).toBe(true);
  });

  it('rejects a password that breaks the shared policy and keeps the old session alive', async () => {
    seedUser({ passwordHash: await bcrypt.hash(OLD_PASSWORD, 4) });

    const response = await POST(resetRequest({ email: EMAIL, password: 'password', token: SETUP_TOKEN }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('10–20 characters') });
    expect(state.db.row('user', { id: 'user-1' })!.sessionVersion).toBe(2);
  });

  it('does not reveal whether an unknown email exists beyond the documented 404', async () => {
    const response = await POST(resetRequest({ email: 'nobody@example.test', password: NEW_PASSWORD, token: SETUP_TOKEN }));
    expect(response.status).toBe(404);
    expect(state.db.rows('user')).toEqual([]);
  });

  it('stops after the per-fingerprint reset limit', async () => {
    seedUser({ passwordHash: await bcrypt.hash(OLD_PASSWORD, 4) });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await POST(resetRequest({ email: EMAIL, password: NEW_PASSWORD, token: SETUP_TOKEN }))).status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    // Five successful resets, and the sixth never reached the account update.
    expect(state.db.row('user', { id: 'user-1' })!.sessionVersion).toBe(7);
  });

  it('never writes the submitted password or the setup token into logs or the response', async () => {
    seedUser();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The failure message deliberately embeds every secret the route handles.
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'user' && entry.operation === 'update') {
        throw new Error(`update failed for ${NEW_PASSWORD} with token ${SETUP_TOKEN}`);
      }
    };

    const response = await POST(resetRequest({ email: EMAIL, password: NEW_PASSWORD, token: SETUP_TOKEN }));
    const payload = await response.json();
    const logged = JSON.stringify(errorSpy.mock.calls);

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Unable to reset password' });
    for (const secret of [NEW_PASSWORD, SETUP_TOKEN, 'passwordHash']) {
      expect(JSON.stringify(payload)).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain('password_reset');
  });
});
