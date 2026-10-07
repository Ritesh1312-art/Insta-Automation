import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType, session: vi.fn() }));
// Only the session cookie is mocked; requireAdmin re-reads the role from the database.
vi.mock('@/lib/auth', () => ({ requireSessionUser: state.session }));
vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import { GET, POST } from './route';

function post(body: unknown) {
  return POST(new Request('https://app.example.test/api/admin/upi-settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never);
}

function signIn(userId: string | null, role = 'ADMIN') {
  if (userId) state.session.mockResolvedValue({ userId, email: `${userId}@example.test`, role });
  else state.session.mockRejectedValue(new Error('UNAUTHORIZED'));
}

beforeEach(() => {
  state.db.reset();
  state.session.mockReset();
  vi.unstubAllEnvs();
  state.db.seed('user', { id: 'admin-1', email: 'admin@example.test', passwordHash: 'hash', role: 'ADMIN' });
  state.db.seed('user', { id: 'creator', email: 'creator@example.test', passwordHash: 'hash', role: 'USER' });
});

describe('admin UPI settings authorization', () => {
  it('returns 401 without a session and 403 for a non-admin', async () => {
    signIn(null);
    expect((await GET()).status).toBe(401);
    expect((await post({ adminUpiId: 'name@okaxis' })).status).toBe(401);

    signIn('creator', 'USER');
    expect((await GET()).status).toBe(403);
    expect((await post({ adminUpiId: 'name@okaxis' })).status).toBe(403);
  });
});

describe('admin UPI settings custom QR URL validation', () => {
  it('requires a valid UPI ID', async () => {
    signIn('admin-1');
    const response = await post({ adminUpiId: 'not-a-upi-id' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('UPI ID');
  });

  it('rejects an external QR host that is not allowlisted (CSP would block it in the browser)', async () => {
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', '');
    signIn('admin-1');
    const response = await post({ adminUpiId: 'name@okaxis', adminQrCodeUrl: 'https://evil.example.com/qr.png' });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('evil.example.com');
    expect(body.error).toContain('UPI_QR_ALLOWED_IMAGE_HOSTS');
    expect(state.db.rows('user').find((row) => row.id === 'admin-1')?.adminQrCodeUrl).toBeNull();
  });

  it('rejects a non-HTTPS QR URL even on an allowlisted host', async () => {
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', 'qr.example.com');
    signIn('admin-1');
    const response = await post({ adminUpiId: 'name@okaxis', adminQrCodeUrl: 'http://qr.example.com/qr.png' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('HTTPS');
  });

  it('saves an allowlisted HTTPS QR host', async () => {
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', 'qr.example.com');
    signIn('admin-1');
    const response = await post({ adminUpiId: 'name@okaxis', adminQrCodeUrl: 'https://qr.example.com/qr.png' });
    expect(response.status).toBe(200);
    expect(state.db.rows('user').find((row) => row.id === 'admin-1')?.adminQrCodeUrl).toBe('https://qr.example.com/qr.png');
  });

  it('saves a same-origin local QR path without any allowlist', async () => {
    signIn('admin-1');
    const response = await post({ adminUpiId: 'name@okaxis', adminQrCodeUrl: '/qr.png' });
    expect(response.status).toBe(200);
    expect(state.db.rows('user').find((row) => row.id === 'admin-1')?.adminQrCodeUrl).toBe('/qr.png');
  });

  it('GET never returns a stored QR URL that the CSP would block', async () => {
    // Simulate a value stored before save-time validation existed.
    state.db.reset();
    state.db.seed('user', {
      id: 'admin-legacy', email: 'legacy@example.test', passwordHash: 'hash', role: 'ADMIN',
      adminUpiId: 'name@okaxis', adminQrCodeUrl: 'https://evil.example.com/qr.png',
    });
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', '');
    signIn('admin-legacy');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.adminQrCodeUrl).toBe('');
    expect(body.autoQr).toBe(true);
  });

  it('GET returns an allowlisted stored QR URL', async () => {
    state.db.reset();
    state.db.seed('user', {
      id: 'admin-qr', email: 'qr@example.test', passwordHash: 'hash', role: 'ADMIN',
      adminUpiId: 'name@okaxis', adminQrCodeUrl: 'https://qr.example.com/qr.png',
    });
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', 'qr.example.com');
    signIn('admin-qr');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.adminQrCodeUrl).toBe('https://qr.example.com/qr.png');
    expect(body.autoQr).toBe(false);
  });
});
