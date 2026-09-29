import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  sessionVersion: number;
}

function authSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be configured with at least 32 characters');
  }
  return new TextEncoder().encode(value);
}

export async function signToken(payload: Omit<JWTPayload, 'sessionVersion'> & { sessionVersion?: number }): Promise<string> {
  return new SignJWT({ ...payload, sessionVersion: payload.sessionVersion ?? 0, purpose: 'session' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(authSecret());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, authSecret(), { algorithms: ['HS256'] });
    if (
      payload.purpose !== 'session' ||
      typeof payload.userId !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.role !== 'string'
    ) return null;

    return {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      sessionVersion: typeof payload.sessionVersion === 'number' ? payload.sessionVersion : 0,
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  return token ? verifyToken(token) : null;
}

/** Verifies both the JWT and its revocation version against the current user. */
export async function requireSessionUser(): Promise<JWTPayload> {
  const session = await getSessionUser();
  if (!session) throw new Error('UNAUTHORIZED');

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, role: true, sessionVersion: true },
  });
  if (!user || user.sessionVersion !== session.sessionVersion) throw new Error('UNAUTHORIZED');

  return {
    userId: session.userId,
    email: user.email,
    role: user.role,
    sessionVersion: user.sessionVersion,
  };
}

export async function createOAuthState(userId: string): Promise<string> {
  return new SignJWT({ userId, nonce: randomUUID(), purpose: 'meta-oauth' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(authSecret());
}

export async function verifyOAuthState(state: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, authSecret(), { algorithms: ['HS256'] });
    return payload.purpose === 'meta-oauth' && typeof payload.userId === 'string' ? payload.userId : null;
  } catch {
    return null;
  }
}
