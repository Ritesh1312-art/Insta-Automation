// DEBUG SCRIPT: Live test what Meta sends us when user clicks Get Prompt button
// This logs the EXACT raw webhook payload Meta sends for postback clicks
// Run: node test-debug-webhook.js (Then click Get Prompt in Instagram DM)

const http = require('http');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function testSendDM() {
  console.log('=== TESTING DIRECT MESSAGE SEND ===\n');
  
  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  if (!connection) { console.log('No connection found'); return; }
  
  const cryptoParts = connection.accessTokenEncrypted.split(':');
  const iv = Buffer.from(cryptoParts[0], 'hex');
  const authTag = Buffer.from(cryptoParts[1], 'hex');
  const enc = cryptoParts[2];
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(authTag);
  let accessToken = dec.update(enc, 'hex', 'utf8') + dec.final('utf8');

  console.log('accessToken prefix:', accessToken.substring(0, 20) + '...');
  
  // Get real commenter IGSID from recent webhook events
  const events = await prisma.webhookEvent.findMany({
    where: { commenterId: { not: null } },
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { commenterId: true, commenterUsername: true },
  });
  
  console.log('Recent commenters:', events.map(e => `${e.commenterUsername} (${e.commenterId})`));
  
  // Test DM send to first real commenter
  const target = events.find(e => e.commenterId !== connection.instagramAccountId);
  if (!target) { console.log('No external commenter found'); return; }
  
  console.log(`\nTesting DM to ${target.commenterUsername} (IGSID: ${target.commenterId})...`);
  
  // Find automation prompt
  const automation = await prisma.automation.findFirst({ 
    where: { status: 'ACTIVE' }, 
    orderBy: { updatedAt: 'desc' },
    include: { resource: true }
  });
  console.log('Automation:', automation?.id, '| DM Template:', automation?.dmMessageTemplate);
  console.log('Resource URL:', automation?.resource?.url || automation?.resource?.textContent);

  const resourceValue = automation?.resource?.url || automation?.resource?.textContent || 'TEST PROMPT';
  const messageText = (automation?.dmMessageTemplate || 'Hi {{username}}! Here is your prompt:\n\n{{resource_url}}')
    .replace(/\{\{username\}\}/g, target.commenterUsername || 'follower')
    .replace(/\{\{resource_url\}\}/g, resourceValue);

  console.log('\nMessage to send:', messageText);
  
  const res = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      recipient: { id: target.commenterId },
      message: { text: messageText },
    }),
  });
  
  const data = await res.json();
  console.log('\nDM send response:', JSON.stringify(data, null, 2));
}

testSendDM().finally(() => prisma.$disconnect());
