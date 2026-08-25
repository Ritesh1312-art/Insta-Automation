import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PLANS } from '@/lib/plans';
import { publicUpiConfig } from '@/lib/upi';

export const dynamic = 'force-dynamic';

export async function GET() {
  const envUpi = publicUpiConfig();
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { adminUpiId: true, adminQrCodeUrl: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({
    plans: Object.values(PLANS),
    upiId: admin?.adminUpiId || envUpi.upiId || '',
    payeeName: envUpi.payeeName || admin?.name || 'InstaDM Auto',
    qrCodeUrl: admin?.adminQrCodeUrl || '',
  });
}
