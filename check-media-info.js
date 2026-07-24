const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const media = await prisma.media.findUnique({
    where: { id: 'aa9bb06f-ac45-4abe-b4c8-f74f726f2c87' },
  });
  console.log('MEDIA RECORD:', JSON.stringify(media, null, 2));

  const allMedia = await prisma.media.findMany({ take: 10 });
  console.log('ALL MEDIA IN DB (FIRST 10):', JSON.stringify(allMedia, null, 2));
}

main().finally(() => prisma.$disconnect());
