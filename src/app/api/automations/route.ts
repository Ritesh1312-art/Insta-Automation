import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const automations = await prisma.automation.findMany({
      include: {
        media: true,
        resource: true,
        metaConnection: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ automations });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      mediaId,
      resourceId,
      name,
      triggerType,
      matchingMode,
      keywords,
      dmMessageTemplate,
      publicReplyEnabled,
      publicReplyTemplates,
      status,
    } = body;

    const connection = await prisma.metaConnection.findFirst({
      where: { connectionStatus: 'CONNECTED' },
    });

    if (!connection) {
      return NextResponse.json(
        { error: 'No Instagram Professional Account connected. Please connect Instagram first.' },
        { status: 400 }
      );
    }

    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({
        data: { email: 'admin@example.com', passwordHash: 'hash', name: 'Creator' },
      });
    }

    const automation = await prisma.automation.create({
      data: {
        userId: user.id,
        instagramAccountId: connection.instagramAccountId,
        mediaId: mediaId || null,
        resourceId: resourceId || null,
        name: name || 'New Reel Automation',
        status: status || 'ACTIVE',
        triggerType: triggerType || 'KEYWORD',
        matchingMode: matchingMode || 'EXACT',
        keywords: keywords || [],
        dmMessageTemplate: dmMessageTemplate || 'Here is your requested content: {{resource_url}}',
        publicReplyEnabled: Boolean(publicReplyEnabled),
        publicReplyTemplates: publicReplyTemplates || [],
      },
    });

    return NextResponse.json({ automation }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    const updated = await prisma.automation.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ automation: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
