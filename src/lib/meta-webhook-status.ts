/**
 * Webhook-subscription state is a separate axis from token/connection state.
 * A freshly exchanged, valid Page token whose `subscribed_apps` call failed is
 * a *webhook setup* problem — not an expired token — so it must never be
 * collapsed into `connectionStatus: 'ERROR'` (which the dashboard renders as
 * "token expired, reconnect"). These values are persisted on MetaConnection and
 * reported by the OAuth callback, the admin re-subscribe action, and the UI.
 */
export const WEBHOOK_STATUSES = ['UNKNOWN', 'SUBSCRIBED', 'PARTIAL', 'FAILED'] as const;

export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

export type WebhookSubscriptionState = {
  status: WebhookStatus;
  /** Per-target outcome, e.g. `{ page: true, instagram: false }`. */
  page: boolean;
  instagram: boolean;
};

export function isWebhookStatus(value: unknown): value is WebhookStatus {
  return typeof value === 'string' && (WEBHOOK_STATUSES as readonly string[]).includes(value);
}

/**
 * Collapses one subscribe attempt per target into a truthful status:
 * every target subscribed → SUBSCRIBED, some → PARTIAL, none → FAILED.
 * No attempts at all means nothing is known, never "subscribed".
 */
export function webhookStatusFromAttempts(attempts: readonly boolean[]): WebhookStatus {
  if (!attempts.length) return 'UNKNOWN';
  const succeeded = attempts.filter(Boolean).length;
  if (succeeded === attempts.length) return 'SUBSCRIBED';
  return succeeded === 0 ? 'FAILED' : 'PARTIAL';
}

export function describeWebhookSubscription(page: boolean, instagram: boolean): WebhookSubscriptionState {
  return { status: webhookStatusFromAttempts([page, instagram]), page, instagram };
}

/** Statuses a creator must fix before comment/DM events can arrive. */
export function webhookSetupIncomplete(status: string | null | undefined): boolean {
  return status === 'PARTIAL' || status === 'FAILED';
}
