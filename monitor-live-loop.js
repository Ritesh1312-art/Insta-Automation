const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== REAL-TIME LIVE COMMENT MONITORING STARTED (5 MINUTE DURATION) ===');
  console.log('Waiting for incoming comment webhooks from Meta...\n');

  const initialEventCount = await prisma.webhookEvent.count();
  const initialRunCount = await prisma.automationRun.count();

  console.log(`Initial Webhook Events Count: ${initialEventCount}`);
  console.log(`Initial Automation Runs Count: ${initialRunCount}`);
  console.log('--------------------------------------------------');

  const start = Date.now();
  let lastEventCount = initialEventCount;

  while (Date.now() - start < 300000) {
    const currentEventCount = await prisma.webhookEvent.count();
    if (currentEventCount > lastEventCount) {
      lastEventCount = currentEventCount;
      const latestEvent = await prisma.webhookEvent.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      const latestRun = await prisma.automationRun.findFirst({
        where: { webhookEventId: latestEvent.id },
        include: { automation: true },
      });

      console.log('\n🚨 NEW LIVE COMMENT EVENT DETECTED ON SERVER!');
      console.log('WEBHOOK EVENT:', JSON.stringify(latestEvent, null, 2));
      console.log('AUTOMATION RUN RECORD:', JSON.stringify(latestRun, null, 2));
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log('\n[Status Check]: 5-minute monitoring window completed.');
}

main().finally(() => prisma.$disconnect());
