import { NextRequest, NextResponse } from 'next/server';
import { MetaAuthService } from '@/services/meta/MetaAuthService';
import { createOAuthState, requireSessionUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await requireSessionUser();
    const appUrl = process.env.APP_URL;
    if (!appUrl?.startsWith('https://')) throw new Error('APP_URL must be an HTTPS production URL');
    const state = await createOAuthState(user.userId);
    return NextResponse.json({ url: MetaAuthService.getOAuthUrl(state, `${appUrl}/api/auth/meta/callback`) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message === 'UNAUTHORIZED' ? 'Unauthorized' : error.message }, { status: error.message === 'UNAUTHORIZED' ? 401 : 500 });
  }
}
