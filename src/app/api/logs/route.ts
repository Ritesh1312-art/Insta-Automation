import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const runs = await prisma.automationRun.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        automation: true,
        webhookEvent: true,
      },
    });

    const webhooks = await prisma.webhookEvent.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ runs, webhooks });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
