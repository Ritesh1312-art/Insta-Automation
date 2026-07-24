const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.automation.updateMany({
    data: {
      mediaId: null, // Allow automations to trigger on ALL posts & reels!
      status: 'ACTIVE',
      oneDeliveryPerUser: false,
      oneDeliveryPerComment: false,
      ignoreOwnerComments: false,
    },
  });
  console.log('Successfully set all automations to ALL POSTS & REELS:', updated);
}

main().finally(() => prisma.$disconnect());
