import { AutomationEngine } from './src/services/automation/AutomationEngine';
import { prisma } from './src/lib/prisma';

async function main() {
  const event = await prisma.webhookEvent.create({
    data: {
      eventType: 'comments',
      instagramAccountId: '17841439216724676',
      mediaId: '18145004791546571',
      commentId: '18002681963774453_' + Date.now(),
      commenterId: '888399997216251',
      commenterUsername: 'real_follower_user',
      commentText: 'Awesome post! PROMPT',
      status: 'RECEIVED',
      rawPayload: {},
    },
  });

  console.log('Created fresh test event in DB:', event.id);

  const result = await AutomationEngine.processWebhookEvent(event.id);

  console.log('\n====================================');
  console.log('LIVE ENGINE PROCESSING RESULT:', JSON.stringify(result, null, 2));
  console.log('====================================\n');

  const run = await prisma.automationRun.findFirst({
    where: { webhookEventId: event.id },
  });
  console.log('AUTOMATION RUN RECORD IN POSTGRESQL:', JSON.stringify(run, null, 2));
}

main().finally(() => prisma.$disconnect());
