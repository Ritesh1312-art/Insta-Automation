/**
 * Unit tests for the Meta data-deletion record.
 *
 * The important claim in `meta-data-deletion.ts` is that the deletion scope is
 * "whatever the schema says hangs off the connection", so this file checks that
 * claim against `prisma/schema.prisma` itself: every model related to
 * MetaConnection with `onDelete: Cascade` must be covered, and the additive
 * migration must create exactly the columns the schema model declares. If
 * someone adds another cascading table, these tests fail instead of silently
 * leaving Meta-linked rows behind.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType, ModelName } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType }));

vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import { getDataDeletionStatus, processMetaDataDeletion } from './meta-data-deletion';

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
const MIGRATION = readFileSync(
  join(process.cwd(), 'prisma/migrations/20261007000000_meta_webhook_and_data_deletion/migration.sql'),
  'utf8',
);
const META_USER = 'meta-user-cascade';

/** Split the schema into `model Name { ... }` blocks. */
function modelBlocks() {
  return new Map(
    [...SCHEMA.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)].map((match) => [match[1], match[2]]),
  );
}

/** Child models the database removes with a MetaConnection row, and their FK field. */
function schemaCascadesFrom(modelName: string) {
  const blocks = modelBlocks();
  const cascades = new Map<string, string>();
  for (const [name, body] of blocks) {
    if (name === modelName) continue;
    for (const line of body.split('\n')) {
      if (!/onDelete:\s*Cascade/.test(line)) continue;
      const type = line.trim().split(/\s+/)[1]?.replace('?', '');
      if (type !== modelName) continue;
      const fields = line.match(/fields:\s*\[([^\]]+)\]/)?.[1].trim();
      if (fields) cascades.set(name, fields);
    }
  }
  return cascades;
}

/** One row per cascading table, with the FK pointing at the seeded connection. */
const CASCADE_SEEDS: Record<string, { model: ModelName; field: string; data: Record<string, unknown> }> = {
  Media: { model: 'media', field: 'instagramAccountId', data: { instagramMediaId: 'media-1', mediaType: 'REEL', timestamp: new Date() } },
  Automation: { model: 'automation', field: 'instagramAccountId', data: { userId: 'owner-1', name: 'flow', dmMessageTemplate: 'x' } },
  Contact: { model: 'contact', field: 'instagramAccountId', data: { igsid: 'igsid-1' } },
  AutomationContactState: { model: 'automationContactState', field: 'instagramAccountId', data: { automationId: 'automation-1', igsid: 'igsid-1' } },
  WebhookEvent: { model: 'webhookEvent', field: 'instagramAccountId', data: { eventType: 'comments', rawPayload: {} } },
};

beforeEach(() => {
  state.db.reset();
});

describe('Meta deletion scope declared by the schema', () => {
  it('covers every model the schema deletes with a MetaConnection', () => {
    const cascades = schemaCascadesFrom('MetaConnection');

    expect([...cascades.keys()].sort()).toEqual(Object.keys(CASCADE_SEEDS).sort());
    for (const [model, field] of cascades) {
      expect(field, `${model} must cascade on the Instagram account id`).toBe(CASCADE_SEEDS[model].field);
    }
  });

  it('removes a row from each cascading table (and nested automation runs)', async () => {
    state.db.seed('user', { id: 'owner-1', email: 'owner@example.test', passwordHash: 'hash' });
    state.db.seed('metaConnection', { userId: 'owner-1', metaUserId: META_USER, instagramAccountId: 'ig-1', instagramUsername: 'creator' });
    const automation = state.db.seed('automation', { userId: 'owner-1', instagramAccountId: 'ig-1', name: 'flow', dmMessageTemplate: 'x' });
    const event = state.db.seed('webhookEvent', { instagramAccountId: 'ig-1', eventType: 'comments', rawPayload: {} });
    state.db.seed('automationRun', { automationId: automation.id, webhookEventId: event.id, idempotencyKey: 'key-1' });
    for (const seed of Object.values(CASCADE_SEEDS)) {
      state.db.seed(seed.model, { ...seed.data, ...(seed.field === 'instagramAccountId' ? { instagramAccountId: 'ig-1' } : {}) });
    }

    await processMetaDataDeletion(META_USER);

    for (const seed of Object.values(CASCADE_SEEDS)) {
      expect(state.db.rows(seed.model), `${seed.model} rows must be gone`).toEqual([]);
    }
    expect(state.db.rows('automationRun')).toEqual([]);
    // The workspace account itself is app data, not Meta data.
    expect(state.db.rows('user')).toHaveLength(1);
  });

  it('audits the additive migration against the schema model', () => {
    const metaConnection = modelBlocks().get('MetaConnection')!;
    expect(metaConnection).toMatch(/webhookStatus\s+String\s+@default\("UNKNOWN"\)/);
    expect(MIGRATION).toContain('ALTER TABLE "MetaConnection" ADD COLUMN IF NOT EXISTS "webhookStatus" TEXT NOT NULL DEFAULT \'UNKNOWN\'');

    const model = modelBlocks().get('MetaDataDeletionRequest')!;
    const fields = [...model.matchAll(/^\s{2}(\w+)\s+(\S+)/gm)].map((match) => ({ name: match[1], type: match[2] }));
    expect(fields.length).toBeGreaterThan(10);
    for (const field of fields) {
      expect(MIGRATION, `migration must create "${field.name}"`).toContain(`"${field.name}"`);
    }
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "MetaDataDeletionRequest_confirmationCode_key"');
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "MetaDataDeletionRequest_metaUserId_key"');
  });
});

describe('Meta data-deletion records', () => {
  it('keeps the same confirmation code and never double-counts on a retry', async () => {
    state.db.seed('metaConnection', { userId: 'owner-1', metaUserId: META_USER, instagramAccountId: 'ig-1', instagramUsername: 'creator' });
    state.db.seed('media', { instagramAccountId: 'ig-1', instagramMediaId: 'media-1', mediaType: 'REEL', timestamp: new Date() });

    const first = await processMetaDataDeletion(META_USER);
    const second = await processMetaDataDeletion(META_USER);

    expect(first).toMatchObject({ status: 'COMPLETED', deleted: { connections: 1, media: 1 } });
    expect(second.confirmationCode).toBe(first.confirmationCode);
    expect(second).toMatchObject({ status: 'COMPLETED', deleted: { connections: 1, media: 1 } });
    expect(state.db.rows('metaDataDeletionRequest')).toHaveLength(1);
  });

  it('records a failure without storing secret-bearing error text, then recovers', async () => {
    state.db.seed('metaConnection', { userId: 'owner-1', metaUserId: META_USER, instagramAccountId: 'ig-1', instagramUsername: 'creator' });
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'metaConnection' && entry.operation === 'deleteMany') {
        throw new Error('delete failed for EAAG-secret-token-0123456789abcdef and postgresql://admin:hunter2@db/prod');
      }
    };

    await expect(processMetaDataDeletion(META_USER)).rejects.toThrow();

    const failed = state.db.row('metaDataDeletionRequest', { metaUserId: META_USER })!;
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(String(failed.errorDetails)).not.toContain('EAAG-secret-token-0123456789abcdef');
    expect(String(failed.errorDetails)).not.toContain('hunter2');
    // The data is untouched, so the record is telling the truth.
    expect(state.db.rows('metaConnection')).toHaveLength(1);

    state.db.beforeOperation = null;
    const recovered = await processMetaDataDeletion(META_USER);
    expect(recovered).toMatchObject({ status: 'COMPLETED', deleted: { connections: 1 } });
    expect(state.db.row('metaDataDeletionRequest', { metaUserId: META_USER })).toMatchObject({
      status: 'COMPLETED', errorDetails: null,
    });
  });

  it('looks up only codes that could actually be stored', async () => {
    state.db.seed('metaDataDeletionRequest', {
      metaUserId: META_USER, confirmationCode: 'known-code', status: 'COMPLETED',
    });

    expect(await getDataDeletionStatus('')).toBeNull();
    expect(await getDataDeletionStatus('   ')).toBeNull();
    expect(await getDataDeletionStatus('x'.repeat(201))).toBeNull();
    expect(await getDataDeletionStatus('unknown-code')).toBeNull();
    expect(await getDataDeletionStatus(' known-code ')).toMatchObject({ confirmationCode: 'known-code', status: 'COMPLETED' });
    // The public view never includes the Meta user id.
    expect(JSON.stringify(await getDataDeletionStatus('known-code'))).not.toContain(META_USER);
  });
});
