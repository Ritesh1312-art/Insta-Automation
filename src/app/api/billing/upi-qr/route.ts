import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getPlan, normalizePlanId } from '@/lib/plans';
import { buildUpiUri } from '@/lib/upi';
import { resolveCheckoutUpi } from '@/lib/upi-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const planId = normalizePlanId(req.nextUrl.searchParams.get('plan')) || 'PREMIUM';
  const plan = getPlan(planId === 'FREE' ? 'PREMIUM' : planId);
  const checkout = await resolveCheckoutUpi();
  if (!checkout.upiId) {
    return NextResponse.json({ error: 'Set UPI_ID (or save an admin UPI ID) to auto-generate the QR' }, { status: 404 });
  }

  const uri = buildUpiUri({
    upiId: checkout.upiId,
    payeeName: checkout.payeeName,
    amount: plan.priceInr,
    note: `InstaDM ${plan.name}`,
  });

  const png = await QRCode.toBuffer(uri, {
    type: 'png',
    width: 480,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  return new NextResponse(png, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}
