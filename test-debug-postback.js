// LIVE DEBUG: Test exact postback flow step by step
const fs = require('fs');
const path = require('path');
// Manually load .env.local
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim().replace(/^"|"$/g, '');
  });
}
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

function decryptToken(encryptedText) {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const enc = parts[2];
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(authTag);
  return dec.update(enc, 'hex', 'utf8') + dec.final('utf8');
}

async function main() {
  console.log('\n=== STEP 1: Checking Connection ===');
  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  if (!connection) { console.log('❌ No CONNECTED meta connection!'); return; }
  console.log('✅ Connection:', connection.instagramUsername, '| ID:', connection.instagramAccountId, '| PageID:', connection.facebookPageId);

  const accessToken = decryptToken(connection.accessTokenEncrypted);
  console.log('✅ Token decrypted, prefix:', accessToken.substring(0, 25) + '...');

  console.log('\n=== STEP 2: Checking Active Automation ===');
  const automation = await prisma.automation.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    include: { resource: true }
  });
  if (!automation) { console.log('❌ No ACTIVE automation found!'); return; }
  console.log('✅ Automation ID:', automation.id);
  console.log('   DM Template:', automation.dmMessageTemplate);
  console.log('   Resource URL:', automation.resource?.url);
  console.log('   Resource Text:', automation.resource?.textContent);

  const resourceValue = automation.resource?.url || automation.resource?.textContent || '';
  console.log('   Final Resource Value:', resourceValue || '❌ EMPTY - No resource set!');

  console.log('\n=== STEP 3: Checking Recent Commenters ===');
  const events = await prisma.webhookEvent.findMany({
    where: { commenterId: { not: null } },
    take: 3,
    orderBy: { createdAt: 'desc' },
    select: { commenterId: true, commenterUsername: true, instagramAccountId: true }
  });
  console.log('Recent commenters:', events.map(e => `@${e.commenterUsername} (IGSID: ${e.commenterId})`));

  const target = events.find(e => e.commenterId !== connection.instagramAccountId);
  if (!target) { console.log('❌ No external commenter found!'); return; }

  console.log(`\n=== STEP 4: Testing DM Send to @${target.commenterUsername} ===`);

  const messageText = (automation.dmMessageTemplate || 'Hi {{username}}! Here is your prompt:\n\n{{resource_url}}')
    .replace(/\{\{username\}\}/g, target.commenterUsername || 'follower')
    .replace(/\{\{resource_url\}\}/g, resourceValue);

  console.log('Message to send:\n', messageText);
  console.log('\nSending to IGSID:', target.commenterId, '...');

  const res = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v19.0'}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      recipient: { id: target.commenterId },
      message: { text: messageText },
    }),
  });

  const data = await res.json();
  if (res.ok) {
    console.log('✅ DM SENT SUCCESSFULLY! Message ID:', data.message_id || data.id);
  } else {
    console.log('❌ DM FAILED:', JSON.stringify(data, null, 2));
    console.log('\n>>> This is the error that happens when Get Prompt button is clicked <<<');
  }

  console.log('\n=== STEP 5: Testing Webhook Postback Payload Parsing ===');
  // Simulate the EXACT payload Meta sends for postback button click
  const simulatedPostback = {
    object: 'instagram',
    entry: [{
      id: connection.instagramAccountId,
      messaging: [{
        sender: { id: target.commenterId },
        recipient: { id: connection.instagramAccountId },
        postback: {
          title: '✨ Get Prompt',
          payload: `GET_PROMPT_POSTBACK_${automation.id}`
        }
      }]
    }]
  };
  
  // Parse it like the webhook does
  const events2 = [];
  for (const entry of simulatedPostback.entry) {
    if (entry.messaging) {
      for (const msg of entry.messaging) {
        const senderId = msg.sender?.id;
        const postbackPayload = msg.postback?.payload || msg.postback?.title || msg.message?.quick_reply?.payload;
        if (senderId && postbackPayload) {
          events2.push({
            instagramAccountId: msg.recipient?.id || entry.id,
            senderId,
            postbackPayload,
          });
        }
      }
    }
  }
  console.log('Parsed postback events:', JSON.stringify(events2, null, 2));
  console.log(events2.length > 0 ? '✅ Postback parsing works!' : '❌ Postback parsing FAILED!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
