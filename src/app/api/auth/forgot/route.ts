import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetOtpEmail } from '@/lib/mailer';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password-policy';
import { consumeRateLimit, requestFingerprint } from '@/lib/rate-limit';

const OTP_TTL_MS = 10 * 60 * 1000;
const GENERIC_REQUEST_MESSAGE = 'If that account exists, a verification code has been sent to its registered email address.';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    const requesting = action === 'REQUEST_OTP';
    const allowed = await consumeRateLimit({
      action: requesting ? 'RATE_LIMIT_PASSWORD_OTP' : 'RATE_LIMIT_PASSWORD_VERIFY',
      fingerprint: requestFingerprint(req, email),
      limit: requesting ? 3 : 10,
      windowMs: 15 * 60 * 1000,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many password reset attempts. Try again in 15 minutes.' },
        { status: 429, headers: { 'Retry-After': '900' } },
      );
    }

    if (action === 'REQUEST_OTP') {
      const rate = await consumeRateLimit({
        scope: 'password-reset-request',
        identifier: `${requestIp(req)}:${email}`,
        limit: 5,
        windowMs: 60 * 60 * 1000,
      });
      if (!rate.allowed) {
        return NextResponse.json({ error: 'Too many reset requests. Try again later.' }, rateLimitResponse(rate));
      }

      const user = await prisma.user.findUnique({ where: { email } });
      const genericMessage = 'If an account exists, a verification code has been sent to its registered email.';
      if (!user) return NextResponse.json({ success: true, message: genericMessage });

      const generatedOtp = randomInt(100000, 1_000_000).toString();
      const otpHash = await bcrypt.hash(generatedOtp, 10);
      const expiresAt = Date.now() + OTP_TTL_MS;

      await prisma.$transaction([
        prisma.auditLog.deleteMany({ where: { action: 'PASSWORD_RESET_OTP', userId: user.id } }),
        prisma.auditLog.create({
          data: {
            action: 'PASSWORD_RESET_OTP',
            userId: user.id,
            ipAddress: requestIp(req),
            details: { otpHash, expiresAt, attempts: 0 },
          },
        }),
      ]);

      const mail = await sendPasswordResetOtpEmail(email, generatedOtp);
      if (!mail.sent) console.error('Password reset email could not be sent:', mail.reason);
      return NextResponse.json({ success: true, message: genericMessage });
    }

    if (action === 'VERIFY_AND_RESET') {
      const rate = await consumeRateLimit({
        scope: 'password-reset-verify',
        identifier: `${requestIp(req)}:${email}`,
        limit: 10,
        windowMs: 15 * 60 * 1000,
      });
      if (!rate.allowed) {
        return NextResponse.json({ error: 'Too many verification attempts. Try again later.' }, rateLimitResponse(rate));
      }

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
      const details = activeLog?.details as { otpHash?: string; expiresAt?: number; attempts?: number } | null;
      if (!activeLog || !details?.otpHash || !details.expiresAt || details.expiresAt < Date.now() || (details.attempts || 0) >= 5) {
        if (activeLog) await prisma.auditLog.delete({ where: { id: activeLog.id } });
        return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 401 });
      }
      if (!(await bcrypt.compare(otp, details.otpHash))) {
        await prisma.auditLog.update({
          where: { id: activeLog.id },
          data: { details: { ...details, attempts: (details.attempts || 0) + 1 } },
        });
        return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 401 });
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await bcrypt.hash(newPassword, 12), sessionVersion: { increment: 1 } },
        }),
        prisma.auditLog.delete({ where: { id: activeLog.id } }),
        prisma.auditLog.create({
          data: { userId: user.id, action: 'PASSWORD_RESET_COMPLETED', ipAddress: requestIp(req) },
        }),
      ]);
      return NextResponse.json({ success: true, message: 'Password reset successful' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Password reset failed:', error);
    return NextResponse.json({ error: 'Password reset request failed' }, { status: 500 });
  }
}
