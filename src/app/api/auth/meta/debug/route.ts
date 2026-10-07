import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { isAuthError, requireAdmin } from '@/lib/require-admin';
import { logAuthFailure } from '@/lib/auth-logging';
import {
  MetaAuthService,
  META_INSTAGRAM_WEBHOOK_FIELDS,
  META_PAGE_WEBHOOK_FIELDS,
  isMetaAuthFailure,
} from '@/services/meta/MetaAuthService';

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

/** Admin-only explicit webhook re-subscribe. Previously this side effect ran on an unauthenticated GET. */
export async function POST() {
  try {
    await requireAdmin();
    const connections = await prisma.metaConnection.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    const graphApiVersion = process.env.META_GRAPH_API_VERSION || 'v26.0';
    const subscriptionResults: any[] = [];

    for (const conn of connections) {
      if (!conn.facebookPageId) {
        subscriptionResults.push({ instagramUsername: conn.instagramUsername, success: false, error: 'No Facebook page linked to this connection' });
        continue;
      }
      try {
        const pageAccessToken = conn.accessTokenEncrypted ? decryptToken(conn.accessTokenEncrypted) : '';
        const attempts = await Promise.allSettled([
          MetaAuthService.subscribeObject(conn.facebookPageId, META_PAGE_WEBHOOK_FIELDS, pageAccessToken, graphApiVersion),
          MetaAuthService.subscribeObject(conn.instagramAccountId, META_INSTAGRAM_WEBHOOK_FIELDS, pageAccessToken, graphApiVersion),
        ]);
        // A rejected token is reported as such: the connection is marked
        // TOKEN_EXPIRED so the dashboard asks for a fresh OAuth run instead of
        // retrying a dead token forever. Anything else stays a plain failure.
        const failedAttempts = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        const requiresReauthorization = failedAttempts.some((result) => isMetaAuthFailure(result.reason));
        const errors = failedAttempts.map(() => 'Subscription failed');
        if (requiresReauthorization) {
          await prisma.metaConnection.update({
            where: { id: conn.id },
            data: { connectionStatus: 'TOKEN_EXPIRED' },
          }).catch(() => undefined);
          await prisma.auditLog.create({
            data: {
              userId: conn.userId,
              action: 'META_TOKEN_INVALIDATED',
              details: { instagramUsername: conn.instagramUsername, reason: 'webhook_resubscribe_failed' },
            },
          }).catch(() => undefined);
        }
        subscriptionResults.push({
          instagramUsername: conn.instagramUsername,
          success: errors.length === 0,
          pageSubscribed: attempts[0].status === 'fulfilled',
          instagramSubscribed: attempts[1].status === 'fulfilled',
          requiresReauthorization,
          connectionStatus: requiresReauthorization ? 'TOKEN_EXPIRED' : conn.connectionStatus,
          errors,
        });
      } catch {
        subscriptionResults.push({
          instagramUsername: conn.instagramUsername,
          success: false,
          error: 'Subscription failed',
        });
      }
    }

    return NextResponse.json({
      success: true,
      subscribedFields: {
        page: [...META_PAGE_WEBHOOK_FIELDS],
        instagram: [...META_INSTAGRAM_WEBHOOK_FIELDS],
      },
      subscriptionResults,
    });
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    logAuthFailure('admin_meta_debug', error);
    return NextResponse.json({ success: false, error: 'Unable to re-subscribe Meta webhooks' }, { status: 500 });
  }
}
