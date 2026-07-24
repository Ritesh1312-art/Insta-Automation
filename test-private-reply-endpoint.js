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
  const igAccountId = connection.instagramAccountId;
  const pageId = connection.facebookPageId || '1165684963302442';

  // Find latest comment ID
  const latestEvent = await prisma.webhookEvent.findFirst({
    where: { eventType: 'comments', commentId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  if (!latestEvent) return;

  const commentId = latestEvent.commentId;
  console.log(`Testing Private Reply on Comment ID: ${commentId}`);
  console.log(`Instagram Account ID: ${igAccountId}`);
  console.log(`Facebook Page ID: ${pageId}`);

  // Test 1: /{igAccountId}/messages
  console.log('\n--- TEST 1: /{igAccountId}/messages ---');
  let res = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: 'Test DM Private Reply' } }),
  });
  console.log('Result 1:', await res.json());

  // Test 2: /me/messages
  console.log('\n--- TEST 2: /me/messages ---');
  res = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: 'Test DM Private Reply' } }),
  });
  console.log('Result 2:', await res.json());

  // Test 3: /{pageId}/messages
  console.log('\n--- TEST 3: /{pageId}/messages ---');
  res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: 'Test DM Private Reply' } }),
  });
  console.log('Result 3:', await res.json());

  // Test 4: Public Reply /{commentId}/replies
  console.log('\n--- TEST 4: Public Reply /{commentId}/replies ---');
  res = await fetch(`https://graph.facebook.com/v19.0/${commentId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message: 'Done! Check DMs 🚀' }),
  });
  console.log('Result 4 (Public Comment Reply):', await res.json());
}

main().finally(() => prisma.$disconnect());
