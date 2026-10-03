import { NextResponse } from 'next/server';

/**
 * Authenticated, per-user API responses must never be stored by the browser
 * HTTP cache, a CDN, or a proxy; a stored copy is what makes a dashboard show
 * numbers from before the last change.
 */
export const PRIVATE_NO_STORE = 'private, no-store';

/** NextResponse.json with `Cache-Control: private, no-store` (always overrides any caller value). */
export function privateJson<T>(body: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', PRIVATE_NO_STORE);
  return NextResponse.json(body, { ...init, headers });
}
