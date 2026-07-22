const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('1. Clearing database records...');
  await prisma.metaConnection.deleteMany({});
  await prisma.media.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('Database cleared!');

  console.log('2. Immediately fetching live Vercel stats API...');
  const res = await fetch('https://insta-automation-vert.vercel.app/api/stats');
  const data = await res.json();
  console.log('Live Vercel Response:', JSON.stringify(data, null, 2));

  // Check DB again to see if it was re-populated
  const count = await prisma.metaConnection.count();
  console.log(`DB Connection Count after fetch: ${count}`);
}

main().finally(() => prisma.$disconnect());
