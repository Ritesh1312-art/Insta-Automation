import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const admin = await prisma.user.findFirst({
      where: { OR: [{ role: 'ADMIN' }, { email: 'ritesh.gupta131290@gmail.com' }] },
      select: { adminUpiId: true, adminQrCodeUrl: true }
    });

    return NextResponse.json({
      adminUpiId: admin?.adminUpiId || '7500002329@ybl',
      adminQrCodeUrl: admin?.adminQrCodeUrl || '',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch Admin UPI settings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { adminUpiId, adminQrCodeUrl } = await req.json();

    if (!adminUpiId) {
      return NextResponse.json({ error: 'Admin UPI ID is required' }, { status: 400 });
    }

    await prisma.user.updateMany({
      where: { OR: [{ role: 'ADMIN' }, { email: 'ritesh.gupta131290@gmail.com' }] },
      data: { adminUpiId, adminQrCodeUrl: adminQrCodeUrl || '' },
    });

    return NextResponse.json({ success: true, message: 'Admin UPI settings saved successfully!' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to save Admin UPI settings' }, { status: 500 });
  }
}
