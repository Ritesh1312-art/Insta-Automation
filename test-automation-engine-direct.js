const { AutomationEngine } = require('./src/services/automation/AutomationEngine');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Testing AutomationEngine logic with simulated comment event...');
  const event = await prisma.webhookEvent.create({
    data: {
      provider: 'META',
      eventType: 'COMMENT',
      instagramAccountId: '17841439216724676',
      mediaId: '18145004791546571',
      commentId: '18999888777666554',
      commenterId: '9988776655',
      commenterUsername: 'test_follower_user',
      commentText: 'Awesome post! PROMPT',
      status: 'RECEIVED',
    },
  });

  console.log('Created test webhook event in DB:', event.id);

  const engine = new AutomationEngine();
  const result = await engine.processCommentEvent(event.id);

  console.log('Engine Processing Result:', JSON.stringify(result, null, 2));

  const run = await prisma.automationRun.findFirst({
    where: { webhookEventId: event.id },
  });
  console.log('Created Automation Run in DB:', JSON.stringify(run, null, 2));
}

main().finally(() => prisma.$disconnect());
