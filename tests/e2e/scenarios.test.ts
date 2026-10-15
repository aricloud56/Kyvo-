// End-to-end scenarios A–G in a real browser (Chromium via Playwright) at phone size, against a real server,
// a real PostgreSQL test database and a local mock of the Stripe API.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { MockStripe, newUser, startApp, stripeEnv, uniqueEmail, type Running } from '../helpers.js';
import { weekdayOf } from '../../src/core/util.js';

let run: Running;
let stripe: MockStripe;
let browser: Browser;

before(async () => {
  stripe = new MockStripe();
  await stripe.start();
  run = await startApp(stripeEnv(stripe));
  stripe.appBase = run.base;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  await run?.close();
  stripe?.close();
});

async function phone(): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

async function signedIn(user: { client: { cookie: string } }) {
  const p = await phone();
  const [name, value] = user.client.cookie.split('=');
  await p.ctx.addCookies([{ name, value, url: run.base }]);
  return p;
}

async function noHorizontalScroll(page: Page, where: string) {
  const over = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth") as number;
  assert.ok(over <= 1, `${where} scrolls sideways by ${over}px`);
}

test('A: new user registers, onboards and gets a populated Daily Plan', async () => {
  const { ctx, page, errors } = await phone();
  await page.goto(`${run.base}/l/daily-plan?utm_source=tiktok&utm_campaign=e2e`);
  await noHorizontalScroll(page, 'landing page');
  await page.click('a.btn-lg');
  const email = uniqueEmail('e2e-a');
  await page.fill('#email', email);
  await page.fill('#password', 'correct-horse-battery');
  await page.check('input[name=ageConfirmed]');
  await page.check('input[name=acceptTerms]');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=About you');
  await page.click('[data-field=ageRange][data-value="25-34"]');
  await page.click('[data-field=sex][data-value=female]');
  await page.fill('#h', '165');
  await page.fill('#w', '62');
  for (let i = 0; i < 4; i++) {
    await page.click('button[type=submit]');
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('text=Create my plan');
  await page.click('button[type=submit]');
  await page.waitForURL(/#\/today/);
  await page.waitForSelector('.greet h1');
  assert.equal(await page.locator('article.meal').count(), 4, 'four meals planned');
  assert.ok(await page.locator('.checklist button').count() >= 4, 'checklist present');
  const hasWorkoutOrRest = (await page.locator('.workout-card').count()) + (await page.locator('text=Rest day').count());
  assert.ok(hasWorkoutOrRest > 0);
  await noHorizontalScroll(page, 'Daily Plan');
  // Attribution was captured from the landing page and stored server-side.
  const attr = await run.app.db.asSystem((tx) => tx.query<any>('select a.utm_source, a.utm_campaign from kyvo.attribution a join kyvo.users u on u.id = a.user_id where u.email = $1', [email]));
  assert.equal(attr[0]?.utm_source, 'tiktok');
  assert.equal(attr[0]?.utm_campaign, 'e2e');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('B: start the planned workout, log sets, finish, refresh and the session is still saved', async () => {
  const u = await newUser(run.base, { trainingDays: [0, 1, 2, 3, 4, 5, 6] });
  const { ctx, page, errors } = await signedIn(u);
  await page.goto(`${run.base}/app#/today`);
  await page.waitForSelector('.greet h1');
  if (await page.locator('[data-action=train-anyway]').count()) {
    await page.click('[data-action=train-anyway]');
    await page.locator('.sheet [data-w]').first().click();
    await page.waitForSelector('[data-action=start]');
  }
  await page.click('[data-action=start]');
  await page.waitForURL(/#\/workout/);
  const first = page.locator('section.card').filter({ has: page.locator('.set-row') }).first();
  const rows = first.locator('.set-row');
  for (let i = 0; i < 2; i++) {
    const row = rows.nth(i);
    if (await row.locator('[data-f=w]').count()) await row.locator('[data-f=w]').fill('40');
    await row.locator('[data-f=v]').fill('10');
    await row.locator('[data-action=done]').click();
    await page.waitForTimeout(250);
  }
  await page.click('[data-action=finish]');
  await page.click('#fin button[type=submit]');
  await page.waitForURL(/#\/session\//);
  const url = page.url();
  await page.reload();
  await page.waitForSelector('h1');
  assert.equal(page.url(), url);
  assert.ok((await page.locator('table.data tbody tr').count()) >= 2, 'logged sets survive a refresh');
  const hist = await u.client.get('/api/sessions');
  assert.equal(hist.body.length, 1);
  assert.equal(hist.body[0].sets, 2);
  await page.goto(`${run.base}/app#/today`);
  await page.waitForSelector('.greet h1');
  assert.ok(await page.locator('text=Completed').count(), 'today shows the workout as completed');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('C: log a food, change the serving size and the totals update', async () => {
  const u = await newUser(run.base);
  const { ctx, page, errors } = await signedIn(u);
  await page.goto(`${run.base}/app#/nutrition`);
  await page.waitForSelector('h1:text("Nutrition")');
  await page.click('[data-action=add][data-slot=lunch]');
  await page.fill('#fq', 'rolled oats');
  await page.locator('#fr [data-food]:has-text("Rolled oats")').first().click();
  await page.fill('#fg', '100');
  await page.locator('form:has(#fg) button[type=submit]').click();
  await page.waitForTimeout(400);
  const d1 = (await u.client.get(`/api/diary/${u.today}`)).body;
  assert.equal(d1.entries.length, 1);
  const kcal100 = d1.totals.kcal;
  assert.ok(kcal100 > 300 && kcal100 < 420, `100 g oats = ${kcal100} kcal`);
  await page.waitForSelector('[data-action=edit]');
  assert.match(await page.locator('#tot-h + div, section[aria-labelledby=tot-h]').first().innerText(), new RegExp(String(Math.round(kcal100))));
  await page.click('[data-action=edit]');
  await page.fill('#ea', '150');
  await page.click('.sheet button[type=submit]');
  await page.waitForTimeout(400);
  const d2 = (await u.client.get(`/api/diary/${u.today}`)).body;
  assert.equal(Math.round(d2.totals.kcal), Math.round(kcal100 * 1.5));
  assert.ok(Math.abs(d2.totals.p - d1.totals.p * 1.5) < 0.2);
  assert.match(await page.locator('section[aria-labelledby=tot-h]').innerText(), new RegExp(String(Math.round(kcal100 * 1.5))));
  await noHorizontalScroll(page, 'nutrition');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D: swap a suggested meal and the plan and totals update', async () => {
  const u = await newUser(run.base);
  const before = (await u.client.get(`/api/plan/${u.today}`)).body.plan;
  const lunch = before.meals.find((m: any) => m.slot === 'lunch');
  const { ctx, page, errors } = await signedIn(u);
  await page.goto(`${run.base}/app#/today`);
  await page.waitForSelector('.greet h1');
  await page.click('[data-action=swap][data-slot=lunch]');
  const option = page.locator('.sheet [data-r]').first();
  const chosen = await option.getAttribute('data-r');
  await option.click();
  await page.waitForTimeout(500);
  const after = (await u.client.get(`/api/plan/${u.today}`)).body.plan;
  const newLunch = after.meals.find((m: any) => m.slot === 'lunch');
  assert.equal(newLunch.recipeId, chosen);
  assert.notEqual(newLunch.recipeId, lunch.recipeId);
  assert.equal(after.plannedTotals.kcal, Math.round(after.meals.reduce((a: number, m: any) => a + m.kcal, 0)));
  assert.deepEqual(after.meals.filter((m: any) => m.slot !== 'lunch'), before.meals.filter((m: any) => m.slot !== 'lunch'), 'other meals unchanged');
  assert.ok(await page.locator(`article.meal:has-text("${newLunch.name.replace(/"/g, '')}")`).count());
  assert.match(await page.locator('#m-h + span, .row:has(#m-h) span').first().innerText(), new RegExp(after.plannedTotals.kcal.toLocaleString('en-AU')));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('E: a rest day has no workout requirement', async () => {
  const u0 = await newUser(run.base);
  const restDay = weekdayOf(u0.today);
  const u = await newUser(run.base, { trainingDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== restDay).slice(0, 3) });
  const plan = (await u.client.get(`/api/plan/${u.today}`)).body;
  assert.equal(plan.plan.isRest, true);
  assert.equal(plan.workoutStatus, 'rest');
  assert.ok(!plan.checklist.some((c: any) => c.key === 'workout'));
  const { ctx, page, errors } = await signedIn(u);
  await page.goto(`${run.base}/app#/today`);
  await page.waitForSelector('.next-eyebrow:has-text("Rest day")');
  assert.equal(await page.locator('[data-action=start]').count(), 0);
  assert.equal(await page.locator('.checklist :text("Complete today")').count(), 0);
  // Completing every required task on a rest day earns the end-of-day summary without any workout.
  for (const slot of ['breakfast', 'lunch', 'dinner']) await u.client.post(`/api/plan/${u.today}/meals/${slot}/log`);
  await u.client.post(`/api/plan/${u.today}/checklist/review`, { done: true });
  const done = (await u.client.get(`/api/plan/${u.today}`)).body;
  assert.ok(done.summary, 'summary shown once all tasks are done');
  assert.equal(done.summary.workout, 'rest');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('F: test checkout grants Premium, cancelling keeps it to period end, then access ends', async () => {
  const u = await newUser(run.base);
  const { ctx, page, errors } = await signedIn(u);
  await page.goto(`${run.base}/app#/premium`);
  await page.click('[data-action=checkout][data-interval=monthly]');
  await page.waitForSelector('#pay');
  assert.equal((await u.client.get('/api/me')).body.premium, false, 'not Premium before payment');
  await page.click('#pay');
  await page.waitForURL(/checkout=success/);
  await page.waitForSelector('text=Premium is now active');
  assert.equal((await u.client.get('/api/me')).body.premium, true);
  const locked = (await u.client.get('/api/exercises')).body.exercises.filter((e: any) => e.locked);
  assert.equal(locked.length, 0, 'Premium unlocks the full library');
  await page.click('[data-action=portal]');
  await page.click('#cancel-plan');
  await page.waitForSelector('text=You have Premium');
  await page.waitForSelector('text=ends on');
  const b = (await u.client.get('/api/billing')).body;
  assert.equal(b.premium, true);
  assert.equal(b.subscription.cancelAtPeriodEnd, true);
  // Period ends: Stripe sends the deletion.
  const sub = [...stripe.subs.values()].find((s) => s.metadata.user_id === u.id);
  await stripe.update(sub, { status: 'canceled' }, 'customer.subscription.deleted');
  await page.reload();
  await page.waitForSelector('text=Choose monthly');
  assert.equal((await u.client.get('/api/me')).body.premium, false);
  assert.ok((await u.client.get('/api/exercises')).body.exercises.some((e: any) => e.locked));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('G: another user’s data and the admin pages are not reachable', async () => {
  const a = await newUser(run.base);
  const s = await a.client.post('/api/sessions', {});
  await a.client.post(`/api/diary/${a.today}`, { slot: 'dinner', name: 'A’s private dinner', kcal: 700 });
  const b = await newUser(run.base);
  const { ctx, page } = await signedIn(b);
  await page.goto(`${run.base}/app#/session/${s.body.id}`);
  await page.waitForSelector('text=Something went wrong');
  assert.equal(await page.locator('text=A’s private dinner').count(), 0);
  await page.goto(`${run.base}/app#/nutrition/${a.today}`);
  await page.waitForSelector('h1:text("Nutrition")');
  assert.equal(await page.locator('text=A’s private dinner').count(), 0);
  await page.goto(`${run.base}/app#/admin`);
  await page.waitForSelector('text=You don’t have access');
  for (const p of ['/api/admin/overview', '/api/admin/errors']) {
    const r = await page.request.get(`${run.base}${p}`, { headers: { 'X-Kyvo-Request': '1' } });
    assert.equal(r.status(), 403, p);
  }
  const anon = await browser.newContext();
  const r = await anon.request.get(`${run.base}/api/diary/${a.today}`, { headers: { 'X-Kyvo-Request': '1' } });
  assert.equal(r.status(), 401);
  const ap = await anon.newPage();
  await ap.goto(`${run.base}/app#/today`);
  await ap.waitForURL(/#\/login/);
  await anon.close();
  await ctx.close();
});
