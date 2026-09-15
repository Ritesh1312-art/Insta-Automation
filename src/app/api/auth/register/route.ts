import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { PLANS } from '@/lib/plans';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';

    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12) {
      return NextResponse.json({ error: 'Use a valid email and a password of at least 12 characters' }, { status: 400 });
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
  } catch {
    return NextResponse.json({ error: 'Unable to create account' }, { status: 500 });
  }
}
