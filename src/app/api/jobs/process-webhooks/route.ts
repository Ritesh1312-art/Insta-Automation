import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { AutomationEngine } from '@/services/automation/AutomationEngine';
import { prisma } from '@/lib/prisma';

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
  const now = Date.now();
  const [webhookRetention, auditRetention] = await Promise.all([
    prisma.webhookEvent.deleteMany({ where: { OR: [{ status: { in: ['PROCESSED', 'IGNORED'] }, createdAt: { lt: new Date(now - 30 * 86400000) } }, { status: 'FAILED', createdAt: { lt: new Date(now - 90 * 86400000) } }] } }),
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: new Date(now - 180 * 86400000) }, action: { in: ['RATE_LIMIT_LOGIN', 'RATE_LIMIT_PASSWORD_OTP', 'RATE_LIMIT_PASSWORD_VERIFY', 'PASSWORD_RESET_OTP', 'MESSAGING_PROCESSED', 'MESSAGING_FAILED', 'FOLLOW_GATE_VERIFIED'] } } }),
  ]);
  return NextResponse.json({ processed: results.length, quotasReset, webhookRetention: webhookRetention.count, auditRetention: auditRetention.count, results });
}
