-- Caps how often one person is sent the "Follow to unlock" prompt for one flow.
ALTER TABLE "AutomationContactState" ADD COLUMN IF NOT EXISTS "followPromptCount" INTEGER NOT NULL DEFAULT 0;
