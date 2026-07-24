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
  if (!connection) {
    console.log('No connected account found');
    return;
  }

  const accessToken = decryptToken(connection.accessTokenEncrypted);
  console.log('Testing Meta Use Case API endpoints with access token...');

  // 1. Test instagram_manage_messages call (/v19.0/{ig-account-id}/conversations)
  const convUrl = `https://graph.facebook.com/v19.0/${connection.instagramAccountId}/conversations?access_token=${accessToken}`;
  const convRes = await fetch(convUrl);
  console.log('Conversations API status:', convRes.status);
  console.log('Conversations API body:', await convRes.text());

  // 2. Test instagram_basic media fetch (/v19.0/{ig-account-id}/media)
  const mediaUrl = `https://graph.facebook.com/v19.0/${connection.instagramAccountId}/media?fields=id,caption&access_token=${accessToken}`;
  const mediaRes = await fetch(mediaUrl);
  console.log('Media API status:', mediaRes.status);
  console.log('Media API body:', await mediaRes.text());
}

main().finally(() => prisma.$disconnect());
