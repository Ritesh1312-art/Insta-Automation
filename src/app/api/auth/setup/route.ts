import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const { email, password, token } = await request.json(); const setupToken = process.env.SETUP_TOKEN;
    if (!setupToken || typeof token !== 'string' || token.length !== setupToken.length || !timingSafeEqual(Buffer.from(token), Buffer.from(setupToken))) return NextResponse.json({ error: 'Invalid setup token' }, { status: 401 });
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 12) return NextResponse.json({ error: 'Use a valid email and a password of at least 12 characters' }, { status: 400 });
    if (await prisma.user.count({ where: { role: 'ADMIN' } })) return NextResponse.json({ error: 'Setup is already complete' }, { status: 409 });
    await prisma.user.create({ data: { email: email.toLowerCase().trim(), passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN' } });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch { return NextResponse.json({ error: 'Unable to create administrator' }, { status: 500 }); }
}
