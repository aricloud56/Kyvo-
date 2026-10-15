// Shared test helpers: a migrated + seeded test database, an app instance on a random port, and a cookie-aware client.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig, type Config } from '../src/server/config.js';
import { createApp, type App } from '../src/server/app.js';
import { migrate } from '../src/server/migrate.js';
import { seedContent } from '../src/server/seed.js';
import { Db } from '../src/server/lib/db.js';
import { parseDatabaseUrl } from '../src/server/lib/pg.js';
import { DATA_DIR, MIGRATIONS_DIR } from '../src/server/paths.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://kyvo_app:kyvo_app_dev@127.0.0.1:5433/kyvo_test';
export const TEST_DB_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:devpass@127.0.0.1:5433/kyvo_test';
export const WEBHOOK_SECRET = 'whsec_test_kyvo';

let prepared = false;
/** Apply migrations and seed content once per process (both are idempotent). */
export async function prepareDatabase(): Promise<void> {
  if (prepared) return;
  await migrate(parseDatabaseUrl(TEST_DB_ADMIN_URL), MIGRATIONS_DIR, () => undefined);
  const admin = new Db(parseDatabaseUrl(TEST_DB_ADMIN_URL), 1);
  await admin.asSystem((tx) => seedContent(tx, DATA_DIR));
  await admin.close();
  prepared = true;
}

export function adminDb(): Db {
  return new Db(parseDatabaseUrl(TEST_DB_ADMIN_URL), 2);
}

export interface Running {
  app: App;
  base: string;
  cfg: Config;
  close(): Promise<void>;
}

export async function startApp(overrides: Record<string, string> = {}): Promise<Running> {
  await prepareDatabase();
  const cfg = loadConfig({ DATABASE_URL: TEST_DB_URL, STORAGE_DIR: './storage-test', AUTH_RATE_LIMIT: '1000', ...overrides });
  const app = await createApp(cfg);
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  cfg.baseUrl = overrides.APP_BASE_URL ?? base;
  return { app, base, cfg, close: () => app.close() };
}

/** Minimal API client that keeps the session cookie, like a browser would. */
export class Client {
  cookie = '';
  constructor(public base: string) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: Headers }> {
    const r = await fetch(this.base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Kyvo-Request': '1', ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      if (name === 'kyvo_session') this.cookie = value ? `kyvo_session=${value}` : '';
    }
    const text = await r.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: r.status, body: parsed, headers: r.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  put = (p: string, b: unknown = {}) => this.req('PUT', p, b);
  patch = (p: string, b: unknown = {}) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);
}

export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.kyvo`;

export const SAMPLE_PROFILE = {
  displayName: 'Test', ageRange: '25-34', sex: 'female', heightCm: 168, weightKg: 64, goal: 'fat_loss', experience: 'beginner', location: 'gym',
  equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bench', 'rack', 'pullup_bar', 'plate', 'bodyweight', 'mat'], trainingDays: [1, 3, 5],
  sessionMinutes: 45, trainingStyle: 'balanced', diet: 'none', allergies: [], exclusions: [], units: 'metric', activity: 'light', hydrationEnabled: false, hydrationTargetMl: 2500,
};

/** Register and onboard a user through the public API. */
export async function newUser(base: string, profile: Record<string, unknown> = {}, email = uniqueEmail('user')): Promise<{ client: Client; email: string; today: string; id: string }> {
  const client = new Client(base);
  const reg = await client.post('/api/auth/register', { email, password: 'correct-horse-battery', ageConfirmed: true, acceptTerms: true });
  if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  const ob = await client.post('/api/onboarding', { profile: { ...SAMPLE_PROFILE, ...profile }, timezone: 'Australia/Sydney' });
  if (ob.status !== 200) throw new Error(`onboarding failed: ${JSON.stringify(ob.body)}`);
  const me = await client.get('/api/me');
  return { client, email, today: ob.body.today, id: me.body.user.id };
}

/** A fake Stripe API good enough for checkout, subscription fetch, portal and cancellation. */
export class MockStripe {
  server = http.createServer((req, res) => void this.handle(req, res));
  base = '';
  subs = new Map<string, any>();
  sessions = new Map<string, any>();
  calls: string[] = [];
  private n = 0;
  private runId = Date.now().toString(36);
  appBase = '';

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  close() {
    this.server.close();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
    const url = new URL(req.url!, this.base);
    this.calls.push(`${req.method} ${url.pathname}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.startsWith('/v1/') && req.headers.authorization !== 'Bearer sk_test_mock') return send(401, { error: { message: 'bad key' } });
    if (req.method === 'POST' && url.pathname === '/v1/customers') return send(200, { id: `cus_${this.runId}_${++this.n}` });
    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const id = `cs_${this.runId}_${++this.n}`;
      this.sessions.set(id, form);
      return send(200, { id, url: `${this.base}/pay/${id}` });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v1/subscriptions/')) {
      const s = this.subs.get(url.pathname.split('/').pop()!);
      return s ? send(200, s) : send(404, {});
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/v1/subscriptions/')) {
      const s = this.subs.get(url.pathname.split('/').pop()!);
      if (s) s.status = 'canceled';
      return s ? send(200, s) : send(404, {});
    }
    if (req.method === 'POST' && url.pathname === '/v1/billing_portal/sessions') return send(200, { url: `${this.base}/portal/${form.customer}` });
    // Hosted pages a browser visits.
    if (req.method === 'GET' && url.pathname.startsWith('/pay/')) {
      const s = this.sessions.get(url.pathname.split('/').pop()!);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<h1>Mock checkout</h1><form method="post"><button id="pay">Pay A$9.99</button></form><a id="cancel" href="${s.cancel_url}">Back</a>`);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/pay/')) {
      const id = url.pathname.split('/').pop()!;
      const s = this.sessions.get(id);
      await this.completeCheckout(id, s);
      res.writeHead(303, { Location: s.success_url });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname.startsWith('/portal/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<h1>Mock billing portal</h1><form method="post"><button id="cancel-plan">Cancel plan</button></form>');
    }
    if (req.method === 'POST' && url.pathname.startsWith('/portal/')) {
      const customer = url.pathname.split('/').pop()!;
      for (const sub of this.subs.values()) if (sub.customer === customer) await this.update(sub, { cancel_at_period_end: true });
      res.writeHead(303, { Location: `${this.appBase}/app/premium` });
      return res.end();
    }
    send(404, { error: { message: `mock: no route ${req.method} ${url.pathname}` } });
  }

  async completeCheckout(sessionId: string, s: any) {
    const subId = `sub_${this.runId}_${++this.n}`;
    const interval = s['line_items[0][price]'] === 'price_annual' ? 'year' : 'month';
    const sub = {
      id: subId, customer: s.customer, status: 'active', cancel_at_period_end: false, metadata: { user_id: s['subscription_data[metadata][user_id]'] },
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, items: { data: [{ price: { id: s['line_items[0][price]'], recurring: { interval } } }] },
    };
    this.subs.set(subId, sub);
    await this.sendEvent('checkout.session.completed', { id: sessionId, customer: s.customer, client_reference_id: s.client_reference_id, subscription: subId });
  }

  async update(sub: any, patch: Record<string, unknown>, type = 'customer.subscription.updated') {
    Object.assign(sub, patch);
    await this.sendEvent(type, { ...sub });
  }

  eventCounter = 0;
  async sendEvent(type: string, object: unknown, id = `evt_${Date.now()}_${++this.eventCounter}`): Promise<Response> {
    const { signStripePayload } = await import('../src/server/services/billing.js');
    const payload = JSON.stringify({ id, type, created: Math.floor(Date.now() / 1000) + this.eventCounter, data: { object } });
    return fetch(`${this.appBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signStripePayload(payload, WEBHOOK_SECRET) }, body: payload });
  }
}

export function stripeEnv(mock: MockStripe): Record<string, string> {
  return { STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY: 'price_monthly', STRIPE_PRICE_ANNUAL: 'price_annual', STRIPE_API_BASE: mock.base };
}
