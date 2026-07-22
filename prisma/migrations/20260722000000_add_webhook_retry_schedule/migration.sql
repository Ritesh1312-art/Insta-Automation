ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "processingStartedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "WebhookEvent_status_nextRetryAt_idx" ON "WebhookEvent"("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "WebhookEvent_status_processingStartedAt_idx" ON "WebhookEvent"("status", "processingStartedAt");
