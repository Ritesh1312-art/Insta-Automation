const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== REAL-TIME LIVE COMMENT MONITORING STARTED ===');
  console.log('Waiting for incoming comment webhooks from Meta...\n');

  const initialEventCount = await prisma.webhookEvent.count();
  const initialRunCount = await prisma.automationRun.count();

  console.log(`Initial Webhook Events Count: ${initialEventCount}`);
  console.log(`Initial Automation Runs Count: ${initialRunCount}`);
  console.log('--------------------------------------------------');

  const start = Date.now();
  let found = false;

  while (Date.now() - start < 45000) {
    const events = await prisma.webhookEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    const runs = await prisma.automationRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: { automation: true },
    });

    if (events.length > initialEventCount || runs.length > initialRunCount) {
      found = true;
      console.log('\n🚨 NEW LIVE EVENT DETECTED!');
      console.log('RECENT WEBHOOK EVENTS:', JSON.stringify(events, null, 2));
      console.log('RECENT AUTOMATION RUNS:', JSON.stringify(runs, null, 2));
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!found) {
    console.log('\n[Status Check]: No new webhook events received in the last 45 seconds.');
  }
}

main().finally(() => prisma.$disconnect());
