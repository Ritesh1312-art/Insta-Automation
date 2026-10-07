import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { isAuthError, requireAdmin } from '@/lib/require-admin';
import { logAuthFailure } from '@/lib/auth-logging';
import { MetaAuthService, META_INSTAGRAM_WEBHOOK_FIELDS, META_PAGE_WEBHOOK_FIELDS } from '@/services/meta/MetaAuthService';
import { webhookStatusFromAttempts, type WebhookStatus } from '@/lib/meta-webhook-status';

export const dynamic = 'force-dynamic';

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '***';
  const visible = name.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

/** Admin-only, read-only diagnostics. Never exposes raw tokens or full emails. */
export async function GET() {
  try {
    await requireAdmin();

    const [logs, connections, users, webhookEvents, automationRuns] = await Promise.all([
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
      prisma.metaConnection.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          userId: true,
          instagramAccountId: true,
          facebookPageId: true,
          instagramUsername: true,
          connectionStatus: true,
          webhookStatus: true,
          expiresAt: true,
          scopes: true,
          createdAt: true,
        },
      }),
      prisma.user.findMany({ select: { id: true, email: true, role: true } }),
      prisma.webhookEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.automationRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { automation: { select: { name: true } } },
      }),
    ]);

    return NextResponse.json({
      success: true,
      logs,
      connections,
      users: users.map((user: { id: string; email: string; role: string }) => ({
        id: user.id,
        email: maskEmail(user.email),
        role: user.role,
      })),
      webhookEvents,
      automationRuns,
      env: {
        APP_URL: process.env.APP_URL || 'Not Set',
        META_APP_ID: process.env.META_APP_ID ? 'Configured' : 'Missing',
        META_APP_SECRET: process.env.META_APP_SECRET ? 'Configured' : 'Missing',
        META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION || 'Not Set',
        SETUP_TOKEN: process.env.SETUP_TOKEN ? 'Configured' : 'Missing',
        META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN ? 'Configured' : 'Missing',
      },
    });
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    logAuthFailure('admin_meta_debug', error);
    return NextResponse.json({ success: false, error: 'Unable to load Meta diagnostics' }, { status: 500 });
  }
}

/**
 * Records the outcome of a subscribe attempt on the connection itself, so the
 * dashboard keeps showing "webhook setup incomplete" after this request ends
 * instead of silently reverting to a healthy-looking state.
 */
async function persistWebhookStatus(connectionId: string, status: WebhookStatus) {
  await prisma.metaConnection.update({ where: { id: connectionId }, data: { webhookStatus: status } });
}

/** Admin-only explicit webhook re-subscribe. Previously this side effect ran on an unauthenticated GET. */
export async function POST() {
  try {
    await requireAdmin();
    const connections = await prisma.metaConnection.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    const graphApiVersion = process.env.META_GRAPH_API_VERSION || 'v26.0';
    const subscriptionResults: Array<Record<string, unknown>> = [];

    for (const conn of connections) {
      if (!conn.facebookPageId) {
        // Nothing can be subscribed without a Page, so the connection must not
        // keep claiming webhooks are in place.
        let persisted = true;
        await persistWebhookStatus(conn.id, 'FAILED').catch(() => { persisted = false; });
        subscriptionResults.push({
          instagramUsername: conn.instagramUsername,
          success: false,
          status: 'FAILED',
          pageSubscribed: false,
          instagramSubscribed: false,
          persisted,
          error: 'No Facebook page linked to this connection',
        });
        continue;
      }

      let pageSubscribed = false;
      let instagramSubscribed = false;
      let status: WebhookStatus = 'FAILED';
      let persisted = false;
      try {
        const pageAccessToken = conn.accessTokenEncrypted ? decryptToken(conn.accessTokenEncrypted) : '';
        const attempts = await Promise.allSettled([
          MetaAuthService.subscribeObject(conn.facebookPageId, META_PAGE_WEBHOOK_FIELDS, pageAccessToken, graphApiVersion),
          MetaAuthService.subscribeObject(conn.instagramAccountId, META_INSTAGRAM_WEBHOOK_FIELDS, pageAccessToken, graphApiVersion),
        ]);
        pageSubscribed = attempts[0].status === 'fulfilled';
        instagramSubscribed = attempts[1].status === 'fulfilled';
        status = webhookStatusFromAttempts([pageSubscribed, instagramSubscribed]);
        await persistWebhookStatus(conn.id, status);
        persisted = true;
      } catch {
        // Graph/decrypt errors are never surfaced: they can echo request
        // parameters. The stored status still reflects "webhooks not in place".
        await persistWebhookStatus(conn.id, 'FAILED').catch(() => undefined);
      }

      const errors = status === 'SUBSCRIBED' && persisted
        ? []
        : (!pageSubscribed || !instagramSubscribed ? ['Subscription failed'] : ['Unable to persist webhook status']);
      subscriptionResults.push({
        instagramUsername: conn.instagramUsername,
        success: status === 'SUBSCRIBED' && persisted,
        status: persisted ? status : 'FAILED',
        pageSubscribed,
        instagramSubscribed,
        persisted,
        errors,
      });
    }

    const summary = {
      total: subscriptionResults.length,
      subscribed: subscriptionResults.filter((result) => result.status === 'SUBSCRIBED').length,
      partial: subscriptionResults.filter((result) => result.status === 'PARTIAL').length,
      failed: subscriptionResults.filter((result) => result.status === 'FAILED').length,
    };

    return NextResponse.json({
      success: true,
      subscribedFields: {
        page: [...META_PAGE_WEBHOOK_FIELDS],
        instagram: [...META_INSTAGRAM_WEBHOOK_FIELDS],
      },
      summary,
      subscriptionResults,
    });
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    logAuthFailure('admin_meta_debug', error);
    return NextResponse.json({ success: false, error: 'Unable to re-subscribe Meta webhooks' }, { status: 500 });
  }
}
