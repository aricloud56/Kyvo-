// Workout planner (custom workouts, schedule) and live workout sessions (sets, finish, history, records).
import type { Tx } from '../lib/db.js';
import { json } from '../lib/db.js';
import type { Catalog } from './catalog.js';
import type { PlanService } from './plan.js';
import { loadProfile, premiumFor, rowToSet } from './plan.js';
import type { DailyPlan, PlannedExercise } from '../../core/types.js';
import { detectRecords, setVolume, prescribe } from '../../core/workouts.js';
import { FREE_LIMITS } from '../../core/plans.js';
import { addDays, todayIn } from '../../core/util.js';
import { badRequest, notFound, premiumRequired, HttpError } from '../lib/http.js';
import { num, obj, oneOf, slug, str } from '../lib/validate.js';

const MODES = ['weight_reps', 'reps', 'time', 'distance_time'] as const;

export function parsePlannedExercises(v: unknown, catalog: Catalog, premium: boolean): PlannedExercise[] {
  if (!Array.isArray(v)) throw badRequest('exercises must be a list.');
  if (v.length > 30) throw badRequest('A workout can have at most 30 exercises.');
  return v.map((raw) => {
    const x = obj(raw);
    const id = slug(x.exerciseId, 'exerciseId');
    const ex = catalog.exercises.get(id);
    if (!ex) throw badRequest(`Unknown exercise: ${id}.`);
    if (ex.premium && !premium) throw premiumRequired(`${ex.name} is part of the Premium exercise library.`);
    const repMin = num(x.repMin, 'repMin', { min: 1, max: 600, int: true }) as number;
    const repMax = num(x.repMax, 'repMax', { min: repMin, max: 600, int: true }) as number;
    return {
      exerciseId: id,
      sets: num(x.sets, 'sets', { min: 1, max: 10, int: true }) as number,
      repMin, repMax,
      restSec: num(x.restSec, 'restSec', { min: 0, max: 600, int: true }) as number,
      mode: oneOf(x.mode, 'mode', MODES, ex.logging),
      rir: str(x.rir ?? '1-3', 'rir', { max: 10 }),
      weightKg: num(x.weightKg, 'weightKg', { min: 0, max: 500, optional: true }),
    };
  });
}

export class TrainingService {
  constructor(private catalog: Catalog, private plans: PlanService) {}

  async program(tx: Tx, userId: string) {
    const workouts = await tx.query<any>('select id, name, focus, exercises, source, template_id, created_at from kyvo.user_workouts where user_id = $1 and not archived order by source, created_at', [userId]);
    const schedule = await tx.query<{ weekday: number; workout_id: string | null }>('select weekday, workout_id from kyvo.user_schedule where user_id = $1', [userId]);
    const overrides = await tx.query<any>('select plan_date, workout_id from kyvo.schedule_overrides where user_id = $1 and plan_date >= current_date - 1 order by plan_date', [userId]);
    const profile = await loadProfile(tx, userId);
    return {
      templatePref: profile.templatePref,
      workouts: workouts.map((w) => ({ ...w, exercises: (w.exercises as PlannedExercise[]).map((x) => ({ ...x, name: this.catalog.exercises.get(x.exerciseId)?.name ?? x.exerciseId })) })),
      schedule: Object.fromEntries(schedule.map((s) => [s.weekday, s.workout_id])),
      overrides: overrides.map((o) => ({ date: o.plan_date, workoutId: o.workout_id })),
    };
  }

  async createWorkout(tx: Tx, userId: string, body: any): Promise<string> {
    const premium = await premiumFor(tx, userId);
    if (!premium) {
      const n = await tx.one<{ n: number }>("select count(*)::int as n from kyvo.user_workouts where user_id = $1 and source = 'custom' and not archived", [userId]);
      if (n.n >= FREE_LIMITS.customWorkouts) throw premiumRequired(`Free accounts can keep ${FREE_LIMITS.customWorkouts} custom workouts. Upgrade to Premium for unlimited workouts.`);
    }
    const name = str(body.name, 'name', { min: 1, max: 60 });
    const exercises = parsePlannedExercises(body.exercises ?? [], this.catalog, premium);
    const r = await tx.one<{ id: string }>("insert into kyvo.user_workouts (user_id, name, focus, exercises, source) values ($1,$2,$3,$4::jsonb,'custom') returning id", [
      userId, name, str(body.focus, 'focus', { max: 80, optional: true }), json(exercises),
    ]);
    return r.id;
  }

  async updateWorkout(tx: Tx, userId: string, id: string, body: any): Promise<void> {
    const premium = await premiumFor(tx, userId);
    const w = await tx.maybeOne('select id from kyvo.user_workouts where id = $1 and user_id = $2', [id, userId]);
    if (!w) throw notFound('Workout not found.');
    const exercises = parsePlannedExercises(body.exercises ?? [], this.catalog, premium);
    await tx.exec('update kyvo.user_workouts set name = $2, focus = $3, exercises = $4::jsonb, updated_at = now() where id = $1', [
      id, str(body.name, 'name', { min: 1, max: 60 }), str(body.focus, 'focus', { max: 80, optional: true }), json(exercises),
    ]);
    await this.refreshPlansUsing(tx, userId);
  }

  async duplicateWorkout(tx: Tx, userId: string, id: string): Promise<string> {
    const w = await tx.maybeOne<any>('select name, focus, exercises from kyvo.user_workouts where id = $1', [id]);
    if (!w) throw notFound('Workout not found.');
    return this.createWorkout(tx, userId, { name: `${w.name} (copy)`.slice(0, 60), focus: w.focus, exercises: w.exercises });
  }

  async deleteWorkout(tx: Tx, userId: string, id: string): Promise<void> {
    // Archive rather than delete so completed sessions keep their link.
    const n = await tx.exec('update kyvo.user_workouts set archived = true, updated_at = now() where id = $1 and user_id = $2', [id, userId]);
    if (!n) throw notFound('Workout not found.');
    await tx.exec('update kyvo.user_schedule set workout_id = null where user_id = $1 and workout_id = $2', [userId, id]);
    await this.refreshPlansUsing(tx, userId);
  }

  async assignDay(tx: Tx, userId: string, weekday: number, workoutId: string | null): Promise<void> {
    if (workoutId) await this.ownWorkout(tx, workoutId);
    await tx.exec('insert into kyvo.user_schedule (user_id, weekday, workout_id) values ($1,$2,$3) on conflict (user_id, weekday) do update set workout_id = excluded.workout_id', [userId, weekday, workoutId]);
    await this.refreshPlansUsing(tx, userId);
  }

  /** Move or change the session for one date (e.g. train tomorrow instead of today). */
  async overrideDate(tx: Tx, userId: string, date: string, workoutId: string | null): Promise<void> {
    if (workoutId) await this.ownWorkout(tx, workoutId);
    await tx.exec('insert into kyvo.schedule_overrides (user_id, plan_date, workout_id) values ($1,$2,$3) on conflict (user_id, plan_date) do update set workout_id = excluded.workout_id', [userId, date, workoutId]);
    await this.refreshPlansUsing(tx, userId, date);
  }

  private async ownWorkout(tx: Tx, id: string) {
    const w = await tx.maybeOne('select 1 from kyvo.user_workouts where id = $1 and not archived', [id]);
    if (!w) throw notFound('Workout not found.');
  }

  /** Stored plans for today onwards pick up schedule and workout edits; past plans stay as they were. */
  private async refreshPlansUsing(tx: Tx, userId: string, onlyDate?: string): Promise<void> {
    const profile = await loadProfile(tx, userId);
    const today = todayIn(profile.timezone);
    const rows = await tx.query<{ plan_date: string }>('select plan_date from kyvo.daily_plans where user_id = $1 and plan_date >= $2', [userId, today]);
    for (const r of rows) if (!onlyDate || r.plan_date === onlyDate) await this.plans.regenerate(tx, userId, r.plan_date, 'workout');
  }

  /* ---------------- live sessions ---------------- */

  async start(tx: Tx, userId: string, opts: { date?: string; workoutId?: string | null }): Promise<string> {
    const active = await tx.maybeOne<{ id: string }>("select id from kyvo.workout_sessions where user_id = $1 and status = 'in_progress'", [userId]);
    if (active) return active.id; // resume rather than start a second session
    const profile = await loadProfile(tx, userId);
    const date = opts.date ?? todayIn(profile.timezone);
    let name = 'Quick workout';
    let planned: PlannedExercise[] = [];
    let workoutId: string | null = null;
    if (opts.workoutId) {
      const w = await tx.maybeOne<any>('select id, name, exercises from kyvo.user_workouts where id = $1', [opts.workoutId]);
      if (!w) throw notFound('Workout not found.');
      ({ name } = w);
      planned = w.exercises;
      workoutId = w.id;
    } else {
      const plan: DailyPlan = await this.plans.getOrCreatePlan(tx, userId, date);
      if (plan.workout) {
        name = plan.workout.name;
        workoutId = plan.workout.workoutId;
        planned = plan.workout.exercises.map(({ name: _n, suggestionNote: _s, ...x }) => ({ ...x, weightKg: x.suggestedWeightKg }));
      }
    }
    const r = await tx.one<{ id: string }>('insert into kyvo.workout_sessions (user_id, plan_date, workout_id, name, planned) values ($1,$2,$3,$4,$5::jsonb) returning id', [
      userId, date, workoutId, name, json(planned),
    ]);
    return r.id;
  }

  async get(tx: Tx, userId: string, id: string) {
    const s = await tx.maybeOne<any>('select * from kyvo.workout_sessions where id = $1 and user_id = $2', [id, userId]);
    if (!s) throw notFound('Workout not found.');
    const sets = (await tx.query<any>('select * from kyvo.session_sets where session_id = $1 order by exercise_id, set_index', [id])).map(rowToSet);
    const planned = (s.planned as PlannedExercise[]).map((x) => ({ ...x, name: this.catalog.exercises.get(x.exerciseId)?.name ?? x.exerciseId, logging: this.catalog.exercises.get(x.exerciseId)?.logging }));
    const prs = await tx.query<any>('select exercise_id, kind, value from kyvo.personal_records where session_id = $1', [id]);
    // "Previous" comes from completed sessions on earlier days, so this session's own sets are never included.
    const history = await this.plans.historyFor(tx, userId, planned.map((p) => p.exerciseId), addDays(s.plan_date, -1));
    const previous: Record<string, { weightKg: number | null; reps: number | null; durationSec: number | null }[]> = {};
    for (const [exId, h] of history) {
      const prior = h[0];
      if (prior) previous[exId] = prior.sets.map((x) => ({ weightKg: x.weightKg, reps: x.reps, durationSec: x.durationSec }));
    }
    return {
      id: s.id, date: s.plan_date, name: s.name, status: s.status, startedAt: s.started_at, finishedAt: s.finished_at, notes: s.notes, painReported: s.pain_reported,
      planned, sets, previous,
      records: prs.map((p) => ({ exerciseId: p.exercise_id, kind: p.kind, value: Number(p.value) })),
      volumeKg: Math.round(setVolume(sets)),
    };
  }

  async upsertSet(tx: Tx, userId: string, sessionId: string, body: any): Promise<void> {
    const s = await tx.maybeOne<any>('select status from kyvo.workout_sessions where id = $1 and user_id = $2', [sessionId, userId]);
    if (!s) throw notFound('Workout not found.');
    if (s.status === 'discarded') throw badRequest('This workout was discarded.');
    const exerciseId = slug(body.exerciseId, 'exerciseId');
    if (!this.catalog.exercises.has(exerciseId)) throw badRequest('Unknown exercise.');
    const setIndex = num(body.setIndex, 'setIndex', { min: 0, max: 49, int: true });
    await tx.exec(
      `insert into kyvo.session_sets (session_id, user_id, exercise_id, set_index, weight_kg, reps, duration_sec, distance_m, completed, pain)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (session_id, exercise_id, set_index) do update set weight_kg = excluded.weight_kg, reps = excluded.reps, duration_sec = excluded.duration_sec,
         distance_m = excluded.distance_m, completed = excluded.completed, pain = excluded.pain, updated_at = now()`,
      [
        sessionId, userId, exerciseId, setIndex,
        num(body.weightKg, 'weightKg', { min: 0, max: 1000, optional: true }),
        num(body.reps, 'reps', { min: 0, max: 1000, int: true, optional: true }),
        num(body.durationSec, 'durationSec', { min: 0, max: 86400, int: true, optional: true }),
        num(body.distanceM, 'distanceM', { min: 0, max: 500000, int: true, optional: true }),
        body.completed !== false,
        body.pain === true,
      ],
    );
    if (s.status === 'completed') await this.recomputeRecords(tx, userId, sessionId);
  }

  async deleteSet(tx: Tx, userId: string, sessionId: string, exerciseId: string, setIndex: number): Promise<void> {
    const n = await tx.exec('delete from kyvo.session_sets where session_id = $1 and user_id = $2 and exercise_id = $3 and set_index = $4', [sessionId, userId, exerciseId, setIndex]);
    if (!n) throw notFound('Set not found.');
    const s = await tx.one<{ status: string }>('select status from kyvo.workout_sessions where id = $1', [sessionId]);
    if (s.status === 'completed') await this.recomputeRecords(tx, userId, sessionId);
  }

  /** Add an exercise to a live session, or replace one (sets already logged for the old one are kept). */
  async changeExercise(tx: Tx, userId: string, sessionId: string, add: string, replace: string | null): Promise<void> {
    const s = await tx.maybeOne<any>('select planned, status from kyvo.workout_sessions where id = $1 and user_id = $2', [sessionId, userId]);
    if (!s) throw notFound('Workout not found.');
    const ex = this.catalog.exercises.get(add);
    if (!ex) throw badRequest('Unknown exercise.');
    if (ex.premium && !(await premiumFor(tx, userId))) throw premiumRequired(`${ex.name} is part of the Premium exercise library.`);
    const profile = await loadProfile(tx, userId);
    let planned = s.planned as PlannedExercise[];
    const old = replace ? planned.find((p) => p.exerciseId === replace) : null;
    const presc = old ? { sets: old.sets, repMin: old.repMin, repMax: old.repMax, restSec: old.restSec, mode: ex.logging, rir: old.rir } : prescribe(ex, 'acc', profile.goal, profile.experience);
    const entry: PlannedExercise = { exerciseId: add, ...presc, weightKg: null };
    if (planned.some((p) => p.exerciseId === add)) throw badRequest(`${ex.name} is already in this workout.`);
    planned = old ? planned.map((p) => (p.exerciseId === replace ? entry : p)) : [...planned, entry];
    await tx.exec('update kyvo.workout_sessions set planned = $2::jsonb where id = $1', [sessionId, json(planned)]);
  }

  async finish(tx: Tx, userId: string, sessionId: string, notes: string, painReported: boolean) {
    const s = await tx.maybeOne<any>('select * from kyvo.workout_sessions where id = $1 and user_id = $2', [sessionId, userId]);
    if (!s) throw notFound('Workout not found.');
    if (s.status !== 'in_progress') throw new HttpError(409, 'This workout is already finished.', 'conflict');
    const sets = (await tx.query<any>('select * from kyvo.session_sets where session_id = $1 and completed', [sessionId])).map(rowToSet);
    if (!sets.length) throw badRequest('Log at least one set before finishing, or discard the workout.');
    await tx.exec("update kyvo.workout_sessions set status = 'completed', finished_at = now(), notes = $2, pain_reported = $3 where id = $1", [sessionId, notes, painReported]);
    await this.recomputeRecords(tx, userId, sessionId);
    await this.plans.autoCheck(tx, userId, s.plan_date, 'workout');
    return this.get(tx, userId, sessionId);
  }

  private async recomputeRecords(tx: Tx, userId: string, sessionId: string): Promise<void> {
    const s = await tx.one<any>('select plan_date, finished_at from kyvo.workout_sessions where id = $1', [sessionId]);
    const current = (await tx.query<any>('select * from kyvo.session_sets where session_id = $1 and completed', [sessionId])).map(rowToSet);
    const exIds = [...new Set(current.map((c) => c.exerciseId))];
    const prev = (
      await tx.query<any>(
        `select ss.* from kyvo.session_sets ss join kyvo.workout_sessions w on w.id = ss.session_id
         where w.user_id = $1 and w.status = 'completed' and w.id <> $2 and ss.exercise_id = any($3) and ss.completed and w.finished_at < $4`,
        [userId, sessionId, exIds, s.finished_at ?? new Date().toISOString()],
      )
    ).map(rowToSet);
    await tx.exec('delete from kyvo.personal_records where session_id = $1', [sessionId]);
    for (const r of detectRecords(current, prev)) {
      await tx.exec('insert into kyvo.personal_records (user_id, exercise_id, kind, value, session_id, achieved_on) values ($1,$2,$3,$4,$5,$6)', [userId, r.exerciseId, r.kind, r.value, sessionId, s.plan_date]);
    }
  }

  async discard(tx: Tx, userId: string, sessionId: string): Promise<void> {
    const n = await tx.exec("update kyvo.workout_sessions set status = 'discarded', finished_at = now() where id = $1 and user_id = $2 and status = 'in_progress'", [sessionId, userId]);
    if (!n) throw notFound('No workout in progress with that id.');
  }

  async updateNotes(tx: Tx, userId: string, sessionId: string, notes: string): Promise<void> {
    const n = await tx.exec('update kyvo.workout_sessions set notes = $3 where id = $1 and user_id = $2', [sessionId, userId, notes]);
    if (!n) throw notFound('Workout not found.');
  }

  async list(tx: Tx, userId: string, limitDays: number | null) {
    const rows = await tx.query<any>(
      `select s.id, s.plan_date, s.name, s.status, s.started_at, s.finished_at,
         coalesce(sum(ss.weight_kg * ss.reps) filter (where ss.completed), 0) as volume, count(ss.*) filter (where ss.completed) as sets,
         (select count(*) from kyvo.personal_records p where p.session_id = s.id) as records
       from kyvo.workout_sessions s left join kyvo.session_sets ss on ss.session_id = s.id
       where s.user_id = $1 and s.status = 'completed' and ($2::int is null or s.plan_date >= current_date - $2::int)
       group by s.id order by s.plan_date desc, s.finished_at desc limit 200`,
      [userId, limitDays],
    );
    return rows.map((r) => ({ id: r.id, date: r.plan_date, name: r.name, finishedAt: r.finished_at, startedAt: r.started_at, volumeKg: Math.round(Number(r.volume)), sets: Number(r.sets), records: Number(r.records) }));
  }

  async exerciseHistory(tx: Tx, userId: string, exerciseId: string, limitDays: number | null) {
    const rows = await tx.query<any>(
      `select w.id, w.plan_date, ss.set_index, ss.weight_kg, ss.reps, ss.duration_sec, ss.distance_m, ss.completed, ss.pain, ss.exercise_id
       from kyvo.session_sets ss join kyvo.workout_sessions w on w.id = ss.session_id
       where w.user_id = $1 and w.status = 'completed' and ss.exercise_id = $2 and ss.completed and ($3::int is null or w.plan_date >= current_date - $3::int)
       order by w.plan_date desc, ss.set_index`,
      [userId, exerciseId, limitDays],
    );
    const out: { sessionId: string; date: string; sets: ReturnType<typeof rowToSet>[] }[] = [];
    for (const r of rows) {
      let e = out.find((o) => o.sessionId === r.id);
      if (!e) out.push((e = { sessionId: r.id, date: r.plan_date, sets: [] }));
      e.sets.push(rowToSet(r));
    }
    const records = await tx.query<any>('select kind, max(value) as value from kyvo.personal_records where user_id = $1 and exercise_id = $2 group by kind', [userId, exerciseId]);
    return { sessions: out, records: Object.fromEntries(records.map((r) => [r.kind, Number(r.value)])) };
  }
}
