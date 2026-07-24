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
  const pageId = connection.facebookPageId || '1165684963302442';

  console.log(`Subscribing Facebook Page ${pageId} to valid App subscribed_fields...`);

  const url = `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps?subscribed_fields=messages,feed,mention&access_token=${accessToken}`;
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json();

  console.log('Subscribed Apps Response:', JSON.stringify(data, null, 2));
}

main().finally(() => prisma.$disconnect());
