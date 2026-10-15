// KYVO HTTP application: wires services to routes, serves static assets and server-rendered pages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Config } from './config.js';
import { Db } from './lib/db.js';
import { HttpError, RateLimiter, Router, badRequest, forbidden, newRequestId, notFound, parseCookies, premiumRequired, readBody, securityHeaders, sendJson, setCookie, unauthorized, type Ctx } from './lib/http.js';
import { bool, date, num, obj, oneOf, slug, str, uuid } from './lib/validate.js';
import { AuthService, EMAIL_RE, validatePassword, type Attribution } from './services/auth.js';
import { Catalog } from './services/catalog.js';
import { PlanService, currentTargets, loadProfile, premiumFor, refreshEstimatedTargets, saveTargets } from './services/plan.js';
import { TrainingService } from './services/training.js';
import { NutritionService } from './services/nutrition.js';
import { ProgressService } from './services/progress.js';
import { BillingService } from './services/billing.js';
import { createStorage, sniffImage, type Storage } from './services/storage.js';
import { affectedParts, parseProfile, profileUpdateSql } from './profileInput.js';
import { appShell, campaignPage, landingPage, legalPage } from './pages.js';
import { CLIENT_JS_DIR, PUBLIC_DIR } from './paths.js';
import { MEAL_SLOTS, type MealSlot } from '../core/types.js';
import { estimateTargets, validateManualTargets, recipeNutrition, scaleIngredients, allergensIn } from '../core/nutrition.js';
import { TEMPLATES, equipmentSet, substitutesFor } from '../core/workouts.js';
import { FREE_LIMITS } from '../core/plans.js';
import { CAMPAIGN_BY_SLUG } from '../core/campaigns.js';
import { todayIn, addDays } from '../core/util.js';

const SESSION_COOKIE = 'kyvo_session';
const MIME: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

export interface App {
  server: http.Server;
  db: Db;
  catalog: Catalog;
  cfg: Config;
  close(): Promise<void>;
}

export async function createApp(cfg: Config, opts: { storage?: Storage } = {}): Promise<App> {
  const db = new Db(cfg.db, 10);
  const catalog = new Catalog(db);
  await catalog.load();
  const auth = new AuthService(db, cfg.sessionDays);
  const plans = new PlanService(catalog);
  const training = new TrainingService(catalog, plans);
  const nutrition = new NutritionService(catalog, plans);
  const progress = new ProgressService(catalog);
  const billing = new BillingService(db, cfg);
  const storage = opts.storage ?? createStorage(cfg);
  const authLimiter = new RateLimiter(cfg.authRateLimit, 15 * 60 * 1000);
  const apiLimiter = new RateLimiter(600, 60 * 1000);
  const r = new Router();

  const today = async (userId: string) => todayIn((await db.asUser(userId, (tx) => loadProfile(tx, userId))).timezone);
  const historyLimit = async (userId: string) => ((await db.asUser(userId, (tx) => premiumFor(tx, userId))) ? null : FREE_LIMITS.historyDays);
  const uid = (c: Ctx) => c.user!.id;

  function startSession(c: Ctx, token: string) {
    setCookie(c.res, SESSION_COOKIE, token, { maxAge: cfg.sessionDays * 86400, secure: cfg.production });
  }

  /* ---------------- auth ---------------- */
  r.post('/api/auth/register', async (c) => {
    if (!authLimiter.check(`reg:${c.ip}`)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.', 'rate_limited');
    const b = obj(c.body);
    const email = str(b.email, 'Email', { max: 254, pattern: EMAIL_RE }).toLowerCase();
    const password = validatePassword(b.password);
    if (b.ageConfirmed !== true) throw badRequest('You need to be 18 or older to use KYVO.');
    if (b.acceptTerms !== true) throw badRequest('Please accept the Terms of Service and Privacy Policy.');
    let attribution: Attribution | null = null;
    try {
      const raw = c.cookies.kyvo_attr ? JSON.parse(c.cookies.kyvo_attr) : null;
      if (raw && typeof raw === 'object') {
        attribution = Object.fromEntries(Object.entries(raw).filter(([k, v]) => /^(utm_(source|medium|campaign|content|term)|landing_path|referrer_host|first_seen_at)$/.test(k) && typeof v === 'string').map(([k, v]) => [k, (v as string).slice(0, 120)]));
      }
    } catch {
      attribution = null;
    }
    const { token } = await auth.register(email, password, attribution, b.analyticsConsent === true);
    startSession(c, token);
    setCookie(c.res, 'kyvo_attr', '', { maxAge: 0 });
    return { ok: true };
  }, { auth: 'none' });

  r.post('/api/auth/login', async (c) => {
    const b = obj(c.body);
    const email = str(b.email, 'Email', { max: 254 }).toLowerCase();
    if (!authLimiter.check(`login:${c.ip}`) || !authLimiter.check(`login:${email}`)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.', 'rate_limited');
    const { token } = await auth.login(email, str(b.password, 'Password', { max: 200 }));
    startSession(c, token);
    return { ok: true };
  }, { auth: 'none' });

  r.post('/api/auth/logout', async (c) => {
    await auth.logout(c.user!.sessionId);
    setCookie(c.res, SESSION_COOKIE, '', { maxAge: 0, secure: cfg.production });
    return { ok: true };
  });

  r.post('/api/auth/password', async (c) => {
    const b = obj(c.body);
    await auth.changePassword(uid(c), str(b.current, 'Current password'), validatePassword(b.next));
    setCookie(c.res, SESSION_COOKIE, '', { maxAge: 0, secure: cfg.production });
    return { ok: true, signedOut: true };
  });

  r.get('/api/me', async (c) => {
    return db.asUser(uid(c), async (tx) => {
      const profile = await loadProfile(tx, uid(c));
      const premium = await premiumFor(tx, uid(c));
      const targets = await currentTargets(tx, uid(c));
      const u = await tx.one<{ analytics_consent: boolean }>('select analytics_consent from kyvo.users where id = $1', [uid(c)]);
      return { user: { id: c.user!.id, email: c.user!.email, role: c.user!.role, analyticsConsent: u.analytics_consent }, profile, onboarded: profile.onboarded, premium, targets, today: todayIn(profile.timezone), tiktokPixelId: cfg.tiktokPixelId };
    });
  });

  r.post('/api/consent', async (c) => {
    const b = obj(c.body);
    await db.asUser(uid(c), (tx) => tx.exec('update kyvo.users set analytics_consent = $2 where id = $1', [uid(c), bool(b.analytics, 'analytics')]));
    return { ok: true };
  });

  /* ---------------- onboarding & profile ---------------- */
  r.post('/api/onboarding', async (c) => {
    const b = obj(c.body);
    const p = parseProfile(b.profile, true);
    const tz = typeof b.timezone === 'string' && b.timezone.length < 60 && isValidTz(b.timezone) ? b.timezone : 'Australia/Sydney';
    return db.asUser(uid(c), async (tx) => {
      const { sets, values } = profileUpdateSql(p);
      await tx.exec(`update kyvo.profiles set ${sets.join(', ')}, timezone = $${values.length + 2}, onboarding_completed_at = coalesce(onboarding_completed_at, now()), updated_at = now() where user_id = $1`, [uid(c), ...values, tz]);
      const profile = await loadProfile(tx, uid(c));
      let targets = estimateTargets(profile);
      if (b.manualTargets) {
        const m = obj(b.manualTargets);
        const t = { kcal: num(m.kcal, 'Calories') as number, proteinG: num(m.proteinG, 'Protein') as number, carbsG: num(m.carbsG, 'Carbohydrate') as number, fatG: num(m.fatG, 'Fat') as number };
        const err = validateManualTargets(t);
        if (err) throw badRequest(err);
        targets = { ...t, source: 'manual', notes: ['You set these targets yourself.'] };
      }
      if (!targets) throw badRequest('Add your height, weight and age range for an estimate, or enter your own calorie and macro targets.');
      await saveTargets(tx, uid(c), targets);
      await plans.regenerateProgram(tx, uid(c));
      const day = todayIn(tz);
      await tx.exec('delete from kyvo.daily_plans where user_id = $1 and plan_date >= $2', [uid(c), day]); // re-onboarding: fresh plans from today
      await plans.getOrCreatePlan(tx, uid(c), day);
      const seen = await db.asSystem((s) => s.maybeOne("select 1 from kyvo.product_events where user_id = $1 and name = 'onboarding_complete'", [uid(c)]));
      if (!seen) await tx.exec("insert into kyvo.product_events (user_id, name) values ($1, 'onboarding_complete')", [uid(c)]);
      return { ok: true, today: day };
    });
  });

  r.put('/api/profile', async (c) => {
    const p = parseProfile(c.body, false);
    return db.asUser(uid(c), async (tx) => {
      const { sets, values } = profileUpdateSql(p);
      if (sets.length) await tx.exec(`update kyvo.profiles set ${sets.join(', ')}, updated_at = now() where user_id = $1`, [uid(c), ...values]);
      const profile = await loadProfile(tx, uid(c));
      const parts = affectedParts(p);
      const targets = parts.targets ? await refreshEstimatedTargets(tx, uid(c), profile) : await currentTargets(tx, uid(c));
      return { profile, targets, affects: parts };
    });
  });

  r.get('/api/targets', async (c) => db.asUser(uid(c), async (tx) => {
    const profile = await loadProfile(tx, uid(c));
    return { current: await currentTargets(tx, uid(c)), estimate: estimateTargets(profile) };
  }));

  r.put('/api/targets', async (c) => {
    const b = obj(c.body);
    return db.asUser(uid(c), async (tx) => {
      if (b.mode === 'estimate') {
        const est = estimateTargets(await loadProfile(tx, uid(c)));
        if (!est) throw badRequest('Add your height, weight and age range to use an estimate.');
        await saveTargets(tx, uid(c), est);
        return est;
      }
      const t = { kcal: num(b.kcal, 'Calories') as number, proteinG: num(b.proteinG, 'Protein') as number, carbsG: num(b.carbsG, 'Carbohydrate') as number, fatG: num(b.fatG, 'Fat') as number };
      const err = validateManualTargets(t);
      if (err) throw badRequest(err);
      const targets = { ...t, source: 'manual' as const, notes: ['You set these targets yourself.'] };
      await saveTargets(tx, uid(c), targets);
      return targets;
    });
  });

  /* ---------------- daily plan ---------------- */
  const planDate = (c: Ctx) => {
    const d = date(c.params.date);
    return d;
  };
  r.get('/api/plan/:date', async (c) => db.asUser(uid(c), (tx) => plans.dayView(tx, uid(c), planDate(c))));
  r.post('/api/plan/:date/checklist/:key', async (c) => {
    const b = obj(c.body);
    await db.asUser(uid(c), (tx) => plans.setChecklist(tx, uid(c), planDate(c), slug(c.params.key.replace(/_/g, '-'), 'key').replace(/-/g, '_'), bool(b.done, 'done')));
    return { ok: true };
  });
  r.post('/api/plan/:date/meals/:slot/log', async (c) => {
    const slot = oneOf(c.params.slot, 'slot', MEAL_SLOTS);
    const id = await db.asUser(uid(c), (tx) => nutrition.logPlanned(tx, uid(c), planDate(c), slot));
    return { ok: true, id };
  });
  r.get('/api/plan/:date/meals/:slot/swaps', async (c) => db.asUser(uid(c), (tx) => plans.swapOptions(tx, uid(c), planDate(c), oneOf(c.params.slot, 'slot', MEAL_SLOTS))));
  r.post('/api/plan/:date/meals/:slot/swap', async (c) => {
    const b = obj(c.body);
    const plan = await db.asUser(uid(c), (tx) => plans.swap(tx, uid(c), planDate(c), oneOf(c.params.slot, 'slot', MEAL_SLOTS), slug(b.recipeId, 'recipeId')));
    return { ok: true, plan };
  });
  r.post('/api/plan/:date/regenerate', async (c) => {
    const b = obj(c.body);
    const part = oneOf(b.part, 'part', ['meals', 'workout', 'all'] as const);
    return db.asUser(uid(c), async (tx) => {
      const d = planDate(c);
      const t = todayIn((await loadProfile(tx, uid(c))).timezone);
      if (d < t) throw badRequest('Past plans are kept as they were.');
      if (part !== 'meals') await plans.regenerateProgram(tx, uid(c));
      return { ok: true, plan: await plans.regenerate(tx, uid(c), d, part) };
    });
  });
  r.post('/api/hydration/:date', async (c) => {
    const ml = await db.asUser(uid(c), (tx) => nutrition.addWater(tx, uid(c), planDate(c), num(obj(c.body).addMl, 'addMl', { min: -2000, max: 2000, int: true }) as number));
    return { ml };
  });

  /* ---------------- exercises ---------------- */
  r.get('/api/exercises', async (c) => db.asUser(uid(c), async (tx) => {
    const premium = await premiumFor(tx, uid(c));
    const profile = await loadProfile(tx, uid(c));
    const favs = new Set((await tx.query<{ ref_id: string }>("select ref_id from kyvo.favourites where user_id = $1 and kind = 'exercise'", [uid(c)])).map((f) => f.ref_id));
    const eq = equipmentSet(profile);
    const q = (c.url.searchParams.get('q') || '').toLowerCase().trim().slice(0, 60);
    const group = c.url.searchParams.get('group') || '';
    const equipment = c.url.searchParams.get('equipment') || '';
    const difficulty = c.url.searchParams.get('difficulty') || '';
    const onlyFav = c.url.searchParams.get('favourites') === '1';
    const list = [...catalog.exercises.values()].filter((e) => {
      const content = catalog.exerciseContent.get(e.id)!;
      if (q && !(e.name.toLowerCase().includes(q) || (content.aliases ?? []).some((a: string) => a.toLowerCase().includes(q)))) return false;
      if (group && !e.groups.includes(group)) return false;
      if (equipment && !e.equipment.includes(equipment)) return false;
      if (difficulty && e.difficulty !== difficulty) return false;
      if (onlyFav && !favs.has(e.id)) return false;
      return true;
    });
    return {
      total: catalog.exercises.size,
      count: list.length,
      exercises: list.map((e) => ({ id: e.id, name: e.name, groups: e.groups, equipment: e.equipment, difficulty: e.difficulty, premium: e.premium, locked: e.premium && !premium, favourite: favs.has(e.id), hasVideo: (catalog.media.get(e.id) ?? []).length > 0, available: equipmentSetHas(eq, e.equipment) })),
    };
  }));

  r.get('/api/exercises/:id', async (c) => db.asUser(uid(c), async (tx) => {
    const id = slug(c.params.id);
    const e = catalog.exercises.get(id);
    if (!e) throw notFound('Exercise not found.');
    const premium = await premiumFor(tx, uid(c));
    const locked = e.premium && !premium;
    const content = catalog.exerciseContent.get(id)!;
    const profile = await loadProfile(tx, uid(c));
    const fav = await tx.maybeOne("select 1 from kyvo.favourites where user_id = $1 and kind = 'exercise' and ref_id = $2", [uid(c), id]);
    const subs = substitutesFor(id, catalog.exercises, equipmentSet(profile), premium, 8).map((s) => ({ id: s.id, name: s.name, locked: s.premium && !premium }));
    const media = (catalog.media.get(id) ?? []).map((m) => ({ kind: m.kind, ref: m.ref, title: m.title, attribution: m.attribution, license: m.license, source: m.source, verifiedNote: m.verified_note }));
    const base = { id, name: e.name, groups: e.groups, equipment: e.equipment, difficulty: e.difficulty, logging: e.logging, premium: e.premium, locked, favourite: !!fav, alternatives: subs, musclesText: content.musclesText, primary: e.primary, secondary: e.secondary };
    if (locked) return { ...base, content: null, media: [] };
    const history = await training.exerciseHistory(tx, uid(c), id, premium ? null : FREE_LIMITS.historyDays);
    return { ...base, content: { steps: content.steps, cues: content.cues, mistakes: content.mistakes, safety: content.safety, checks: content.checks, programming: content.programming, reduceLoad: content.reduceLoad, secondary: e.secondary, primary: e.primary }, media, history };
  }));

  r.get('/api/exercises/:id/substitutes', async (c) => db.asUser(uid(c), async (tx) => {
    const premium = await premiumFor(tx, uid(c));
    const profile = await loadProfile(tx, uid(c));
    return substitutesFor(slug(c.params.id), catalog.exercises, equipmentSet(profile), premium, 12).map((s) => ({ id: s.id, name: s.name, locked: s.premium && !premium, equipment: s.equipment }));
  }));

  r.post('/api/favourites', async (c) => {
    const b = obj(c.body);
    const kind = oneOf(b.kind, 'kind', ['exercise', 'food', 'recipe'] as const);
    const ref = slug(b.refId, 'refId');
    await db.asUser(uid(c), (tx) => (b.on === false
      ? tx.exec('delete from kyvo.favourites where user_id = $1 and kind = $2 and ref_id = $3', [uid(c), kind, ref])
      : tx.exec('insert into kyvo.favourites (user_id, kind, ref_id) values ($1,$2,$3) on conflict do nothing', [uid(c), kind, ref])));
    return { ok: true };
  });

  /* ---------------- planner ---------------- */
  r.get('/api/program', async (c) => db.asUser(uid(c), async (tx) => {
    const premium = await premiumFor(tx, uid(c));
    return { ...(await training.program(tx, uid(c))), templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, days: t.days, premium: t.premium, locked: t.premium && !premium })) };
  }));
  r.post('/api/program/generate', async (c) => {
    const b = obj(c.body ?? {});
    const templateId = b.templateId ? oneOf(b.templateId, 'templateId', TEMPLATES.map((t) => t.id)) : undefined;
    return db.asUser(uid(c), async (tx) => {
      if (templateId && TEMPLATES.find((t) => t.id === templateId)!.premium && !(await premiumFor(tx, uid(c)))) throw premiumRequired('That program is part of Premium.');
      await plans.regenerateProgram(tx, uid(c), templateId);
      const t = todayIn((await loadProfile(tx, uid(c))).timezone);
      const stored = await tx.query<{ plan_date: string }>('select plan_date from kyvo.daily_plans where user_id = $1 and plan_date >= $2', [uid(c), t]);
      for (const s of stored) await plans.regenerate(tx, uid(c), s.plan_date, 'workout');
      return { ok: true };
    });
  });
  r.post('/api/workouts', async (c) => ({ id: await db.asUser(uid(c), (tx) => training.createWorkout(tx, uid(c), obj(c.body))) }));
  r.put('/api/workouts/:id', async (c) => {
    await db.asUser(uid(c), (tx) => training.updateWorkout(tx, uid(c), uuid(c.params.id), obj(c.body)));
    return { ok: true };
  });
  r.post('/api/workouts/:id/duplicate', async (c) => ({ id: await db.asUser(uid(c), (tx) => training.duplicateWorkout(tx, uid(c), uuid(c.params.id))) }));
  r.delete('/api/workouts/:id', async (c) => {
    await db.asUser(uid(c), (tx) => training.deleteWorkout(tx, uid(c), uuid(c.params.id)));
    return { ok: true };
  });
  r.put('/api/schedule/:weekday', async (c) => {
    const b = obj(c.body);
    await db.asUser(uid(c), (tx) => training.assignDay(tx, uid(c), num(c.params.weekday, 'weekday', { min: 0, max: 6, int: true }) as number, b.workoutId ? uuid(b.workoutId, 'workoutId') : null));
    return { ok: true };
  });
  r.put('/api/schedule/date/:date', async (c) => {
    const b = obj(c.body);
    await db.asUser(uid(c), (tx) => training.overrideDate(tx, uid(c), date(c.params.date), b.workoutId ? uuid(b.workoutId, 'workoutId') : null));
    return { ok: true };
  });

  /* ---------------- live workouts ---------------- */
  r.post('/api/sessions', async (c) => {
    const b = obj(c.body ?? {});
    const id = await db.asUser(uid(c), (tx) => training.start(tx, uid(c), { date: b.date ? date(b.date) : undefined, workoutId: b.workoutId ? uuid(b.workoutId, 'workoutId') : null }));
    return { id };
  });
  r.get('/api/sessions/active', async (c) => db.asUser(uid(c), async (tx) => {
    const s = await tx.maybeOne<{ id: string }>("select id from kyvo.workout_sessions where user_id = $1 and status = 'in_progress'", [uid(c)]);
    return s ? training.get(tx, uid(c), s.id) : null;
  }));
  r.get('/api/sessions', async (c) => {
    const lim = await historyLimit(uid(c));
    return db.asUser(uid(c), (tx) => training.list(tx, uid(c), lim));
  });
  r.get('/api/sessions/:id', async (c) => db.asUser(uid(c), (tx) => training.get(tx, uid(c), uuid(c.params.id))));
  r.put('/api/sessions/:id/sets', async (c) => {
    await db.asUser(uid(c), (tx) => training.upsertSet(tx, uid(c), uuid(c.params.id), obj(c.body)));
    return { ok: true };
  });
  r.post('/api/sessions/:id/sets/delete', async (c) => {
    const b = obj(c.body);
    await db.asUser(uid(c), (tx) => training.deleteSet(tx, uid(c), uuid(c.params.id), slug(b.exerciseId, 'exerciseId'), num(b.setIndex, 'setIndex', { min: 0, max: 49, int: true }) as number));
    return { ok: true };
  });
  r.post('/api/sessions/:id/exercises', async (c) => {
    const b = obj(c.body);
    await db.asUser(uid(c), (tx) => training.changeExercise(tx, uid(c), uuid(c.params.id), slug(b.exerciseId, 'exerciseId'), b.replace ? slug(b.replace, 'replace') : null));
    return { ok: true };
  });
  r.post('/api/sessions/:id/finish', async (c) => {
    const b = obj(c.body ?? {});
    const result = await db.asUser(uid(c), (tx) => training.finish(tx, uid(c), uuid(c.params.id), str(b.notes, 'notes', { max: 2000, optional: true }), b.painReported === true));
    await db.asSystem(async (tx) => {
      const n = await tx.one<{ n: number }>("select count(*)::int as n from kyvo.workout_sessions where user_id = $1 and status = 'completed'", [uid(c)]);
      await tx.exec('insert into kyvo.product_events (user_id, name) values ($1, $2)', [uid(c), n.n === 1 ? 'first_workout' : 'workout_complete']);
    });
    return result;
  });
  r.post('/api/sessions/:id/discard', async (c) => {
    await db.asUser(uid(c), (tx) => training.discard(tx, uid(c), uuid(c.params.id)));
    return { ok: true };
  });
  r.patch('/api/sessions/:id', async (c) => {
    await db.asUser(uid(c), (tx) => training.updateNotes(tx, uid(c), uuid(c.params.id), str(obj(c.body).notes, 'notes', { max: 2000, optional: true })));
    return { ok: true };
  });

  /* ---------------- nutrition ---------------- */
  r.get('/api/diary/:date', async (c) => db.asUser(uid(c), (tx) => nutrition.diary(tx, uid(c), date(c.params.date))));
  r.post('/api/diary/:date', async (c) => ({ id: await db.asUser(uid(c), (tx) => nutrition.log(tx, uid(c), date(c.params.date), obj(c.body))) }));
  r.post('/api/diary/:date/copy', async (c) => {
    const b = obj(c.body);
    const n = await db.asUser(uid(c), (tx) => nutrition.copy(tx, uid(c), date(c.params.date), date(b.fromDate, 'fromDate'), b.slot ? oneOf(b.slot, 'slot', MEAL_SLOTS) : null));
    return { copied: n };
  });
  r.patch('/api/diary/entry/:id', async (c) => {
    await db.asUser(uid(c), (tx) => nutrition.update(tx, uid(c), uuid(c.params.id), obj(c.body)));
    return { ok: true };
  });
  r.delete('/api/diary/entry/:id', async (c) => {
    await db.asUser(uid(c), (tx) => nutrition.remove(tx, uid(c), uuid(c.params.id)));
    return { ok: true };
  });
  r.get('/api/foods', async (c) => db.asUser(uid(c), (tx) => nutrition.search(tx, uid(c), (c.url.searchParams.get('q') || '').slice(0, 60))));
  r.get('/api/foods/quick', async (c) => db.asUser(uid(c), (tx) => nutrition.quick(tx, uid(c))));
  r.post('/api/foods', async (c) => db.asUser(uid(c), (tx) => nutrition.createFood(tx, uid(c), obj(c.body))));
  r.post('/api/saved-meals', async (c) => {
    const b = obj(c.body);
    if (!Array.isArray(b.entryIds)) throw badRequest('entryIds must be a list.');
    return { id: await db.asUser(uid(c), (tx) => nutrition.saveMeal(tx, uid(c), str(b.name, 'Name', { min: 1, max: 60 }), (b.entryIds as unknown[]).map((x) => uuid(x, 'entry id')))) };
  });
  r.post('/api/saved-meals/:id/log', async (c) => {
    const b = obj(c.body);
    return { logged: await db.asUser(uid(c), (tx) => nutrition.logSaved(tx, uid(c), uuid(c.params.id), date(b.date), oneOf(b.slot, 'slot', MEAL_SLOTS))) };
  });
  r.delete('/api/saved-meals/:id', async (c) => {
    await db.asUser(uid(c), (tx) => tx.exec('delete from kyvo.saved_meals where id = $1 and user_id = $2', [uuid(c.params.id), uid(c)]));
    return { ok: true };
  });

  /* ---------------- recipes ---------------- */
  r.get('/api/recipes', async (c) => db.asUser(uid(c), async (tx) => {
    const premium = await premiumFor(tx, uid(c));
    const favs = new Set((await tx.query<{ ref_id: string }>("select ref_id from kyvo.favourites where user_id = $1 and kind = 'recipe'", [uid(c)])).map((f) => f.ref_id));
    const q = (c.url.searchParams.get('q') || '').toLowerCase().slice(0, 60);
    const meal = c.url.searchParams.get('meal') || '';
    const tag = c.url.searchParams.get('tag') || '';
    return [...catalog.recipes.values()]
      .filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!meal || x.meal.includes(meal as MealSlot)) && (!tag || x.tags.includes(tag)) && (c.url.searchParams.get('favourites') !== '1' || favs.has(x.id)))
      .map((x) => ({ id: x.id, name: x.name, desc: x.description, meal: x.meal, tags: x.tags, prep: x.prep, cook: x.cook, premium: x.premium, locked: x.premium && !premium, favourite: favs.has(x.id), perServing: recipeNutrition(x, catalog.foods).perServing }));
  }));
  r.get('/api/recipes/:id', async (c) => db.asUser(uid(c), async (tx) => {
    const x = catalog.recipes.get(slug(c.params.id));
    if (!x) throw notFound('Recipe not found.');
    const premium = await premiumFor(tx, uid(c));
    const servings = num(c.url.searchParams.get('servings') ?? x.servings, 'servings', { min: 0.5, max: 20 }) as number;
    const n = recipeNutrition(x, catalog.foods);
    const fav = await tx.maybeOne("select 1 from kyvo.favourites where user_id = $1 and kind = 'recipe' and ref_id = $2", [uid(c), x.id]);
    const base = { id: x.id, name: x.name, desc: x.description, meal: x.meal, tags: x.tags, prep: x.prep, cook: x.cook, servings: x.servings, premium: x.premium, locked: x.premium && !premium, favourite: !!fav, perServing: n.perServing, allergens: allergensIn(n.tags) };
    if (base.locked) return base;
    const scaled = scaleIngredients(x, servings);
    return {
      ...base,
      chosenServings: servings,
      ingredients: scaled.map(([id, g]) => ({ foodId: id, name: catalog.foods.get(id)?.name ?? id, grams: g })),
      totalForServings: { kcal: Math.round(n.perServing.kcal * servings), p: Math.round(n.perServing.p * servings * 10) / 10, c: Math.round(n.perServing.c * servings * 10) / 10, f: Math.round(n.perServing.f * servings * 10) / 10 },
      steps: x.steps, storage: x.storage, subs: x.subs,
      source: 'Calculated from ingredient weights using KYVO’s curated generic food values. Values are estimates.',
    };
  }));

  /* ---------------- progress ---------------- */
  r.get('/api/progress', async (c) => {
    const lim = await historyLimit(uid(c));
    const asked = num(c.url.searchParams.get('days') ?? 30, 'days', { min: 7, max: 730, int: true }) as number;
    const days = lim ? Math.min(asked, lim) : asked;
    const t = await today(uid(c));
    const data = await db.asUser(uid(c), (tx) => progress.overview(tx, uid(c), days, t));
    return { ...data, limitedTo: lim && asked > lim ? lim : null };
  });
  r.post('/api/metrics', async (c) => {
    const b = obj(c.body);
    const m = {
      weightKg: num(b.weightKg, 'Weight', { min: 30, max: 350, optional: true }), waistCm: num(b.waistCm, 'Waist', { min: 30, max: 250, optional: true }),
      chestCm: num(b.chestCm, 'Chest', { min: 40, max: 250, optional: true }), hipsCm: num(b.hipsCm, 'Hips', { min: 40, max: 250, optional: true }),
      armCm: num(b.armCm, 'Arm', { min: 10, max: 80, optional: true }), thighCm: num(b.thighCm, 'Thigh', { min: 20, max: 120, optional: true }),
    };
    if (Object.values(m).every((v) => v == null)) throw badRequest('Enter at least one measurement.');
    const d = date(b.date);
    if (d > addDays(await today(uid(c)), 1)) throw badRequest('That date is in the future.');
    await db.asUser(uid(c), (tx) => progress.saveMetrics(tx, uid(c), d, m));
    return { ok: true };
  });
  r.delete('/api/metrics/:id', async (c) => {
    const n = await db.asUser(uid(c), (tx) => progress.deleteMetric(tx, uid(c), uuid(c.params.id)));
    if (!n) throw notFound();
    return { ok: true };
  });
  r.get('/api/photos', async (c) => db.asUser(uid(c), (tx) => tx.query('select id, taken_on as date, bytes from kyvo.progress_photos where user_id = $1 order by taken_on desc', [uid(c)])));
  r.post('/api/photos', async (c) => {
    const b = obj(c.body);
    const data = Buffer.from(str(b.dataBase64, 'image', { max: 7_000_000 }), 'base64');
    const type = sniffImage(data);
    if (!type) throw badRequest('Upload a JPEG, PNG or WebP image.');
    if (data.length > 5_000_000) throw badRequest('Images must be 5 MB or smaller.');
    const id = crypto.randomUUID();
    const key = `${uid(c)}/${id}.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`;
    await storage.put(key, data, type);
    await db.asUser(uid(c), (tx) => tx.exec('insert into kyvo.progress_photos (id, user_id, taken_on, storage_key, content_type, bytes) values ($1,$2,$3,$4,$5,$6)', [id, uid(c), date(b.date), key, type, data.length]));
    return { id };
  }, { maxBody: 8_000_000 });
  r.get('/api/photos/:id/image', async (c) => {
    const p = await db.asUser(uid(c), (tx) => tx.maybeOne<{ storage_key: string; content_type: string }>('select storage_key, content_type from kyvo.progress_photos where id = $1 and user_id = $2', [uuid(c.params.id), uid(c)]));
    if (!p) throw notFound();
    const data = await storage.get(p.storage_key);
    if (!data) throw notFound();
    c.res.writeHead(200, { 'Content-Type': p.content_type, 'Cache-Control': 'private, no-store', 'Content-Length': data.length });
    c.res.end(data);
    return undefined;
  });
  r.delete('/api/photos/:id', async (c) => {
    const p = await db.asUser(uid(c), (tx) => tx.maybeOne<{ storage_key: string }>('delete from kyvo.progress_photos where id = $1 and user_id = $2 returning storage_key', [uuid(c.params.id), uid(c)]));
    if (!p) throw notFound();
    await storage.remove(p.storage_key);
    return { ok: true };
  });

  /* ---------------- billing ---------------- */
  r.get('/api/billing', async (c) => billing.status(uid(c)));
  r.post('/api/billing/checkout', async (c) => ({ url: await billing.checkout(uid(c), c.user!.email, oneOf(obj(c.body).interval, 'interval', ['monthly', 'annual'] as const)) }));
  r.post('/api/billing/portal', async (c) => ({ url: await billing.portal(uid(c)) }));
  r.post('/api/stripe/webhook', async (c) => ({ received: true, result: await billing.handleWebhook(c.rawBody!, c.req.headers['stripe-signature'] as string | undefined) }), { auth: 'none', raw: true, csrf: false });

  /* ---------------- account ---------------- */
  r.get('/api/account/export', async (c) => {
    const data = await db.asUser(uid(c), async (tx) => {
      const tables = ['profiles', 'nutrition_targets', 'user_workouts', 'user_schedule', 'schedule_overrides', 'daily_plans', 'checklist_items', 'workout_sessions', 'session_sets', 'personal_records', 'food_logs', 'favourites', 'saved_meals', 'hydration_logs', 'body_metrics', 'progress_photos', 'subscriptions'];
      const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), account: await tx.one('select id, email, created_at from kyvo.users where id = $1', [uid(c)]) };
      for (const t of tables) out[t] = await tx.query(`select * from kyvo.${t} where user_id = $1`, [uid(c)]);
      out.custom_foods = await tx.query('select * from kyvo.foods where owner_id = $1', [uid(c)]);
      return out;
    });
    c.res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="kyvo-export.json"', 'Cache-Control': 'no-store' });
    c.res.end(JSON.stringify(data, null, 1));
    return undefined;
  });
  r.post('/api/account/delete', async (c) => {
    const b = obj(c.body);
    if (!(await auth.checkPassword(uid(c), str(b.password, 'Password', { max: 200 })))) throw badRequest('Your password is not correct.');
    if (billing.configured) await billing.cancelAllNow(uid(c));
    const photos = await db.asUser(uid(c), (tx) => tx.query<{ storage_key: string }>('select storage_key from kyvo.progress_photos where user_id = $1', [uid(c)]));
    for (const p of photos) await storage.remove(p.storage_key);
    await db.asUser(uid(c), (tx) => tx.exec('delete from kyvo.users where id = $1', [uid(c)]));
    await db.asSystem((tx) => tx.exec("insert into kyvo.audit_log (actor_id, action, target) values (null, 'account_deleted', 'user')", []));
    setCookie(c.res, SESSION_COOKIE, '', { maxAge: 0, secure: cfg.production });
    return { ok: true };
  });

  /* ---------------- growth ---------------- */
  r.post('/api/events/landing', async (c) => {
    if (!apiLimiter.check(`landing:${c.ip}`)) return { ok: true };
    const campaign = typeof c.body?.campaign === 'string' && CAMPAIGN_BY_SLUG.has(c.body.campaign) ? c.body.campaign : null;
    await db.asSystem((tx) => tx.exec("insert into kyvo.product_events (name, campaign) values ('landing_view', $1)", [campaign]));
    return { ok: true };
  }, { auth: 'none' });

  /* ---------------- admin ---------------- */
  registerAdmin(r, db, catalog, billing);

  r.get('/api/health', async () => {
    const ok = await db.asAnon((tx) => tx.one<{ n: number }>('select count(*)::int as n from kyvo.exercises')).then(() => true).catch(() => false);
    return { ok, database: ok, stripeConfigured: billing.configured, storage: cfg.storage.driver, exercises: catalog.exercises.size, recipes: catalog.recipes.size };
  }, { auth: 'none' });

  /* ---------------- request handling ---------------- */
  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestId = newRequestId();
    const url = new URL(req.url || '/', 'http://localhost');
    securityHeaders(res, { tiktok: !!cfg.tiktokPixelId, production: cfg.production });
    const ip = (cfg.production ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!apiLimiter.check(`api:${ip}`)) throw new HttpError(429, 'Too many requests. Please slow down.', 'rate_limited');
        const m = r.match(req.method || 'GET', url.pathname);
        if (!m) throw notFound('Unknown API route.');
        const o = m.route.opts;
        const mutating = !['GET', 'HEAD'].includes(req.method || 'GET');
        if (mutating && o.csrf !== false) {
          // CSRF: browsers cannot send this header cross-site without a CORS preflight, which KYVO never allows.
          if (req.headers['x-kyvo-request'] !== '1') throw forbidden('Missing request header.');
          const origin = req.headers.origin;
          if (origin && cfg.production && origin !== cfg.baseUrl) throw forbidden('Cross-site request blocked.');
        }
        const raw = mutating ? await readBody(req, o.maxBody ?? 1_000_000) : null;
        let body: unknown = null;
        if (raw && raw.length && !o.raw) {
          try {
            body = JSON.parse(raw.toString('utf8'));
          } catch {
            throw badRequest('Request body must be valid JSON.');
          }
        }
        const cookies = parseCookies(req.headers.cookie);
        const user = await auth.resolve(cookies[SESSION_COOKIE]);
        const need = o.auth ?? 'user';
        if (need !== 'none' && !user) throw unauthorized();
        if (need === 'admin' && user?.role !== 'admin') throw forbidden();
        const ctx: Ctx = { req, res, url, params: m.params, body, rawBody: raw, user, ip, requestId, cookies };
        const out = await m.route.handler(ctx);
        if (!res.headersSent) sendJson(res, 200, out);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw notFound();
      await servePage(url.pathname, res);
    } catch (e) {
      const err = e instanceof HttpError ? e : null;
      const status = err?.status ?? (e as { status?: number }).status ?? 500;
      if (status >= 500) {
        const msg = (e as Error).message?.slice(0, 300) ?? 'unknown';
        console.error(`[${requestId}] ${req.method} ${url.pathname}: ${msg}`);
        db.asSystem((tx) => tx.exec('insert into kyvo.error_logs (request_id, route, message) values ($1,$2,$3)', [requestId, `${req.method} ${url.pathname.replace(/[0-9a-f-]{36}/g, ':id').replace(/\d{4}-\d{2}-\d{2}/g, ':date')}`, msg])).catch(() => {});
      }
      if (res.headersSent) {
        res.end();
        return;
      }
      if (url.pathname.startsWith('/api/')) sendJson(res, status, { error: status >= 500 && !err ? 'Something went wrong. Please try again.' : (e as Error).message, code: err?.code ?? 'error', requestId });
      else {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(status === 404 ? '<!doctype html><title>Not found</title><p>Page not found. <a href="/">Go to KYVO</a></p>' : '<!doctype html><title>Error</title><p>Something went wrong.</p>');
      }
    }
  }

  async function servePage(pathname: string, res: http.ServerResponse) {
    const html = (s: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(s);
    };
    if (pathname === '/') return html(landingPage(undefined, cfg.tiktokPixelId));
    if (pathname.startsWith('/l/')) {
      const p = campaignPage(pathname.slice(3).replace(/\/$/, ''), cfg.tiktokPixelId);
      if (!p) throw notFound();
      return html(p);
    }
    if (pathname.startsWith('/legal/')) {
      const p = legalPage(pathname.slice(7).replace(/\/$/, ''));
      if (!p) throw notFound();
      return html(p);
    }
    if (pathname === '/app' || pathname.startsWith('/app/') || pathname === '/login' || pathname === '/signup') return html(appShell());
    const file = pathname.startsWith('/js/') ? path.join(CLIENT_JS_DIR, pathname.slice(4)) : path.join(PUBLIC_DIR, pathname);
    const base = pathname.startsWith('/js/') ? CLIENT_JS_DIR : PUBLIC_DIR;
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(base) + path.sep)) throw notFound();
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat?.isFile()) throw notFound();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] ?? 'application/octet-stream', 'Cache-Control': cfg.production ? 'public, max-age=3600' : 'no-cache', 'Content-Length': stat.size });
    fs.createReadStream(resolved).pipe(res);
  }

  const server = http.createServer((req, res) => void handle(req, res));
  return {
    server, db, catalog, cfg,
    async close() {
      await new Promise<void>((res) => server.close(() => res()));
      await db.close();
    },
  };
}

function equipmentSetHas(eq: Set<string>, needed: string[]): boolean {
  return needed.every((x) => eq.has(x)) || needed.some((x) => eq.has(x) && ['dumbbell', 'kettlebell', 'cable', 'band', 'machine'].includes(x));
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ---------------- admin routes ---------------- */
function registerAdmin(r: Router, db: Db, catalog: Catalog, billing: BillingService) {
  const admin = { auth: 'admin' as const };
  const audit = (actor: string, action: string, target: string) => db.asSystem((tx) => tx.exec('insert into kyvo.audit_log (actor_id, action, target) values ($1,$2,$3)', [actor, action, target]));

  r.get('/api/admin/overview', async () => db.asSystem(async (tx) => {
    const users = await tx.one<any>("select count(*)::int as total, count(*) filter (where created_at > now() - interval '7 days')::int as week, count(*) filter (where created_at > now() - interval '30 days')::int as month from kyvo.users");
    const onboarded = await tx.one<{ n: number }>('select count(*)::int as n from kyvo.profiles where onboarding_completed_at is not null');
    const subs = await tx.query<any>('select status, plan_interval, count(*)::int as n from kyvo.subscriptions group by status, plan_interval order by status');
    const funnel = await tx.query<any>("select name, count(*)::int as n, count(distinct user_id)::int as users from kyvo.product_events where created_at > now() - interval '30 days' group by name");
    const campaigns = await tx.query<any>(
      `select coalesce(a.utm_campaign, '(none)') as campaign, count(*)::int as signups, count(p.onboarding_completed_at)::int as onboarded,
         count(distinct s.user_id) filter (where s.status in ('active','trialing'))::int as premium
       from kyvo.users u left join kyvo.attribution a on a.user_id = u.id left join kyvo.profiles p on p.user_id = u.id left join kyvo.subscriptions s on s.user_id = u.id
       group by 1 order by 2 desc limit 20`,
    );
    const active = await tx.one<any>("select count(distinct user_id)::int as n from kyvo.workout_sessions where started_at > now() - interval '7 days'");
    return { users, onboarded: onboarded.n, activeLast7Days: active.n, subscriptions: subs, funnel, campaigns, billingConfigured: billing.configured };
  }), admin);

  r.get('/api/admin/quality', async () => {
    const issues: { kind: string; id: string; name: string; issue: string }[] = [];
    for (const e of catalog.exercises.values()) {
      const c = catalog.exerciseContent.get(e.id)!;
      if (!(catalog.media.get(e.id) ?? []).length) issues.push({ kind: 'exercise', id: e.id, name: e.name, issue: 'No demonstration video (written instructions shown instead)' });
      if (!c.steps || Object.keys(c.steps).length < 10) issues.push({ kind: 'exercise', id: e.id, name: e.name, issue: 'Incomplete instructions' });
      for (const a of e.alternatives) if (!catalog.exercises.has(a)) issues.push({ kind: 'exercise', id: e.id, name: e.name, issue: `Alternative "${a}" does not exist` });
    }
    for (const x of catalog.recipes.values()) {
      const n = recipeNutrition(x, catalog.foods);
      if (n.missing.length) issues.push({ kind: 'recipe', id: x.id, name: x.name, issue: `Unknown ingredients: ${n.missing.join(', ')}` });
      if (x.steps.length < 2) issues.push({ kind: 'recipe', id: x.id, name: x.name, issue: 'Fewer than 2 steps' });
      issues.push(...(n.perServing.kcal < 100 ? [{ kind: 'recipe', id: x.id, name: x.name, issue: 'Under 100 kcal per serving' }] : []));
    }
    return { exercises: catalog.exercises.size, recipes: catalog.recipes.size, foods: catalog.foods.size, issues };
  }, admin);

  r.get('/api/admin/exercises', async () => [...catalog.exercises.values()].map((e) => ({ id: e.id, name: e.name, groups: e.groups, premium: e.premium, media: catalog.media.get(e.id)?.length ?? 0 })), admin);
  r.get('/api/admin/exercises/:id', async (c) => db.asSystem(async (tx) => ({
    exercise: await tx.one('select id, name, premium, published, content from kyvo.exercises where id = $1', [slug(c.params.id)]),
    media: await tx.query('select * from kyvo.exercise_media where exercise_id = $1 order by id', [slug(c.params.id)]),
  })), admin);
  r.put('/api/admin/exercises/:id', async (c) => {
    const b = obj(c.body);
    const id = slug(c.params.id);
    await db.asSystem(async (tx) => {
      const cur = await tx.one<{ content: any }>('select content from kyvo.exercises where id = $1', [id]);
      const content = { ...cur.content };
      if (b.cues !== undefined) content.cues = (Array.isArray(b.cues) ? b.cues : []).map((x: unknown) => str(x, 'cue', { max: 200 }));
      if (b.safety !== undefined) content.safety = (Array.isArray(b.safety) ? b.safety : []).map((x: unknown) => str(x, 'safety note', { max: 300 }));
      await tx.exec('update kyvo.exercises set name = $2, premium = $3, published = $4, content = $5::jsonb, updated_at = now() where id = $1', [
        id, str(b.name, 'name', { min: 2, max: 80 }), bool(b.premium, 'premium'), bool(b.published, 'published'), JSON.stringify(content),
      ]);
    });
    await audit(c.user!.id, 'edit_exercise', id);
    await catalog.load();
    return { ok: true };
  }, admin);
  r.post('/api/admin/exercises/:id/media', async (c) => {
    const b = obj(c.body);
    const kind = oneOf(b.kind, 'kind', ['youtube', 'video', 'image'] as const);
    const ref = kind === 'youtube' ? str(b.ref, 'YouTube video id', { pattern: /^[A-Za-z0-9_-]{11}$/ }) : str(b.ref, 'URL', { max: 300, pattern: /^(\/media\/[a-z0-9-]+\.(webm|mp4|jpg|png|webp)|https:\/\/[^\s]+)$/ });
    await db.asSystem((tx) => tx.exec('insert into kyvo.exercise_media (exercise_id, kind, ref, title, source, license, attribution, verified_note) values ($1,$2,$3,$4,$5,$6,$7,$8)', [
      slug(c.params.id), kind, ref, str(b.title, 'title', { max: 120, optional: true }), str(b.source, 'source', { max: 300 }), str(b.license, 'licence', { max: 120 }),
      str(b.attribution, 'attribution', { max: 200 }), `Added by an admin on ${new Date().toISOString().slice(0, 10)}; verify before publishing`,
    ]));
    await audit(c.user!.id, 'add_media', slug(c.params.id));
    await catalog.load();
    return { ok: true };
  }, admin);
  r.put('/api/admin/media/:id', async (c) => {
    const status = oneOf(obj(c.body).status, 'status', ['active', 'hidden', 'broken'] as const);
    await db.asSystem((tx) => tx.exec('update kyvo.exercise_media set status = $2 where id = $1', [num(c.params.id, 'id', { int: true, min: 1 }), status]));
    await audit(c.user!.id, 'media_status', c.params.id);
    await catalog.load();
    return { ok: true };
  }, admin);
  r.get('/api/admin/recipes', async () => db.asSystem((tx) => tx.query('select id, name, description, premium, published, meal_types, tags from kyvo.recipes order by name')), admin);
  r.put('/api/admin/recipes/:id', async (c) => {
    const b = obj(c.body);
    const id = slug(c.params.id);
    await db.asSystem((tx) => tx.exec('update kyvo.recipes set name = $2, description = $3, premium = $4, published = $5, updated_at = now() where id = $1', [
      id, str(b.name, 'name', { min: 2, max: 100 }), str(b.description, 'description', { max: 400, optional: true }), bool(b.premium, 'premium'), bool(b.published, 'published'),
    ]));
    await audit(c.user!.id, 'edit_recipe', id);
    await catalog.load();
    return { ok: true };
  }, admin);
  r.get('/api/admin/templates', async () => db.asSystem((tx) => tx.query('select id, name, description, days, premium from kyvo.workout_templates order by days')), admin);
  r.get('/api/admin/errors', async () => db.asSystem((tx) => tx.query('select request_id, route, message, created_at from kyvo.error_logs order by id desc limit 100')), admin);
  r.get('/api/admin/billing-events', async () => db.asSystem((tx) => tx.query('select id, type, received_at, processed_at from kyvo.billing_events order by received_at desc limit 50')), admin);
}
