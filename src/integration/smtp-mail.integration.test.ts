/**
 * GROUP B — transactional mail and password recovery, verified against a real
 * SMTP conversation captured by scripts/mocks/smtp-mock.cjs and a real
 * PostgreSQL database.
 *
 * B1 welcome mail on registration
 * B2 payment submitted / plan activated / payment rejected mails
 * B3 OTP request → verify → reset, plus wrong/expired/reused OTP and rate limit
 * B4 OTP stored only as a bcrypt hash, only the latest usable, deleted after use
 * B5 /forgot page wired to this exact API contract
 */
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_IDENTIFIER,
  ADMIN_PASSWORD,
  BASE_URL,
  Session,
  clearMails,
  extractOtp,
  integrationEnabled,
  readMails,
  truncateAll,
  waitFor,
} from './helpers';

const describeIntegration = integrationEnabled ? describe : describe.skip;
const PASSWORD = 'StrongPass123!';
const NEW_PASSWORD = 'RotatedPass456!';

describeIntegration('GROUP B — welcome, payment and password-recovery mail', () => {
  let prisma: typeof import('@/lib/prisma').prisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    delete (globalThis as { prisma?: unknown }).prisma;
    ({ prisma } = await import('@/lib/prisma'));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await clearMails();
  });

  it('B1: registration sends the welcome mail to the new address', async () => {
    const session = new Session();
    const { status } = await session.json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'welcome@example.test', password: PASSWORD, name: 'Welcome User' }),
    });
    expect(status).toBe(201);

    const mails = await waitFor(async () => {
      const captured = await readMails();
      return captured.length ? captured : null;
    }, 10_000, 'welcome mail');
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('welcome@example.test');
    expect(mails[0].subject).toBe('Welcome to InstaDM Auto');
    expect(mails[0].from).toContain('no-reply@instadm.test');
    expect(mails[0].text).toContain('Hi Welcome User');
    expect(mails[0].text).toContain('30 DMs per month');
    expect(mails[0].text).toContain('Free plan');
  });

  it('B2: payment submitted, activated and rejected mails each reach the paying user', async () => {
    const session = new Session();
    await session.json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'payer@example.test', password: PASSWORD, name: 'Payer' }),
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'payer@example.test' } });
    await clearMails();

    const submit = await session.json('/api/payments/direct-upi/submit', {
      method: 'POST',
      body: JSON.stringify({
        planType: 'STANDARD',
        payerName: 'Payer Name',
        payerUpiId: 'payer@okaxis',
        utrNumber: 'UTR123456789012',
      }),
    });
    expect(submit.status).toBe(200);

    const submitted = await waitFor(async () => {
      const mails = await readMails();
      return mails.find((mail) => mail.subject === 'UPI payment submitted for review') ? mails : null;
    }, 10_000, 'payment submitted mail');
    expect(submitted[0]).toMatchObject({ to: 'payer@example.test', subject: 'UPI payment submitted for review' });
    expect(submitted[0].text).toContain('Standard');
    expect(submitted[0].text).toContain('₹99');
    expect(submitted[0].text).toContain('UTR123456789012');

    const payment = await prisma.directUpiPayment.findUniqueOrThrow({ where: { utrNumber: 'UTR123456789012' } });
    expect(payment).toMatchObject({ userId: user.id, amount: 9900, status: 'PENDING_REVIEW' });

    // Approve through the dashboard API (as an admin).
    await prisma.user.create({
      data: { email: ADMIN_IDENTIFIER, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), role: 'ADMIN', subscriptionStatus: 'ACTIVE' },
    });
    const admin = new Session();
    expect((await admin.json('/api/auth/admin-login', { method: 'POST', body: JSON.stringify({ password: ADMIN_PASSWORD }) })).status).toBe(200);
    const approve = await admin.json('/api/payments/direct-upi/review', {
      method: 'POST',
      body: JSON.stringify({ paymentId: payment.id, decision: 'VERIFIED' }),
    });
    expect(approve.status).toBe(200);

    const activated = await waitFor(async () => {
      const mails = await readMails();
      return mails.find((mail) => mail.subject === 'Standard plan activated') ? mails : null;
    }, 10_000, 'plan activated mail');
    const activationMail = activated.find((mail) => mail.subject === 'Standard plan activated')!;
    expect(activationMail.to).toBe('payer@example.test');
    expect(activationMail.text).toContain('250');
    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .resolves.toMatchObject({ plan: 'STANDARD', monthlyDmQuota: 250, subscriptionStatus: 'ACTIVE' });

    // A second submission from the same user that the admin rejects.
    const secondSubmit = await session.json('/api/payments/direct-upi/submit', {
      method: 'POST',
      body: JSON.stringify({
        planType: 'PREMIUM',
        payerName: 'Payer Name',
        payerUpiId: 'payer@okaxis',
        utrNumber: 'UTR987654321098',
      }),
    });
    expect(secondSubmit.status).toBe(200);
    const secondPayment = await prisma.directUpiPayment.findUniqueOrThrow({ where: { utrNumber: 'UTR987654321098' } });
    const reject = await admin.json('/api/payments/direct-upi/review', {
      method: 'POST',
      body: JSON.stringify({ paymentId: secondPayment.id, decision: 'REJECTED', reviewNote: 'UTR did not match the bank statement' }),
    });
    expect(reject.status).toBe(200);

    const rejected = await waitFor(async () => {
      const mails = await readMails();
      return mails.find((mail) => mail.subject === 'UPI payment needs attention') ? mails : null;
    }, 10_000, 'rejection mail');
    const rejectionMail = rejected.find((mail) => mail.subject === 'UPI payment needs attention')!;
    expect(rejectionMail.to).toBe('payer@example.test');
    expect(rejectionMail.text).toContain('UTR did not match the bank statement');
    expect(rejectionMail.text).toContain('PREMIUM');
    await expect(prisma.directUpiPayment.findUniqueOrThrow({ where: { id: secondPayment.id } }))
      .resolves.toMatchObject({ status: 'REJECTED', reviewNote: 'UTR did not match the bank statement' });
  });

  it('B3/B4: OTP request → verify → reset, with wrong/expired/reused codes and rate limiting', async () => {
    const session = new Session();
    await session.json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'recover@example.test', password: PASSWORD }),
    });
    await clearMails();

    const request = await session.json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'REQUEST_OTP', email: 'recover@example.test' }),
    });
    expect(request.status).toBe(200);
    expect(request.body.success).toBe(true);
    expect(request.body.message).toContain('If an account exists');

    const mails = await waitFor(async () => {
      const captured = await readMails();
      return captured.length ? captured : null;
    }, 10_000, 'OTP mail');
    expect(mails[0].to).toBe('recover@example.test');
    expect(mails[0].subject).toBe('InstaDM Auto password reset code');
    const otp = extractOtp(mails[0]);
    expect(otp).toMatch(/^\d{6}$/);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'recover@example.test' } });

    // B4: the database stores a bcrypt hash of the code and the plain code only
    // exists inside the mail. Grep the whole AuditLog row for the digits.
    const otpRows = await prisma.auditLog.findMany({ where: { action: 'PASSWORD_RESET_OTP' } });
    expect(otpRows).toHaveLength(1);
    const details = otpRows[0].details as { otpHash: string; expiresAt: number; email: string };
    expect(details.otpHash).toMatch(/^\$2[aby]\$/);
    expect(details.otpHash).not.toContain(otp);
    expect(JSON.stringify(details)).not.toContain(otp);
    expect(await bcrypt.compare(otp, details.otpHash)).toBe(true);
    expect(details.expiresAt).toBeGreaterThan(Date.now());

    // A wrong code is rejected…
    const wrong = await session.json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'VERIFY_AND_RESET', email: 'recover@example.test', otp: '000000', newPassword: NEW_PASSWORD }),
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('Invalid or expired verification code');

    // …an expired code is rejected and its row is removed…
    await prisma.auditLog.updateMany({
      where: { action: 'PASSWORD_RESET_OTP' },
      data: { details: { ...details, expiresAt: Date.now() - 1_000 } },
    });
    const expired = await session.json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'VERIFY_AND_RESET', email: 'recover@example.test', otp, newPassword: NEW_PASSWORD }),
    });
    expect(expired.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET_OTP' } })).toBe(0);

    // Request a fresh code: only the latest one works.
    const second = await session.json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'REQUEST_OTP', email: 'recover@example.test' }),
    });
    expect(second.status).toBe(200);
    const afterSecond = await waitFor(async () => {
      const captured = await readMails();
      return captured.length >= 2 ? captured : null;
    }, 10_000, 'second OTP mail');
    const freshOtp = extractOtp(afterSecond.at(-1)!);
    expect(freshOtp).toMatch(/^\d{6}$/);
    const freshRows = await prisma.auditLog.findMany({ where: { action: 'PASSWORD_RESET_OTP' } });
    expect(freshRows).toHaveLength(1);
    const freshDetails = freshRows[0].details as { otpHash: string };
    if (freshOtp !== otp) expect(await bcrypt.compare(otp, freshDetails.otpHash)).toBe(false);

    // The correct code resets the password.
    const reset = await session.json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'VERIFY_AND_RESET', email: 'recover@example.test', otp: freshOtp, newPassword: NEW_PASSWORD }),
    });
    expect(reset.status).toBe(200);
    expect(reset.body.success).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET_OTP' } })).toBe(0);
    await expect(prisma.auditLog.findFirstOrThrow({ where: { action: 'PASSWORD_RESET_COMPLETED' } }))
      .resolves.toMatchObject({ userId: user.id });

    // The new password signs in, the old one does not.
    const loginNew = await new Session().json('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'recover@example.test', password: NEW_PASSWORD }),
    });
    expect(loginNew.status).toBe(200);
    const loginOld = await new Session().json('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'recover@example.test', password: PASSWORD }),
    });
    expect(loginOld.status).toBe(401);

    // B4: reusing the consumed code fails now that its row is gone.
    const reused = await session.json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'VERIFY_AND_RESET', email: 'recover@example.test', otp: freshOtp, newPassword: 'AnotherPass789!' }),
    });
    expect(reused.status).toBe(401);

    // Rate limit: three requests per 15 minutes per email/address. Two were
    // already spent above, so the third succeeds and every later one is 429.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await session.json('/api/auth/forgot', {
        method: 'POST',
        body: JSON.stringify({ action: 'REQUEST_OTP', email: 'recover@example.test' }),
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 429, 429, 429, 429]);
    expect(await prisma.auditLog.count({ where: { action: 'RATE_LIMIT_PASSWORD_OTP' } })).toBe(3);
    const limited = await session.json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'REQUEST_OTP', email: 'recover@example.test' }),
    });
    expect(limited.status).toBe(429);
    expect(limited.response.headers.get('retry-after')).toBe('900');

    // An unknown address gets the same generic answer (no account enumeration).
    const unknown = await new Session().json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'REQUEST_OTP', email: 'ghost@example.test' }),
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.success).toBe(true);
  });

  it('B5: the /forgot page posts exactly the fields this API expects', async () => {
    const source = readFileSync(path.join(process.cwd(), 'src/app/forgot/page.tsx'), 'utf8');
    expect(source).toContain("fetch('/api/auth/forgot'");
    expect(source).toContain("action: 'REQUEST_OTP', email");
    expect(source).toContain("action: 'VERIFY_AND_RESET', email, otp, newPassword");
    expect(source).toContain('disabled={loading}');
    expect(source).toContain('setMessage(data.error');
    expect(source).toContain('pattern="[0-9]{6}"');
    // The page itself is served (a real 200, not a build artefact).
    const page = await fetch(`${BASE_URL}/forgot`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Reset Account Password');

    // The page's exact request bodies are accepted by the running route.
    const session = new Session();
    await session.json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'pagewalk@example.test', password: PASSWORD }),
    });
    await clearMails();
    const request = await session.json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'REQUEST_OTP', email: 'pagewalk@example.test' }),
    });
    expect(request.status).toBe(200);
    const mails = await waitFor(async () => {
      const captured = await readMails();
      return captured.length ? captured : null;
    }, 10_000, 'page-walk OTP mail');
    const otp = extractOtp(mails[0]);
    const verify = await session.json('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ action: 'VERIFY_AND_RESET', email: 'pagewalk@example.test', otp, newPassword: 'PageWalk123!' }),
    });
    expect(verify.status).toBe(200);
    expect(verify.body.message).toBe('Password reset successful');
  });
});
