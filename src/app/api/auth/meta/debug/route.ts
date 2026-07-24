import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
    });
    
    const connections = await prisma.metaConnection.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true }
    });

    const webhookEvents = await prisma.webhookEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const automationRuns = await prisma.automationRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { automation: { select: { name: true } } }
    });

    // Auto-subscribe existing connections to make webhooks live immediately
    const subscriptionResults: any[] = [];
    const graphApiVersion = process.env.META_GRAPH_API_VERSION || 'v19.0';
    for (const conn of connections) {
      try {
        const pageAccessToken = decryptToken(conn.accessTokenEncrypted);
        const subResponse = await fetch(
          `https://graph.facebook.com/${graphApiVersion}/${conn.facebookPageId}/subscribed_apps`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${pageAccessToken}` },
          }
        );
        const subData = await subResponse.json();
        subscriptionResults.push({
          instagramUsername: conn.instagramUsername,
          success: subResponse.ok,
          response: subData,
        });
      } catch (err: any) {
        subscriptionResults.push({
          instagramUsername: conn.instagramUsername,
          success: false,
          error: err.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      logs,
      connections,
      users,
      webhookEvents,
      automationRuns,
      subscriptionResults,
      env: {
        APP_URL: process.env.APP_URL || 'Not Set',
        META_APP_ID: process.env.META_APP_ID ? 'Configured' : 'Missing',
        META_APP_SECRET: process.env.META_APP_SECRET ? 'Configured' : 'Missing',
        META_FACEBOOK_PAGE_ID: process.env.META_FACEBOOK_PAGE_ID || 'Not Set',
        META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION || 'Not Set',
        SETUP_TOKEN: process.env.SETUP_TOKEN || 'Not Set',
        META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN ? 'Configured' : 'Missing',
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
