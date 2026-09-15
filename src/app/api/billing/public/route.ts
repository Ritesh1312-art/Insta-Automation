import { NextResponse } from 'next/server';
import { PLANS } from '@/lib/plans';
import { resolveCheckoutUpi } from '@/lib/upi-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checkout = await resolveCheckoutUpi();
  return NextResponse.json({
    plans: Object.values(PLANS),
    upiId: checkout.upiId,
    payeeName: checkout.payeeName,
    qrCodeUrl: checkout.customQrUrl,
    autoQr: Boolean(checkout.upiId) && !checkout.customQrUrl,
    source: checkout.source,
  });
}
