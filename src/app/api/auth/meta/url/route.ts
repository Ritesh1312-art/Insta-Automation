import { NextRequest, NextResponse } from 'next/server';
import { MetaAuthService } from '@/services/meta/MetaAuthService';
import { createOAuthState, requireSessionUser } from '@/lib/auth';
import { metaRedirectUri } from '@/lib/app-url';

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const state = await createOAuthState(user.userId);
    return NextResponse.json({
      url: MetaAuthService.getOAuthUrl(state, metaRedirectUri(req.url)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start Meta authorization';
    const unauthorized = message === 'UNAUTHORIZED';
    return NextResponse.json(
      { error: unauthorized ? 'Unauthorized' : message },
      { status: unauthorized ? 401 : 500 },
    );
  }
}
