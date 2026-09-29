import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password-policy';
import { consumeRateLimit, requestFingerprint } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const rate = await consumeRateLimit({ scope: 'initial-admin-setup', identifier: requestIp(request), limit: 10, windowMs: 60 * 60 * 1000 });
    if (!rate.allowed) return NextResponse.json({ error: 'Too many setup attempts. Try again later.' }, rateLimitResponse(rate));
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
    await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash: await bcrypt.hash(password, 12),
        role: 'ADMIN',
      },
    });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to create administrator' }, { status: 500 });
  }
}
