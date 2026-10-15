// Preview-only API: answers the app's requests in the browser, using the real plan engine (src/core) and the
// real content files, with an in-memory store and a few weeks of clearly labelled sample history.
// Nothing here is used by the production app, which always talks to the server and its database.
import { ApiError, type Api } from '../api.js';
import type { DailyPlan, ExerciseSummary, FoodItem, LoggedSet, Macros, MealSlot, PlannedExercise, Profile, Recipe, Targets, WorkoutDef } from '../../core/types.js';
import { MEAL_SLOTS } from '../../core/types.js';
import { buildDailyPlan, regenerateMeals, summariseDay } from '../../core/dailyPlan.js';
import { buildRecipeInfo, plannedTotals, swapMeal, swapOptions, type RecipeInfo } from '../../core/meals.js';
import { allergensIn, estimateTargets, recipeNutrition, roundMacros, scaleFood, scaleIngredients, validateManualTargets } from '../../core/nutrition.js';
import { TEMPLATES, detectRecords, equipmentSet, exerciseAvailable, generateProgram, prescribe, setVolume, substitutesFor, type PastSession } from '../../core/workouts.js';
import { FREE_LIMITS, PRICES, isPremium } from '../../core/plans.js';
import { addDays, round, seededRandom, todayIn, weekStart, weekdayOf } from '../../core/util.js';

export interface DemoContent {
  exercises: any[];
  media: any[];
  foods: FoodItem[];
  recipes: any[];
}

type R = Recipe & { description: string; premium: boolean };
interface Session { id: string; date: string; workoutId: string | null; name: string; status: 'in_progress' | 'completed' | 'discarded'; planned: PlannedExercise[]; startedAt: string; finishedAt: string | null; notes: string; painReported: boolean }
interface Log { id: string; date: string; slot: MealSlot; foodId: string | null; recipeId: string | null; name: string; grams: number | null; portion: number | null; kcal: number; p: number; c: number; f: number; fromPlan: boolean; createdAt: number }
interface Rec { exerciseId: string; kind: string; value: number; sessionId: string; date: string }

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const bad = (m: string) => new ApiError(400, m);
const notFound = (m = 'Not found.') => new ApiError(404, m);
const premiumRequired = (m: string) => new ApiError(402, m);
const sumItems = (items: { kcal: number; p: number; c: number; f: number }[]): Macros => items.reduce((a, b) => ({ kcal: a.kcal + b.kcal, p: a.p + b.p, c: a.c + b.c, f: a.f + b.f }), { kcal: 0, p: 0, c: 0, f: 0 });

function describeSets(sets: LoggedSet[]): string {
  const done = sets.filter((s) => s.completed);
  if (!done.length) return '';
  if (done.some((s) => s.weightKg)) return done.map((s) => `${s.weightKg ?? 0} kg × ${s.reps ?? 0}`).join(', ');
  if (done.some((s) => s.durationSec)) return done.map((s) => `${s.durationSec} s`).join(', ');
  return done.map((s) => `${s.reps ?? 0} reps`).join(', ');
}

export class DemoApi implements Api {
  readonly demo = true;
  private exercises = new Map<string, ExerciseSummary>();
  private content = new Map<string, any>();
  private media = new Map<string, any[]>();
  private foods = new Map<string, FoodItem>();
  private recipes = new Map<string, R>();
  private recipeInfo: RecipeInfo[] = [];

  private tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney';
  private profile: Profile & { timezone: string; onboarded: boolean };
  private targets: Targets | null = null;
  private premium = false;
  private analytics = false;
  private workouts: (WorkoutDef & { source: 'generated' | 'custom'; archived: boolean; templateId: string | null; createdAt: number })[] = [];
  private schedule: Record<number, string | null> = {};
  private overrides = new Map<string, string | null>();
  private plans = new Map<string, DailyPlan>();
  private checks = new Map<string, Set<string>>();
  private logs: Log[] = [];
  private sessions: Session[] = [];
  private sets = new Map<string, LoggedSet[]>();
  private records: Rec[] = [];
  private favourites = new Set<string>();
  private saved: { id: string; name: string; items: any[] }[] = [];
  private water = new Map<string, number>();
  private metrics: { id: string; date: string; weightKg: number | null; waistCm: number | null; chestCm: number | null; hipsCm: number | null; armCm: number | null; thighCm: number | null }[] = [];
  private customFoods: FoodItem[] = [];

  constructor(data: DemoContent) {
    for (const e of data.exercises) {
      this.exercises.set(e.id, {
        id: e.id, name: e.name, category: e.category, groups: e.groups, primary: e.primary, secondary: e.secondary, equipment: e.equipment, difficulty: e.difficulty,
        mechanic: e.mechanic, logging: e.logging, increment: e.increment ?? 0, pattern: e.pattern, alternatives: e.alternatives ?? [], progressions: e.progressions ?? [], premium: !!e.premium,
      } as ExerciseSummary);
      this.content.set(e.id, e);
    }
    for (const m of data.media) this.media.set(m.exercise_id, [...(this.media.get(m.exercise_id) ?? []), m]);
    for (const f of data.foods) this.foods.set(f.id, { ...f, serving: f.serving ?? { label: '100 g', g: 100 }, tags: f.tags ?? [] });
    for (const r of data.recipes) this.recipes.set(r.id, { ...r, description: r.desc ?? '', premium: !r.free });
    this.recipeInfo = buildRecipeInfo([...this.recipes.values()], this.foods);
    this.profile = {
      displayName: 'Sam', ageRange: '25-34', sex: 'unspecified', heightCm: 176, weightKg: 80, goal: 'muscle_gain', experience: 'intermediate', location: 'gym',
      equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bench', 'rack', 'pullup_bar', 'plate', 'ez_bar', 'smith', 'bodyweight', 'mat', 'band', 'kettlebell', 'dip_station', 'box', 'wall', 'treadmill', 'bike', 'rower'],
      trainingDays: [1, 3, 5], sessionMinutes: 60, trainingStyle: 'balanced', diet: 'none', allergies: [], exclusions: [], units: 'metric', activity: 'light',
      hydrationEnabled: true, hydrationTargetMl: 2500, templatePref: 'auto', timezone: this.tz, onboarded: true,
    };
    this.targets = estimateTargets(this.profile);
    this.regenerateProgram();
    this.seedHistory();
  }

  private today() {
    return todayIn(this.tz);
  }

  /* ---------------- sample history (preview only) ---------------- */
  private seedHistory() {
    const today = this.today();
    const rnd = seededRandom('kyvo-preview');
    const start = addDays(today, -27);
    let weight = 79.2;
    for (let d = start; d < today; d = addDays(d, 1)) {
      const plan = this.planFor(d);
      if ((weekdayOf(d) + 1) % 2 === 0 || rnd() < 0.25) {
        weight += 0.035 + (rnd() - 0.5) * 0.6;
        this.metrics.push({ id: uid(), date: d, weightKg: round(weight, 1), waistCm: weekdayOf(d) === 0 ? round(86 - (28 - Math.abs(dayDiff(d, today))) * 0.03, 1) : null, chestCm: null, hipsCm: null, armCm: null, thighCm: null });
      }
      const done = this.checkSet(d);
      for (const m of plan.meals) {
        if (m.slot !== 'snack' && rnd() < 0.85) {
          this.insertLog(d, m.slot, { recipeId: m.recipeId, name: m.name, portion: m.portion, m: { kcal: m.kcal, p: m.p, c: m.c, f: m.f }, fromPlan: true });
        } else if (m.slot === 'snack' && rnd() < 0.5) this.insertLog(d, 'snack', { recipeId: m.recipeId, name: m.name, portion: m.portion, m: { kcal: m.kcal, p: m.p, c: m.c, f: m.f }, fromPlan: true });
      }
      if (rnd() < 0.7) done.add('review');
      if (plan.workout && rnd() < 0.9) {
        const id = this.start({ date: d });
        const s = this.sessions.find((x) => x.id === id)!;
        for (const px of s.planned) {
          const ex = this.exercises.get(px.exerciseId)!;
          const base = px.weightKg ?? startingLoad(ex);
          for (let i = 0; i < px.sets; i++) {
            const reps = px.mode === 'time' ? null : Math.min(px.repMax, px.repMin + Math.floor(rnd() * (px.repMax - px.repMin + 1)));
            this.upsertSet(id, { exerciseId: px.exerciseId, setIndex: i, weightKg: px.mode === 'weight_reps' ? base : null, reps, durationSec: px.mode === 'time' ? px.repMin + 10 : null, completed: true });
          }
        }
        s.startedAt = `${d}T07:00:00.000Z`;
        this.finish(id, '', false, `${d}T08:00:00.000Z`);
      }
    }
  }

  /* ---------------- engine wiring ---------------- */
  private regenerateProgram(templateId?: string) {
    const prog = generateProgram({ profile: { ...this.profile, templatePref: templateId ?? this.profile.templatePref }, exercises: this.exercises, premium: this.premium });
    for (const w of this.workouts) if (w.source === 'generated') w.archived = true;
    const ids = prog.workouts.map((w) => {
      const id = uid();
      this.workouts.push({ ...w, id, source: 'generated', archived: false, templateId: prog.templateId, createdAt: Date.now() });
      return id;
    });
    for (let wd = 0; wd < 7; wd++) this.schedule[wd] = prog.schedule[wd] == null ? null : ids[prog.schedule[wd]!];
    if (templateId) this.profile.templatePref = templateId;
  }

  private workoutForDate(date: string): WorkoutDef | null {
    const wid = this.overrides.has(date) ? this.overrides.get(date)! : this.schedule[weekdayOf(date)] ?? null;
    const w = wid ? this.workouts.find((x) => x.id === wid) : null;
    return w ? { id: w.id, name: w.name, focus: w.focus, exercises: w.exercises } : null;
  }

  private historyFor(ids: string[], beforeDate: string): Map<string, PastSession[]> {
    const out = new Map<string, PastSession[]>();
    const done = this.sessions.filter((s) => s.status === 'completed' && s.date <= beforeDate).sort((a, b) => (a.finishedAt! < b.finishedAt! ? 1 : -1));
    for (const id of ids) {
      const list: PastSession[] = [];
      for (const s of done) {
        const sets = (this.sets.get(s.id) ?? []).filter((x) => x.exerciseId === id);
        if (sets.length) list.push({ sets: clone(sets), painReported: s.painReported });
        if (list.length >= 3) break;
      }
      if (list.length) out.set(id, list);
    }
    return out;
  }

  private recent(date: string) {
    const out: string[] = [];
    for (let i = 1; i <= 3; i++) this.plans.get(addDays(date, -i))?.meals.forEach((m) => out.push(m.recipeId));
    return out;
  }

  private build(date: string): DailyPlan {
    const targets = this.targets ?? { kcal: 2000, proteinG: 120, carbsG: 220, fatG: 70, source: 'estimated' as const, notes: [] };
    const workout = this.workoutForDate(date);
    return buildDailyPlan({
      userId: 'preview', date, profile: this.profile, targets, workout, exercises: this.exercises,
      history: this.historyFor(workout?.exercises.map((x) => x.exerciseId) ?? [], addDays(date, -1)), recipes: this.recipeInfo, recentRecipeIds: this.recent(date), premium: this.premium,
    });
  }

  private planFor(date: string): DailyPlan {
    let p = this.plans.get(date);
    if (!p) this.plans.set(date, (p = this.build(date)));
    return p;
  }

  private mealInput(date: string, targets: Targets) {
    return { userId: 'preview', date, profile: this.profile, targets, recipes: this.recipeInfo, recentRecipeIds: this.recent(date), premium: this.premium };
  }

  private regenerate(date: string, part: 'meals' | 'workout' | 'all'): DailyPlan {
    const current = this.planFor(date);
    let next: DailyPlan;
    if (part === 'all') {
      const fresh = this.build(date);
      next = regenerateMeals(fresh, this.mealInput(date, fresh.targets));
    } else if (part === 'workout') {
      const fresh = this.build(date);
      next = { ...current, isRest: fresh.isRest, workout: fresh.workout, checklist: fresh.checklist };
    } else next = regenerateMeals(current, this.mealInput(date, this.targets ?? current.targets));
    this.plans.set(date, next);
    return next;
  }

  private refreshPlansUsing() {
    const t = this.today();
    for (const d of [...this.plans.keys()]) if (d >= t) this.regenerate(d, 'workout');
  }

  private checkSet(date: string) {
    let s = this.checks.get(date);
    if (!s) this.checks.set(date, (s = new Set()));
    return s;
  }

  private autoCheck(date: string, key: string) {
    const p = this.plans.get(date);
    if (p?.checklist.some((c) => c.key === key)) this.checkSet(date).add(key);
  }

  private dayView(date: string) {
    const today = this.today();
    const plan = this.planFor(date);
    const done = new Set(this.checkSet(date));
    const entries = this.logs.filter((l) => l.date === date).sort((a, b) => a.createdAt - b.createdAt);
    const eaten = sumItems(entries);
    const session = this.sessions.filter((s) => s.date === date && s.status !== 'discarded').sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
    const workoutDone = session?.status === 'completed';
    if (workoutDone) done.add('workout');
    const lastPerformance: Record<string, string> = {};
    if (plan.workout) for (const [id, ps] of this.historyFor(plan.workout.exercises.map((x) => x.exerciseId), addDays(date, -1))) lastPerformance[id] = describeSets(ps[0].sets);
    const allDone = plan.checklist.filter((c) => !c.optional).every((c) => done.has(c.key));
    const records = this.records.filter((r) => r.date === date).length;
    return {
      date, today, isToday: date === today, isPast: date < today, displayName: this.profile.displayName, goal: this.profile.goal, units: this.profile.units,
      plan,
      eaten: { kcal: Math.round(eaten.kcal), p: round(eaten.p, 1), c: round(eaten.c, 1), f: round(eaten.f, 1) },
      entries, loggedSlots: MEAL_SLOTS.filter((s) => entries.some((e) => e.slot === s)),
      checklist: plan.checklist.map((c) => ({ ...c, done: done.has(c.key) })),
      workoutStatus: plan.isRest && !session ? 'rest' : session ? session.status : 'not_started',
      sessionId: session?.id ?? null,
      lastPerformance,
      demos: Object.fromEntries((plan.workout?.exercises ?? []).map((x) => {
        const m = (this.media.get(x.exerciseId) ?? [])[0];
        return [x.exerciseId, m ? { kind: m.kind, ref: m.ref } : null];
      })),
      hydrationMl: this.water.get(date) ?? 0, hydrationEnabled: this.profile.hydrationEnabled, hydrationTargetMl: this.profile.hydrationTargetMl,
      summary: date < today || allDone ? summariseDay(plan, eaten, done, workoutDone, records) : null,
    };
  }

  /* ---------------- training ---------------- */
  private program() {
    return {
      templatePref: this.profile.templatePref,
      workouts: this.workouts.filter((w) => !w.archived).sort((a, b) => (a.source === b.source ? a.createdAt - b.createdAt : a.source === 'custom' ? -1 : 1))
        .map((w) => ({ id: w.id, name: w.name, focus: w.focus, source: w.source, template_id: w.templateId, exercises: w.exercises.map((x) => ({ ...x, name: this.exercises.get(x.exerciseId)?.name ?? x.exerciseId })) })),
      schedule: { ...this.schedule },
      overrides: [...this.overrides].map(([date, workoutId]) => ({ date, workoutId })),
      templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, days: t.days, premium: t.premium, locked: t.premium && !this.premium })),
    };
  }

  private parsePlanned(v: unknown): PlannedExercise[] {
    if (!Array.isArray(v)) throw bad('exercises must be a list.');
    return v.map((x: any) => {
      const ex = this.exercises.get(x.exerciseId);
      if (!ex) throw bad(`Unknown exercise: ${x.exerciseId}.`);
      if (ex.premium && !this.premium) throw premiumRequired(`${ex.name} is part of the Premium exercise library.`);
      const repMin = Math.max(1, Math.round(Number(x.repMin) || 1));
      return { exerciseId: ex.id, sets: Math.min(10, Math.max(1, Math.round(Number(x.sets) || 3))), repMin, repMax: Math.max(repMin, Math.round(Number(x.repMax) || repMin)), restSec: Math.min(600, Math.max(0, Math.round(Number(x.restSec) || 0))), mode: x.mode ?? ex.logging, rir: String(x.rir ?? '1-3'), weightKg: x.weightKg == null ? null : Number(x.weightKg) };
    });
  }

  private start(opts: { date?: string; workoutId?: string | null }): string {
    const active = this.sessions.find((s) => s.status === 'in_progress');
    if (active) return active.id;
    const date = opts.date ?? this.today();
    let name = 'Quick workout';
    let planned: PlannedExercise[] = [];
    let workoutId: string | null = null;
    if (opts.workoutId) {
      const w = this.workouts.find((x) => x.id === opts.workoutId);
      if (!w) throw notFound('Workout not found.');
      ({ name } = w);
      planned = clone(w.exercises);
      workoutId = w.id;
    } else {
      const plan = this.planFor(date);
      if (plan.workout) {
        name = plan.workout.name;
        workoutId = plan.workout.workoutId;
        planned = plan.workout.exercises.map(({ name: _n, suggestionNote: _s, suggestedWeightKg, ...x }) => ({ ...x, weightKg: suggestedWeightKg }));
      }
    }
    const id = uid();
    this.sessions.push({ id, date, workoutId, name, status: 'in_progress', planned, startedAt: new Date().toISOString(), finishedAt: null, notes: '', painReported: false });
    this.sets.set(id, []);
    return id;
  }

  private session(id: string) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw notFound('Workout not found.');
    return s;
  }

  private getSession(id: string) {
    const s = this.session(id);
    const sets = [...(this.sets.get(id) ?? [])].sort((a, b) => (a.exerciseId === b.exerciseId ? a.setIndex - b.setIndex : a.exerciseId < b.exerciseId ? -1 : 1));
    const planned = s.planned.map((x) => ({ ...x, name: this.exercises.get(x.exerciseId)?.name ?? x.exerciseId, logging: this.exercises.get(x.exerciseId)?.logging }));
    const previous: Record<string, any[]> = {};
    for (const [exId, h] of this.historyFor(planned.map((p) => p.exerciseId), addDays(s.date, -1))) previous[exId] = h[0].sets.map((x) => ({ weightKg: x.weightKg, reps: x.reps, durationSec: x.durationSec }));
    return {
      id: s.id, date: s.date, name: s.name, status: s.status, startedAt: s.startedAt, finishedAt: s.finishedAt, notes: s.notes, painReported: s.painReported,
      planned, sets, previous, records: this.records.filter((r) => r.sessionId === id).map((r) => ({ exerciseId: r.exerciseId, kind: r.kind, value: r.value })), volumeKg: Math.round(setVolume(sets)),
    };
  }

  private upsertSet(id: string, b: any) {
    const s = this.session(id);
    if (s.status === 'discarded') throw bad('This workout was discarded.');
    if (!this.exercises.has(b.exerciseId)) throw bad('Unknown exercise.');
    const list = this.sets.get(id)!;
    const set: LoggedSet = { exerciseId: b.exerciseId, setIndex: Number(b.setIndex), weightKg: b.weightKg ?? null, reps: b.reps ?? null, durationSec: b.durationSec ?? null, distanceM: b.distanceM ?? null, completed: b.completed !== false, pain: b.pain === true };
    const i = list.findIndex((x) => x.exerciseId === set.exerciseId && x.setIndex === set.setIndex);
    if (i >= 0) list[i] = set;
    else list.push(set);
    if (s.status === 'completed') this.recomputeRecords(s);
  }

  private finish(id: string, notes: string, pain: boolean, at = new Date().toISOString()) {
    const s = this.session(id);
    if (s.status !== 'in_progress') throw new ApiError(409, 'This workout is already finished.');
    if (!(this.sets.get(id) ?? []).some((x) => x.completed)) throw bad('Log at least one set before finishing, or discard the workout.');
    Object.assign(s, { status: 'completed', finishedAt: at, notes, painReported: pain });
    this.recomputeRecords(s);
    this.autoCheck(s.date, 'workout');
    return this.getSession(id);
  }

  private recomputeRecords(s: Session) {
    const current = (this.sets.get(s.id) ?? []).filter((x) => x.completed);
    const ids = new Set(current.map((c) => c.exerciseId));
    const prev = this.sessions.filter((o) => o.status === 'completed' && o.id !== s.id && o.finishedAt! < (s.finishedAt ?? new Date().toISOString()))
      .flatMap((o) => (this.sets.get(o.id) ?? []).filter((x) => x.completed && ids.has(x.exerciseId)));
    this.records = this.records.filter((r) => r.sessionId !== s.id);
    for (const r of detectRecords(current, prev)) this.records.push({ exerciseId: r.exerciseId, kind: r.kind, value: r.value, sessionId: s.id, date: s.date });
  }

  private exerciseHistory(id: string) {
    const lim = this.premium ? null : addDays(this.today(), -FREE_LIMITS.historyDays);
    const sessions = this.sessions.filter((s) => s.status === 'completed' && (!lim || s.date >= lim)).sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((s) => ({ sessionId: s.id, date: s.date, sets: (this.sets.get(s.id) ?? []).filter((x) => x.exerciseId === id && x.completed) })).filter((s) => s.sets.length);
    const recs: Record<string, number> = {};
    for (const r of this.records.filter((x) => x.exerciseId === id)) recs[r.kind] = Math.max(recs[r.kind] ?? 0, r.value);
    return { sessions, records: recs };
  }

  /* ---------------- nutrition ---------------- */
  private food(id: string): FoodItem {
    const f = this.foods.get(id) ?? this.customFoods.find((x) => x.id === id);
    if (!f) throw notFound('Food not found.');
    return f;
  }

  private insertLog(date: string, slot: MealSlot, v: { foodId?: string | null; recipeId?: string | null; name: string; grams?: number | null; portion?: number | null; m: Macros; fromPlan?: boolean }) {
    const id = uid();
    this.logs.push({ id, date, slot, foodId: v.foodId ?? null, recipeId: v.recipeId ?? null, name: v.name, grams: v.grams ?? null, portion: v.portion ?? null, kcal: round(v.m.kcal, 1), p: round(v.m.p, 1), c: round(v.m.c, 1), f: round(v.m.f, 1), fromPlan: !!v.fromPlan, createdAt: Date.now() + seq });
    if (slot !== 'snack') this.autoCheck(date, `meal_${slot}`);
    return id;
  }

  private recipeMacros(recipeId: string, portion: number) {
    const r = this.recipes.get(recipeId);
    if (!r) throw notFound('Recipe not found.');
    if (r.premium && !this.premium) throw premiumRequired(`${r.name} is part of the Premium recipe library.`);
    const per = recipeNutrition(r, this.foods).perServing;
    return { r, m: { kcal: per.kcal * portion, p: per.p * portion, c: per.c * portion, f: per.f * portion } };
  }

  private logBody(date: string, b: any) {
    const slot = b.slot as MealSlot;
    if (!MEAL_SLOTS.includes(slot)) throw bad('Choose a meal.');
    if (b.foodId) {
      const f = this.food(b.foodId);
      const g = Number(b.grams);
      if (!(g >= 1 && g <= 3000)) throw bad('Enter an amount between 1 and 3000 g.');
      return this.insertLog(date, slot, { foodId: f.id, name: f.name, grams: g, m: scaleFood(f, g) });
    }
    if (b.recipeId) {
      const portion = Number(b.portion) || 1;
      const { r, m } = this.recipeMacros(b.recipeId, portion);
      return this.insertLog(date, slot, { recipeId: r.id, name: r.name, portion, m });
    }
    if (!b.name) throw bad('Enter a name.');
    if (b.kcal == null || Number.isNaN(Number(b.kcal))) throw bad('Enter the calories.');
    return this.insertLog(date, slot, { name: String(b.name).slice(0, 80), m: { kcal: Number(b.kcal), p: Number(b.p) || 0, c: Number(b.c) || 0, f: Number(b.f) || 0 } });
  }

  private diary(date: string) {
    const entries = this.logs.filter((l) => l.date === date).sort((a, b) => a.createdAt - b.createdAt);
    const totals = roundMacros(sumItems(entries));
    const t = this.targets;
    return {
      date, entries, bySlot: Object.fromEntries(MEAL_SLOTS.map((s) => [s, entries.filter((e) => e.slot === s)])), totals, targets: t,
      remaining: t ? { kcal: t.kcal - totals.kcal, p: Math.round(t.proteinG - totals.p), c: Math.round(t.carbsG - totals.c), f: Math.round(t.fatG - totals.f) } : null,
    };
  }

  /* ---------------- progress ---------------- */
  private progress(asked: number) {
    const lim = this.premium ? null : FREE_LIMITS.historyDays;
    const days = lim ? Math.min(asked, lim) : asked;
    const today = this.today();
    const from = addDays(today, -(days - 1));
    const ms = this.metrics.filter((m) => m.date >= from).sort((a, b) => (a.date < b.date ? -1 : 1));
    const weights = ms.filter((m) => m.weightKg != null).map((m) => ({ date: m.date, value: m.weightKg! }));
    const trend = weights.map((p) => {
      const win = weights.filter((q) => q.date >= addDays(p.date, -6) && q.date <= p.date);
      return { date: p.date, value: round(win.reduce((a, b) => a + b.value, 0) / win.length, 1) };
    });
    const done = this.sessions.filter((s) => s.status === 'completed' && s.date >= from);
    const vol = (s: Session) => setVolume((this.sets.get(s.id) ?? []).filter((x) => x.completed));
    const weeks = new Map<string, { workouts: number; volumeKg: number }>();
    for (let d = weekStart(from); d <= today; d = addDays(d, 7)) weeks.set(d, { workouts: 0, volumeKg: 0 });
    for (const s of done) {
      const w = weeks.get(weekStart(s.date));
      if (w) {
        w.workouts++;
        w.volumeKg += vol(s);
      }
    }
    const planned = Object.values(this.schedule).filter(Boolean).length;
    const byDate = new Map<string, { kcal: number; p: number }>();
    for (const l of this.logs.filter((x) => x.date >= from)) {
      const v = byDate.get(l.date) ?? { kcal: 0, p: 0 };
      v.kcal += l.kcal;
      v.p += l.p;
      byDate.set(l.date, v);
    }
    const nutrition = [...byDate].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => {
      const t = this.plans.get(date)?.targets;
      return { date, kcal: Math.round(v.kcal), proteinG: Math.round(v.p), targetKcal: t?.kcal ?? null, targetProteinG: t?.proteinG ?? null };
    });
    const withT = nutrition.filter((d) => d.targetKcal);
    const period = (a: string) => {
      const s = done.filter((x) => x.date >= a);
      const n = nutrition.filter((x) => x.date >= a);
      return { workouts: s.length, volumeKg: Math.round(s.reduce((x, y) => x + vol(y), 0)), daysLogged: n.length, avgKcal: n.length ? Math.round(n.reduce((x, y) => x + y.kcal, 0) / n.length) : null, avgProteinG: n.length ? Math.round(n.reduce((x, y) => x + y.proteinG, 0) / n.length) : null };
    };
    let tasks = 0;
    for (const [d, s] of this.checks) if (d >= from) tasks += s.size;
    return {
      range: { from, to: today, days }, weights, trend,
      weightChange: trend.length >= 2 ? round(trend[trend.length - 1].value - trend[0].value, 1) : null,
      weightNote: weights.length < 7 ? 'Log your weight a few times a week. Daily weight swings of 1–2 kg are normal, so KYVO shows a 7-day average trend.' : 'The trend line is a 7-day average, which smooths normal day-to-day swings from water and food.',
      measurements: ms,
      weeks: [...weeks].map(([week, v]) => ({ week, workouts: v.workouts, volumeKg: Math.round(v.volumeKg), planned })),
      nutrition,
      calorieConsistency: withT.length ? Math.round((withT.filter((d) => Math.abs(d.kcal - d.targetKcal!) <= d.targetKcal! * 0.1).length / withT.length) * 100) : null,
      proteinConsistency: withT.length ? Math.round((withT.filter((d) => d.targetProteinG && d.proteinG >= d.targetProteinG * 0.9).length / withT.length) * 100) : null,
      records: this.records.filter((r) => r.date >= from).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30).map((r) => ({ exerciseId: r.exerciseId, name: this.exercises.get(r.exerciseId)?.name ?? r.exerciseId, kind: r.kind, value: r.value, date: r.date })),
      tasksCompleted: tasks,
      weekly: period(addDays(today, -6)), monthly: period(addDays(today, -29)),
      limitedTo: lim && asked > lim ? lim : null,
    };
  }

  /* ---------------- request router ---------------- */
  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    await new Promise((r) => setTimeout(r, 60)); // keep async behaviour realistic
    const url = new URL(path, 'https://preview.local');
    const result = this.route(method, url.pathname, url.searchParams, (body ?? {}) as any);
    return clone(result) as T;
  }

  private route(method: string, p: string, q: URLSearchParams, b: any): unknown {
    const m = (re: RegExp) => p.match(re);
    let x: RegExpMatchArray | null;
    const me = () => ({
      user: { id: 'preview', email: 'preview@kyvo.app', role: 'user', analyticsConsent: this.analytics },
      profile: this.profile, onboarded: this.profile.onboarded, premium: this.premium, targets: this.targets, today: this.today(), tiktokPixelId: null,
    });
    const key = `${method} ${p}`;
    switch (key) {
      case 'GET /api/me': return me();
      case 'POST /api/consent': this.analytics = !!b.analytics; return { ok: true };
      case 'POST /api/auth/logout': return { ok: true };
      case 'POST /api/onboarding': {
        Object.assign(this.profile, b.profile, { onboarded: true });
        if (b.manualTargets) {
          const err = validateManualTargets(b.manualTargets);
          if (err) throw bad(err);
          this.targets = { ...b.manualTargets, source: 'manual', notes: ['You set these targets yourself.'] };
        } else {
          const est = estimateTargets(this.profile);
          if (!est) throw bad('Add your height, weight and age range for an estimate, or enter your own calorie and macro targets.');
          this.targets = est;
        }
        this.regenerateProgram();
        const t = this.today();
        for (const d of [...this.plans.keys()]) if (d >= t) this.plans.delete(d);
        this.planFor(t);
        return { ok: true, today: t };
      }
      case 'PUT /api/profile': {
        const before = { ...this.profile };
        Object.assign(this.profile, b);
        const changed = (k: string[]) => k.some((f) => JSON.stringify((before as any)[f]) !== JSON.stringify((this.profile as any)[f]));
        const affects = { workouts: changed(['goal', 'experience', 'location', 'equipment', 'trainingDays', 'sessionMinutes', 'trainingStyle']), meals: changed(['diet', 'allergies', 'exclusions', 'goal', 'weightKg', 'heightCm', 'ageRange', 'sex', 'activity']), targets: changed(['goal', 'weightKg', 'heightCm', 'ageRange', 'sex', 'activity', 'trainingDays']) };
        if (affects.targets && this.targets?.source !== 'manual') this.targets = estimateTargets(this.profile) ?? this.targets;
        return { profile: this.profile, targets: this.targets, affects };
      }
      case 'GET /api/targets': return { current: this.targets, estimate: estimateTargets(this.profile) };
      case 'PUT /api/targets': {
        if (b.mode === 'estimate') {
          const est = estimateTargets(this.profile);
          if (!est) throw bad('Add your height, weight and age range to use an estimate.');
          return (this.targets = est);
        }
        const t = { kcal: Number(b.kcal), proteinG: Number(b.proteinG), carbsG: Number(b.carbsG), fatG: Number(b.fatG) };
        const err = validateManualTargets(t);
        if (err) throw bad(err);
        return (this.targets = { ...t, source: 'manual', notes: ['You set these targets yourself.'] });
      }
      case 'GET /api/exercises': {
        const s = (q.get('q') || '').toLowerCase().trim();
        const eq = equipmentSet(this.profile);
        const list = [...this.exercises.values()].sort((a, c) => a.name.localeCompare(c.name)).filter((e) => {
          const c = this.content.get(e.id);
          if (s && !(e.name.toLowerCase().includes(s) || (c.aliases ?? []).some((a: string) => a.toLowerCase().includes(s)))) return false;
          if (q.get('group') && !e.groups.includes(q.get('group')!)) return false;
          if (q.get('equipment') && !e.equipment.includes(q.get('equipment')!)) return false;
          if (q.get('difficulty') && e.difficulty !== q.get('difficulty')) return false;
          if (q.get('favourites') === '1' && !this.favourites.has(`exercise:${e.id}`)) return false;
          return true;
        });
        return { total: this.exercises.size, count: list.length, exercises: list.map((e) => ({ id: e.id, name: e.name, groups: e.groups, equipment: e.equipment, difficulty: e.difficulty, premium: e.premium, locked: e.premium && !this.premium, favourite: this.favourites.has(`exercise:${e.id}`), hasVideo: (this.media.get(e.id) ?? []).length > 0, available: exerciseAvailable(e, eq) })) };
      }
      case 'POST /api/favourites': {
        const k = `${b.kind}:${b.refId}`;
        if (b.on === false) this.favourites.delete(k);
        else this.favourites.add(k);
        return { ok: true };
      }
      case 'GET /api/program': return this.program();
      case 'POST /api/program/generate': {
        const tpl = TEMPLATES.find((t) => t.id === b.templateId);
        if (tpl?.premium && !this.premium) throw premiumRequired('That program is part of Premium.');
        this.regenerateProgram(b.templateId);
        this.refreshPlansUsing();
        return { ok: true };
      }
      case 'POST /api/workouts': {
        if (!this.premium && this.workouts.filter((w) => w.source === 'custom' && !w.archived).length >= FREE_LIMITS.customWorkouts) throw premiumRequired(`Free accounts can keep ${FREE_LIMITS.customWorkouts} custom workouts. Upgrade to Premium for unlimited workouts.`);
        if (!b.name) throw bad('Give the workout a name.');
        const id = uid();
        this.workouts.push({ id, name: String(b.name).slice(0, 60), focus: b.focus ?? '', exercises: this.parsePlanned(b.exercises ?? []), source: 'custom', archived: false, templateId: null, createdAt: Date.now() });
        return { id };
      }
      case 'POST /api/sessions': return { id: this.start({ date: b.date, workoutId: b.workoutId }) };
      case 'GET /api/sessions/active': {
        const s = this.sessions.find((y) => y.status === 'in_progress');
        return s ? this.getSession(s.id) : null;
      }
      case 'GET /api/sessions': {
        const lim = this.premium ? null : addDays(this.today(), -FREE_LIMITS.historyDays);
        return this.sessions.filter((s) => s.status === 'completed' && (!lim || s.date >= lim)).sort((a, c) => (a.date < c.date ? 1 : -1)).map((s) => {
          const sets = (this.sets.get(s.id) ?? []).filter((y) => y.completed);
          return { id: s.id, date: s.date, name: s.name, finishedAt: s.finishedAt, startedAt: s.startedAt, volumeKg: Math.round(setVolume(sets)), sets: sets.length, records: this.records.filter((r) => r.sessionId === s.id).length };
        });
      }
      case 'GET /api/foods': {
        const s = (q.get('q') || '').toLowerCase().trim();
        const all = [...this.customFoods, ...this.foods.values()];
        return {
          foods: (s ? all.filter((f) => f.name.toLowerCase().includes(s)) : all).slice(0, 60),
          recipes: [...this.recipes.values()].filter((r) => !s || r.name.toLowerCase().includes(s)).slice(0, 20).map((r) => ({ id: r.id, name: r.name, premium: r.premium, ...recipeNutrition(r, this.foods).perServing })),
        };
      }
      case 'GET /api/foods/quick': {
        const seen = new Set<string>();
        const recent = [...this.logs].sort((a, c) => c.createdAt - a.createdAt).filter((l) => {
          const k = l.foodId ?? l.recipeId;
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, 12).map((l) => ({ foodId: l.foodId, recipeId: l.recipeId, name: l.name, grams: l.grams, portion: l.portion }));
        return { recent, favourites: [...this.favourites].map((f) => ({ kind: f.split(':')[0], ref_id: f.split(':')[1] })), saved: this.saved.map((s) => ({ ...s, ...roundMacros(sumItems(s.items)) })) };
      }
      case 'POST /api/foods': {
        const f: FoodItem = { id: `u-${uid().slice(-8)}`, name: String(b.name || '').slice(0, 80), kcal: Number(b.kcal), p: Number(b.p), c: Number(b.c), f: Number(b.f), serving: { label: `${b.servingG ?? 100} g`, g: Number(b.servingG) || 100 }, tags: [], src: 'Entered by you' };
        if (f.name.length < 2) throw bad('Enter a name.');
        this.customFoods.push(f);
        return f;
      }
      case 'POST /api/saved-meals': {
        if (!this.premium && this.saved.length >= FREE_LIMITS.savedMeals) throw premiumRequired(`Free accounts can keep ${FREE_LIMITS.savedMeals} saved meals.`);
        const items = this.logs.filter((l) => (b.entryIds as string[]).includes(l.id)).map(({ foodId, recipeId, name, grams, portion, kcal, p: pp, c, f }) => ({ foodId, recipeId, name, grams, portion, kcal, p: pp, c, f }));
        const id = uid();
        this.saved.push({ id, name: String(b.name).slice(0, 60), items });
        return { id };
      }
      case 'GET /api/recipes': {
        const s = (q.get('q') || '').toLowerCase();
        return [...this.recipes.values()].sort((a, c) => a.name.localeCompare(c.name))
          .filter((r) => (!s || r.name.toLowerCase().includes(s)) && (!q.get('meal') || r.meal.includes(q.get('meal') as MealSlot)) && (!q.get('tag') || r.tags.includes(q.get('tag')!)) && (q.get('favourites') !== '1' || this.favourites.has(`recipe:${r.id}`)))
          .map((r) => ({ id: r.id, name: r.name, desc: r.description, meal: r.meal, tags: r.tags, prep: r.prep, cook: r.cook, premium: r.premium, locked: r.premium && !this.premium, favourite: this.favourites.has(`recipe:${r.id}`), perServing: recipeNutrition(r, this.foods).perServing }));
      }
      case 'GET /api/progress': return this.progress(Number(q.get('days')) || 30);
      case 'POST /api/metrics': {
        const row = { id: uid(), date: b.date, weightKg: b.weightKg ?? null, waistCm: b.waistCm ?? null, chestCm: b.chestCm ?? null, hipsCm: b.hipsCm ?? null, armCm: b.armCm ?? null, thighCm: b.thighCm ?? null };
        if (['weightKg', 'waistCm', 'chestCm', 'hipsCm', 'armCm', 'thighCm'].every((k) => (row as any)[k] == null)) throw bad('Enter at least one measurement.');
        const existing = this.metrics.find((y) => y.date === row.date);
        if (existing) for (const [k, v] of Object.entries(row)) if (k !== 'id' && v != null) (existing as any)[k] = v;
        else this.metrics.push(row);
        if (row.weightKg != null) this.profile.weightKg = row.weightKg;
        return { ok: true };
      }
      case 'GET /api/photos': return [];
      case 'POST /api/photos': throw bad('Progress photos are stored privately on the KYVO server, so they are turned off in this preview.');
      case 'GET /api/billing': return { configured: false, premium: this.premium, subscription: this.premium ? { status: 'active', interval: 'monthly', currentPeriodEnd: `${addDays(this.today(), 30)}T00:00:00Z`, cancelAtPeriodEnd: false } : null, prices: PRICES, preview: true };
      case 'POST /api/billing/checkout':
        this.premium = isPremium({ status: 'active', currentPeriodEnd: `${addDays(this.today(), 30)}T00:00:00Z`, cancelAtPeriodEnd: false });
        this.plans.clear();
        return { url: '#/premium?checkout=success' };
      case 'POST /api/billing/portal':
        this.premium = false;
        this.plans.clear();
        return { url: '#/premium' };
      case 'POST /api/auth/password':
      case 'POST /api/account/delete':
      case 'POST /api/auth/login':
      case 'POST /api/auth/register':
        throw bad('Accounts are turned off in this preview. Everything here uses sample data.');
    }

    if ((x = m(/^\/api\/plan\/(\d{4}-\d{2}-\d{2})$/)) && method === 'GET') return this.dayView(x[1]);
    if ((x = m(/^\/api\/plan\/(\d{4}-\d{2}-\d{2})\/checklist\/([a-z_]+)$/))) {
      const set = this.checkSet(x[1]);
      if (b.done) set.add(x[2]);
      else set.delete(x[2]);
      return { ok: true };
    }
    if ((x = m(/^\/api\/plan\/(\d{4}-\d{2}-\d{2})\/meals\/(\w+)\/log$/))) {
      const meal = this.planFor(x[1]).meals.find((y) => y.slot === x![2]);
      if (!meal) throw bad('There is no planned meal for that slot.');
      const { r, m: mac } = this.recipeMacros(meal.recipeId, meal.portion);
      return { ok: true, id: this.insertLog(x[1], meal.slot, { recipeId: r.id, name: r.name, portion: meal.portion, m: mac, fromPlan: true }) };
    }
    if ((x = m(/^\/api\/plan\/(\d{4}-\d{2}-\d{2})\/meals\/(\w+)\/swaps$/))) {
      const plan = this.planFor(x[1]);
      const slot = x[2] as MealSlot;
      return swapOptions(slot, plan.meals.find((y) => y.slot === slot), plan.targets, this.recipeInfo, { diet: this.profile.diet, allergies: this.profile.allergies, exclusions: this.profile.exclusions, premium: this.premium });
    }
    if ((x = m(/^\/api\/plan\/(\d{4}-\d{2}-\d{2})\/meals\/(\w+)\/swap$/))) {
      const plan = this.planFor(x[1]);
      const info = this.recipeInfo.find((r) => r.recipe.id === b.recipeId);
      if (!info) throw bad('That recipe is not available.');
      const meals = swapMeal(plan.meals, x[2] as MealSlot, info, plan.targets);
      const next = { ...plan, meals, plannedTotals: plannedTotals(meals) };
      this.plans.set(x[1], next);
      return { ok: true, plan: next };
    }
    if ((x = m(/^\/api\/plan\/(\d{4}-\d{2}-\d{2})\/regenerate$/))) {
      if (x[1] < this.today()) throw bad('Past plans are kept as they were.');
      if (b.part !== 'meals') this.regenerateProgram();
      return { ok: true, plan: this.regenerate(x[1], b.part) };
    }
    if ((x = m(/^\/api\/hydration\/(\d{4}-\d{2}-\d{2})$/))) {
      const ml = Math.max(0, (this.water.get(x[1]) ?? 0) + Number(b.addMl));
      this.water.set(x[1], ml);
      if (this.profile.hydrationEnabled && ml >= this.profile.hydrationTargetMl) this.autoCheck(x[1], 'hydration');
      return { ml };
    }
    if ((x = m(/^\/api\/exercises\/([a-z0-9-]+)\/substitutes$/))) {
      return substitutesFor(x[1], this.exercises, equipmentSet(this.profile), this.premium, 12).map((s) => ({ id: s.id, name: s.name, locked: s.premium && !this.premium, equipment: s.equipment }));
    }
    if ((x = m(/^\/api\/exercises\/([a-z0-9-]+)$/))) {
      const e = this.exercises.get(x[1]);
      if (!e) throw notFound('Exercise not found.');
      const c = this.content.get(e.id);
      const locked = e.premium && !this.premium;
      const base = { id: e.id, name: e.name, groups: e.groups, equipment: e.equipment, difficulty: e.difficulty, logging: e.logging, premium: e.premium, locked, favourite: this.favourites.has(`exercise:${e.id}`), musclesText: c.musclesText,
        alternatives: substitutesFor(e.id, this.exercises, equipmentSet(this.profile), this.premium, 8).map((s) => ({ id: s.id, name: s.name, locked: s.premium && !this.premium })) };
      if (locked) return { ...base, content: null, media: [] };
      return {
        ...base,
        content: { steps: c.steps, cues: c.cues, mistakes: c.mistakes, safety: c.safety, checks: c.checks, programming: c.programming, reduceLoad: c.reduceLoad, secondary: e.secondary, primary: e.primary },
        media: (this.media.get(e.id) ?? []).map((md) => ({ kind: md.kind, ref: md.kind === 'video' ? md.ref.replace(/^\//, '') : md.ref, title: md.title, attribution: md.attribution, license: md.license, source: md.source, verifiedNote: md.verified_note })),
        history: this.exerciseHistory(e.id),
      };
    }
    if ((x = m(/^\/api\/workouts\/([0-9a-f-]{36})\/duplicate$/))) {
      const w = this.workouts.find((y) => y.id === x![1]);
      if (!w) throw notFound('Workout not found.');
      return this.route('POST', '/api/workouts', q, { name: `${w.name} (copy)`, focus: w.focus, exercises: w.exercises });
    }
    if ((x = m(/^\/api\/workouts\/([0-9a-f-]{36})$/))) {
      const w = this.workouts.find((y) => y.id === x![1] && !y.archived);
      if (!w) throw notFound('Workout not found.');
      if (method === 'DELETE') {
        w.archived = true;
        for (const k of Object.keys(this.schedule)) if (this.schedule[Number(k)] === w.id) this.schedule[Number(k)] = null;
      } else Object.assign(w, { name: String(b.name).slice(0, 60), focus: b.focus ?? '', exercises: this.parsePlanned(b.exercises ?? []) });
      this.refreshPlansUsing();
      return { ok: true };
    }
    if ((x = m(/^\/api\/schedule\/date\/(\d{4}-\d{2}-\d{2})$/))) {
      this.overrides.set(x[1], b.workoutId ?? null);
      if (this.plans.has(x[1])) this.regenerate(x[1], 'workout');
      return { ok: true };
    }
    if ((x = m(/^\/api\/schedule\/(\d)$/))) {
      this.schedule[Number(x[1])] = b.workoutId ?? null;
      this.refreshPlansUsing();
      return { ok: true };
    }
    if ((x = m(/^\/api\/sessions\/([0-9a-f-]{36})(\/[a-z/]+)?$/))) {
      const id = x[1];
      switch (`${method} ${x[2] ?? ''}`) {
        case 'GET ': return this.getSession(id);
        case 'PATCH ': this.session(id).notes = String(b.notes ?? ''); return { ok: true };
        case 'PUT /sets': this.upsertSet(id, b); return { ok: true };
        case 'POST /sets/delete': {
          const list = this.sets.get(id) ?? [];
          this.sets.set(id, list.filter((s) => !(s.exerciseId === b.exerciseId && s.setIndex === Number(b.setIndex))));
          const s = this.session(id);
          if (s.status === 'completed') this.recomputeRecords(s);
          return { ok: true };
        }
        case 'POST /exercises': {
          const s = this.session(id);
          const ex = this.exercises.get(b.exerciseId);
          if (!ex) throw bad('Unknown exercise.');
          if (ex.premium && !this.premium) throw premiumRequired(`${ex.name} is part of the Premium exercise library.`);
          if (s.planned.some((y) => y.exerciseId === ex.id)) throw bad(`${ex.name} is already in this workout.`);
          const old = b.replace ? s.planned.find((y) => y.exerciseId === b.replace) : null;
          const presc = old ? { sets: old.sets, repMin: old.repMin, repMax: old.repMax, restSec: old.restSec, mode: ex.logging, rir: old.rir } : prescribe(ex, 'acc', this.profile.goal, this.profile.experience);
          const entry: PlannedExercise = { exerciseId: ex.id, ...presc, weightKg: null };
          s.planned = old ? s.planned.map((y) => (y.exerciseId === b.replace ? entry : y)) : [...s.planned, entry];
          return { ok: true };
        }
        case 'POST /finish': return this.finish(id, String(b.notes ?? ''), b.painReported === true);
        case 'POST /discard': {
          const s = this.session(id);
          if (s.status !== 'in_progress') throw notFound('No workout in progress with that id.');
          s.status = 'discarded';
          s.finishedAt = new Date().toISOString();
          return { ok: true };
        }
      }
    }
    if ((x = m(/^\/api\/diary\/(\d{4}-\d{2}-\d{2})$/))) return method === 'GET' ? this.diary(x[1]) : { id: this.logBody(x[1], b) };
    if ((x = m(/^\/api\/diary\/(\d{4}-\d{2}-\d{2})\/copy$/))) {
      const src = this.logs.filter((l) => l.date === b.fromDate && (!b.slot || l.slot === b.slot));
      for (const l of src) this.logs.push({ ...l, id: uid(), date: x[1], fromPlan: false, createdAt: Date.now() + seq });
      return { copied: src.length };
    }
    if ((x = m(/^\/api\/diary\/entry\/([0-9a-f-]{36})$/))) {
      const e = this.logs.find((l) => l.id === x![1]);
      if (!e) throw notFound('Diary entry not found.');
      if (method === 'DELETE') {
        this.logs = this.logs.filter((l) => l !== e);
        return { ok: true };
      }
      if (b.slot) e.slot = b.slot;
      let mac: Macros | null = null;
      if (e.foodId && b.grams !== undefined) {
        e.grams = Number(b.grams);
        mac = scaleFood(this.food(e.foodId), e.grams);
      } else if (e.recipeId && b.portion !== undefined) {
        e.portion = Number(b.portion);
        mac = this.recipeMacros(e.recipeId, e.portion).m;
      } else if (!e.foodId && !e.recipeId && b.kcal !== undefined) mac = { kcal: Number(b.kcal), p: Number(b.p) || 0, c: Number(b.c) || 0, f: Number(b.f) || 0 };
      if (mac) Object.assign(e, { kcal: round(mac.kcal, 1), p: round(mac.p, 1), c: round(mac.c, 1), f: round(mac.f, 1) });
      return { ok: true };
    }
    if ((x = m(/^\/api\/saved-meals\/([0-9a-f-]{36})(\/log)?$/))) {
      const s = this.saved.find((y) => y.id === x![1]);
      if (!s) throw notFound('Saved meal not found.');
      if (method === 'DELETE') {
        this.saved = this.saved.filter((y) => y !== s);
        return { ok: true };
      }
      for (const it of s.items) this.insertLog(b.date, b.slot, { foodId: it.foodId, recipeId: it.recipeId, name: it.name, grams: it.grams, portion: it.portion, m: it });
      return { logged: s.items.length };
    }
    if ((x = m(/^\/api\/recipes\/([a-z0-9-]+)$/))) {
      const r = this.recipes.get(x[1]);
      if (!r) throw notFound('Recipe not found.');
      const servings = Math.min(20, Math.max(0.5, Number(q.get('servings') ?? r.servings) || r.servings));
      const n = recipeNutrition(r, this.foods);
      const base = { id: r.id, name: r.name, desc: r.description, meal: r.meal, tags: r.tags, prep: r.prep, cook: r.cook, servings: r.servings, premium: r.premium, locked: r.premium && !this.premium, favourite: this.favourites.has(`recipe:${r.id}`), perServing: n.perServing, allergens: allergensIn(n.tags) };
      if (base.locked) return base;
      return {
        ...base, chosenServings: servings,
        ingredients: scaleIngredients(r, servings).map(([id, g]) => ({ foodId: id, name: this.foods.get(id)?.name ?? id, grams: g })),
        totalForServings: { kcal: Math.round(n.perServing.kcal * servings), p: round(n.perServing.p * servings, 1), c: round(n.perServing.c * servings, 1), f: round(n.perServing.f * servings, 1) },
        steps: r.steps, storage: r.storage, subs: r.subs,
        source: 'Calculated from ingredient weights using KYVO’s curated generic food values. Values are estimates.',
      };
    }
    if ((x = m(/^\/api\/metrics\/([0-9a-f-]{36})$/))) {
      this.metrics = this.metrics.filter((y) => y.id !== x![1]);
      return { ok: true };
    }
    if (p.startsWith('/api/admin')) throw new ApiError(403, 'The admin dashboard needs a real admin account, so it is not part of this preview.');
    throw new ApiError(501, 'This part of KYVO is not available in the preview.');
  }
}

function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** A plausible first working weight for the sample history only. */
function startingLoad(ex: ExerciseSummary): number | null {
  if (ex.logging !== 'weight_reps') return null;
  if (ex.equipment.includes('barbell')) return ex.mechanic === 'compound' ? 60 : 30;
  if (ex.equipment.includes('dumbbell')) return ex.mechanic === 'compound' ? 22.5 : 12.5;
  if (ex.equipment.includes('machine') || ex.equipment.includes('smith')) return 45;
  if (ex.equipment.includes('cable')) return 25;
  return 20;
}
