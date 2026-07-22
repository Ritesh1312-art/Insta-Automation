const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.count();
  const connections = await prisma.metaConnection.count();
  const media = await prisma.media.count();
  const automations = await prisma.automation.count();
  const firstConnection = await prisma.metaConnection.findFirst();
  console.log(`DB Status: Users=${users}, Connections=${connections}, Media=${media}, Automations=${automations}`);
  if (firstConnection) {
    console.log(`First connection username: ${firstConnection.instagramUsername}, status: ${firstConnection.connectionStatus}`);
  }
}

main().finally(() => prisma.$disconnect());
