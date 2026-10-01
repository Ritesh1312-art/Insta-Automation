-- Production correctness: additive, idempotent where possible. Reconciliation runs before constraints.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totalCommentsReceived" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MetaConnection" ALTER COLUMN "accessTokenEncrypted" DROP NOT NULL;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "messagingSenderId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "messagingPayload" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "interactionType" TEXT;
ALTER TABLE "WebhookEvent" DROP CONSTRAINT IF EXISTS "WebhookEvent_instagramAccountId_fkey";
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "MetaConnection"("instagramAccountId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE IF NOT EXISTS "AutomationContactState" (
  "id" TEXT NOT NULL, "automationId" TEXT NOT NULL, "instagramAccountId" TEXT NOT NULL, "igsid" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW', "claimStartedAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3), "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationContactState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationContactState_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AutomationContactState_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "MetaConnection"("instagramAccountId") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Preserve the oldest active flow per account/media/scope; all other duplicates are paused.
WITH ranked AS (SELECT id, row_number() OVER (PARTITION BY "instagramAccountId", "mediaId" ORDER BY "createdAt", id) n FROM "Automation" WHERE status='ACTIVE')
UPDATE "Automation" a SET status='PAUSED' FROM ranked r WHERE a.id=r.id AND r.n>1;
WITH ranked AS (SELECT id, row_number() OVER (PARTITION BY "instagramAccountId" ORDER BY "createdAt", id) n FROM "Automation" WHERE status='ACTIVE' AND "mediaId" IS NULL)
UPDATE "Automation" a SET status='PAUSED' FROM ranked r WHERE a.id=r.id AND r.n>1;
-- retain newest live connection, clear old credentials, and pause their flows
WITH ranked AS (SELECT id, row_number() OVER (PARTITION BY "userId" ORDER BY "updatedAt" DESC, id DESC) n FROM "MetaConnection" WHERE "connectionStatus" <> 'DISCONNECTED')
UPDATE "MetaConnection" c SET "connectionStatus"='DISCONNECTED', "accessTokenEncrypted"=NULL, "expiresAt"=NULL FROM ranked r WHERE c.id=r.id AND r.n>1;
UPDATE "Automation" a SET status='PAUSED' WHERE a."instagramAccountId" IN (SELECT "instagramAccountId" FROM "MetaConnection" WHERE "connectionStatus"='DISCONNECTED');
UPDATE "User" SET "totalCommentsReceived"=GREATEST("totalCommentsReceived", (SELECT COUNT(*) FROM "WebhookEvent" w WHERE w."eventType"='comments' AND w."instagramAccountId" IN (SELECT "instagramAccountId" FROM "MetaConnection" m WHERE m."userId"="User"."id")));
CREATE UNIQUE INDEX IF NOT EXISTS "Automation_one_active_per_scope" ON "Automation" ("instagramAccountId", COALESCE("mediaId", '__ALL_POSTS__')) WHERE status='ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS "MetaConnection_one_live_per_workspace" ON "MetaConnection" ("userId") WHERE "connectionStatus" <> 'DISCONNECTED';
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationContactState_automationId_igsid_key" ON "AutomationContactState" ("automationId", "igsid");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog" ("action", "createdAt");
CREATE INDEX IF NOT EXISTS "WebhookEvent_retention_idx" ON "WebhookEvent" ("status", "createdAt");
