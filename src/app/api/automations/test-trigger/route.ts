import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';
import { consumeRateLimit, identityFingerprint } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/safe-error';

/**
 * Configuration validation only. No UI or documentation promises an actual
 * test Instagram comment/DM from this endpoint, so it deliberately sends
 * nothing: it checks that the user's active automations for a post are
 * configured correctly and reports blockers. Sending a fake comment or a real
 * DM would risk unintended messages to real Instagram users.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const allowed = await consumeRateLimit({
      action: 'RATE_LIMIT_AUTOMATION_TEST_TRIGGER',
      fingerprint: identityFingerprint('automation-test-trigger', user.userId),
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many validation requests. Try again in 10 minutes.' },
        { status: 429, headers: { 'Retry-After': '600' } },
      );
    }

    let mediaId: unknown;
    try {
      mediaId = (await req.json())?.mediaId;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof mediaId !== 'string') return NextResponse.json({ error: 'Select a post to validate' }, { status: 400 });
    const media = await prisma.media.findFirst({ where: { id: mediaId, metaConnection: { userId: user.userId, connectionStatus: 'CONNECTED' } } });
    if (!media) return NextResponse.json({ error: 'Selected post is unavailable for your connected account' }, { status: 404 });
    const automations = await prisma.automation.findMany({ where: { userId: user.userId, status: 'ACTIVE', OR: [{ mediaId }, { mediaId: null }] }, include: { resource: true } });
    type PreviewAutomation = {
      name: string;
      keywords: string[];
      triggerType: string;
      dmMessageTemplate: string;
      resource?: { url?: string | null; textContent?: string | null } | null;
    };
    const blockers = automations.flatMap((automation: PreviewAutomation) => [
      ...(automation.triggerType === 'KEYWORD' && automation.keywords.length === 0 ? [`${automation.name}: no keywords`] : []),
      ...(automation.dmMessageTemplate.includes('{{resource_url}}') && !automation.resource?.url && !automation.resource?.textContent ? [`${automation.name}: resource is missing`] : []),
    ]);
    return NextResponse.json({
      ready: automations.length > 0 && blockers.length === 0,
      automationCount: automations.length,
      blockers,
      validationOnly: true,
      message: 'Configuration validated only — no Instagram comment, DM, or other message was sent.',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    console.error('Automation test-trigger validation failed:', safeErrorMessage(error));
    return NextResponse.json({ error: 'Unable to validate configuration' }, { status: 500 });
  }
}
