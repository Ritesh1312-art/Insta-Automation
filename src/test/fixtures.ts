import type { FakePrisma, ModelName } from './fake-prisma';

const DAY = 86_400_000;

/**
 * A workspace shaped like the production account in the incident: one ACTIVE
 * flow, a paused flow, 84 comments received, DM quota usage, a connected
 * Instagram account with an encrypted token, media, a resource, webhook
 * events, execution logs, contacts, a payment, and a second unrelated user.
 */
export function seedProductionLikeWorkspace(db: FakePrisma) {
  const lastTrigger = new Date(Date.now() - DAY);
  db.seed('user', {
    id: 'admin', email: 'admin@example.test', passwordHash: 'admin-password-hash', role: 'ADMIN',
  });
  const creator = db.seed('user', {
    id: 'creator', email: 'creator@example.test', name: 'Creator', passwordHash: 'creator-password-hash',
    role: 'USER', plan: 'STANDARD', monthlyDmQuota: 250, dmsUsedThisMonth: 37, subscriptionStatus: 'ACTIVE',
    planActivatedAt: new Date(Date.now() - 5 * DAY), quotaResetAt: new Date(Date.now() + 25 * DAY),
    totalCommentsReceived: 84, telegramBotTokenEncrypted: 'telegram-token-ciphertext', sessionVersion: 3,
  });
  db.seed('metaConnection', {
    id: 'connection', userId: 'creator', metaUserId: 'meta-user', instagramAccountId: 'ig-creator',
    instagramUsername: 'creator', accessTokenEncrypted: 'access-token-ciphertext', scopes: ['instagram_business_basic'],
  });
  db.seed('media', {
    id: 'media', instagramAccountId: 'ig-creator', instagramMediaId: 'ig-media-1', mediaType: 'REEL', timestamp: new Date(),
  });
  db.seed('resource', { id: 'resource', userId: 'creator', name: 'Guide', type: 'URL', url: 'https://example.test/guide' });
  const activeFlow = db.seed('automation', {
    id: 'flow-active', userId: 'creator', instagramAccountId: 'ig-creator', mediaId: 'media', resourceId: 'resource',
    name: 'Guide flow', status: 'ACTIVE', keywords: ['guide'], dmMessageTemplate: 'Here is {resource_url}',
    totalTriggers: 20, totalSuccess: 17, totalFailed: 3, lastTriggeredAt: lastTrigger,
  });
  const pausedFlow = db.seed('automation', {
    id: 'flow-paused', userId: 'creator', instagramAccountId: 'ig-creator', name: 'Old flow', status: 'PAUSED',
    keywords: ['old'], dmMessageTemplate: 'Old', totalTriggers: 5, totalSuccess: 5, totalFailed: 0,
    lastTriggeredAt: new Date(Date.now() - 9 * DAY),
  });
  const event = db.seed('webhookEvent', {
    id: 'event', instagramAccountId: 'ig-creator', eventId: 'comment:1', eventType: 'comments', commentId: 'comment-1',
    commenterId: 'fan', commenterUsername: 'fan', commentText: 'guide please, my phone is 555-0100',
    rawPayload: { field: 'comments' }, status: 'PROCESSED',
  });
  db.seed('automationRun', {
    id: 'run', automationId: 'flow-active', webhookEventId: 'event', idempotencyKey: 'run-1', status: 'API_ACCEPTED', dmStatus: 'SENT',
  });
  db.seed('contact', { id: 'contact', instagramAccountId: 'ig-creator', igsid: 'fan', username: 'fan', followGateStatus: 'DELIVERED' });
  db.seed('automationContactState', { id: 'contact-state', automationId: 'flow-active', instagramAccountId: 'ig-creator', igsid: 'fan', status: 'DELIVERED' });
  db.seed('directUpiPayment', {
    id: 'payment', userId: 'creator', planType: 'STANDARD', amount: 99, utrNumber: '123456789012', status: 'VERIFIED',
  });
  db.seed('auditLog', { id: 'older-audit', userId: 'creator', action: 'LOGIN', details: { note: 'pre-existing' } });

  db.seed('user', {
    id: 'bystander', email: 'bystander@example.test', passwordHash: 'bystander-hash', totalCommentsReceived: 7, dmsUsedThisMonth: 2,
  });
  db.seed('metaConnection', {
    id: 'bystander-connection', userId: 'bystander', metaUserId: 'meta-2', instagramAccountId: 'ig-bystander',
    instagramUsername: 'bystander', accessTokenEncrypted: 'bystander-token-ciphertext',
  });
  db.seed('automation', {
    id: 'bystander-flow', userId: 'bystander', instagramAccountId: 'ig-bystander', name: 'Bystander flow', status: 'ACTIVE',
    keywords: ['hi'], dmMessageTemplate: 'Hi', totalTriggers: 4, totalSuccess: 4, lastTriggeredAt: lastTrigger,
  });

  return { creator, activeFlow, pausedFlow, event, lastTrigger };
}

export type TableChange = { model: ModelName; id: string; change: 'added' | 'removed' | `field:${string}` };

/** Lists every row added/removed and every field changed between two snapshots. */
export function diffTables(before: Record<ModelName, any[]>, after: Record<ModelName, any[]>): TableChange[] {
  const changes: TableChange[] = [];
  for (const model of Object.keys(after) as ModelName[]) {
    const previous = new Map(before[model].map((row) => [row.id, row]));
    const current = new Map(after[model].map((row) => [row.id, row]));
    for (const [id, row] of current) {
      const old = previous.get(id);
      if (!old) { changes.push({ model, id, change: 'added' }); continue; }
      for (const field of new Set([...Object.keys(old), ...Object.keys(row)])) {
        if (JSON.stringify(old[field]) !== JSON.stringify(row[field])) changes.push({ model, id, change: `field:${field}` });
      }
    }
    for (const id of previous.keys()) if (!current.has(id)) changes.push({ model, id, change: 'removed' });
  }
  return changes;
}
