const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== AUTOMATIONS IN DB ===');
  const automations = await prisma.automation.findMany();
  console.log(JSON.stringify(automations, null, 2));

  console.log('\n=== RECENT WEBHOOK EVENTS ===');
  const webhooks = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log(JSON.stringify(webhooks, null, 2));

  console.log('\n=== RECENT AUTOMATION RUNS ===');
  const runs = await prisma.automationRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log(JSON.stringify(runs, null, 2));
}

main().finally(() => prisma.$disconnect());
