const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const latestOtpLogs = await prisma.auditLog.findMany({
    where: { action: 'PASSWORD_RESET_OTP' },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  console.log('=== LATEST GENERATED PASSWORD RESET OTPs ===\n');
  if (latestOtpLogs.length === 0) {
    console.log('No OTP generated yet.');
  } else {
    latestOtpLogs.forEach(log => {
      console.log(`Email : ${log.details.email}`);
      console.log(`OTP   : ${log.details.otp}`);
      console.log(`Time  : ${log.createdAt}`);
      console.log('-----------------------------------');
    });
  }
}

main().finally(() => prisma.$disconnect());
