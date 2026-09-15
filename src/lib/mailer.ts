import nodemailer from 'nodemailer';
import { getPlan, type PlanId } from '@/lib/plans';

export type MailResult = { sent: boolean; reason?: string };

type Mail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

function smtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number.parseInt(process.env.SMTP_PORT || '', 10);
  const user = (process.env.SMTP_USER || '').trim();
  const password = process.env.SMTP_PASSWORD || '';
  const from = (process.env.SMTP_FROM || '').trim();

  if (!host || !Number.isInteger(port) || port <= 0 || !user || !password || !from) {
    return null;
  }
  return { host, port, user, password, from };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

/** SMTP is optional. Mail failures are logged and never roll back user actions. */
export async function sendTransactionalEmail(mail: Mail): Promise<MailResult> {
  const config = smtpConfig();
  if (!config) return { sent: false, reason: 'SMTP is not fully configured' };

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transporter.sendMail({
      from: config.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown SMTP error';
    console.error('Transactional email failed:', reason);
    return { sent: false, reason };
  }
}

export function sendWelcomeEmail(to: string, name?: string | null) {
  const greeting = name?.trim() ? `Hi ${name.trim()}` : 'Hi';
  return sendTransactionalEmail({
    to,
    subject: 'Welcome to InstaDM Auto',
    text: `${greeting},\n\nYour InstaDM Auto workspace is ready on the Free plan with 30 DMs per month. Sign in, connect Instagram, and attach an automation to a post.\n`,
    html: `<p>${escapeHtml(greeting)},</p><p>Your <strong>InstaDM Auto</strong> workspace is ready on the Free plan with 30 DMs per month.</p><p>Sign in, connect Instagram, and attach an automation to a post.</p>`,
  });
}

export function sendPasswordResetOtpEmail(to: string, otp: string) {
  return sendTransactionalEmail({
    to,
    subject: 'InstaDM Auto password reset code',
    text: `Your password reset verification code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`,
    html: `<p>Your InstaDM Auto password reset code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(otp)}</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>`,
  });
}

export function sendPaymentSubmittedEmail(to: string, planId: PlanId, amount: number, utrNumber: string) {
  const plan = getPlan(planId);
  return sendTransactionalEmail({
    to,
    subject: 'UPI payment submitted for review',
    text: `We received your payment submission for ${plan.name} (₹${amount}). UTR: ${utrNumber}. An admin will verify it in the bank app before activating your plan. Do not pay again while it is pending.`,
    html: `<p>We received your payment submission for <strong>${escapeHtml(plan.name)}</strong> (₹${amount}).</p><p>UTR: <strong>${escapeHtml(utrNumber)}</strong></p><p>An admin will verify it before activating your plan. Do not pay again while it is pending.</p>`,
  });
}

export function sendPlanActivatedEmail(to: string, planId: PlanId, quota: number) {
  const plan = getPlan(planId);
  return sendTransactionalEmail({
    to,
    subject: `${plan.name} plan activated`,
    text: `Your ${plan.name} plan is active for 30 days with a quota of ${quota.toLocaleString('en-IN')} DMs.`,
    html: `<p>Your <strong>${escapeHtml(plan.name)}</strong> plan is now active for 30 days.</p><p>DM quota: <strong>${quota.toLocaleString('en-IN')}</strong></p>`,
  });
}

export function sendPaymentRejectedEmail(to: string, planId: string, note?: string | null) {
  const normalizedNote = note?.trim() || 'The payment details could not be verified.';
  return sendTransactionalEmail({
    to,
    subject: 'UPI payment needs attention',
    text: `Your payment submission for ${planId} was rejected. Reason: ${normalizedNote} Please check the details before submitting another payment.`,
    html: `<p>Your payment submission for <strong>${escapeHtml(planId)}</strong> was rejected.</p><p>Reason: ${escapeHtml(normalizedNote)}</p><p>Please check the details before submitting another payment.</p>`,
  });
}
