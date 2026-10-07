import { randomUUID } from 'node:crypto';
import type { TransactionClient } from '@/lib/advisory-lock';
import { prisma } from '@/lib/prisma';
import { safeErrorMessage } from '@/lib/safe-error';

export const DATA_DELETION_PENDING = 'PENDING';
export const DATA_DELETION_COMPLETED = 'COMPLETED';
export const DATA_DELETION_FAILED = 'FAILED';

export type DataDeletionCounts = {
  connections: number;
  media: number;
  automations: number;
  contacts: number;
  webhookEvents: number;
};

export type DataDeletionStatus = {
  confirmationCode: string;
  status: string;
  requestedAt: Date;
  completedAt: Date | null;
  deleted: DataDeletionCounts;
};

type DeletionRecord = {
  confirmationCode: string;
  status: string;
  requestedAt: Date;
  completedAt: Date | null;
  deletedConnections: number;
  deletedMedia: number;
  deletedAutomations: number;
  deletedContacts: number;
  deletedWebhookEvents: number;
};

/**
 * Public, PII-free view of a deletion request. The Meta user id is deliberately
 * never returned: the confirmation code is the only handle the status page (and
 * Meta's own status URL) needs.
 */
function view(record: DeletionRecord): DataDeletionStatus {
  return {
    confirmationCode: record.confirmationCode,
    status: record.status,
    requestedAt: record.requestedAt,
    completedAt: record.completedAt,
    deleted: {
      connections: record.deletedConnections,
      media: record.deletedMedia,
      automations: record.deletedAutomations,
      contacts: record.deletedContacts,
      webhookEvents: record.deletedWebhookEvents,
    },
  };
}

/**
 * Deletion scope is derived from the schema relations, not from a hand-kept
 * list: everything that hangs off the deleted MetaConnection rows is removed by
 * `onDelete: Cascade` — Media, Automation (and their AutomationRun rows),
 * Contact, AutomationContactState, and WebhookEvent. Row counts are read inside
 * the same transaction before the delete, so the confirmation page can only
 * report what this request actually removed.
 *
 * The workspace `User` row (email, password hash, plan, UPI payments, audit
 * logs) is app data the person entered here rather than data received from
 * Meta, so it is intentionally left for the email-based deletion path.
 */
export async function processMetaDataDeletion(metaUserId: string): Promise<DataDeletionStatus> {
  const existing = await prisma.metaDataDeletionRequest.findUnique({ where: { metaUserId } });
  const confirmationCode = existing?.confirmationCode ?? randomUUID();

  let counts: DataDeletionCounts;
  try {
    counts = await prisma.$transaction(async (tx: TransactionClient) => {
      const connections = await tx.metaConnection.findMany({
        where: { metaUserId },
        select: { instagramAccountId: true },
      }) as Array<{ instagramAccountId: string }>;
      const accountIds = connections.map((connection) => connection.instagramAccountId);
      const nested: Omit<DataDeletionCounts, 'connections'> = accountIds.length
        ? {
          media: await tx.media.count({ where: { instagramAccountId: { in: accountIds } } }),
          automations: await tx.automation.count({ where: { instagramAccountId: { in: accountIds } } }),
          contacts: await tx.contact.count({ where: { instagramAccountId: { in: accountIds } } }),
          webhookEvents: await tx.webhookEvent.count({ where: { instagramAccountId: { in: accountIds } } }),
        }
        : { media: 0, automations: 0, contacts: 0, webhookEvents: 0 };
      const removed = await tx.metaConnection.deleteMany({ where: { metaUserId } });
      return { connections: removed.count, ...nested };
    });
  } catch (error) {
    // Never leave a request claiming deletion it did not perform: record the
    // failure so the status page reports FAILED, then let the caller answer 5xx
    // so Meta retries the callback.
    await prisma.metaDataDeletionRequest.upsert({
      where: { metaUserId },
      create: {
        metaUserId,
        confirmationCode,
        status: DATA_DELETION_FAILED,
        errorDetails: safeErrorMessage(error),
      },
      update: { status: DATA_DELETION_FAILED, errorDetails: safeErrorMessage(error) },
    }).catch(() => undefined);
    throw error;
  }

  // Retries only ever add to the recorded totals: an idempotent repeat that
  // finds nothing new keeps the original confirmation code and counts.
  const record = await prisma.metaDataDeletionRequest.upsert({
    where: { metaUserId },
    create: {
      metaUserId,
      confirmationCode,
      status: DATA_DELETION_COMPLETED,
      deletedConnections: counts.connections,
      deletedMedia: counts.media,
      deletedAutomations: counts.automations,
      deletedContacts: counts.contacts,
      deletedWebhookEvents: counts.webhookEvents,
      completedAt: new Date(),
    },
    update: {
      status: DATA_DELETION_COMPLETED,
      deletedConnections: { increment: counts.connections },
      deletedMedia: { increment: counts.media },
      deletedAutomations: { increment: counts.automations },
      deletedContacts: { increment: counts.contacts },
      deletedWebhookEvents: { increment: counts.webhookEvents },
      completedAt: new Date(),
      errorDetails: null,
    },
  });

  return view(record as DeletionRecord);
}

/** Looks a deletion request up by the confirmation code shown on the status URL. */
export async function getDataDeletionStatus(confirmationCode: string): Promise<DataDeletionStatus | null> {
  const code = confirmationCode.trim();
  if (!code || code.length > 200) return null;
  const record = await prisma.metaDataDeletionRequest.findUnique({ where: { confirmationCode: code } });
  return record ? view(record as DeletionRecord) : null;
}
