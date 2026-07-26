const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== CHECKING POSTBACK / MESSAGING EVENTS IN DB ===\n');

  // Check all audit logs or webhook events for postback
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  console.log(`Found ${logs.length} audit logs:\n`);
  logs.forEach(l => {
    console.log(`Action : ${l.action}`);
    console.log(`Details: ${JSON.stringify(l.details)}`);
    console.log(`Time   : ${l.createdAt}`);
    console.log('-------------------------------------------');
  });
}

main().finally(() => prisma.$disconnect());
