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
    console.log('No connected account found!');
    return;
  }

  const accessToken = decryptToken(connection.accessTokenEncrypted);
  console.log('Decrypted token successfully. Checking Meta Graph API account info...');

  const url = `https://graph.facebook.com/v19.0/${connection.instagramAccountId}?fields=id,username,name,profile_picture_url&access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();

  console.log('Graph API Status:', res.status);
  console.log('Graph API Data:', JSON.stringify(data, null, 2));
}

main().finally(() => prisma.$disconnect());
