// Profiles, targets, weekly programs and the persisted Daily Plan.
import type { Tx } from '../lib/db.js';
import { json } from '../lib/db.js';
import type { Catalog } from './catalog.js';
import type { DailyPlan, LoggedSet, Macros, MealSlot, PlannedExercise, Profile, Targets, WorkoutDef } from '../../core/types.js';
import { MEAL_SLOTS } from '../../core/types.js';
import { buildDailyPlan, plannedWorkoutFor, regenerateMeals, summariseDay, type DaySummary } from '../../core/dailyPlan.js';
import { generateProgram, type PastSession } from '../../core/workouts.js';
import { estimateTargets } from '../../core/nutrition.js';
import { swapMeal, swapOptions, plannedTotals } from '../../core/meals.js';
import { isPremium } from '../../core/plans.js';
import { addDays, todayIn, weekdayOf, round } from '../../core/util.js';
import { badRequest, notFound } from '../lib/http.js';

export function rowToProfile(r: any): Profile & { timezone: string; onboarded: boolean } {
  return {
    displayName: r.display_name, ageRange: r.age_range, sex: r.sex, heightCm: r.height_cm == null ? null : Number(r.height_cm), weightKg: r.weight_kg == null ? null : Number(r.weight_kg),
    goal: r.goal, experience: r.experience, location: r.location, equipment: r.equipment, trainingDays: r.training_days.map(Number), sessionMinutes: Number(r.session_minutes),
    trainingStyle: r.training_style, diet: r.diet, allergies: r.allergies, exclusions: r.exclusions, units: r.units, activity: r.activity,
    hydrationEnabled: r.hydration_enabled, hydrationTargetMl: Number(r.hydration_target_ml), templatePref: r.template_pref, timezone: r.timezone, onboarded: !!r.onboarding_completed_at,
  };
}

export async function loadProfile(tx: Tx, userId: string) {
  const r = await tx.maybeOne('select * from kyvo.profiles where user_id = $1', [userId]);
  if (!r) throw notFound('Profile not found.');
  return rowToProfile(r);
}

export async function premiumFor(tx: Tx, userId: string): Promise<boolean> {
  const s = await tx.maybeOne<any>('select status, current_period_end, cancel_at_period_end from kyvo.subscriptions where user_id = $1 order by updated_at desc limit 1', [userId]);
  return isPremium(s ? { status: s.status, currentPeriodEnd: s.current_period_end, cancelAtPeriodEnd: s.cancel_at_period_end } : null);
}

export async function currentTargets(tx: Tx, userId: string): Promise<Targets | null> {
  const t = await tx.maybeOne<any>('select * from kyvo.nutrition_targets where user_id = $1 order by created_at desc, id desc limit 1', [userId]);
  return t ? { kcal: t.kcal, proteinG: t.protein_g, carbsG: t.carbs_g, fatG: t.fat_g, source: t.source, notes: t.notes } : null;
}

export async function saveTargets(tx: Tx, userId: string, t: Targets): Promise<void> {
  await tx.exec('insert into kyvo.nutrition_targets (user_id, kcal, protein_g, carbs_g, fat_g, source, notes) values ($1,$2,$3,$4,$5,$6,$7::jsonb)', [
    userId, Math.round(t.kcal), Math.round(t.proteinG), Math.round(t.carbsG), Math.round(t.fatG), t.source, json(t.notes),
  ]);
}

/** Recalculate estimated targets after profile changes, unless the user set manual targets. */
export async function refreshEstimatedTargets(tx: Tx, userId: string, profile: Profile): Promise<Targets | null> {
  const cur = await currentTargets(tx, userId);
  if (cur?.source === 'manual') return cur;
  const est = estimateTargets(profile);
  if (est && (!cur || cur.kcal !== est.kcal || cur.proteinG !== est.proteinG || cur.carbsG !== est.carbsG || cur.fatG !== est.fatG)) await saveTargets(tx, userId, est);
  return est ?? cur;
}

export class PlanService {
  constructor(private catalog: Catalog) {}

  /** Build and store a new weekly program. Generated workouts are archived, custom ones and all history are kept. */
  async regenerateProgram(tx: Tx, userId: string, templateId?: string): Promise<void> {
    const profile = await loadProfile(tx, userId);
    const premium = await premiumFor(tx, userId);
    const prog = generateProgram({ profile: { ...profile, templatePref: templateId ?? profile.templatePref }, exercises: this.catalog.exercises, premium });
    await tx.exec("update kyvo.user_workouts set archived = true, updated_at = now() where user_id = $1 and source = 'generated' and not archived", [userId]);
    const ids: string[] = [];
    for (const w of prog.workouts) {
      const r = await tx.one<{ id: string }>("insert into kyvo.user_workouts (user_id, name, focus, exercises, source, template_id) values ($1,$2,$3,$4::jsonb,'generated',$5) returning id", [
        userId, w.name, w.focus, json(w.exercises), prog.templateId,
      ]);
      ids.push(r.id);
    }
    for (let wd = 0; wd < 7; wd++) {
      const idx = prog.schedule[wd];
      await tx.exec('insert into kyvo.user_schedule (user_id, weekday, workout_id) values ($1,$2,$3) on conflict (user_id, weekday) do update set workout_id = excluded.workout_id', [
        userId, wd, idx == null ? null : ids[idx],
      ]);
    }
    if (templateId) await tx.exec('update kyvo.profiles set template_pref = $2 where user_id = $1', [userId, templateId]);
  }

  async workoutForDate(tx: Tx, userId: string, date: string): Promise<WorkoutDef | null> {
    const o = await tx.maybeOne<{ workout_id: string | null }>('select workout_id from kyvo.schedule_overrides where user_id = $1 and plan_date = $2', [userId, date]);
    let wid: string | null;
    if (o) wid = o.workout_id;
    else {
      const s = await tx.maybeOne<{ workout_id: string | null }>('select workout_id from kyvo.user_schedule where user_id = $1 and weekday = $2', [userId, weekdayOf(date)]);
      wid = s?.workout_id ?? null;
    }
    if (!wid) return null;
    const w = await tx.maybeOne<any>('select id, name, focus, exercises from kyvo.user_workouts where id = $1', [wid]);
    return w ? { id: w.id, name: w.name, focus: w.focus, exercises: w.exercises as PlannedExercise[] } : null;
  }

  async historyFor(tx: Tx, userId: string, exerciseIds: string[], beforeDate: string): Promise<Map<string, PastSession[]>> {
    const out = new Map<string, PastSession[]>();
    if (!exerciseIds.length) return out;
    const rows = await tx.query<any>(
      `select s.id, s.pain_reported, s.finished_at, ss.exercise_id, ss.set_index, ss.weight_kg, ss.reps, ss.duration_sec, ss.distance_m, ss.completed, ss.pain
       from kyvo.session_sets ss join kyvo.workout_sessions s on s.id = ss.session_id
       where s.user_id = $1 and s.status = 'completed' and ss.exercise_id = any($2) and s.plan_date <= $3
       order by s.finished_at desc, ss.set_index`,
      [userId, exerciseIds, beforeDate],
    );
    const bySession = new Map<string, Map<string, PastSession>>();
    for (const r of rows) {
      let m = bySession.get(r.exercise_id);
      if (!m) bySession.set(r.exercise_id, (m = new Map()));
      let ps = m.get(r.id);
      if (!ps) {
        if (m.size >= 3) continue;
        m.set(r.id, (ps = { sets: [], painReported: r.pain_reported }));
      }
      ps.sets.push(rowToSet(r));
    }
    for (const [ex, m] of bySession) out.set(ex, [...m.values()]);
    return out;
  }

  /** The stored plan for a date, generating and persisting it the first time it is requested. */
  async getOrCreatePlan(tx: Tx, userId: string, date: string): Promise<DailyPlan> {
    const existing = await tx.maybeOne<{ plan: DailyPlan }>('select plan from kyvo.daily_plans where user_id = $1 and plan_date = $2', [userId, date]);
    if (existing) return existing.plan;
    const plan = await this.build(tx, userId, date);
    await tx.exec('insert into kyvo.daily_plans (user_id, plan_date, plan) values ($1,$2,$3::jsonb) on conflict (user_id, plan_date) do nothing', [userId, date, json(plan)]);
    return (await tx.one<{ plan: DailyPlan }>('select plan from kyvo.daily_plans where user_id = $1 and plan_date = $2', [userId, date])).plan;
  }

  private async build(tx: Tx, userId: string, date: string): Promise<DailyPlan> {
    const profile = await loadProfile(tx, userId);
    if (!profile.onboarded) throw badRequest('Finish onboarding to get your plan.');
    const targets = (await currentTargets(tx, userId)) ?? { kcal: 2000, proteinG: 120, carbsG: 220, fatG: 70, source: 'estimated', notes: ['Add your height, weight and age range for a personalised estimate.'] };
    const premium = await premiumFor(tx, userId);
    const workout = await this.workoutForDate(tx, userId, date);
    const history = await this.historyFor(tx, userId, workout?.exercises.map((x) => x.exerciseId) ?? [], addDays(date, -1));
    const recent = await this.recentRecipeIds(tx, userId, date);
    return buildDailyPlan({ userId, date, profile, targets, workout, exercises: this.catalog.exercises, history, recipes: this.catalog.recipeInfo, recentRecipeIds: recent, premium });
  }

  private async recentRecipeIds(tx: Tx, userId: string, date: string): Promise<string[]> {
    const rows = await tx.query<{ plan: DailyPlan }>('select plan from kyvo.daily_plans where user_id = $1 and plan_date between $2 and $3', [userId, addDays(date, -3), addDays(date, -1)]);
    return rows.flatMap((r) => r.plan.meals.map((m) => m.recipeId));
  }

  private async store(tx: Tx, userId: string, date: string, plan: DailyPlan): Promise<DailyPlan> {
    await tx.exec('update kyvo.daily_plans set plan = $3::jsonb, version = version + 1, generated_at = now() where user_id = $1 and plan_date = $2', [userId, date, json(plan)]);
    return plan;
  }

  /** Regenerate parts of a day's plan. Logged meals, workouts and checklist ticks are never touched. */
  async regenerate(tx: Tx, userId: string, date: string, part: 'meals' | 'workout' | 'all'): Promise<DailyPlan> {
    const current = await this.getOrCreatePlan(tx, userId, date);
    if (part === 'all') {
      const fresh = await this.build(tx, userId, date);
      const meals = regenerateMeals(fresh, this.mealInput(userId, date, fresh.targets, await loadProfile(tx, userId), await premiumFor(tx, userId), await this.recentRecipeIds(tx, userId, date)));
      return this.store(tx, userId, date, meals);
    }
    if (part === 'workout') {
      const fresh = await this.build(tx, userId, date);
      return this.store(tx, userId, date, { ...current, isRest: fresh.isRest, workout: fresh.workout, checklist: fresh.checklist });
    }
    const profile = await loadProfile(tx, userId);
    const targets = (await currentTargets(tx, userId)) ?? current.targets;
    return this.store(tx, userId, date, regenerateMeals(current, this.mealInput(userId, date, targets, profile, await premiumFor(tx, userId), await this.recentRecipeIds(tx, userId, date))));
  }

  private mealInput(userId: string, date: string, targets: Targets, profile: Profile, premium: boolean, recent: string[]) {
    return { userId, date, profile, targets, recipes: this.catalog.recipeInfo, recentRecipeIds: recent, premium };
  }

  async swapOptions(tx: Tx, userId: string, date: string, slot: MealSlot) {
    const plan = await this.getOrCreatePlan(tx, userId, date);
    const profile = await loadProfile(tx, userId);
    const premium = await premiumFor(tx, userId);
    return swapOptions(slot, plan.meals.find((m) => m.slot === slot), plan.targets, this.catalog.recipeInfo, { diet: profile.diet, allergies: profile.allergies, exclusions: profile.exclusions, premium });
  }

  async swap(tx: Tx, userId: string, date: string, slot: MealSlot, recipeId: string): Promise<DailyPlan> {
    const options = await this.swapOptions(tx, userId, date, slot);
    const allowed = new Set(options.map((o) => o.recipeId));
    // Also allow any suitable recipe, not just the top suggestions.
    const profile = await loadProfile(tx, userId);
    const premium = await premiumFor(tx, userId);
    const all = swapOptions(slot, undefined, { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, source: 'estimated', notes: [] }, this.catalog.recipeInfo, { diet: profile.diet, allergies: profile.allergies, exclusions: profile.exclusions, premium }, 999);
    all.forEach((o) => allowed.add(o.recipeId));
    if (!allowed.has(recipeId)) throw badRequest('That recipe is not available for this meal with your current preferences or plan.');
    const info = this.catalog.recipeInfo.find((r) => r.recipe.id === recipeId)!;
    const plan = await this.getOrCreatePlan(tx, userId, date);
    const meals = swapMeal(plan.meals, slot, info, plan.targets);
    return this.store(tx, userId, date, { ...plan, meals, plannedTotals: plannedTotals(meals) });
  }

  /** Everything the Daily Plan screen needs for one date. */
  async dayView(tx: Tx, userId: string, date: string) {
    const profile = await loadProfile(tx, userId);
    const today = todayIn(profile.timezone);
    const plan = await this.getOrCreatePlan(tx, userId, date);
    const checks = await tx.query<{ key: string; done: boolean }>('select key, done from kyvo.checklist_items where user_id = $1 and plan_date = $2', [userId, date]);
    const done = new Set(checks.filter((c) => c.done).map((c) => c.key));
    const logs = await tx.query<any>('select * from kyvo.food_logs where user_id = $1 and log_date = $2 order by created_at', [userId, date]);
    const entries = logs.map(rowToLog);
    const eaten: Macros = { kcal: 0, p: 0, c: 0, f: 0 };
    for (const e of entries) {
      eaten.kcal += e.kcal; eaten.p += e.p; eaten.c += e.c; eaten.f += e.f;
    }
    const session = await tx.maybeOne<any>("select id, status, finished_at from kyvo.workout_sessions where user_id = $1 and plan_date = $2 and status <> 'discarded' order by started_at desc limit 1", [userId, date]);
    const hyd = await tx.maybeOne<{ ml: number }>('select ml from kyvo.hydration_logs where user_id = $1 and log_date = $2', [userId, date]);
    const records = await tx.one<{ n: number }>('select count(*)::int as n from kyvo.personal_records where user_id = $1 and achieved_on = $2', [userId, date]);
    const workoutDone = session?.status === 'completed';
    if (workoutDone) done.add('workout');
    const loggedSlots = MEAL_SLOTS.filter((s) => entries.some((e) => e.slot === s));
    const lastPerformance: Record<string, string> = {};
    if (plan.workout) {
      const hist = await this.historyFor(tx, userId, plan.workout.exercises.map((x) => x.exerciseId), addDays(date, -1));
      for (const [exId, ps] of hist) lastPerformance[exId] = describeSets(ps[0].sets);
    }
    const required = plan.checklist.filter((c) => !c.optional);
    const allDone = required.every((c) => done.has(c.key));
    const summary: DaySummary | null = date < today || allDone ? summariseDay(plan, eaten, done, workoutDone, records.n) : null;
    return {
      date, today, isToday: date === today, isPast: date < today, displayName: profile.displayName, goal: profile.goal, units: profile.units,
      plan,
      eaten: { kcal: Math.round(eaten.kcal), p: round(eaten.p, 1), c: round(eaten.c, 1), f: round(eaten.f, 1) },
      entries, loggedSlots,
      checklist: plan.checklist.map((c) => ({ ...c, done: done.has(c.key) })),
      workoutStatus: plan.isRest && !session ? 'rest' : session ? (session.status as string) : 'not_started',
      sessionId: session?.id ?? null,
      lastPerformance,
      demos: Object.fromEntries((plan.workout?.exercises ?? []).map((x) => {
        const m = (this.catalog.media.get(x.exerciseId) ?? [])[0];
        return [x.exerciseId, m ? { kind: m.kind, ref: m.ref } : null];
      })),
      hydrationMl: hyd?.ml ?? 0,
      hydrationEnabled: profile.hydrationEnabled,
      hydrationTargetMl: profile.hydrationTargetMl,
      summary,
    };
  }

  async setChecklist(tx: Tx, userId: string, date: string, key: string, done: boolean): Promise<void> {
    const plan = await this.getOrCreatePlan(tx, userId, date);
    if (!plan.checklist.some((c) => c.key === key)) throw badRequest('Unknown checklist item.');
    await tx.exec(
      'insert into kyvo.checklist_items (user_id, plan_date, key, done, done_at) values ($1,$2,$3,$4, case when $4 then now() end) on conflict (user_id, plan_date, key) do update set done = excluded.done, done_at = excluded.done_at',
      [userId, date, key, done],
    );
  }

  /** Mark a checklist item done because the matching activity happened (only if the plan has that item). */
  async autoCheck(tx: Tx, userId: string, date: string, key: string): Promise<void> {
    const p = await tx.maybeOne<{ plan: DailyPlan }>('select plan from kyvo.daily_plans where user_id = $1 and plan_date = $2', [userId, date]);
    if (!p || !p.plan.checklist.some((c) => c.key === key)) return;
    await tx.exec('insert into kyvo.checklist_items (user_id, plan_date, key, done, done_at) values ($1,$2,$3,true,now()) on conflict (user_id, plan_date, key) do update set done = true, done_at = now()', [userId, date, key]);
  }

  refreshWorkoutView(workout: WorkoutDef, history: Map<string, PastSession[]>) {
    return plannedWorkoutFor(workout, this.catalog.exercises, history);
  }
}

export function rowToSet(r: any): LoggedSet {
  return {
    exerciseId: r.exercise_id, setIndex: r.set_index, weightKg: r.weight_kg == null ? null : Number(r.weight_kg), reps: r.reps, durationSec: r.duration_sec,
    distanceM: r.distance_m, completed: r.completed, pain: r.pain,
  };
}

export function rowToLog(r: any) {
  return {
    id: r.id as string, date: r.log_date as string, slot: r.meal_slot as MealSlot, foodId: r.food_id as string | null, recipeId: r.recipe_id as string | null, name: r.name as string,
    grams: r.grams == null ? null : Number(r.grams), portion: r.portion == null ? null : Number(r.portion),
    kcal: Number(r.kcal), p: Number(r.protein), c: Number(r.carbs), f: Number(r.fat), fromPlan: r.from_plan as boolean,
  };
}

export function describeSets(sets: LoggedSet[]): string {
  const done = sets.filter((s) => s.completed);
  if (!done.length) return '';
  if (done.some((s) => s.weightKg)) return done.map((s) => `${s.weightKg ?? 0} kg × ${s.reps ?? 0}`).join(', ');
  if (done.some((s) => s.durationSec)) return done.map((s) => `${s.durationSec} s`).join(', ');
  return done.map((s) => `${s.reps ?? 0} reps`).join(', ');
}
