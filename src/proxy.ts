import { NextRequest, NextResponse } from 'next/server';

const EXTERNAL_POST_PATHS = new Set([
  '/api/webhooks/meta',
  '/api/webhooks/telegram',
  '/api/meta/data-deletion',
]);

function csrfRejected(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api/')) return false;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return false;
  if (EXTERNAL_POST_PATHS.has(request.nextUrl.pathname)) return false;

  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return true;
  return request.headers.get('sec-fetch-site') === 'cross-site';
}

export function proxy(request: NextRequest) {
  if (csrfRejected(request)) {
    return NextResponse.json({ error: 'Cross-site request rejected' }, { status: 403 });
  }
  if (request.nextUrl.pathname.startsWith('/dashboard') && !request.cookies.get('auth_token')?.value) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*', '/api/:path*'] };
