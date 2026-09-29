import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = { $queryRaw: vi.fn(), auditLog: { count: vi.fn(), create: vi.fn() } };
  return { tx, prisma: { $transaction: vi.fn() } };
});
vi.mock('./prisma', () => ({ prisma: mocks.prisma }));
import { consumeRateLimit, requestFingerprint } from './rate-limit';

describe('database rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
    mocks.tx.$queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
  });

  it('creates stable, non-plaintext request fingerprints', () => {
    const request = new Request('https://app.example.com', {
      headers: { 'x-forwarded-for': '203.0.113.4, 10.0.0.1', 'user-agent': 'test-browser' },
    });
    const first = requestFingerprint(request, 'User@Example.com');
    const second = requestFingerprint(request, 'user@example.com');
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('203.0.113.4');
  });

  it('records requests below the limit and rejects exhausted windows', async () => {
    mocks.tx.auditLog.count.mockResolvedValueOnce(2);
    mocks.tx.auditLog.create.mockResolvedValue({});
    await expect(consumeRateLimit({ action: 'LOGIN', fingerprint: 'hash', limit: 3, windowMs: 60_000 })).resolves.toBe(true);
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({ data: { action: 'LOGIN', ipAddress: 'hash' } });

    mocks.tx.auditLog.count.mockResolvedValueOnce(3);
    await expect(consumeRateLimit({ action: 'LOGIN', fingerprint: 'hash', limit: 3, windowMs: 60_000 })).resolves.toBe(false);
    expect(mocks.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
