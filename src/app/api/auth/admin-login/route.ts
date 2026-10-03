import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { logAuthFailure } from '@/lib/auth-logging';
import { DUMMY_PASSWORD_HASH, isBcryptPasswordHash } from '@/lib/password-auth';
import { consumeRateLimit, identityFingerprint, requestFingerprint } from '@/lib/rate-limit';

const ADMIN_SESSION_JWT_LIFETIME = '8h';
const ADMIN_CLIENT_LIMIT = 5;
const ADMIN_ACCOUNT_LIMIT = 10;
const ADMIN_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const INVALID_CREDENTIALS = { error: 'Invalid credentials' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedConfiguredIdentifier() {
  const configured = process.env.ADMIN_LOGIN_IDENTIFIER?.trim().toLowerCase();
  return configured && configured.length <= 254 && !/[\s\u0000-\u001f\u007f]/u.test(configured)
    ? configured
    : null;
}

export async function POST(req: NextRequest) {
  try {
    // The identifier is read only on the server and is never accepted from the
    // request body. Throttle both the originating client and the configured
    // account (the latter across clients) using the shared database limiter.
    const configuredIdentifier = normalizedConfiguredIdentifier();
    const [clientAllowed, accountAllowed] = await Promise.all([
      consumeRateLimit({
        action: 'RATE_LIMIT_ADMIN_LOGIN_CLIENT',
        fingerprint: requestFingerprint(req),
        limit: ADMIN_CLIENT_LIMIT,
        windowMs: ADMIN_LIMIT_WINDOW_MS,
      }),
      consumeRateLimit({
        action: 'RATE_LIMIT_ADMIN_LOGIN_ACCOUNT',
        fingerprint: identityFingerprint('admin-login-account', configuredIdentifier ?? 'configuration-missing'),
        limit: ADMIN_ACCOUNT_LIMIT,
        windowMs: ADMIN_LIMIT_WINDOW_MS,
      }),
    ]);
    if (!clientAllowed || !accountAllowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
        { status: 429, headers: { 'Retry-After': '900' } },
      );
    }

    const parsedBody: unknown = await req.json();
    const body = isRecord(parsedBody) ? parsedBody : {};
    const passwordInputIsValid = typeof body.password === 'string' && body.password.length > 0 && body.password.length <= 1024;
    const password = typeof body.password === 'string' && body.password.length <= 1024 ? body.password : '';
    const account = configuredIdentifier
      ? await prisma.user.findUnique({ where: { email: configuredIdentifier } })
      : null;
    const passwordHash = account?.role === 'ADMIN' && isBcryptPasswordHash(account.passwordHash)
      ? account.passwordHash
      : DUMMY_PASSWORD_HASH;
    // Missing configuration, absent accounts, wrong roles, and malformed
    // hashes still perform a cost-12 bcrypt comparison before returning 401.
    const passwordIsValid = await bcrypt.compare(password, passwordHash);

    if (
      !configuredIdentifier
      || !account
      || account.role !== 'ADMIN'
      || !isBcryptPasswordHash(account.passwordHash)
      || !passwordInputIsValid
      || !passwordIsValid
    ) {
      return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
    }

    const token = await signToken(
      {
        userId: account.id,
        email: account.email,
        role: account.role,
        sessionVersion: account.sessionVersion,
      },
      ADMIN_SESSION_JWT_LIFETIME,
    );
    const response = NextResponse.json({ success: true });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return response;
  } catch (error) {
    logAuthFailure('admin_login', error);
    return NextResponse.json({ error: 'Unable to sign in right now' }, { status: 500 });
  }
}
