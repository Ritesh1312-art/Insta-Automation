import { NextRequest, NextResponse } from 'next/server';
import { MetaAuthService } from '@/services/meta/MetaAuthService';
import { createOAuthState, requireSessionUser } from '@/lib/auth';
import { metaRedirectUri } from '@/lib/app-url';
import { logAuthFailure } from '@/lib/auth-logging';

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const state = await createOAuthState(user.userId);
    return NextResponse.json({
      url: MetaAuthService.getOAuthUrl(state, metaRedirectUri(req.url)),
    });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'UNAUTHORIZED';
    if (!unauthorized) logAuthFailure('meta_oauth_start', error);
    return NextResponse.json(
      { error: unauthorized ? 'Unauthorized' : 'Unable to start Meta authorization' },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
