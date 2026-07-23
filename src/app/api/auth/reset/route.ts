import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const { email, password, token } = await request.json();
    const setupToken = process.env.SETUP_TOKEN;
    const receivedToken = typeof token === 'string' ? Buffer.from(token) : null;
    const expectedToken = setupToken ? Buffer.from(setupToken) : null;
    
    if (!receivedToken || !expectedToken || receivedToken.length !== expectedToken.length || !timingSafeEqual(receivedToken, expectedToken)) {
      return NextResponse.json({ error: 'Invalid setup token' }, { status: 401 });
    }
    
    if (typeof email !== 'string' || typeof password !== 'string' || password.length < 12) {
      return NextResponse.json({ error: 'Use a valid email and a password of at least 12 characters' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await prisma.user.update({
      where: { email: normalizedEmail },
      data: { passwordHash: await bcrypt.hash(password, 12) }
    });

    return NextResponse.json({ success: true, message: 'Password updated successfully' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to reset password' }, { status: 500 });
  }
}
