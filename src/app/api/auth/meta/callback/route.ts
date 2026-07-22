import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { getSessionUser } from '@/lib/auth';
import { MetaAuthService } from '@/services/meta/MetaAuthService';
import { encryptToken } from '@/lib/encryption';
import { prisma } from '@/lib/prisma';
import { InstagramMediaService } from '@/services/meta/InstagramMediaService';

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionUser();
    let userId = session?.userId;

    if (!userId) {
      // Auto-fetch or create fallback default user for easy onboarding
      let defaultUser = await prisma.user.findFirst();
      if (!defaultUser) {
        defaultUser = await prisma.user.create({
          data: {
            email: 'creator@example.com',
            passwordHash: 'seeded',
            name: 'Instagram Creator',
          },
        });
      }
      userId = defaultUser.id;
    }

    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code') || 'mock_code';

    // Dynamically compute the redirect URI based on the request's hostname
    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = req.headers.get('x-forwarded-proto') || 'http';
    const origin = `${protocol}://${host}`;
    const dynamicRedirectUri = `${origin}/api/auth/meta/callback`;

    // 1. Exchange code for Meta token & account details
    const connectedAccount = await MetaAuthService.handleOAuthCallback(code, dynamicRedirectUri);

    const encryptedToken = encryptToken(connectedAccount.accessToken);
    const expiresAt = connectedAccount.expiresInSeconds
      ? new Date(Date.now() + connectedAccount.expiresInSeconds * 1000)
      : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    // 2. Save or update MetaConnection in DB
    const connection = await prisma.metaConnection.upsert({
      where: { instagramAccountId: connectedAccount.instagramAccountId },
      create: {
        userId,
        metaUserId: connectedAccount.instagramAccountId,
        instagramAccountId: connectedAccount.instagramAccountId,
        facebookPageId: connectedAccount.facebookPageId,
        instagramUsername: connectedAccount.instagramUsername,
        profilePictureUrl: connectedAccount.profilePictureUrl,
        accessTokenEncrypted: encryptedToken,
        scopes: ['instagram_basic', 'instagram_manage_comments', 'instagram_manage_messages'],
        expiresAt,
        connectionStatus: 'CONNECTED',
      },
      update: {
        accessTokenEncrypted: encryptedToken,
        connectionStatus: 'CONNECTED',
        expiresAt,
        profilePictureUrl: connectedAccount.profilePictureUrl,
      },
    });

    // 3. Cache media items
    const mediaItems = await InstagramMediaService.fetchAccountMedia(
      connectedAccount.instagramAccountId,
      connectedAccount.accessToken
    );

    for (const m of mediaItems) {
      await prisma.media.upsert({
        where: { instagramMediaId: m.instagramMediaId },
        create: {
          instagramAccountId: connectedAccount.instagramAccountId,
          instagramMediaId: m.instagramMediaId,
          mediaType: m.mediaType,
          caption: m.caption,
          permalink: m.permalink,
          mediaUrl: m.mediaUrl,
          thumbnailUrl: m.thumbnailUrl,
          timestamp: m.timestamp,
        },
        update: {
          caption: m.caption,
          thumbnailUrl: m.thumbnailUrl,
        },
      });
    }

    // 4. Seed demo resources and post-specific automations (Reels A, B, C) if none exist
    const existingResources = await prisma.resource.findMany({ where: { userId } });
    if (existingResources.length === 0) {
      const resA = await prisma.resource.create({
        data: {
          userId,
          name: 'Hanuman Chalisa PDF',
          type: 'URL',
          url: 'https://example.com/downloads/hanuman-chalisa.pdf',
        },
      });

      const resB = await prisma.resource.create({
        data: {
          userId,
          name: 'AI Prompt Pack',
          type: 'URL',
          url: 'https://example.com/downloads/ai-prompt-pack.zip',
        },
      });

      const resC = await prisma.resource.create({
        data: {
          userId,
          name: 'Editing Presets',
          type: 'URL',
          url: 'https://example.com/downloads/editing-presets.zip',
        },
      });

      // Find cached media records
      const dbMedia = await prisma.media.findMany({
        where: { instagramAccountId: connectedAccount.instagramAccountId },
      });

      const mediaA = dbMedia.find((m) => m.caption?.includes('Hanuman'));
      const mediaB = dbMedia.find((m) => m.caption?.includes('Prompt'));
      const mediaC = dbMedia.find((m) => m.caption?.includes('Presets'));

      if (mediaA) {
        await prisma.automation.create({
          data: {
            userId,
            instagramAccountId: connectedAccount.instagramAccountId,
            mediaId: mediaA.id,
            resourceId: resA.id,
            name: 'Reel A - Hanuman Chalisa Automation',
            status: 'ACTIVE',
            triggerType: 'KEYWORD',
            matchingMode: 'EXACT',
            keywords: ['HANUMAN'],
            dmMessageTemplate: 'Here is your Hanuman Chalisa PDF: {{resource_url}}',
            publicReplyEnabled: true,
            publicReplyTemplates: ['Sent! Check your DMs 📩', 'Sent 🙏 Check inbox!'],
          },
        });
      }

      if (mediaB) {
        await prisma.automation.create({
          data: {
            userId,
            instagramAccountId: connectedAccount.instagramAccountId,
            mediaId: mediaB.id,
            resourceId: resB.id,
            name: 'Reel B - AI Prompt Pack Automation',
            status: 'ACTIVE',
            triggerType: 'KEYWORD',
            matchingMode: 'EXACT',
            keywords: ['PROMPT'],
            dmMessageTemplate: 'Here is your AI Prompt Pack: {{resource_url}}',
            publicReplyEnabled: true,
            publicReplyTemplates: ['Prompt pack sent! 🚀 Check DMs.'],
          },
        });
      }

      if (mediaC) {
        await prisma.automation.create({
          data: {
            userId,
            instagramAccountId: connectedAccount.instagramAccountId,
            mediaId: mediaC.id,
            resourceId: resC.id,
            name: 'Reel C - Presets Automation',
            status: 'ACTIVE',
            triggerType: 'ANY_COMMENT',
            matchingMode: 'EXACT',
            keywords: [],
            dmMessageTemplate: 'Download the editing presets here: {{resource_url}}',
            publicReplyEnabled: false,
            publicReplyTemplates: [],
          },
        });
      }
    }

    return NextResponse.redirect(`${origin}/dashboard?connected=true`);
  } catch (error: any) {
    console.error('Error handling Meta OAuth Callback:', error);
    try {
      let userId: string | undefined = undefined;
      try {
        const user = await prisma.user.findFirst();
        userId = user?.id;
      } catch (dbUserError) {
        console.error('Failed to query user for error logging:', dbUserError);
      }

      await prisma.auditLog.create({
        data: {
          userId: userId,
          action: 'META_AUTH_CALLBACK_ERROR',
          details: {
            errorMessage: error?.message || String(error),
            stack: error?.stack,
          },
        },
      });
    } catch (logDbError) {
      console.error('Failed to log auth error to DB:', logDbError);
    }

    try {
      const errMsg = error?.message || 'unknown_error';
      return NextResponse.redirect(
        new URL(`/dashboard?error=${encodeURIComponent(errMsg)}`, req.url)
      );
    } catch (redirectError) {
      console.error('Failed to redirect on error:', redirectError);
      return NextResponse.json(
        { error: error?.message || 'Authentication failed' },
        { status: 500 }
      );
    }
  }
}
