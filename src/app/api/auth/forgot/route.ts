import { randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetOtpEmail } from '@/lib/mailer';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password-policy';

const OTP_TTL_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    if (action === 'REQUEST_OTP') {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return NextResponse.json({ error: 'User with this email not found' }, { status: 404 });

      const generatedOtp = randomInt(100000, 1_000_000).toString();
      const otpHash = await bcrypt.hash(generatedOtp, 10);
      const expiresAt = Date.now() + OTP_TTL_MS;

      // Only the latest code is usable; the database never stores the OTP itself.
      await prisma.auditLog.deleteMany({ where: { action: 'PASSWORD_RESET_OTP', userId: user.id } });
      await prisma.auditLog.create({
        data: {
          action: 'PASSWORD_RESET_OTP',
          userId: user.id,
          details: { email, otpHash, expiresAt },
        },
      });

      const mail = await sendPasswordResetOtpEmail(email, generatedOtp);
      return NextResponse.json({
        success: true,
        emailSent: mail.sent,
        message: mail.sent
          ? 'Verification code sent to your registered email address.'
          : 'Code generated, but email delivery is unavailable. Ask the administrator to configure all SMTP variables.',
      });
    }

    if (action === 'VERIFY_AND_RESET') {
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (!/^\d{6}$/.test(otp)) {
        return NextResponse.json({ error: 'Enter the 6-digit verification code' }, { status: 400 });
      }
      if (!validatePassword(newPassword)) {
        return NextResponse.json({ error: PASSWORD_POLICY_MESSAGE }, { status: 400 });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 401 });
      const activeLog = await prisma.auditLog.findFirst({
        where: { action: 'PASSWORD_RESET_OTP', userId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      const details = activeLog?.details as { otpHash?: string; expiresAt?: number } | null;
      if (!activeLog || !details?.otpHash || !details.expiresAt || details.expiresAt < Date.now()) {
        if (activeLog) await prisma.auditLog.delete({ where: { id: activeLog.id } });
        return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 401 });
      }
      if (!(await bcrypt.compare(otp, details.otpHash))) {
        return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 401 });
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await bcrypt.hash(newPassword, 12) },
        }),
        prisma.auditLog.delete({ where: { id: activeLog.id } }),
        prisma.auditLog.create({ data: { userId: user.id, action: 'PASSWORD_RESET_COMPLETED' } }),
      ]);
      return NextResponse.json({ success: true, message: 'Password reset successful' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Password reset failed:', error);
    return NextResponse.json({ error: 'Password reset request failed' }, { status: 500 });
  }
}
