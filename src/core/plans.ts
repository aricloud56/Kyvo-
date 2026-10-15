// Subscription tiers, prices and entitlement rules. Prices are configured here and nowhere else in the app;
// Stripe holds the actual price objects, referenced by the STRIPE_PRICE_* environment variables.

export type PlanInterval = 'monthly' | 'annual';

export const PRICES: Record<PlanInterval, { label: string; amountCents: number; currency: 'AUD'; per: string; env: string }> = {
  monthly: { label: 'Monthly', amountCents: 999, currency: 'AUD', per: 'month', env: 'STRIPE_PRICE_MONTHLY' },
  annual: { label: 'Annual', amountCents: 7999, currency: 'AUD', per: 'year', env: 'STRIPE_PRICE_ANNUAL' },
};

export const formatPrice = (cents: number): string => `A$${(cents / 100).toFixed(2)}`;

/** Limits applied to Free accounts. Premium has no limits. */
export const FREE_LIMITS = {
  customWorkouts: 3,
  historyDays: 90,
  savedMeals: 5,
} as const;

export const PREMIUM_FEATURES = [
  'Full exercise library (170 exercises)',
  'All workout templates, including upper/lower, push/pull/legs, strength and hypertrophy',
  'Complete recipe library and advanced meal planning',
  'Unlimited custom workouts',
  'Full progress history and nutrition analytics',
  'Training volume and personal-record analytics',
];

export const FREE_FEATURES = [
  'Personalised Daily Plan every day',
  '3-day beginner, full-body and home dumbbell programs',
  'Workout logging with rest timer and progression suggestions',
  'Food diary with calories and macros',
  'Starter recipe collection',
  `Progress tracking (last ${FREE_LIMITS.historyDays} days)`,
];

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';

export interface SubscriptionState {
  status: SubscriptionStatus;
  currentPeriodEnd: string | Date | null;
  cancelAtPeriodEnd: boolean;
}

/** Days of continued access while Stripe retries a failed payment. */
export const PAST_DUE_GRACE_DAYS = 3;

/**
 * Premium is granted only from server-side subscription records (written by verified Stripe webhooks).
 * A subscription set to cancel at period end stays 'active' (cancelAtPeriodEnd = true) and keeps Premium
 * until the end of the paid period; Stripe then sends status 'canceled', which ends access.
 */
export function isPremium(sub: SubscriptionState | null | undefined, now: Date = new Date()): boolean {
  if (!sub) return false;
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : 0;
  if (sub.status === 'active' || sub.status === 'trialing') return end === 0 || end > now.getTime();
  if (sub.status === 'past_due') return end + PAST_DUE_GRACE_DAYS * 86400000 > now.getTime();
  return false;
}
