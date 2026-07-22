const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Clearing database records to remove mock connection and media...');
  
  // Delete all records to start completely fresh
  const deletedRuns = await prisma.automationRun.deleteMany({});
  console.log(`Deleted ${deletedRuns.count} automation runs.`);

  const deletedAutomations = await prisma.automation.deleteMany({});
  console.log(`Deleted ${deletedAutomations.count} automations.`);

  const deletedMedia = await prisma.media.deleteMany({});
  console.log(`Deleted ${deletedMedia.count} media items.`);

  const deletedWebhookEvents = await prisma.webhookEvent.deleteMany({});
  console.log(`Deleted ${deletedWebhookEvents.count} webhook events.`);

  const deletedContacts = await prisma.contact.deleteMany({});
  console.log(`Deleted ${deletedContacts.count} contacts.`);

  const deletedConnections = await prisma.metaConnection.deleteMany({});
  console.log(`Deleted ${deletedConnections.count} Meta connections.`);

  const deletedResources = await prisma.resource.deleteMany({});
  console.log(`Deleted ${deletedResources.count} resources.`);

  const deletedUsers = await prisma.user.deleteMany({});
  console.log(`Deleted ${deletedUsers.count} users.`);

  console.log('Database cleared successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
