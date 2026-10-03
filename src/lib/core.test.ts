import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));

import { createOAuthState, signToken, verifyOAuthState, verifyToken } from './auth';
import { publicAppUrl, metaRedirectUri } from './app-url';
import { decryptToken, encryptToken } from './encryption';
import { MetaGraphError, describeMetaError, metaErrorRequiresReauthorization } from './meta-errors';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from './password-policy';
import { formatPaiseAsInr, getPlan, normalizePlanId, PLANS } from './plans';
import { buildUpiUri, isValidUpiId, isValidUtr } from './upi';
import { isFollowRetryText, parseButtonPayload } from '@/services/automation/FollowGateService';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('session and OAuth tokens', () => {
  it('signs and verifies a constrained session token', async () => {
    const token = await signToken({ userId: 'user-1', email: 'a@example.com', role: 'USER' });
    await expect(verifyToken(token)).resolves.toEqual({ userId: 'user-1', email: 'a@example.com', role: 'USER', sessionVersion: 0 });
    await expect(verifyOAuthState(token)).resolves.toBeNull();
  });

  it('separates OAuth state from sessions and rejects tampering', async () => {
    const state = await createOAuthState('user-2');
    await expect(verifyOAuthState(state)).resolves.toBe('user-2');
    await expect(verifyToken(state)).resolves.toBeNull();
    const parts = state.split('.');
    parts[2] = `${parts[2][0] === 'a' ? 'b' : 'a'}${parts[2].slice(1)}`;
    await expect(verifyOAuthState(parts.join('.'))).resolves.toBeNull();
  });

  it('fails closed when AUTH_SECRET is missing', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    await expect(signToken({ userId: 'u', email: 'a@b.com', role: 'USER' })).rejects.toThrow('AUTH_SECRET');
    await expect(verifyToken('forged')).resolves.toBeNull();
  });
});

describe('encryption', () => {
  it('round-trips tokens with authenticated encryption and random IVs', () => {
    const first = encryptToken('access-token');
    const second = encryptToken('access-token');
    expect(first).not.toBe(second);
    expect(decryptToken(first)).toBe('access-token');
  });

  it('rejects tampered ciphertext and invalid keys', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const encrypted = encryptToken('secret');
    const encryptedParts = encrypted.split(':');
    encryptedParts[2] = `${encryptedParts[2][0] === '0' ? '1' : '0'}${encryptedParts[2].slice(1)}`;
    expect(() => decryptToken(encryptedParts.join(':'))).toThrow('Unable to decrypt access token');
    vi.stubEnv('ENCRYPTION_KEY', 'short');
    expect(() => encryptToken('secret')).toThrow('ENCRYPTION_KEY');
  });
});

describe('configuration helpers', () => {
  it('uses only HTTPS configured public URLs in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_URL', 'https://app.example.com/path');
    vi.stubEnv('META_REDIRECT_URI', 'https://app.example.com/api/auth/meta/callback');
    expect(publicAppUrl('http://localhost:3000')).toBe('https://app.example.com');
    expect(metaRedirectUri()).toBe('https://app.example.com/api/auth/meta/callback');
  });

  it('rejects insecure redirect configuration', () => {
    vi.stubEnv('META_REDIRECT_URI', 'http://example.com/callback');
    expect(() => metaRedirectUri('http://localhost:3000')).toThrow('HTTPS');
  });
});

describe('plans, passwords, UPI, and follow-gate parsing', () => {
  it('normalizes current and legacy plan IDs with enforced limits', () => {
    expect(normalizePlanId('pro_creator')).toBe('PREMIUM');
    expect(getPlan('not-real')).toBe(PLANS.FREE);
    expect(PLANS.FREE.activeAutomationLimit).toBe(1);
    expect(PLANS.PREMIUM_PRO_PLUS.activeAutomationLimit).toBe(50);
    expect(formatPaiseAsInr(29_900)).toContain('299');
  });

  it('enforces the shared password policy', () => {
    expect(validatePassword('Secure#1234')).toBe(true);
    expect(validatePassword('weakpassword')).toBe(false);
    expect(PASSWORD_POLICY_MESSAGE).toContain('10–20');
  });

  it('builds encoded UPI URIs and validates identifiers', () => {
    expect(buildUpiUri({ upiId: 'name@okaxis', payeeName: 'Ritesh Gupta', amount: 299, note: 'Premium plan' }))
      .toBe('upi://pay?pa=name%40okaxis&pn=Ritesh%20Gupta&am=299&cu=INR&tn=Premium%20plan');
    expect(isValidUpiId('name@okaxis')).toBe(true);
    expect(isValidUpiId('not-an-id')).toBe(false);
    expect(isValidUtr('123456789012')).toBe(true);
    expect(isValidUtr('123')).toBe(false);
  });

  it('parses only known button prefixes and common honor confirmations', () => {
    expect(parseButtonPayload('CONFIRM_FOLLOW_auto-1')).toEqual({ action: 'CONFIRM', automationId: 'auto-1' });
    expect(parseButtonPayload('DELIVER_RESOURCE_auto-1')).toEqual({ action: 'DELIVER', automationId: 'auto-1' });
    expect(parseButtonPayload('anything else')).toEqual({ action: 'UNKNOWN' });
    expect(isFollowRetryText('Ho gaya!')).toBe(true);
    expect(isFollowRetryText('maybe later')).toBe(false);
  });
});

describe('Meta errors', () => {
  it('classifies invalid tokens as requiring OAuth again', () => {
    const error = new MetaGraphError({ code: 190, error_subcode: 460, message: 'Session invalidated' }, 'fallback', 401);
    expect(error.requiresReauthorization).toBe(true);
    expect(metaErrorRequiresReauthorization(error)).toBe(true);
    expect(describeMetaError(error)).toContain('code 190, subcode 460');
  });

  it('does not mark transient errors as authorization failures', () => {
    expect(metaErrorRequiresReauthorization(new Error('Network timeout'))).toBe(false);
  });
});
