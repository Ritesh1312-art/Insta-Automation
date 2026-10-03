import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password-policy';
import { consumeRateLimit, requestFingerprint } from '@/lib/rate-limit';
import { logAuthFailure } from '@/lib/auth-logging';

export async function POST(request: NextRequest) {
  try {
    const { email, password, token } = await request.json();
    const allowed = await consumeRateLimit({
      action: 'RATE_LIMIT_ADMIN_RESET',
      fingerprint: requestFingerprint(request, typeof email === 'string' ? email : ''),
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!allowed) return NextResponse.json({ error: 'Too many reset attempts' }, { status: 429, headers: { 'Retry-After': '3600' } });
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

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    await prisma.user.update({
      where: { email: normalizedEmail },
      data: { passwordHash: await bcrypt.hash(password, 12) },
    });
    return NextResponse.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    logAuthFailure('password_reset', error);
    return NextResponse.json({ error: 'Unable to reset password' }, { status: 500 });
  }
}
