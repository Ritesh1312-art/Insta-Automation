import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';

const ISSUER = 'instadm-auto';
const SESSION_AUDIENCE = 'instadm-session';
const OAUTH_AUDIENCE = 'meta-oauth';

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  sessionVersion?: number;
}

function authKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be configured with at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

function isSessionPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & JWTPayload {
  return typeof payload.userId === 'string'
    && payload.userId.length > 0
    && typeof payload.email === 'string'
    && payload.email.length > 0
    && typeof payload.role === 'string'
    && payload.role.length > 0
    && (payload.sessionVersion === undefined || (typeof payload.sessionVersion === 'number' && Number.isInteger(payload.sessionVersion) && payload.sessionVersion >= 0));
}

export async function signToken(payload: JWTPayload, expiresIn = '7d'): Promise<string> {
  return new SignJWT({ ...payload, purpose: 'session' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(expiresIn)
    .sign(authKey());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, authKey(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: SESSION_AUDIENCE,
    });
    if (payload.purpose !== 'session' || !isSessionPayload(payload)) return null;
    return { userId: payload.userId, email: payload.email, role: payload.role, sessionVersion: typeof payload.sessionVersion === 'number' ? payload.sessionVersion : 0 };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  return token ? verifyToken(token) : null;
}

export async function requireSessionUser(): Promise<JWTPayload> {
  const user = await getSessionUser();
  if (!user) throw new Error('UNAUTHORIZED');
  const current = await prisma.user.findUnique({ where: { id: user.userId }, select: { email: true, role: true, sessionVersion: true } });
  if (!current || (current.sessionVersion !== (user.sessionVersion ?? 0))) throw new Error('UNAUTHORIZED');
  return { ...user, email: current.email, role: current.role, sessionVersion: current.sessionVersion };
}

export async function createOAuthState(userId: string): Promise<string> {
  return new SignJWT({ userId, nonce: randomUUID(), purpose: 'meta-oauth' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(OAUTH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(authKey());
}

export async function verifyOAuthState(state: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, authKey(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: OAUTH_AUDIENCE,
    });
    return payload.purpose === 'meta-oauth' && typeof payload.userId === 'string'
      ? payload.userId
      : null;
  } catch {
    return null;
  }
}
