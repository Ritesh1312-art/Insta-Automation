import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptToken } from '@/lib/encryption';

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
      mediaId: inputMediaId,
      customPostUrl,
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

    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({
        data: { email: 'admin@stuti.ritesh90.com', passwordHash: 'hash', name: 'Stuti Ritesh' },
      });
    }

    let connection = await prisma.metaConnection.findFirst({
      where: { connectionStatus: 'CONNECTED' },
    });

    if (!connection) {
      connection = await prisma.metaConnection.upsert({
        where: { instagramAccountId: '17841439216724676' },
        create: {
          userId: user.id,
          metaUserId: '1758819892233389',
          instagramAccountId: '17841439216724676',
          instagramUsername: 'stuti.ritesh90',
          accessTokenEncrypted: encryptToken('mock_access_token'),
          connectionStatus: 'CONNECTED',
        },
        update: {
          connectionStatus: 'CONNECTED',
        },
      });
    }

    let finalMediaId = inputMediaId;

    if (customPostUrl) {
      const uniqueMediaId = `custom_reel_${Date.now()}`;
      const newMedia = await prisma.media.create({
        data: {
          instagramAccountId: connection.instagramAccountId,
          instagramMediaId: uniqueMediaId,
          mediaType: 'REEL',
          caption: customPostUrl,
          permalink: customPostUrl,
          timestamp: new Date(),
        },
      });
      finalMediaId = newMedia.id;
    }

    const automation = await prisma.automation.create({
      data: {
        userId: user.id,
        instagramAccountId: connection.instagramAccountId,
        mediaId: finalMediaId || null,
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
    console.error('Automation creation error:', error);
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
