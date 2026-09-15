-- Dashboard values are fallbacks only. TELEGRAM_* environment variables win.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramBotTokenEncrypted" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT;
