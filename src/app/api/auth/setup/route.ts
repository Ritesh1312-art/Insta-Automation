import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { advisoryLockKeys, withTransactionAdvisoryLock } from '@/lib/advisory-lock';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password-policy';
import { consumeRateLimit, requestFingerprint } from '@/lib/rate-limit';
import { logAuthFailure } from '@/lib/auth-logging';

export async function POST(request: NextRequest) {
  try {
    const { email, password, token } = await request.json();
    const allowed = await consumeRateLimit({
      action: 'RATE_LIMIT_ADMIN_SETUP',
      fingerprint: requestFingerprint(request, typeof email === 'string' ? email : ''),
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!allowed) return NextResponse.json({ error: 'Too many setup attempts' }, { status: 429, headers: { 'Retry-After': '3600' } });
    const setupToken = process.env.SETUP_TOKEN;
    const receivedToken = typeof token === 'string' ? Buffer.from(token) : null;
    const expectedToken = setupToken ? Buffer.from(setupToken) : null;
    if (!receivedToken || !expectedToken || receivedToken.length !== expectedToken.length || !timingSafeEqual(receivedToken, expectedToken)) {
      return NextResponse.json({ error: 'Invalid setup token' }, { status: 401 });
    }
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }
    if (!validatePassword(password)) {
      return NextResponse.json({ error: PASSWORD_POLICY_MESSAGE }, { status: 400 });
    }
    if (await prisma.user.count({ where: { role: 'ADMIN' } })) {
      return NextResponse.json({ error: 'Setup is already complete' }, { status: 409 });
    }
    // Hash before taking the lock so the critical section stays short.
    const passwordHash = await bcrypt.hash(password, 12);
    // Re-check and create under one lock so concurrent setup requests cannot
    // both observe zero administrators and create two.
    const created = await withTransactionAdvisoryLock(prisma, advisoryLockKeys.adminSetup(), async (tx) => {
      if (await tx.user.count({ where: { role: 'ADMIN' } })) return false;
      await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          passwordHash,
          role: 'ADMIN',
        },
      });
      return true;
    });
    if (!created) return NextResponse.json({ error: 'Setup is already complete' }, { status: 409 });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    logAuthFailure('admin_setup', error);
    return NextResponse.json({ error: 'Unable to create administrator' }, { status: 500 });
  }
}
