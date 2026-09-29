import { requireSessionUser, type JWTPayload } from '@/lib/auth';

export async function requireAdmin(): Promise<JWTPayload> {
  const session = await requireSessionUser();
  if (session.role !== 'ADMIN') throw new Error('FORBIDDEN');
  return session;
}

export function isAuthError(error: unknown, code: 'UNAUTHORIZED' | 'FORBIDDEN') {
  return error instanceof Error && error.message === code;
}
