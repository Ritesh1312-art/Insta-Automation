import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { consumeRateLimit, rateLimitResponse, requestIp } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

    const rate = await consumeRateLimit({
      scope: 'login',
      identifier: `${requestIp(req)}:${email}`,
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Try again later.' },
        rateLimitResponse(rate),
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !valid) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

    const token = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionVersion: user.sessionVersion,
    });

    const response = NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    return response;
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('AUTH_SECRET')
      ? error.message
      : 'Login failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
