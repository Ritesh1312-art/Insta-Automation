const { PrismaClient } = require('@prisma/client');

if (process.env.ALLOW_DATABASE_RESET !== 'true') {
  throw new Error('Set ALLOW_DATABASE_RESET=true to run this destructive maintenance command.');
}

const prisma = new PrismaClient();

async function main() {
  const [runs, automations, media, events, contacts, connections, resources, users] = await prisma.$transaction([
    prisma.automationRun.deleteMany(), prisma.automation.deleteMany(), prisma.media.deleteMany(), prisma.webhookEvent.deleteMany(),
    prisma.contact.deleteMany(), prisma.metaConnection.deleteMany(), prisma.resource.deleteMany(), prisma.user.deleteMany(),
  ]);
  console.log({ runs: runs.count, automations: automations.count, media: media.count, events: events.count, contacts: contacts.count, connections: connections.count, resources: resources.count, users: users.count });
}

main().finally(() => prisma.$disconnect());
