import { describe, expect, it } from 'vitest';
import {
  describeWebhookSubscription,
  isWebhookStatus,
  webhookSetupIncomplete,
  webhookStatusFromAttempts,
  WEBHOOK_STATUSES,
} from './meta-webhook-status';

describe('Meta webhook-subscription status', () => {
  it('maps subscribe attempts to a truthful status', () => {
    expect(webhookStatusFromAttempts([true, true])).toBe('SUBSCRIBED');
    expect(webhookStatusFromAttempts([true, false])).toBe('PARTIAL');
    expect(webhookStatusFromAttempts([false, true])).toBe('PARTIAL');
    expect(webhookStatusFromAttempts([false, false])).toBe('FAILED');
  });

  it('never claims SUBSCRIBED without an attempt', () => {
    expect(webhookStatusFromAttempts([])).toBe('UNKNOWN');
    expect(webhookStatusFromAttempts([true])).toBe('SUBSCRIBED');
    expect(webhookStatusFromAttempts([false])).toBe('FAILED');
  });

  it('keeps the per-target result alongside the status', () => {
    expect(describeWebhookSubscription(true, false)).toEqual({ status: 'PARTIAL', page: true, instagram: false });
    expect(describeWebhookSubscription(true, true)).toEqual({ status: 'SUBSCRIBED', page: true, instagram: true });
    expect(describeWebhookSubscription(false, false)).toEqual({ status: 'FAILED', page: false, instagram: false });
  });

  it('flags only PARTIAL and FAILED as a setup the creator must fix', () => {
    expect(WEBHOOK_STATUSES.filter(webhookSetupIncomplete)).toEqual(['PARTIAL', 'FAILED']);
    expect(webhookSetupIncomplete(undefined)).toBe(false);
    expect(webhookSetupIncomplete(null)).toBe(false);
  });

  it('validates stored values', () => {
    expect(isWebhookStatus('SUBSCRIBED')).toBe(true);
    expect(isWebhookStatus('subscribed')).toBe(false);
    expect(isWebhookStatus(undefined)).toBe(false);
  });
});
