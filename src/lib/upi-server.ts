import { prisma } from '@/lib/prisma';
import { publicUpiConfig } from '@/lib/upi';
import { validateCustomQrUrl } from '@/lib/upi-qr';

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
    // Defense in depth: only serve a custom QR the CSP would actually allow,
    // even if the stored value predates save-time validation.
    const qrValidation = validateCustomQrUrl(admin?.adminQrCodeUrl?.trim() || '');
    customQrUrl = qrValidation.ok ? qrValidation.url : '';
    adminName = admin?.name?.trim() || '';
  } catch {
    // Env-only fallback when the database is unavailable
  }

  return {
    upiId: adminUpiId || envUpi.upiId,
    payeeName: envUpi.configuredPayeeName || adminName || 'InstaDM Auto',
    note: envUpi.note,
    customQrUrl,
    source: adminUpiId ? 'admin' : envUpi.upiId ? 'env' : 'missing',
  };
}
