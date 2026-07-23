import { NextRequest, NextResponse } from 'next/server';
import { MetaAuthService } from '@/services/meta/MetaAuthService';
import { createOAuthState, requireSessionUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    let appUrl = process.env.APP_URL;
    if (!appUrl || !appUrl.startsWith('https://')) {
      appUrl = new URL(req.url).origin;
    }
    const state = await createOAuthState(user.userId);
    return NextResponse.json({ url: MetaAuthService.getOAuthUrl(state, `${appUrl}/api/auth/meta/callback`) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message === 'UNAUTHORIZED' ? 'Unauthorized' : error.message }, { status: error.message === 'UNAUTHORIZED' ? 401 : 500 });
  }
}
