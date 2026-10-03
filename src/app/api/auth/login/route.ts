import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth';
import { logAuthFailure } from '@/lib/auth-logging';
import { DUMMY_PASSWORD_HASH, isBcryptPasswordHash } from '@/lib/password-auth';
import { consumeRateLimit, requestFingerprint } from '@/lib/rate-limit';

const SESSION_JWT_LIFETIME = '12h';
const REMEMBER_ME_JWT_LIFETIME = '30d';
const REMEMBER_ME_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const INVALID_CREDENTIALS = { error: 'Invalid credentials' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || /[\s\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}

export async function POST(req: NextRequest) {
  try {
    const parsedBody: unknown = await req.json();
    const body = isRecord(parsedBody) ? parsedBody : {};
    // `email` remains accepted for older callers; both fields resolve against
    // the existing User.email lookup column, which also stores usernames.
    const identifier = normalizeIdentifier(body.identifier ?? body.email);
    const password = typeof body.password === 'string' && body.password.length <= 1024 ? body.password : '';
    const rememberMeFieldValid = body.rememberMe === undefined || typeof body.rememberMe === 'boolean';
    const rememberMe = body.rememberMe === true;

    const allowed = await consumeRateLimit({
      action: 'RATE_LIMIT_LOGIN',
      fingerprint: requestFingerprint(req, identifier ?? ''),
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
        { status: 429, headers: { 'Retry-After': '900' } },
      );
    }

    if (!rememberMeFieldValid) {
      return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
    }

    const user = identifier
      ? await prisma.user.findUnique({ where: { email: identifier } })
      : null;
    // Admin accounts sign in only through the dedicated, configured admin flow.
    const passwordHash = user?.role === 'USER' && isBcryptPasswordHash(user.passwordHash)
      ? user.passwordHash
      : DUMMY_PASSWORD_HASH;
    const passwordIsValid = await bcrypt.compare(password, passwordHash);

    if (
      !identifier
      || !password
      || !user
      || user.role !== 'USER'
      || !isBcryptPasswordHash(user.passwordHash)
      || !passwordIsValid
    ) {
      return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
    }

    const persistent = rememberMe;
    const token = await signToken(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionVersion: user.sessionVersion,
      },
      persistent ? REMEMBER_ME_JWT_LIFETIME : SESSION_JWT_LIFETIME,
    );

    const response = NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
    if (persistent) {
      response.cookies.set('auth_token', token, { ...cookieOptions, maxAge: REMEMBER_ME_LIFETIME_SECONDS });
    } else {
      // No Max-Age or Expires: the browser treats this as a session cookie.
      response.cookies.set('auth_token', token, cookieOptions);
    }

    return response;
  } catch (error) {
    logAuthFailure('login', error);
    return NextResponse.json({ error: 'Unable to sign in right now' }, { status: 500 });
  }
}
