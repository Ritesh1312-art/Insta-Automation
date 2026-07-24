const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== CONNECTIONS ===');
  const connections = await prisma.metaConnection.findMany();
  console.log(JSON.stringify(connections, null, 2));

  console.log('\n=== AUDIT LOGS (LAST 5) ===');
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log(JSON.stringify(logs, null, 2));
}

main().finally(() => prisma.$disconnect());
