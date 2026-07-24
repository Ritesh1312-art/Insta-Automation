import { AutomationEngine } from './src/services/automation/AutomationEngine';
import { prisma } from './src/lib/prisma';

async function main() {
  console.log('Testing AutomationEngine logic with simulated comment event...');
  const event = await prisma.webhookEvent.create({
    data: {
      eventType: 'comments',
      instagramAccountId: '17841439216724676',
      mediaId: '18145004791546571',
      commentId: '18999888777666554_' + Date.now(),
      commenterId: '9988776655',
      commenterUsername: 'test_follower_user',
      commentText: 'Awesome post! PROMPT',
      status: 'RECEIVED',
      rawPayload: {},
    },
  });

  console.log('Created test webhook event in DB:', event.id);

  const result = await AutomationEngine.processWebhookEvent(event.id);

  console.log('\nEngine Processing Result:', JSON.stringify(result, null, 2));

  const run = await prisma.automationRun.findFirst({
    where: { webhookEventId: event.id },
  });
  console.log('\nCreated Automation Run in DB:', JSON.stringify(run, null, 2));
}

main().finally(() => prisma.$disconnect());
