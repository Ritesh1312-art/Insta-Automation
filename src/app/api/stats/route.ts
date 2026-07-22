import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';


export async function GET() {
  try {
    const totalAutomations = await prisma.automation.count();
    const activeAutomations = await prisma.automation.count({ where: { status: 'ACTIVE' } });
    const totalCommentsReceived = await prisma.webhookEvent.count();
    const totalRuns = await prisma.automationRun.count();
    const totalSuccess = await prisma.automationRun.count({ where: { status: 'API_ACCEPTED' } });
    const totalFailed = await prisma.automationRun.count({ where: { status: 'FAILED' } });
    const connection = await prisma.metaConnection.findFirst();

    const successRate = totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : 100;

    return NextResponse.json({
      totalAutomations,
      activeAutomations,
      totalCommentsReceived,
      totalRuns,
      totalSuccess,
      totalFailed,
      successRate,
      connectionStatus: connection?.connectionStatus || (process.env.META_API_MOCK === 'true' ? 'CONNECTED' : 'DISCONNECTED'),
      instagramUsername: connection?.instagramUsername || (process.env.META_API_MOCK === 'true' ? 'ritesh_tech_creator' : null),
    });
  } catch (error: any) {
    if (process.env.META_API_MOCK === 'true') {
      return NextResponse.json({
        totalAutomations: 3,
        activeAutomations: 3,
        totalCommentsReceived: 12,
        totalRuns: 10,
        totalSuccess: 10,
        totalFailed: 0,
        successRate: 100,
        connectionStatus: 'CONNECTED',
        instagramUsername: 'ritesh_tech_creator',
      });
    }
    return NextResponse.json({
      totalAutomations: 0,
      activeAutomations: 0,
      totalCommentsReceived: 0,
      totalRuns: 0,
      totalSuccess: 0,
      totalFailed: 0,
      successRate: 100,
      connectionStatus: 'DISCONNECTED',
      instagramUsername: null,
    });
  }
}

