import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decodeJwt } from 'jose';
import { DUMMY_PASSWORD_HASH } from '@/lib/password-auth';

const mocks = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() } },
  compare: vi.fn(),
  consumeRateLimit: vi.fn(),
  requestFingerprint: vi.fn(() => 'hashed-client-and-identifier'),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare } }));
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  requestFingerprint: mocks.requestFingerprint,
}));

import { POST } from './route';

const passwordHash = '$2a$12$mYopVWdnErWefVlobSvFAOwY0N7yXMEF9GZE0fmM53Y7nPJwc2aGa';
const regularUser = {
  id: 'regular-user-id',
  email: 'ritesh.gupta131290',
  role: 'USER',
  passwordHash,
  sessionVersion: 6,
  name: 'Ritesh',
};

function post(body: unknown) {
  return new NextRequest('https://app.example.test/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function cookieFor(response: Response) {
  return response.headers.get('set-cookie') ?? '';
}

function jwtFor(response: Response) {
  const token = cookieFor(response).match(/auth_token=([^;]+)/)?.[1];
  expect(token).toBeTruthy();
  return decodeJwt(token!);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  mocks.consumeRateLimit.mockResolvedValue(true);
  mocks.prisma.user.findUnique.mockResolvedValue(regularUser);
  mocks.compare.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('regular user login API', () => {
  it('accepts a normalized username-style identifier stored in the existing User lookup field', async () => {
    const response = await POST(post({
      identifier: '  Ritesh.Gupta131290  ',
      password: 'CorrectHorseBattery#1',
      rememberMe: false,
    }));

    expect(response.status).toBe(200);
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'ritesh.gupta131290' } });
    expect(mocks.compare).toHaveBeenCalledWith('CorrectHorseBattery#1', passwordHash);
    expect(await json(response)).toMatchObject({ success: true, user: { id: 'regular-user-id' } });
  });

  it('creates a session cookie without Max-Age or Expires when Remember Me is unchecked', async () => {
    const response = await POST(post({
      identifier: 'ritesh.gupta131290',
      password: 'CorrectHorseBattery#1',
      rememberMe: false,
    }));

    expect(response.status).toBe(200);
    const cookie = cookieFor(response);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
    const claims = jwtFor(response);
    expect(claims.role).toBe('USER');
    expect(claims.sessionVersion).toBe(6);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(12 * 60 * 60);
  });

  it('creates a 30-day persistent cookie with a matching 30-day JWT lifetime when Remember Me is checked', async () => {
    const response = await POST(post({
      identifier: 'ritesh.gupta131290',
      password: 'CorrectHorseBattery#1',
      rememberMe: true,
    }));

    expect(response.status).toBe(200);
    expect(cookieFor(response)).toMatch(/Max-Age=2592000/i);
    const claims = jwtFor(response);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(30 * 24 * 60 * 60);
  });

  it('does not interpret string values as a Remember Me boolean', async () => {
    const response = await POST(post({
      identifier: 'ritesh.gupta131290',
      password: 'CorrectHorseBattery#1',
      rememberMe: 'true',
    }));

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toEqual({ error: 'Invalid credentials' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not authenticate an ADMIN through the regular user login', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ ...regularUser, role: 'ADMIN' });

    const response = await POST(post({ identifier: 'admin.username', password: 'CorrectHorseBattery#1' }));

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toEqual({ error: 'Invalid credentials' });
    expect(mocks.compare).toHaveBeenCalledWith('CorrectHorseBattery#1', DUMMY_PASSWORD_HASH);
  });

  it('uses the same generic response for an unknown identifier and a wrong password', async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(regularUser);
    mocks.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const unknownIdentifier = await POST(post({ identifier: 'unknown.user123', password: 'wrong', rememberMe: false }));
    const wrongPassword = await POST(post({ identifier: 'ritesh.gupta131290', password: 'wrong', rememberMe: false }));

    expect(unknownIdentifier.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    await expect(json(unknownIdentifier)).resolves.toEqual({ error: 'Invalid credentials' });
    await expect(json(wrongPassword)).resolves.toEqual({ error: 'Invalid credentials' });
    expect(mocks.compare).toHaveBeenNthCalledWith(1, 'wrong', DUMMY_PASSWORD_HASH);
    expect(mocks.compare).toHaveBeenNthCalledWith(2, 'wrong', passwordHash);
  });
});
