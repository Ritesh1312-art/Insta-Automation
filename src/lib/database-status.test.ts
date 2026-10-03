import { describe, expect, it } from 'vitest';
import { inferDatabaseStatus } from './database-status';

describe('database URL status inference', () => {
  it.each([
    [
      'postgresql://user:pass@ep-example-pooler.us-east-2.aws.neon.tech/db',
      { provider: 'Neon', connectionMode: 'pooled', confidence: 'high' },
    ],
    [
      'postgresql://user:pass@ep-example.us-east-2.aws.neon.tech/db',
      { provider: 'Neon', connectionMode: 'direct', confidence: 'high' },
    ],
    [
      'postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com/db',
      { provider: 'Supabase', connectionMode: 'pooled', confidence: 'high' },
    ],
    [
      'postgresql://user:pass@roundhouse.proxy.rlwy.net:14000/db',
      { provider: 'Railway', connectionMode: 'direct', confidence: 'high' },
    ],
    [
      'postgresql://user:pass@dpg-example.oregon-postgres.render.com/db',
      { provider: 'Render', connectionMode: 'direct', confidence: 'high' },
    ],
    [
      'postgresql://user:pass@custom.example.test/db?pgbouncer=true',
      { provider: 'Other', connectionMode: 'pooled', confidence: 'low' },
    ],
  ])('classifies the URL without returning its private details', (databaseUrl, expected) => {
    expect(inferDatabaseStatus(databaseUrl)).toEqual(expected);
  });

  it('uses explicit URL mode hints but treats conflicting hints as unknown', () => {
    expect(inferDatabaseStatus('postgresql://user:pass@db.prisma.io/app?connection_mode=pooled')).toEqual({
      provider: 'Prisma Postgres',
      connectionMode: 'pooled',
      confidence: 'high',
    });
    expect(inferDatabaseStatus('postgresql://user:pass@db-direct.neon.tech/app?pgbouncer=true')).toEqual({
      provider: 'Neon',
      connectionMode: 'unknown',
      confidence: 'low',
    });
  });

  it('returns a low-confidence unknown status for invalid or unsupported URLs', () => {
    const unknown = { provider: 'Other', connectionMode: 'unknown', confidence: 'low' };
    expect(inferDatabaseStatus(undefined)).toEqual(unknown);
    expect(inferDatabaseStatus('not a URL')).toEqual(unknown);
    expect(inferDatabaseStatus('mysql://user:pass@db.neon.tech/app')).toEqual(unknown);
  });
});
