const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

function decryptToken(encryptedText) {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function main() {
  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  if (!connection) return;

  const accessToken = decryptToken(connection.accessTokenEncrypted);
  console.log('Connected Instagram Account ID:', connection.instagramAccountId);

  // Get recent webhook event sender IDs
  const events = await prisma.webhookEvent.findMany({
    where: { commenterId: { not: null } },
    take: 5,
    orderBy: { createdAt: 'desc' },
  });

  for (const ev of events) {
    console.log(`\nTesting user profile lookup for IGSID: ${ev.commenterId} (${ev.commenterUsername})...`);
    const url = `https://graph.facebook.com/v19.0/${ev.commenterId}?fields=username,is_user_follow_business&access_token=${accessToken}`;
    const res = await fetch(url);
    const data = await res.json();
    console.log('Profile Response:', JSON.stringify(data, null, 2));
  }
}

main().finally(() => prisma.$disconnect());
