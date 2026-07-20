import { NextResponse } from 'next/server';
import { MetaAuthService } from '@/services/meta/MetaAuthService';

export async function GET() {
  const state = `state_${Date.now()}`;
  const url = MetaAuthService.getOAuthUrl(state);
  return NextResponse.json({ url });
}
