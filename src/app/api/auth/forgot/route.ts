import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email, otp, newPassword } = body;

    if (action === 'REQUEST_OTP') {
      if (typeof email !== 'string' || !email.trim()) {
        return NextResponse.json({ error: 'Email is required' }, { status: 400 });
      }
      const normalizedEmail = email.trim().toLowerCase();
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (!user) {
        return NextResponse.json({ error: 'User with this email not found' }, { status: 404 });
      }

      // Generate a 6-digit numeric OTP
      const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes from now

      // Save OTP session in AuditLog database
      await prisma.auditLog.create({
        data: {
          action: 'PASSWORD_RESET_OTP',
          userId: user.id,
          details: {
            email: normalizedEmail,
            otp: generatedOtp,
            expiresAt,
          },
        },
      });

      // Try sending OTP via Email (SMTP configuration)
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = process.env.SMTP_PORT;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASSWORD;
      const smtpFrom = process.env.SMTP_FROM || 'noreply@instadm.com';

      let emailSent = false;
      let emailError = '';

      if (smtpHost && smtpPort && smtpUser && smtpPass) {
        try {
          const nm = require('nodemailer');
          const transporter = nm.createTransport({
            host: smtpHost,
            port: parseInt(smtpPort),
            secure: parseInt(smtpPort) === 465,
            auth: { user: smtpUser, pass: smtpPass },
          });

          await transporter.sendMail({
            from: smtpFrom,
            to: normalizedEmail,
            subject: 'InstaDM Auto - Password Reset OTP Code',
            text: `Your password reset verification code is: ${generatedOtp}\n\nThis OTP is valid for 10 minutes.`,
            html: `<p>Your password reset verification code is: <strong>${generatedOtp}</strong></p><p>This OTP is valid for 10 minutes.</p>`,
          });
          emailSent = true;
        } catch (err: any) {
          emailError = err.message || 'SMTP sending failed';
        }
      }

      return NextResponse.json({
        success: true,
        emailSent,
        message: emailSent
          ? 'Verification OTP has been sent to your registered email address.'
          : 'OTP request received. (Please configure SMTP_HOST/SMTP_USER in .env for email delivery).',
      });
    }

    if (action === 'VERIFY_AND_RESET') {
      if (!email || !otp || !newPassword) {
        return NextResponse.json({ error: 'Email, OTP, and new password are required' }, { status: 400 });
      }
      if (newPassword.length < 12) {
        return NextResponse.json({ error: 'Password must be at least 12 characters long' }, { status: 400 });
      }

      const normalizedEmail = email.trim().toLowerCase();

      // Find the latest active OTP for this email in AuditLog
      const latestLogs = await prisma.auditLog.findMany({
        where: { action: 'PASSWORD_RESET_OTP' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const activeLog = latestLogs.find((log: any) => {
        const details = log.details as any;
        return details?.email === normalizedEmail && details?.otp === otp;
      });

      if (!activeLog) {
        return NextResponse.json({ error: 'Invalid OTP code' }, { status: 401 });
      }

      const details = activeLog.details as any;
      if (details.expiresAt < Date.now()) {
        return NextResponse.json({ error: 'OTP code has expired' }, { status: 410 });
      }

      // Valid OTP! Perform Password reset
      await prisma.user.update({
        where: { email: normalizedEmail },
        data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      });

      // Cleanup OTP from active logs to prevent reuse
      await prisma.auditLog.delete({ where: { id: activeLog.id } });

      return NextResponse.json({ success: true, message: 'Password reset successful!' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Password reset request failed' }, { status: 500 });
  }
}
