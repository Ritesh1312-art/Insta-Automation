const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.automation.updateMany({
    data: {
      ignoreOwnerComments: false,
      oneDeliveryPerUser: false,
      oneDeliveryPerComment: false,
    },
  });
  console.log('Updated automations to allow owner comments & repeat testing:', updated);
}

main().finally(() => prisma.$disconnect());
