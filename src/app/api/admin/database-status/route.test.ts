import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));

vi.mock('@/lib/require-admin', () => ({
  requireAdmin: mocks.requireAdmin,
  isAuthError: (error: unknown, code: string) => error instanceof Error && error.message === code,
}));

import { GET } from './route';

const privateDatabaseUrl = 'postgresql://db-user:db-password@ep-projectsecret-pooler.us-east-2.aws.neon.tech:6543/private_customer_db?project=project-secret&api_key=query-secret#fragment-secret';
const sensitiveValues = [
  privateDatabaseUrl,
  'ep-projectsecret-pooler.us-east-2.aws.neon.tech',
  'ep-projectsecret',
  'db-user',
  'db-password',
  'private_customer_db',
  '6543',
  'project=project-secret',
  'api_key=query-secret',
  'fragment-secret',
];
const logSpies: ReturnType<typeof vi.spyOn>[] = [];

function captureConsole() {
  for (const method of ['debug', 'info', 'log', 'warn', 'error'] as const) {
    logSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
}

function expectNoSensitiveData(responseBody: unknown) {
  const serialized = JSON.stringify({
    response: responseBody,
    logs: logSpies.flatMap((spy) => spy.mock.calls),
  });
  for (const value of sensitiveValues) {
    expect(serialized).not.toContain(value);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ userId: 'admin-id' });
});

afterEach(() => {
  for (const spy of logSpies.splice(0)) spy.mockRestore();
  vi.unstubAllEnvs();
});

describe('GET /api/admin/database-status', () => {
  it('returns only inferred status categories and never exposes or logs URL details', async () => {
    captureConsole();
    vi.stubEnv('DATABASE_URL', privateDatabaseUrl);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({
      provider: 'Neon',
      connectionMode: 'pooled',
      confidence: 'high',
    });
    expect(Object.keys(body)).toEqual(['provider', 'connectionMode', 'confidence']);
    expectNoSensitiveData(body);
    expect(logSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it('classifies a standard Supabase direct endpoint without exposing its project reference', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@db.project-ref-987.supabase.co:5432/app_db?sslmode=require');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: 'Supabase',
      connectionMode: 'direct',
      confidence: 'high',
    });
  });

  it('returns a low-confidence unknown mode when the provider URL does not identify pooling', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@db.prisma.io:5432/app_db?sslmode=require');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: 'Prisma Postgres',
      connectionMode: 'unknown',
      confidence: 'low',
    });
  });

  it('returns 401 to unauthenticated requests and does not cache the response', async () => {
    mocks.requireAdmin.mockRejectedValue(new Error('UNAUTHORIZED'));
    vi.stubEnv('DATABASE_URL', privateDatabaseUrl);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns 403 to authenticated non-admin users and does not cache the response', async () => {
    mocks.requireAdmin.mockRejectedValue(new Error('FORBIDDEN'));
    vi.stubEnv('DATABASE_URL', privateDatabaseUrl);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Admin only' });
  });

  it('returns a generic server error without logging exception details', async () => {
    captureConsole();
    mocks.requireAdmin.mockRejectedValue(new Error(`Authentication database failed: ${privateDatabaseUrl}`));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({ error: 'Unable to load database status' });
    expectNoSensitiveData(body);
    expect(logSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it('fails closed to Other and unknown for an absent or malformed URL', async () => {
    vi.stubEnv('DATABASE_URL', 'not-a-database-url');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: 'Other',
      connectionMode: 'unknown',
      confidence: 'low',
    });
  });
});
