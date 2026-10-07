export type PlanId = 'FREE' | 'STANDARD' | 'PREMIUM' | 'PREMIUM_PRO' | 'PREMIUM_PRO_PLUS';

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  priceInr: number;
  dmQuota: number;
  quotaLabel: string;
  automations: string;
  activeAutomationLimit: number | null;
  features: string[];
  highlighted?: boolean;
  cta: string;
}

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    tagline: 'Try official comment-to-DM on one account.',
    priceInr: 0,
    dmQuota: 30,
    quotaLabel: '30 DMs / month',
    automations: '1 active automation',
    activeAutomationLimit: 1,
    features: [
      '30 official Meta private replies / month',
      '1 active automation',
      'Follow-gate workflow',
      'Keyword + any-comment triggers',
    ],
    cta: 'Start free',
  },
  STANDARD: {
    id: 'STANDARD',
    name: 'Standard',
    tagline: 'For new creators testing lead magnets.',
    priceInr: 99,
    dmQuota: 250,
    quotaLabel: '250 DMs / month',
    automations: '3 active automations',
    activeAutomationLimit: 3,
    features: [
      '250 DMs / month',
      '3 active automations',
      'Follow-gate + resource unlock',
      'Retry worker for transient Meta errors',
    ],
    cta: 'Pay ₹99 via UPI',
  },
  PREMIUM: {
    id: 'PREMIUM',
    name: 'Premium',
    tagline: 'For active Reels that convert comments daily.',
    priceInr: 299,
    dmQuota: 750,
    quotaLabel: '750 DMs / month',
    automations: '8 active automations',
    activeAutomationLimit: 8,
    highlighted: true,
    features: [
      '750 DMs / month',
      '8 active automations',
      'Custom DM + public reply templates',
      'Retry handling for transient Meta errors',
    ],
    cta: 'Pay ₹299 via UPI',
  },
  PREMIUM_PRO: {
    id: 'PREMIUM_PRO',
    name: 'Premium Pro',
    tagline: 'For high-traffic creators and small agencies.',
    priceInr: 699,
    dmQuota: 2000,
    quotaLabel: '2,000 DMs / month',
    automations: '20 active automations',
    activeAutomationLimit: 20,
    features: [
      '2,000 DMs / month',
      '20 active automations',
      'Follow-gate audit trail',
      'Email support during IST business hours',
    ],
    cta: 'Pay ₹699 via UPI',
  },
  PREMIUM_PRO_PLUS: {
    id: 'PREMIUM_PRO_PLUS',
    name: 'Premium Pro Plus',
    tagline: 'Highest published cap. Not unlimited.',
    priceInr: 1299,
    dmQuota: 5000,
    quotaLabel: '5,000+ DMs / month',
    automations: '50 active automations',
    activeAutomationLimit: 50,
    features: [
      '5,000 DMs / month (hard cap, not unlimited)',
      '50 active automations on one IG account',
      'Email support for account questions',
    ],
    cta: 'Pay ₹1,299 via UPI',
  },
};

export const PAID_PLANS = (Object.values(PLANS) as Plan[]).filter((plan) => plan.priceInr > 0);

export const LEGACY_PLAN_MAP: Record<string, PlanId> = {
  PRO_CREATOR: 'PREMIUM',
  VIP_UNLIMITED: 'PREMIUM_PRO',
  PRO: 'PREMIUM',
};

export function normalizePlanId(value: unknown): PlanId | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (upper in PLANS) return upper as PlanId;
  return LEGACY_PLAN_MAP[upper] || null;
}

export function getPlan(planId: string | null | undefined): Plan {
  const normalized = normalizePlanId(planId) || 'FREE';
  return PLANS[normalized];
}

export function isPaidPlan(planId: string | null | undefined): boolean {
  const plan = normalizePlanId(planId);
  return Boolean(plan && plan !== 'FREE');
}

export function formatPaiseAsInr(amountPaise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: amountPaise % 100 === 0 ? 0 : 2,
  }).format(amountPaise / 100);
}

/**
 * DirectUpiPayment.amount is stored in paise (the submit route writes
 * `plan.priceInr * 100` and never trusts a client amount). Summing verified
 * payments therefore yields paise — always render the total through
 * formatPaiseAsInr, never as raw rupees.
 */
export function verifiedRevenuePaise(payments: ReadonlyArray<{ amount: number; status: string }>): number {
  return payments
    .filter((payment) => payment.status === 'VERIFIED')
    .reduce((sum, payment) => sum + payment.amount, 0);
}
