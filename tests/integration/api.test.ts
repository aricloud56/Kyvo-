// Integration tests against a real PostgreSQL database (kyvo_test) through the HTTP API and directly via RLS.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, MockStripe, adminDb, newUser, startApp, stripeEnv, type Running } from '../helpers.js';
import { signStripePayload } from '../../src/server/services/billing.js';
import { Db } from '../../src/server/lib/db.js';
import { addDays } from '../../src/core/util.js';

let run: Running;
let stripe: MockStripe;
let admin: Db;

before(async () => {
  stripe = new MockStripe();
  await stripe.start();
  run = await startApp(stripeEnv(stripe));
  stripe.appBase = run.base;
  admin = adminDb();
});
after(async () => {
  await run.close();
  stripe.close();
  await admin.close();
});

describe('content', () => {
  test('database holds at least 150 unique, published exercises (177 expected)', async () => {
    const r = await admin.asSystem((tx) => tx.one<{ n: number; names: number; ids: number }>('select count(*)::int as n, count(distinct lower(name))::int as names, count(distinct id)::int as ids from kyvo.exercises where published'));
    assert.equal(r.n, 177);
    assert.equal(r.names, r.n);
    assert.equal(r.ids, r.n);
    const orphanMedia = await admin.asSystem((tx) => tx.one<{ n: number }>('select count(*)::int as n from kyvo.exercise_media m left join kyvo.exercises e on e.id = m.exercise_id where e.id is null'));
    assert.equal(orphanMedia.n, 0);
    const recipes = await admin.asSystem((tx) => tx.one<{ n: number }>('select count(*)::int as n from kyvo.recipes'));
    assert.ok(recipes.n >= 30);
  });

  test('health endpoint reports database and content', async () => {
    const r = await new Client(run.base).get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.database, true);
    assert.equal(r.body.exercises, 177);
  });
});

describe('auth and request protection', () => {
  test('API requires a session and the CSRF header', async () => {
    const anon = new Client(run.base);
    assert.equal((await anon.get('/api/plan/2026-10-14')).status, 401);
    const { client } = await newUser(run.base);
    const noHeader = await fetch(`${run.base}/api/consent`, { method: 'POST', headers: { Cookie: client.cookie, 'Content-Type': 'application/json' }, body: '{"analytics":true}' });
    assert.equal(noHeader.status, 403);
  });

  test('registration needs 18+ confirmation, terms and a 10+ character password', async () => {
    const c = new Client(run.base);
    assert.equal((await c.post('/api/auth/register', { email: 'x1@test.kyvo', password: 'short', ageConfirmed: true, acceptTerms: true })).status, 400);
    assert.equal((await c.post('/api/auth/register', { email: 'x2@test.kyvo', password: 'long-enough-pw', ageConfirmed: false, acceptTerms: true })).status, 400);
  });

  test('wrong passwords are rejected without revealing whether the email exists', async () => {
    const { email } = await newUser(run.base);
    const c = new Client(run.base);
    const a = await c.post('/api/auth/login', { email, password: 'wrong-password-1' });
    const b = await c.post('/api/auth/login', { email: 'nobody-here@test.kyvo', password: 'wrong-password-1' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error, b.body.error);
  });
});

describe('rate limiting', () => {
  test('repeated failed sign-ins are throttled', async () => {
    const small = await startApp({ AUTH_RATE_LIMIT: '3' });
    try {
      const c = new Client(small.base);
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await c.post('/api/auth/login', { email: 'brute@test.kyvo', password: `guess-${i}-xxxxx` })).status);
      assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    } finally {
      await small.close();
    }
  });
});

describe('row level security', () => {
  test('a user cannot read or write another user’s rows, even with direct SQL as the app role', async () => {
    const a = await newUser(run.base);
    const b = await newUser(run.base);
    await a.client.post(`/api/diary/${a.today}`, { slot: 'lunch', name: 'Private sandwich', kcal: 500, p: 30, c: 50, f: 15 });
    await a.client.post('/api/metrics', { date: a.today, weightKg: 70, waistCm: 80 });
    const db = run.app.db;
    for (const table of ['food_logs', 'body_metrics', 'daily_plans', 'profiles', 'nutrition_targets', 'user_workouts', 'attribution']) {
      const rows = await db.asUser(b.id, (tx) => tx.query(`select * from kyvo.${table} where user_id = $1`, [a.id]));
      assert.equal(rows.length, 0, `${table} leaked`);
    }
    const users = await db.asUser(b.id, (tx) => tx.query('select id from kyvo.users'));
    assert.deepEqual(users.map((u: any) => u.id), [b.id]);
    await assert.rejects(db.asUser(b.id, (tx) => tx.exec("insert into kyvo.food_logs (user_id, log_date, meal_slot, name, kcal, protein, carbs, fat) values ($1, current_date, 'lunch', 'x', 1, 0, 0, 0)", [a.id])));
    const updated = await db.asUser(b.id, (tx) => tx.exec('update kyvo.food_logs set kcal = 1 where user_id = $1', [a.id]));
    assert.equal(updated, 0);
    const anonRows = await db.asAnon((tx) => tx.query('select * from kyvo.food_logs'));
    assert.equal(anonRows.length, 0);
  });

  test('users cannot grant themselves admin or Premium, and cannot edit shared content', async () => {
    const a = await newUser(run.base);
    const db = run.app.db;
    await assert.rejects(db.asUser(a.id, (tx) => tx.exec("update kyvo.users set role = 'admin' where id = $1", [a.id])));
    await assert.rejects(db.asUser(a.id, (tx) => tx.exec("insert into kyvo.subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status) values ('sub_fake', $1, 'cus_fake', 'active')", [a.id])));
    const n = await db.asUser(a.id, (tx) => tx.exec("update kyvo.exercises set premium = false where id = 'barbell-bench-press'"));
    assert.equal(n, 0);
    // The profile API ignores unknown fields such as "premium".
    await a.client.put('/api/profile', { premium: true, role: 'admin' });
    const me = await a.client.get('/api/me');
    assert.equal(me.body.premium, false);
    assert.equal(me.body.user.role, 'user');
  });

  test('API returns 404 for another user’s workout, diary entry and photos', async () => {
    const a = await newUser(run.base);
    const b = await newUser(run.base);
    const s = await a.client.post('/api/sessions', {});
    const entry = await a.client.post(`/api/diary/${a.today}`, { slot: 'dinner', name: 'Secret', kcal: 400 });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(entry.status, 200, JSON.stringify(entry.body));
    assert.equal((await b.client.get(`/api/sessions/${s.body.id}`)).status, 404);
    assert.equal((await b.client.patch(`/api/diary/entry/${entry.body.id}`, { kcal: 1 })).status, 404);
    assert.equal((await b.client.del(`/api/diary/entry/${entry.body.id}`)).status, 404);
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const photo = await a.client.post('/api/photos', { dataBase64: png.toString('base64'), date: a.today });
    assert.equal(photo.status, 200);
    assert.equal((await b.client.get(`/api/photos/${photo.body.id}/image`)).status, 404);
    assert.equal((await a.client.get(`/api/photos/${photo.body.id}/image`)).status, 200);
    assert.equal((await new Client(run.base).get(`/api/photos/${photo.body.id}/image`)).status, 401);
  });

  test('admin endpoints are refused for normal users and anonymous visitors', async () => {
    const a = await newUser(run.base);
    for (const p of ['/api/admin/overview', '/api/admin/quality', '/api/admin/errors', '/api/admin/billing-events']) {
      assert.equal((await a.client.get(p)).status, 403, p);
      assert.equal((await new Client(run.base).get(p)).status, 401, p);
    }
    const adminUser = await newUser(run.base, {}, `admin-${Date.now()}@test.kyvo`);
    assert.equal((await adminUser.client.get('/api/admin/overview')).status, 403, 'an admin-looking email must not grant admin');
    // Only an operator (the make-admin CLI, run with database admin rights) can grant the role.
    await admin.asSystem((tx) => tx.exec("update kyvo.users set role = 'admin' where id = $1", [adminUser.id]));
    assert.equal((await adminUser.client.get('/api/admin/overview')).status, 200, 'operator-granted admin can open the dashboard');
  });
});

describe('daily plan', () => {
  test('onboarding creates a complete first plan immediately', async () => {
    const a = await newUser(run.base, { diet: 'vegetarian', allergies: ['peanut'], exclusions: ['mushroom'] });
    const d = await a.client.get(`/api/plan/${a.today}`);
    assert.equal(d.status, 200);
    assert.ok(d.body.plan.meals.length >= 3);
    assert.ok(d.body.plan.targets.kcal > 1000);
    assert.ok(d.body.checklist.length >= 4);
    const prog = await a.client.get('/api/program');
    assert.ok(prog.body.workouts.length >= 2);
  });

  test('regenerating meals never deletes logged food, finished workouts or past plans', async () => {
    const a = await newUser(run.base);
    const past = addDays(a.today, -1);
    const pastPlan = (await a.client.get(`/api/plan/${past}`)).body.plan;
    await a.client.post(`/api/diary/${a.today}`, { slot: 'breakfast', name: 'Eggs', kcal: 300, p: 20 });
    const s = await a.client.post('/api/sessions', { workoutId: (await a.client.get('/api/program')).body.workouts[0].id });
    const sess = await a.client.get(`/api/sessions/${s.body.id}`);
    const ex = sess.body.planned[0];
    await a.client.put(`/api/sessions/${s.body.id}/sets`, { exerciseId: ex.exerciseId, setIndex: 0, weightKg: 40, reps: 8 });
    assert.equal((await a.client.post(`/api/sessions/${s.body.id}/finish`, {})).status, 200);
    assert.equal((await a.client.post(`/api/plan/${a.today}/regenerate`, { part: 'all' })).status, 200);
    assert.equal((await a.client.post(`/api/plan/${past}/regenerate`, { part: 'meals' })).status, 400);
    const diary = await a.client.get(`/api/diary/${a.today}`);
    assert.equal(diary.body.entries.length, 1);
    const hist = await a.client.get('/api/sessions');
    assert.equal(hist.body.length, 1);
    assert.deepEqual((await a.client.get(`/api/plan/${past}`)).body.plan, pastPlan);
  });

  test('logging a planned meal ticks the checklist; un-ticking is kept', async () => {
    const a = await newUser(run.base);
    await a.client.post(`/api/plan/${a.today}/meals/lunch/log`);
    let d = await a.client.get(`/api/plan/${a.today}`);
    assert.ok(d.body.checklist.find((c: any) => c.key === 'meal_lunch').done);
    assert.ok(d.body.eaten.kcal > 0);
    await a.client.post(`/api/plan/${a.today}/checklist/meal_lunch`, { done: false });
    d = await a.client.get(`/api/plan/${a.today}`);
    assert.equal(d.body.checklist.find((c: any) => c.key === 'meal_lunch').done, false);
  });
});

describe('free tier limits and premium gating', () => {
  test('free users can keep 3 custom workouts and cannot open Premium exercises', async () => {
    const a = await newUser(run.base);
    const body = { name: 'Mine', exercises: [{ exerciseId: 'push-up', sets: 3, repMin: 8, repMax: 12, restSec: 60, mode: 'reps' }] };
    for (let i = 0; i < 3; i++) assert.equal((await a.client.post('/api/workouts', body)).status, 200);
    assert.equal((await a.client.post('/api/workouts', body)).status, 402);
    const locked = (await a.client.get('/api/exercises')).body.exercises.find((e: any) => e.locked);
    const detail = await a.client.get(`/api/exercises/${locked.id}`);
    assert.equal(detail.body.locked, true);
    assert.equal(detail.body.content, null);
  });
});

describe('billing webhooks', () => {
  const send = (payload: string, sig: string) => fetch(`${run.base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body: payload });

  test('unsigned or forged webhooks are rejected and change nothing', async () => {
    const payload = JSON.stringify({ id: 'evt_forged', type: 'customer.subscription.updated', created: 1, data: { object: { id: 'sub_x', customer: 'cus_x', status: 'active' } } });
    assert.equal((await send(payload, 'garbage')).status, 400);
    assert.equal((await send(payload, signStripePayload(payload, 'whsec_wrong'))).status, 400);
    const seen = await admin.asSystem((tx) => tx.maybeOne("select 1 from kyvo.billing_events where id = 'evt_forged'"));
    assert.equal(seen, null);
  });

  test('checkout grants Premium only via the verified webhook; duplicates are ignored', async () => {
    const a = await newUser(run.base);
    const co = await a.client.post('/api/billing/checkout', { interval: 'monthly' });
    assert.equal(co.status, 200);
    assert.equal((await a.client.get('/api/me')).body.premium, false, 'no Premium before payment is confirmed');
    const sessionId = co.body.url.split('/').pop();
    await stripe.completeCheckout(sessionId, stripe.sessions.get(sessionId));
    assert.equal((await a.client.get('/api/me')).body.premium, true);
    const billing = await a.client.get('/api/billing');
    assert.equal(billing.body.subscription.interval, 'monthly');
    // Re-deliver the same event id: processed once only.
    const sub = [...stripe.subs.values()].find((s) => s.metadata.user_id === a.id);
    const dupId = `evt_dup_${Date.now()}`;
    const r1 = await stripe.sendEvent('customer.subscription.updated', sub, dupId);
    const r2 = await stripe.sendEvent('customer.subscription.updated', sub, dupId);
    assert.equal(((await r1.json()) as any).result, 'processed');
    assert.equal(((await r2.json()) as any).result, 'duplicate');
  });

  test('cancellation keeps access to period end; deletion and out-of-order events are handled', async () => {
    const a = await newUser(run.base);
    const co = await a.client.post('/api/billing/checkout', { interval: 'annual' });
    const sid = co.body.url.split('/').pop();
    await stripe.completeCheckout(sid, stripe.sessions.get(sid));
    const sub = [...stripe.subs.values()].find((s) => s.metadata.user_id === a.id);
    await stripe.update(sub, { cancel_at_period_end: true });
    let b = await a.client.get('/api/billing');
    assert.equal(b.body.premium, true);
    assert.equal(b.body.subscription.cancelAtPeriodEnd, true);
    assert.equal(b.body.subscription.interval, 'annual');
    await stripe.update(sub, { status: 'canceled' }, 'customer.subscription.deleted');
    assert.equal((await a.client.get('/api/me')).body.premium, false);
    // A stale "active" event arriving late must not resurrect access.
    const stale = JSON.stringify({ id: `evt_stale_${Date.now()}`, type: 'customer.subscription.updated', created: 1000, data: { object: { ...sub, status: 'active' } } });
    assert.equal((await send(stale, signStripePayload(stale, 'whsec_test_kyvo'))).status, 200);
    assert.equal((await a.client.get('/api/me')).body.premium, false);
  });

  test('failed payment: past_due keeps a short grace period, unpaid ends access', async () => {
    const a = await newUser(run.base);
    const co = await a.client.post('/api/billing/checkout', { interval: 'monthly' });
    const sid = co.body.url.split('/').pop();
    await stripe.completeCheckout(sid, stripe.sessions.get(sid));
    const sub = [...stripe.subs.values()].find((s) => s.metadata.user_id === a.id);
    await stripe.update(sub, { status: 'past_due' });
    assert.equal((await a.client.get('/api/me')).body.premium, true);
    await stripe.update(sub, { status: 'unpaid' });
    assert.equal((await a.client.get('/api/me')).body.premium, false);
  });
});

describe('account', () => {
  test('export contains the user’s data; deletion removes it and cancels billing', async () => {
    const a = await newUser(run.base);
    await a.client.post(`/api/diary/${a.today}`, { slot: 'lunch', name: 'Soup', kcal: 250 });
    const exp = await a.client.get('/api/account/export');
    assert.equal(exp.status, 200);
    assert.equal(exp.body.food_logs.length, 1);
    assert.equal((await a.client.post('/api/account/delete', { password: 'wrong-password-x' })).status, 400);
    assert.equal((await a.client.post('/api/account/delete', { password: 'correct-horse-battery' })).status, 200);
    const left = await admin.asSystem((tx) => tx.one<{ n: number }>('select (select count(*) from kyvo.users where id = $1) + (select count(*) from kyvo.food_logs where user_id = $1) as n', [a.id]));
    assert.equal(Number(left.n), 0);
  });
});
