const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.automation.updateMany({
    data: {
      oneDeliveryPerUser: false,
      oneDeliveryPerComment: false,
      mediaId: null, // Allow automations to trigger on ALL posts & reels by default!
    },
  });
  console.log('Updated automations:', updated);
}

main().finally(() => prisma.$disconnect());
