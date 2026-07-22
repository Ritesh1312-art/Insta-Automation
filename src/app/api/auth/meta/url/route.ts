import { NextRequest, NextResponse } from 'next/server';
import { MetaAuthService } from '@/services/meta/MetaAuthService';

export async function GET(req: NextRequest) {
  const state = `state_${Date.now()}`;
  
  // Dynamically compute the redirect URI based on the request's hostname
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = req.headers.get('x-forwarded-proto') || 'http';
  const origin = `${protocol}://${host}`;
  const dynamicRedirectUri = `${origin}/api/auth/meta/callback`;

  const url = MetaAuthService.getOAuthUrl(state, dynamicRedirectUri);
  return NextResponse.json({ url });
}
