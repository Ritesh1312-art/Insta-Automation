import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { PLANS } from '@/lib/plans';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password-policy';
import { sendWelcomeEmail } from '@/lib/mailer';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }
    if (!validatePassword(password)) {
      return NextResponse.json({ error: PASSWORD_POLICY_MESSAGE }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });

    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'USER',
        plan: 'FREE',
        monthlyDmQuota: PLANS.FREE.dmQuota,
        subscriptionStatus: 'ACTIVE',
        quotaResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    await sendWelcomeEmail(user.email, user.name);
    const token = await signToken({ userId: user.id, email: user.email, role: user.role });
    const response = NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name } }, { status: 201 });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    return response;
  } catch (error) {
    console.error('Registration failed:', error);
    return NextResponse.json({ error: 'Unable to create account' }, { status: 500 });
  }
}
