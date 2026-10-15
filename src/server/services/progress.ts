// Progress analytics from persisted data: weight trend, measurements, consistency, volume, records, nutrition.
import type { Tx } from '../lib/db.js';
import type { Catalog } from './catalog.js';
import { addDays, round, weekStart } from '../../core/util.js';

export function movingAverage(points: { date: string; value: number }[], days = 7): { date: string; value: number }[] {
  return points.map((p) => {
    const from = addDays(p.date, -(days - 1));
    const win = points.filter((q) => q.date >= from && q.date <= p.date);
    return { date: p.date, value: round(win.reduce((a, b) => a + b.value, 0) / win.length, 1) };
  });
}

export class ProgressService {
  constructor(private catalog: Catalog) {}

  async overview(tx: Tx, userId: string, days: number, today: string) {
    const from = addDays(today, -(days - 1));
    const metrics = await tx.query<any>('select * from kyvo.body_metrics where user_id = $1 and measured_on >= $2 order by measured_on', [userId, from]);
    const weights = metrics.filter((m) => m.weight_kg != null).map((m) => ({ date: m.measured_on as string, value: Number(m.weight_kg) }));
    const trend = movingAverage(weights);
    const sessions = await tx.query<any>(
      `select s.plan_date, coalesce(sum(ss.weight_kg * ss.reps) filter (where ss.completed), 0) as volume
       from kyvo.workout_sessions s left join kyvo.session_sets ss on ss.session_id = s.id
       where s.user_id = $1 and s.status = 'completed' and s.plan_date >= $2 group by s.id, s.plan_date`,
      [userId, from],
    );
    const weeks = new Map<string, { workouts: number; volumeKg: number }>();
    for (let d = weekStart(from); d <= today; d = addDays(d, 7)) weeks.set(d, { workouts: 0, volumeKg: 0 });
    for (const s of sessions) {
      const w = weeks.get(weekStart(s.plan_date));
      if (w) {
        w.workouts++;
        w.volumeKg += Number(s.volume);
      }
    }
    const scheduled = await tx.one<{ n: number }>('select count(*)::int as n from kyvo.user_schedule where user_id = $1 and workout_id is not null', [userId]);
    const nutrition = await tx.query<any>(
      `select l.log_date, sum(l.kcal) as kcal, sum(l.protein) as protein from kyvo.food_logs l where l.user_id = $1 and l.log_date >= $2 group by l.log_date order by l.log_date`,
      [userId, from],
    );
    const plans = await tx.query<any>("select plan_date, (plan->'targets'->>'kcal')::int as kcal, (plan->'targets'->>'proteinG')::int as protein from kyvo.daily_plans where user_id = $1 and plan_date >= $2", [userId, from]);
    const targetOn = new Map(plans.map((p) => [p.plan_date, p]));
    const nutritionDays = nutrition.map((n) => {
      const t = targetOn.get(n.log_date);
      return { date: n.log_date, kcal: Math.round(Number(n.kcal)), proteinG: Math.round(Number(n.protein)), targetKcal: t?.kcal ?? null, targetProteinG: t?.protein ?? null };
    });
    const withTargets = nutritionDays.filter((d) => d.targetKcal);
    const records = await tx.query<any>('select exercise_id, kind, value, achieved_on from kyvo.personal_records where user_id = $1 and achieved_on >= $2 order by achieved_on desc limit 30', [userId, from]);
    const checklist = await tx.query<any>('select plan_date, count(*) filter (where done) as done from kyvo.checklist_items where user_id = $1 and plan_date >= $2 group by plan_date', [userId, from]);
    const weekly = this.period(sessions, nutritionDays, addDays(today, -6), today);
    const monthly = this.period(sessions, nutritionDays, addDays(today, -29), today);
    return {
      range: { from, to: today, days },
      weights, trend,
      weightChange: trend.length >= 2 ? round(trend[trend.length - 1].value - trend[0].value, 1) : null,
      weightNote: weights.length < 7 ? 'Log your weight a few times a week. Daily weight swings of 1–2 kg are normal, so KYVO shows a 7-day average trend.' : 'The trend line is a 7-day average, which smooths normal day-to-day swings from water and food.',
      measurements: metrics.map((m) => ({ id: m.id, date: m.measured_on, weightKg: num(m.weight_kg), waistCm: num(m.waist_cm), chestCm: num(m.chest_cm), hipsCm: num(m.hips_cm), armCm: num(m.arm_cm), thighCm: num(m.thigh_cm) })),
      weeks: [...weeks.entries()].map(([week, v]) => ({ week, workouts: v.workouts, volumeKg: Math.round(v.volumeKg), planned: scheduled.n })),
      nutrition: nutritionDays,
      calorieConsistency: withTargets.length ? Math.round((withTargets.filter((d) => Math.abs(d.kcal - d.targetKcal) <= d.targetKcal * 0.1).length / withTargets.length) * 100) : null,
      proteinConsistency: withTargets.length ? Math.round((withTargets.filter((d) => d.targetProteinG && d.proteinG >= d.targetProteinG * 0.9).length / withTargets.length) * 100) : null,
      records: records.map((r) => ({ exerciseId: r.exercise_id, name: this.catalog.exercises.get(r.exercise_id)?.name ?? r.exercise_id, kind: r.kind, value: Number(r.value), date: r.achieved_on })),
      tasksCompleted: checklist.reduce((a, c) => a + Number(c.done), 0),
      weekly, monthly,
    };
  }

  private period(sessions: any[], nutrition: { date: string; kcal: number; proteinG: number }[], from: string, to: string) {
    const s = sessions.filter((x) => x.plan_date >= from && x.plan_date <= to);
    const n = nutrition.filter((x) => x.date >= from && x.date <= to);
    return {
      workouts: s.length,
      volumeKg: Math.round(s.reduce((a, b) => a + Number(b.volume), 0)),
      daysLogged: n.length,
      avgKcal: n.length ? Math.round(n.reduce((a, b) => a + b.kcal, 0) / n.length) : null,
      avgProteinG: n.length ? Math.round(n.reduce((a, b) => a + b.proteinG, 0) / n.length) : null,
    };
  }

  async saveMetrics(tx: Tx, userId: string, date: string, m: Record<string, number | null>): Promise<void> {
    await tx.exec(
      `insert into kyvo.body_metrics (user_id, measured_on, weight_kg, waist_cm, chest_cm, hips_cm, arm_cm, thigh_cm) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (user_id, measured_on) do update set weight_kg = coalesce(excluded.weight_kg, kyvo.body_metrics.weight_kg), waist_cm = coalesce(excluded.waist_cm, kyvo.body_metrics.waist_cm),
         chest_cm = coalesce(excluded.chest_cm, kyvo.body_metrics.chest_cm), hips_cm = coalesce(excluded.hips_cm, kyvo.body_metrics.hips_cm),
         arm_cm = coalesce(excluded.arm_cm, kyvo.body_metrics.arm_cm), thigh_cm = coalesce(excluded.thigh_cm, kyvo.body_metrics.thigh_cm)`,
      [userId, date, m.weightKg, m.waistCm, m.chestCm, m.hipsCm, m.armCm, m.thighCm],
    );
    if (m.weightKg != null) {
      const latest = await tx.maybeOne<{ measured_on: string }>('select measured_on from kyvo.body_metrics where user_id = $1 and weight_kg is not null order by measured_on desc limit 1', [userId]);
      if (latest?.measured_on === date) await tx.exec('update kyvo.profiles set weight_kg = $2, updated_at = now() where user_id = $1', [userId, m.weightKg]);
    }
  }

  async deleteMetric(tx: Tx, userId: string, id: string): Promise<number> {
    return tx.exec('delete from kyvo.body_metrics where id = $1 and user_id = $2', [id, userId]);
  }
}

const num = (v: unknown) => (v == null ? null : Number(v));
