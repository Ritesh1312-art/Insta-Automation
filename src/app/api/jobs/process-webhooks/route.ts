import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { AutomationEngine } from '@/services/automation/AutomationEngine';

export const runtime = 'nodejs';
function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization');
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice(7)); const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { resetDueQuotas } = await import('@/lib/quota');
  const [results, quotasReset] = await Promise.all([AutomationEngine.processDueEvents(), resetDueQuotas()]);
  return NextResponse.json({ processed: results.length, quotasReset, results });
}
