import { prisma } from '@/lib/prisma';
import { publicUpiConfig } from '@/lib/upi';

export async function resolveCheckoutUpi() {
  const envUpi = publicUpiConfig();
  let adminUpiId = '';
  let customQrUrl = '';
  let adminName = '';
  try {
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { adminUpiId: true, adminQrCodeUrl: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    adminUpiId = admin?.adminUpiId?.trim() || '';
    customQrUrl = admin?.adminQrCodeUrl?.trim() || '';
    adminName = admin?.name?.trim() || '';
  } catch {
    // Env-only fallback when the database is unavailable
  }

  return {
    upiId: adminUpiId || envUpi.upiId,
    payeeName: envUpi.payeeName || adminName || 'InstaDM Auto',
    note: envUpi.note,
    customQrUrl,
    source: adminUpiId ? 'admin' : envUpi.upiId ? 'env' : 'missing',
  };
}
