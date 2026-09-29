import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const ISSUER = 'instadm-auto';
const SESSION_AUDIENCE = 'instadm-session';
const OAUTH_AUDIENCE = 'meta-oauth';

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  sessionVersion: number;
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
    && payload.role.length > 0;
}

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload, purpose: 'session' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime('7d')
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
    return { userId: payload.userId, email: payload.email, role: payload.role };
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
