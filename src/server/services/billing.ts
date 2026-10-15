// Stripe Billing over the REST API: checkout, billing portal, signed webhooks and entitlement records.
import crypto from 'node:crypto';
import type { Db, Tx } from '../lib/db.js';
import { json } from '../lib/db.js';
import type { Config } from '../config.js';
import { HttpError, badRequest } from '../lib/http.js';
import { PRICES, type PlanInterval, isPremium } from '../../core/plans.js';

export class StripeNotConfigured extends HttpError {
  constructor() {
    super(503, 'Payments are not set up yet. Premium checkout will be available soon.', 'billing_unavailable');
  }
}

/** Verify a Stripe-Signature header (v1 scheme, HMAC-SHA256 of "timestamp.payload"). */
export function verifyStripeSignature(payload: Buffer, header: string | undefined, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(payload).digest();
  return sigs.some((s) => {
    const b = Buffer.from(s, 'hex');
    return b.length === expected.length && crypto.timingSafeEqual(b, expected);
  });
}

/** Build a valid signature header (used by tests and the local webhook simulator). */
export function signStripePayload(payload: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
}

function form(data: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

export class BillingService {
  constructor(private db: Db, private cfg: Config) {}

  get configured(): boolean {
    const s = this.cfg.stripe;
    return !!(s.secretKey && s.webhookSecret && s.priceMonthly && s.priceAnnual);
  }

  priceId(interval: PlanInterval): string | null {
    return interval === 'monthly' ? this.cfg.stripe.priceMonthly : this.cfg.stripe.priceAnnual;
  }

  private async stripe(method: 'GET' | 'POST' | 'DELETE', path: string, data?: Record<string, string | number | boolean | undefined>, idempotencyKey?: string): Promise<any> {
    if (!this.cfg.stripe.secretKey) throw new StripeNotConfigured();
    const headers: Record<string, string> = { Authorization: `Bearer ${this.cfg.stripe.secretKey}`, 'Stripe-Version': '2024-06-20' };
    if (data) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const r = await fetch(`${this.cfg.stripe.apiBase}${path}`, { method, headers, body: data ? form(data) : undefined });
    const body = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) throw new HttpError(502, 'The payment provider returned an error. Please try again.', 'stripe_error');
    return body;
  }

  async status(userId: string) {
    return this.db.asUser(userId, async (tx) => {
      const s = await tx.maybeOne<any>('select status, plan_interval, current_period_end, cancel_at_period_end from kyvo.subscriptions where user_id = $1 order by updated_at desc limit 1', [userId]);
      const state = s ? { status: s.status, currentPeriodEnd: s.current_period_end, cancelAtPeriodEnd: s.cancel_at_period_end } : null;
      return {
        configured: this.configured,
        premium: isPremium(state),
        subscription: s ? { status: s.status, interval: s.plan_interval, currentPeriodEnd: s.current_period_end, cancelAtPeriodEnd: s.cancel_at_period_end } : null,
        prices: PRICES,
      };
    });
  }

  private async customerFor(userId: string, email: string): Promise<string> {
    const existing = await this.db.asSystem((tx) => tx.maybeOne<{ stripe_customer_id: string }>('select stripe_customer_id from kyvo.billing_customers where user_id = $1', [userId]));
    if (existing) return existing.stripe_customer_id;
    const c = await this.stripe('POST', '/v1/customers', { email, 'metadata[user_id]': userId }, `customer-${userId}`);
    await this.db.asSystem((tx) => tx.exec('insert into kyvo.billing_customers (user_id, stripe_customer_id) values ($1,$2) on conflict (user_id) do nothing', [userId, c.id]));
    return c.id;
  }

  async checkout(userId: string, email: string, interval: PlanInterval): Promise<string> {
    if (!this.configured) throw new StripeNotConfigured();
    const price = this.priceId(interval)!;
    const status = await this.status(userId);
    if (status.premium) throw badRequest('You already have Premium. Manage your plan from the billing portal.');
    const customer = await this.customerFor(userId, email);
    const s = await this.stripe('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      customer,
      client_reference_id: userId,
      'line_items[0][price]': price,
      'line_items[0][quantity]': 1,
      'subscription_data[metadata][user_id]': userId,
      success_url: `${this.cfg.baseUrl}/app/premium?checkout=success`,
      cancel_url: `${this.cfg.baseUrl}/app/premium?checkout=cancelled`,
      'automatic_tax[enabled]': false,
    });
    await this.db.asSystem((tx) => tx.exec("insert into kyvo.product_events (user_id, name) values ($1, 'checkout_started')", [userId]));
    return s.url;
  }

  async portal(userId: string): Promise<string> {
    if (!this.cfg.stripe.secretKey) throw new StripeNotConfigured();
    const c = await this.db.asSystem((tx) => tx.maybeOne<{ stripe_customer_id: string }>('select stripe_customer_id from kyvo.billing_customers where user_id = $1', [userId]));
    if (!c) throw badRequest('There is no billing account yet.');
    const s = await this.stripe('POST', '/v1/billing_portal/sessions', { customer: c.stripe_customer_id, return_url: `${this.cfg.baseUrl}/app/premium` });
    return s.url;
  }

  /** Cancel immediately (used when an account is deleted). */
  async cancelAllNow(userId: string): Promise<void> {
    const subs = await this.db.asSystem((tx) => tx.query<{ stripe_subscription_id: string }>("select stripe_subscription_id from kyvo.subscriptions where user_id = $1 and status in ('active','trialing','past_due','unpaid','incomplete')", [userId]));
    for (const s of subs) await this.stripe('DELETE', `/v1/subscriptions/${s.stripe_subscription_id}`);
  }

  /** Process a verified webhook. Returns 'duplicate' when this event id was already handled. */
  async handleWebhook(raw: Buffer, signature: string | undefined): Promise<'processed' | 'duplicate' | 'ignored'> {
    if (!this.cfg.stripe.webhookSecret) throw new StripeNotConfigured();
    if (!verifyStripeSignature(raw, signature, this.cfg.stripe.webhookSecret)) throw new HttpError(400, 'Invalid signature.', 'bad_signature');
    const event = JSON.parse(raw.toString('utf8'));
    if (!event?.id || !event.type) throw badRequest('Malformed event.');
    // Fetched outside the transaction so a slow API call doesn't hold database locks.
    let fetchedSub: any = null;
    if (event.type === 'checkout.session.completed' && event.data?.object?.subscription && this.cfg.stripe.secretKey) {
      fetchedSub = await this.stripe('GET', `/v1/subscriptions/${event.data.object.subscription}`);
    }
    return this.db.asSystem(async (tx) => {
      const fresh = await tx.maybeOne('insert into kyvo.billing_events (id, type, summary) values ($1,$2,$3::jsonb) on conflict (id) do nothing returning id', [
        event.id, event.type, json({ object: event.data?.object?.id ?? null }),
      ]);
      if (!fresh) return 'duplicate';
      let result: 'processed' | 'ignored' = 'processed';
      const o = event.data?.object ?? {};
      switch (event.type) {
        case 'checkout.session.completed': {
          const userId = o.client_reference_id ?? o.metadata?.user_id;
          if (userId && o.customer) await tx.exec('insert into kyvo.billing_customers (user_id, stripe_customer_id) values ($1,$2) on conflict do nothing', [userId, o.customer]);
          if (fetchedSub) await this.upsertSubscription(tx, fetchedSub, event.created);
          if (userId) await tx.exec("insert into kyvo.product_events (user_id, name) values ($1, 'subscribed')", [userId]);
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed':
          await this.upsertSubscription(tx, o, event.created);
          if (event.type === 'customer.subscription.deleted') {
            const uid = await this.userForCustomer(tx, o.customer, o.metadata?.user_id);
            if (uid) await tx.exec("insert into kyvo.product_events (user_id, name) values ($1, 'canceled')", [uid]);
          }
          break;
        case 'invoice.payment_failed':
        case 'invoice.paid':
          // Access follows the subscription status Stripe sends in customer.subscription.updated (past_due, active...).
          break;
        default:
          result = 'ignored';
      }
      await tx.exec('update kyvo.billing_events set processed_at = now() where id = $1', [event.id]);
      return result;
    });
  }

  private async userForCustomer(tx: Tx, customer: string, metaUser?: string): Promise<string | null> {
    if (metaUser) {
      const u = await tx.maybeOne('select 1 from kyvo.users where id = $1', [metaUser]);
      if (u) return metaUser;
    }
    const c = await tx.maybeOne<{ user_id: string }>('select user_id from kyvo.billing_customers where stripe_customer_id = $1', [customer]);
    return c?.user_id ?? null;
  }

  private async upsertSubscription(tx: Tx, sub: any, eventCreated: number): Promise<void> {
    const userId = await this.userForCustomer(tx, sub.customer, sub.metadata?.user_id);
    const item = sub.items?.data?.[0];
    const periodEnd = sub.current_period_end ?? item?.current_period_end ?? null;
    await tx.exec(
      `insert into kyvo.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, price_id, plan_interval, current_period_end, cancel_at_period_end, stripe_updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (stripe_subscription_id) do update set user_id = coalesce(excluded.user_id, kyvo.subscriptions.user_id), status = excluded.status,
         price_id = excluded.price_id, plan_interval = excluded.plan_interval, current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end, stripe_updated_at = excluded.stripe_updated_at, updated_at = now()
       where kyvo.subscriptions.stripe_updated_at <= excluded.stripe_updated_at`,
      [sub.id, userId, sub.customer, sub.status, item?.price?.id ?? null, intervalOf(item?.price?.recurring?.interval), periodEnd ? new Date(periodEnd * 1000) : null, !!sub.cancel_at_period_end, eventCreated ?? 0],
    );
  }
}

/** Stripe's recurring interval ('month' | 'year') as KYVO's plan name. */
export function intervalOf(stripeInterval: string | undefined): PlanInterval | null {
  return stripeInterval === 'year' ? 'annual' : stripeInterval === 'month' ? 'monthly' : null;
}
