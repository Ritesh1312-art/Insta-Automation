import { NextRequest, NextResponse } from 'next/server';

const EXTERNAL_POST_PATHS = new Set([
  '/api/webhooks/meta',
  '/api/webhooks/telegram',
  '/api/meta/data-deletion',
]);

/**
 * The origin the browser actually addressed. `nextUrl.origin` is built from the
 * bind address (or the platform's internal URL), which is `http://0.0.0.0:3000`
 * behind a proxy — comparing the `Origin` header against it rejects every
 * legitimate cross-proxied request. The Host header (or the forwarded one) is
 * what the client used, so that is what has to be matched.
 */
function expectedOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host')?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (host) {
    const protocol = forwardedProto || request.nextUrl.protocol.replace(':', '');
    return `${protocol}://${host}`;
  }
  return request.nextUrl.origin;
}

function csrfRejected(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api/')) return false;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return false;
  if (EXTERNAL_POST_PATHS.has(request.nextUrl.pathname)) return false;

  const origin = request.headers.get('origin');
  if (origin && origin !== expectedOrigin(request)) return true;
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
