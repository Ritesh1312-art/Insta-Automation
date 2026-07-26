const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== CHRONOLOGICAL LOG OF TODAY\'S WEBHOOKS & RUNS ===\n');

  const events = await prisma.webhookEvent.findMany({
    where: {
      createdAt: { gte: new Date('2026-07-26T00:00:00Z') }
    },
    orderBy: { createdAt: 'desc' },
    include: { runs: true }
  });

  console.log(`Total events today: ${events.length}\n`);

  events.forEach((ev, i) => {
    const time = new Date(ev.createdAt).toLocaleTimeString('en-IN');
    console.log(`[${i + 1}] Time: ${time} | EventID: ${ev.id}`);
    console.log(`    User    : @${ev.commenterUsername || 'unknown'} (ID: ${ev.commenterId})`);
    console.log(`    Comment : "${ev.commentText}"`);
    console.log(`    Status  : ${ev.status}`);
    if (ev.errorDetails) console.log(`    Error   : ${ev.errorDetails}`);

    if (ev.runs.length > 0) {
      ev.runs.forEach(r => {
        console.log(`    🤖 Run ID     : ${r.id}`);
        console.log(`       Run Status : ${r.status}`);
        console.log(`       DM Status  : ${r.dmStatus}`);
        console.log(`       DM Resp ID : ${r.dmResponseId}`);
        if (r.errorMessage) console.log(`       Run Error  : ${r.errorMessage}`);
      });
    } else {
      console.log(`    🤖 Runs       : NONE (0 runs)`);
    }
    console.log('----------------------------------------------------');
  });

  const contacts = await prisma.contact.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 10
  });

  console.log('\n=== ALL CONTACTS IN DB ===\n');
  contacts.forEach(c => {
    console.log(`👤 @${c.username || c.igsid}`);
    console.log(`   FollowedAt : ${c.followedAt ? c.followedAt.toISOString() : 'NULL (Not Followed)'}`);
    console.log(`   PromptSent : ${c.promptSentAt ? c.promptSentAt.toISOString() : 'NULL (Not Sent)'}`);
  });
}

main().finally(() => prisma.$disconnect());
