import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publicUpiConfig, isValidUpiId } from '@/lib/upi';
import { isAuthError, requireAdmin } from '@/lib/require-admin';

export async function GET() {
  try {
    const envUpi = publicUpiConfig();
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { adminUpiId: true, adminQrCodeUrl: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({
      adminUpiId: admin?.adminUpiId || envUpi.upiId || '',
      adminQrCodeUrl: admin?.adminQrCodeUrl || '',
      payeeName: envUpi.payeeName || admin?.name || 'InstaDM Auto',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch Admin UPI settings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { adminUpiId, adminQrCodeUrl } = await req.json();

    if (!adminUpiId || !isValidUpiId(String(adminUpiId))) {
      return NextResponse.json({ error: 'A valid Admin UPI ID is required' }, { status: 400 });
    }

    await prisma.user.updateMany({
      where: { role: 'ADMIN' },
      data: { adminUpiId: String(adminUpiId).trim(), adminQrCodeUrl: adminQrCodeUrl ? String(adminQrCodeUrl).trim() : '' },
    });

    return NextResponse.json({ success: true, message: 'Admin UPI settings saved successfully!' });
  } catch (error: any) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    return NextResponse.json({ error: error.message || 'Failed to save Admin UPI settings' }, { status: 500 });
  }
}
