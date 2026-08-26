export type PlanId = 'FREE' | 'STANDARD' | 'PREMIUM' | 'PREMIUM_PRO' | 'PREMIUM_PRO_PLUS';

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  priceInr: number;
  dmQuota: number;
  quotaLabel: string;
  automations: string;
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
    highlighted: true,
    features: [
      '750 DMs / month',
      '8 active automations',
      'Custom DM + public reply templates',
      'Priority retry queue',
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
    automations: 'Unlimited automations*',
    features: [
      '5,000 DMs / month (hard cap, not unlimited)',
      'Unlimited automations on one IG account',
      'Manual quota top-up on request',
      'WhatsApp onboarding call',
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
