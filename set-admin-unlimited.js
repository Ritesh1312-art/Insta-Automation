const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== SETTING RITESH GUPTA AS ADMIN WITH UNLIMITED VIP ACCESS ===\n');

  const user = await prisma.user.upsert({
    where: { email: 'ritesh.gupta131290@gmail.com' },
    create: {
      email: 'ritesh.gupta131290@gmail.com',
      passwordHash: 'placeholder',
      name: 'Ritesh Gupta (Owner & Admin)',
      role: 'ADMIN',
      plan: 'VIP_UNLIMITED',
      monthlyDmQuota: 999999,
      dmsUsedThisMonth: 0,
      subscriptionStatus: 'ACTIVE',
    },
    update: {
      role: 'ADMIN',
      plan: 'VIP_UNLIMITED',
      monthlyDmQuota: 999999,
      subscriptionStatus: 'ACTIVE',
    },
  });

  console.log(`✅ Admin Account Updated:`);
  console.log(`   Email : ${user.email}`);
  console.log(`   Role  : ${user.role}`);
  console.log(`   Plan  : ${user.plan} (UNLIMITED ACCESS)`);
  console.log(`   Quota : ${user.monthlyDmQuota} DMs/month`);
}

main().finally(() => prisma.$disconnect());
