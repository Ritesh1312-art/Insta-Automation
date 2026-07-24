const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const connections = await prisma.metaConnection.findMany();
  console.log('CONNECTIONS_COUNT:', connections.length);
  console.log('CONNECTIONS_DATA:', JSON.stringify(connections, null, 2));
}

main().finally(() => prisma.$disconnect());
