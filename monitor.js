// LIVE REAL-TIME MONITOR - Polls DB every 5 seconds for new events
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

const seen = new Set();
const seenRuns = new Set();
const seenContacts = new Set();

let checkCount = 0;

async function poll() {
  checkCount++;
  const since = new Date(Date.now() - 10 * 60 * 1000); // last 10 min

  // New webhook events
  const events = await prisma.webhookEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  });

  for (const ev of events) {
    if (!seen.has(ev.id)) {
      seen.add(ev.id);
      const ts = new Date().toLocaleTimeString('en-IN');
      console.log(`\n[${ts}] 📨 NEW COMMENT EVENT`);
      console.log(`   By       : @${ev.commenterUsername}`);
      console.log(`   Comment  : "${ev.commentText}"`);
      console.log(`   Status   : ${ev.status}`);
      console.log(`   Error    : ${ev.errorDetails || 'none'}`);
    } else {
      // Check if status changed
      const fresh = await prisma.webhookEvent.findUnique({ where: { id: ev.id }, select: { status: true, errorDetails: true } });
      if (fresh && fresh.status !== ev.status) {
        const ts = new Date().toLocaleTimeString('en-IN');
        console.log(`\n[${ts}] 🔄 EVENT STATUS CHANGED: ${ev.commenterUsername} → ${fresh.status}`);
        if (fresh.errorDetails) console.log(`   Error: ${fresh.errorDetails}`);
      }
    }
  }

  // New automation runs
  const runs = await prisma.automationRun.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    include: { webhookEvent: { select: { commenterUsername: true, commentText: true } } }
  });

  for (const run of runs) {
    if (!seenRuns.has(run.id)) {
      seenRuns.add(run.id);
      const ts = new Date().toLocaleTimeString('en-IN');
      const user = run.webhookEvent?.commenterUsername || 'unknown';
      const comment = run.webhookEvent?.commentText || '';
      console.log(`\n[${ts}] 🤖 AUTOMATION RUN`);
      console.log(`   User     : @${user} | "${comment}"`);
      console.log(`   Status   : ${run.status}`);
      console.log(`   DM       : ${run.dmStatus || 'pending'} ${run.dmResponseId ? '✅' : ''}`);
      console.log(`   Comment  : ${run.publicReplyStatus || 'pending'} ${run.publicReplyId ? '✅' : ''}`);
      if (run.errorMessage) console.log(`   ❌ ERROR: ${run.errorMessage}`);
    }
  }

  // Contact follow status changes
  const contacts = await prisma.contact.findMany({
    where: { updatedAt: { gte: since } },
    orderBy: { updatedAt: 'desc' }
  });

  for (const c of contacts) {
    const key = `${c.igsid}:${c.followedAt}:${c.promptSentAt}`;
    if (!seenContacts.has(key)) {
      seenContacts.add(key);
      const ts = new Date().toLocaleTimeString('en-IN');
      if (c.followedAt) {
        console.log(`\n[${ts}] 👥 FOLLOW TRACKED: @${c.username} clicked Follow button`);
      }
      if (c.promptSentAt) {
        console.log(`\n[${ts}] ✨ PROMPT DELIVERED: @${c.username} received prompt`);
      }
    }
  }

  if (checkCount % 12 === 0) {
    // Every 60s print summary
    const ts = new Date().toLocaleTimeString('en-IN');
    const auto = await prisma.automation.findFirst({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } });
    console.log(`\n[${ts}] 📊 STATUS: Triggers=${auto?.totalTriggers} | Success=${auto?.totalSuccess} | Failed=${auto?.totalFailed}`);
  }
}

async function run() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║      🔴 LIVE MONITOR STARTED — Polling every 5s       ║');
  console.log('║   Aap comment karo — main yahan track karunga! 👀     ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('Checking for events... Press Ctrl+C to stop.\n');
  
  // Print initial state
  const auto = await prisma.automation.findFirst({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' }, include: { resource: true } });
  console.log(`Active Automation : "${auto?.name}"`);
  console.log(`Resource          : ${auto?.resource?.url || auto?.resource?.textContent || '❌ NOT SET'}`);
  console.log(`Mode              : ${auto?.triggerType} | Keywords: [${auto?.keywords.join(', ') || 'ANY'}]`);
  console.log(`Public Reply      : ${auto?.publicReplyEnabled ? '✅ ON' : '❌ OFF'}`);
  console.log('');

  while (true) {
    try {
      await poll();
    } catch (e) {
      console.error('Poll error:', e.message);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

run().catch(console.error);
