import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decodeJwt } from 'jose';
import { DUMMY_PASSWORD_HASH } from '@/lib/password-auth';

const mocks = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() } },
  compare: vi.fn(),
  consumeRateLimit: vi.fn(),
  identityFingerprint: vi.fn(() => 'hashed-admin-account'),
  requestFingerprint: vi.fn(() => 'hashed-client'),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare } }));
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  identityFingerprint: mocks.identityFingerprint,
  requestFingerprint: mocks.requestFingerprint,
}));

import { POST } from './route';

const passwordHash = '$2a$12$mYopVWdnErWefVlobSvFAOwY0N7yXMEF9GZE0fmM53Y7nPJwc2aGa';
const adminAccount = {
  id: 'configured-admin-id',
  email: 'admin@example.test',
  role: 'ADMIN',
  passwordHash,
  sessionVersion: 4,
};

function post(body: unknown) {
  return new NextRequest('https://app.example.test/api/auth/admin-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ADMIN_LOGIN_IDENTIFIER', '  ADMIN@EXAMPLE.TEST  ');
  vi.stubEnv('NODE_ENV', 'production');
  mocks.consumeRateLimit.mockResolvedValue(true);
  mocks.prisma.user.findUnique.mockResolvedValue(adminAccount);
  mocks.compare.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dedicated administrator login API', () => {
  it('authenticates the configured ADMIN using only a password and issues a short session cookie', async () => {
    const response = await POST(post({ password: 'CorrectHorseBattery#1' }));

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toEqual({ success: true });
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'admin@example.test' } });
    expect(mocks.compare).toHaveBeenCalledWith('CorrectHorseBattery#1', passwordHash);

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
    const token = cookie.match(/auth_token=([^;]+)/)?.[1];
    expect(token).toBeTruthy();
    const claims = decodeJwt(token!);
    expect(claims.role).toBe('ADMIN');
    expect(claims.sessionVersion).toBe(4);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(8 * 60 * 60);
  });

  it('fails closed when the configured account exists but has the USER role', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ ...adminAccount, role: 'USER' });

    const response = await POST(post({ password: 'CorrectHorseBattery#1' }));

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toEqual({ error: 'Invalid credentials' });
    expect(mocks.compare).toHaveBeenCalledWith('CorrectHorseBattery#1', DUMMY_PASSWORD_HASH);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns generic credentials and performs bcrypt work when the configured account is absent', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);

    const response = await POST(post({ password: 'CorrectHorseBattery#1' }));

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toEqual({ error: 'Invalid credentials' });
    expect(mocks.compare).toHaveBeenCalledWith('CorrectHorseBattery#1', DUMMY_PASSWORD_HASH);
  });

  it('fails closed with generic credentials when ADMIN_LOGIN_IDENTIFIER is missing', async () => {
    vi.stubEnv('ADMIN_LOGIN_IDENTIFIER', '');

    const response = await POST(post({ password: 'CorrectHorseBattery#1' }));

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toEqual({ error: 'Invalid credentials' });
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.compare).toHaveBeenCalledWith('CorrectHorseBattery#1', DUMMY_PASSWORD_HASH);
  });

  it('returns the same generic response for a wrong administrator password', async () => {
    mocks.compare.mockResolvedValue(false);

    const response = await POST(post({ password: 'WrongPassword#1' }));

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toEqual({ error: 'Invalid credentials' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('uses strict database-backed limits for both the client and configured account', async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const response = await POST(post({ password: 'CorrectHorseBattery#1' }));

    expect(response.status).toBe(429);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(1, {
      action: 'RATE_LIMIT_ADMIN_LOGIN_CLIENT',
      fingerprint: 'hashed-client',
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(2, {
      action: 'RATE_LIMIT_ADMIN_LOGIN_ACCOUNT',
      fingerprint: 'hashed-admin-account',
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it('logs authentication failures without emitting exception details', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.consumeRateLimit.mockRejectedValue(new Error('password=hidden DATABASE_URL=postgres://secret'));

    const response = await POST(post({ password: 'do-not-log-this' }));

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith('[auth:admin_login] request failed', {
      category: 'internal_error',
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('hidden');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('postgres://secret');
  });
});
