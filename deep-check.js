// DEEP DIAGNOSIS: Find exact automation matching + permission issues
const fs = require('fs');
const path = require('path');
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

function decryptToken(enc) {
  const [ivHex, tagHex, data] = enc.split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');
  const dec = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  dec.setAuthTag(Buffer.from(tagHex, 'hex'));
  return dec.update(data, 'hex', 'utf8') + dec.final('utf8');
}

async function main() {
  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  const accessToken = decryptToken(connection.accessTokenEncrypted);

  console.log('\n━━━ ALL AUTOMATIONS IN DB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const allAutomations = await prisma.automation.findMany({
    include: { resource: true, media: true },
    orderBy: { updatedAt: 'desc' }
  });
  allAutomations.forEach((a, i) => {
    console.log(`\n[${i+1}] ${a.name}`);
    console.log(`   ID       : ${a.id}`);
    console.log(`   Status   : ${a.status}`);
    console.log(`   IG AcctID: ${a.instagramAccountId}`);
    console.log(`   MediaID  : ${a.mediaId || '(none - all posts)'}`);
    console.log(`   Media IG : ${a.media?.instagramMediaId || 'N/A'}`);
    console.log(`   Keywords : [${a.keywords.join(', ')}] | Mode: ${a.matchingMode} | Type: ${a.triggerType}`);
    console.log(`   Resource : ${a.resource?.url || a.resource?.textContent || '❌ EMPTY'}`);
    console.log(`   DM Tmpl  : ${a.dmMessageTemplate?.substring(0,60)}`);
    console.log(`   Triggers : ${a.totalTriggers} | Success: ${a.totalSuccess} | Failed: ${a.totalFailed}`);
  });

  console.log('\n━━━ ALL WEBHOOK EVENTS (last 5) ━━━━━━━━━━━━━━━━━━━━━━');
  const events = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  events.forEach(ev => {
    console.log(`\n   EventID  : ${ev.id}`);
    console.log(`   IG AcctID: ${ev.instagramAccountId}`);
    console.log(`   MediaID  : ${ev.mediaId}`);
    console.log(`   Comment  : "${ev.commentText}" by @${ev.commenterUsername}`);
    console.log(`   Status   : ${ev.status}`);
    console.log(`   Error    : ${ev.errorDetails || 'none'}`);
  });

  console.log('\n━━━ CHECKING MEDIA MATCH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const media = await prisma.media.findMany();
  media.forEach(m => {
    console.log(`   Media DB ID: ${m.id} | IG Media ID: ${m.instagramMediaId}`);
  });

  console.log('\n━━━ TESTING pages_messaging PERMISSION ━━━━━━━━━━━━━━━');
  // Test: try sending a message with pages_messaging style
  const shaluIgsid = '1684299182797183'; // shalugupta67781
  const res = await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      recipient: { id: shaluIgsid },
      message: { text: 'Test from live-check (shalugupta67781)' }
    })
  });
  const data = await res.json();
  console.log('DM Test to @shalugupta67781:', JSON.stringify(data));

  // Check Page permissions
  const pageRes = await fetch(`https://graph.facebook.com/v19.0/${connection.facebookPageId}?fields=id,name,access_token&access_token=${accessToken}`);
  const pageData = await pageRes.json();
  console.log('\nPage Info:', JSON.stringify(pageData));
}

main().catch(console.error).finally(() => prisma.$disconnect());
