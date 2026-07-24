// COMPLETE LIVE STATUS CHECK
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
  const now = new Date();
  const since = new Date(now.getTime() - 2 * 60 * 60 * 1000); // last 2 hours

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         COMPLETE LIVE AUTOMATION STATUS CHECK        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ──────────────────────────────────────────────
  // 1. CONNECTION STATUS
  // ──────────────────────────────────────────────
  console.log('━━━ [1] META CONNECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const connection = await prisma.metaConnection.findFirst({ where: { connectionStatus: 'CONNECTED' } });
  if (!connection) {
    console.log('❌ NO CONNECTED INSTAGRAM ACCOUNT!');
    return;
  }
  console.log(`✅ Account   : @${connection.instagramUsername}`);
  console.log(`   IG ID     : ${connection.instagramAccountId}`);
  console.log(`   Page ID   : ${connection.facebookPageId}`);
  console.log(`   Status    : ${connection.connectionStatus}`);
  console.log(`   Expires   : ${connection.expiresAt || 'Never'}`);

  // ──────────────────────────────────────────────
  // 2. ACTIVE AUTOMATION
  // ──────────────────────────────────────────────
  console.log('\n━━━ [2] ACTIVE AUTOMATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const automation = await prisma.automation.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    include: { resource: true, media: true }
  });
  if (!automation) {
    console.log('❌ NO ACTIVE AUTOMATION FOUND!');
  } else {
    console.log(`✅ Name      : ${automation.name}`);
    console.log(`   ID        : ${automation.id}`);
    console.log(`   Keywords  : [${automation.keywords.join(', ')}]`);
    console.log(`   Mode      : ${automation.matchingMode} / ${automation.triggerType}`);
    console.log(`   Media     : ${automation.media?.instagramMediaId || '(all posts)'}`);
    console.log(`   Resource  : ${automation.resource?.url || automation.resource?.textContent || '❌ NOT SET'}`);
    console.log(`   DM Tmpl   : ${automation.dmMessageTemplate?.substring(0, 80)}`);
    console.log(`   PublicReply: ${automation.publicReplyEnabled ? '✅ ON' : '⭕ OFF'}`);
    if (automation.publicReplyEnabled) {
      console.log(`   Reply Tmpl: [${automation.publicReplyTemplates.join(' | ')}]`);
    }
    console.log(`   Stats     : Triggers=${automation.totalTriggers} | Success=${automation.totalSuccess} | Failed=${automation.totalFailed}`);
  }

  // ──────────────────────────────────────────────
  // 3. RECENT WEBHOOK EVENTS (last 2 hours)
  // ──────────────────────────────────────────────
  console.log('\n━━━ [3] RECENT COMMENTS (last 2 hours) ━━━━━━━━━━━━━━━');
  const recentEvents = await prisma.webhookEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  if (recentEvents.length === 0) {
    console.log('⚠️  No webhook events in last 2 hours');
  } else {
    recentEvents.forEach(ev => {
      const age = Math.round((now - ev.createdAt) / 60000);
      const statusIcon = ev.status === 'PROCESSED' ? '✅' : ev.status === 'IGNORED' ? '⭕' : ev.status === 'FAILED' ? '❌' : '🟡';
      console.log(`${statusIcon} ${age}min ago | @${ev.commenterUsername || 'unknown'} | "${(ev.commentText || '').substring(0, 30)}" | ${ev.status}`);
      if (ev.errorDetails) console.log(`   ⚠️  Error: ${ev.errorDetails}`);
    });
  }

  // ──────────────────────────────────────────────
  // 4. RECENT AUTOMATION RUNS
  // ──────────────────────────────────────────────
  console.log('\n━━━ [4] AUTOMATION RUNS (last 2 hours) ━━━━━━━━━━━━━━');
  const recentRuns = await prisma.automationRun.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { webhookEvent: { select: { commenterUsername: true, commentText: true } } }
  });
  if (recentRuns.length === 0) {
    console.log('⚠️  No automation runs in last 2 hours');
  } else {
    recentRuns.forEach(run => {
      const age = Math.round((now - run.createdAt) / 60000);
      const statusIcon = run.status === 'API_ACCEPTED' ? '✅' : run.status === 'FAILED' ? '❌' : '🟡';
      console.log(`${statusIcon} ${age}min ago | @${run.webhookEvent?.commenterUsername || 'unknown'}`);
      console.log(`   Status    : ${run.status}`);
      console.log(`   DM        : ${run.dmStatus || 'N/A'} ${run.dmResponseId ? '(ID: '+run.dmResponseId?.substring(0,20)+'...)' : ''}`);
      console.log(`   PublicReply: ${run.publicReplyStatus || 'N/A'}`);
      if (run.errorMessage) console.log(`   ❌ Error  : ${run.errorMessage}`);
    });
  }

  // ──────────────────────────────────────────────
  // 5. CONTACTS (follow status)
  // ──────────────────────────────────────────────
  console.log('\n━━━ [5] CONTACTS (follow/prompt status) ━━━━━━━━━━━━━━');
  const contacts = await prisma.contact.findMany({
    orderBy: { lastInteraction: 'desc' },
    take: 10,
  });
  if (contacts.length === 0) {
    console.log('⚠️  No contacts yet');
  } else {
    contacts.forEach(c => {
      const followed = c.followedAt ? '✅ FOLLOWED' : '❌ NOT FOLLOWED';
      const prompted = c.promptSentAt ? '✅ PROMPT SENT' : '⏳ PENDING';
      console.log(`👤 @${c.username || c.igsid} | ${followed} | ${prompted}`);
    });
  }

  // ──────────────────────────────────────────────
  // 6. LIVE DM TEST
  // ──────────────────────────────────────────────
  console.log('\n━━━ [6] LIVE DM CAPABILITY TEST ━━━━━━━━━━━━━━━━━━━━━');
  const accessToken = decryptToken(connection.accessTokenEncrypted);
  // Test by checking account info (not sending a message)
  const res = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v19.0'}/me?fields=id,name&access_token=${accessToken}`);
  const acctData = await res.json();
  if (acctData.id) {
    console.log(`✅ Token Valid - Account: ${acctData.name} (${acctData.id})`);
  } else {
    console.log(`❌ Token Issue: ${JSON.stringify(acctData.error)}`);
  }

  // Check Meta app mode via graph
  const appRes = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || 'v19.0'}/me/permissions?access_token=${accessToken}`);
  const appData = await appRes.json();
  if (appData.data) {
    const grantedPerms = appData.data.filter(p => p.status === 'granted').map(p => p.permission);
    const hasMessages = grantedPerms.includes('instagram_manage_messages');
    const hasComments = grantedPerms.includes('instagram_manage_comments');
    console.log(`\n   Permissions granted:`);
    console.log(`   💬 instagram_manage_messages : ${hasMessages ? '✅ GRANTED' : '❌ MISSING'}`);
    console.log(`   📝 instagram_manage_comments : ${hasComments ? '✅ GRANTED' : '❌ MISSING'}`);
    console.log(`\n   All perms: ${grantedPerms.join(', ')}`);
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║                   CHECK COMPLETE                     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
}

main().catch(console.error).finally(() => prisma.$disconnect());
