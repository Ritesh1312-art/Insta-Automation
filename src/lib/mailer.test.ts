import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }));

import {
  sendPasswordResetOtpEmail,
  sendPaymentRejectedEmail,
  sendPlanActivatedEmail,
  sendTransactionalEmail,
  sendWelcomeEmail,
} from './mailer';

const smtpNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of smtpNames) delete process.env[name];
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  mocks.sendMail.mockResolvedValue({ messageId: 'mail' });
});
afterEach(() => vi.unstubAllEnvs());

describe('transactional mail', () => {
  it('soft-fails when SMTP is incomplete', async () => {
    await expect(sendWelcomeEmail('user@example.com', 'User')).resolves.toEqual({
      sent: false, reason: 'SMTP is not fully configured',
    });
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it('uses bounded SMTP timeouts and escapes user-controlled HTML', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('SMTP_PORT', '465');
    vi.stubEnv('SMTP_USER', 'mailer');
    vi.stubEnv('SMTP_PASSWORD', 'secret');
    vi.stubEnv('SMTP_FROM', 'InstaDM <mail@example.com>');

    await expect(sendWelcomeEmail('user@example.com', '<Admin>')).resolves.toEqual({ sent: true });
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com', port: 465, secure: true,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    }));
    expect(mocks.sendMail.mock.calls[0][0].html).toContain('&lt;Admin&gt;');
  });

  it('returns a safe result instead of rolling back when SMTP fails', async () => {
    for (const [name, value] of Object.entries({
      SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'secret', SMTP_FROM: 'mail@example.com',
    })) vi.stubEnv(name, value);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.sendMail.mockRejectedValue(new Error('SMTP offline'));
    await expect(sendTransactionalEmail({ to: 'user@example.com', subject: 'Test', text: 'Body' }))
      .resolves.toEqual({ sent: false, reason: 'SMTP offline' });
  });

  it('renders OTP, activation, and escaped rejection templates', async () => {
    // Template construction happens before the optional SMTP early return.
    await sendPasswordResetOtpEmail('user@example.com', '123456');
    await sendPlanActivatedEmail('user@example.com', 'PREMIUM', 750);
    await sendPaymentRejectedEmail('user@example.com', 'PREMIUM', '<not found>');
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });
});
