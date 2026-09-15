import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { isAuthError, requireAdmin } from '@/lib/require-admin';

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
  } catch (error: any) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    return NextResponse.json({ success: false, error: error.message || 'Debug lookup failed' }, { status: 500 });
  }
}

/** Admin-only explicit webhook re-subscribe. Previously this side effect ran on an unauthenticated GET. */
export async function POST() {
  try {
    await requireAdmin();
    const connections = await prisma.metaConnection.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    const graphApiVersion = process.env.META_GRAPH_API_VERSION || 'v19.0';
    const subscriptionResults: any[] = [];

    for (const conn of connections) {
      if (!conn.facebookPageId) {
        subscriptionResults.push({ instagramUsername: conn.instagramUsername, success: false, error: 'No Facebook page linked to this connection' });
        continue;
      }
      try {
        const pageAccessToken = decryptToken(conn.accessTokenEncrypted);
        const subResponse = await fetch(
          `https://graph.facebook.com/${graphApiVersion}/${conn.facebookPageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed,mention`,
          { method: 'POST', headers: { Authorization: `Bearer ${pageAccessToken}` } }
        );
        const subData = await subResponse.json();
        subscriptionResults.push({ instagramUsername: conn.instagramUsername, success: subResponse.ok, response: subData });
      } catch (err: any) {
        subscriptionResults.push({ instagramUsername: conn.instagramUsername, success: false, error: err.message });
      }
    }

    return NextResponse.json({ success: true, subscriptionResults });
  } catch (error: any) {
    if (isAuthError(error, 'UNAUTHORIZED')) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (isAuthError(error, 'FORBIDDEN')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    return NextResponse.json({ success: false, error: error.message || 'Webhook re-subscribe failed' }, { status: 500 });
  }
}
