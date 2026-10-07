-- Meta webhook-subscription state is tracked separately from token/connection
-- state, so a valid connection with a failed subscribe is not reported as an
-- expired token. Existing rows keep 'UNKNOWN' until a subscribe attempt runs.
ALTER TABLE "MetaConnection" ADD COLUMN IF NOT EXISTS "webhookStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- Persistent record for Meta data-deletion callbacks. One row per Meta user so
-- retries are idempotent and the public status page can only confirm a deletion
-- that was actually recorded.
CREATE TABLE IF NOT EXISTS "MetaDataDeletionRequest" (
    "id" TEXT NOT NULL,
    "metaUserId" TEXT NOT NULL,
    "confirmationCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "deletedConnections" INTEGER NOT NULL DEFAULT 0,
    "deletedMedia" INTEGER NOT NULL DEFAULT 0,
    "deletedAutomations" INTEGER NOT NULL DEFAULT 0,
    "deletedContacts" INTEGER NOT NULL DEFAULT 0,
    "deletedWebhookEvents" INTEGER NOT NULL DEFAULT 0,
    "errorDetails" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetaDataDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MetaDataDeletionRequest_metaUserId_key" ON "MetaDataDeletionRequest"("metaUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "MetaDataDeletionRequest_confirmationCode_key" ON "MetaDataDeletionRequest"("confirmationCode");
