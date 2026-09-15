import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password-policy';

export async function POST(request: NextRequest) {
  try {
    const { email, password, token } = await request.json();
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
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to reset password' }, { status: 500 });
  }
}
