// Deep diagnostic: calls real FB API with live token to see exactly what pages returns
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check if we have any connections stored
  const conn = await prisma.metaConnection.findFirst();
  if (conn) {
    console.log('=== Stored Connection ===');
    console.log('Username:', conn.instagramUsername);
    console.log('Status:', conn.connectionStatus);
    console.log('ExpiresAt:', conn.expiresAt);
    return;
  }
  
  console.log('No connection stored in DB yet.');
  
  // Check audit logs for debug info
  const logs = await prisma.auditLog.findMany({
    where: { action: 'META_AUTH_CALLBACK_ERROR' },
    orderBy: { createdAt: 'desc' },
    take: 3
  });
  
  console.log('\n=== Latest Error Details ===');
  for (const log of logs) {
    console.log('Time:', log.createdAt);
    console.log('Error:', log.details?.errorMessage);
    console.log('---');
  }
}

main().finally(() => prisma.$disconnect());
