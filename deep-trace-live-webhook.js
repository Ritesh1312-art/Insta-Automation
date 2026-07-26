const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== DEEP TRACE OF ALL RECENT WEBHOOK EVENTS & RUNS ===\n');

  const events = await prisma.webhookEvent.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { runs: true },
  });

  console.log(`Found ${events.length} recent Webhook Events:\n`);
  for (const ev of events) {
    console.log(`📅 Event ID : ${ev.id}`);
    console.log(`   Type     : ${ev.eventType}`);
    console.log(`   User     : @${ev.commenterUsername} (ID: ${ev.commenterId})`);
    console.log(`   Comment  : "${ev.commentText}"`);
    console.log(`   Status   : ${ev.status}`);
    console.log(`   Error    : ${ev.errorDetails || 'None'}`);
    console.log(`   Runs     : ${ev.runs.length} runs`);
    ev.runs.forEach(r => {
      console.log(`     -> Run Status: ${r.status} | DM: ${r.dmStatus} | Error: ${r.errorMessage}`);
    });
    console.log('----------------------------------------------------');
  }

  const contacts = await prisma.contact.findMany({
    take: 10,
    orderBy: { updatedAt: 'desc' },
  });

  console.log(`\nFound ${contacts.length} Contacts:\n`);
  contacts.forEach(c => {
    console.log(`👤 Username   : @${c.username}`);
    console.log(`   IGSID      : ${c.igsid}`);
    console.log(`   FollowedAt : ${c.followedAt || '❌ NULL (Not Followed)'}`);
    console.log(`   PromptSent : ${c.promptSentAt || '❌ NULL (Prompt Not Sent)'}`);
    console.log('----------------------------------------------------');
  });
}

main().finally(() => prisma.$disconnect());
