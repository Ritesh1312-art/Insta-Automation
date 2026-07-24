// Manual trigger test - simulate exact what happens when bhakti comments
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
const prisma = new PrismaClient();

async function main() {
  console.log('=== MANUAL TRIGGER TEST ===\n');

  // Get the last unprocessed event from a real external user
  const ev = await prisma.webhookEvent.findFirst({
    where: {
      commenterUsername: { notIn: ['stuti.ritesh90'] },
      status: { in: ['RECEIVED', 'PROCESSED'] }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!ev) { console.log('No events found'); return; }

  console.log(`Testing with event: @${ev.commenterUsername} - "${ev.commentText}"`);
  console.log(`Event ID: ${ev.id}`);
  console.log(`Event IG Account: ${ev.instagramAccountId}`);
  console.log(`Event Media ID: ${ev.mediaId}`);
  console.log(`Event Status: ${ev.status}`);

  // Find matching automation
  const connection = await prisma.metaConnection.findFirst({
    where: {
      OR: [
        { instagramAccountId: ev.instagramAccountId },
        { facebookPageId: ev.instagramAccountId },
      ]
    }
  });
  console.log(`\nConnection found: ${connection ? `@${connection.instagramUsername}` : 'NONE ❌'}`);
  console.log(`Real IG Account ID: ${connection?.instagramAccountId}`);

  if (!connection) return;

  const media = await prisma.media.upsert({
    where: { instagramMediaId: ev.mediaId || 'none' },
    create: { instagramAccountId: connection.instagramAccountId, instagramMediaId: ev.mediaId || 'none', mediaType: 'REEL', caption: null, permalink: null, timestamp: new Date() },
    update: {}
  });
  console.log(`Media DB ID: ${media.id}`);

  // Find automations
  const automations = await prisma.automation.findMany({
    where: {
      instagramAccountId: connection.instagramAccountId,
      status: 'ACTIVE',
      OR: [{ mediaId: media.id }, { mediaId: null }]
    },
    include: { resource: true }
  });
  
  console.log(`\nMatching automations found: ${automations.length}`);
  automations.forEach(a => {
    console.log(`  - "${a.name}" | keywords: [${a.keywords.join(', ')}] | mode: ${a.matchingMode} | type: ${a.triggerType}`);
    console.log(`    MediaId on auto: ${a.mediaId} | media.id: ${media.id} | MATCH: ${a.mediaId === media.id || a.mediaId === null}`);
  });

  // Check one delivery per user
  if (automations.length > 0) {
    const auto = automations[0];
    const prior = await prisma.automationRun.findFirst({
      where: { automationId: auto.id, status: 'API_ACCEPTED', webhookEvent: { commenterId: ev.commenterId } }
    });
    console.log(`\nOneDeliveryPerUser: ${auto.oneDeliveryPerUser}`);
    console.log(`Prior delivery exists: ${prior ? 'YES - BLOCKED ❌' : 'NO - Will proceed ✅'}`);
    
    console.log(`\nIgnoreOwner: ${auto.ignoreOwnerComments}`);
    console.log(`Commenter: @${ev.commenterUsername} | Owner: @${connection.instagramUsername}`);
    console.log(`Is owner: ${ev.commenterUsername === connection.instagramUsername ? 'YES - IGNORED ❌' : 'NO - Will proceed ✅'}`);
  }

  // Show all existing runs for this automation
  if (automations.length > 0) {
    const runs = await prisma.automationRun.findMany({
      where: { automationId: automations[0].id },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { webhookEvent: { select: { commenterUsername: true, commentText: true } } }
    });
    console.log(`\nExisting runs for automation "${automations[0].name}": ${runs.length}`);
    runs.forEach(r => console.log(`  - ${r.status} | @${r.webhookEvent?.commenterUsername} | DM: ${r.dmStatus}`));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
