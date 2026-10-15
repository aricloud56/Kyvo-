// Workout programming: templates, exercise selection, prescriptions, substitutions and progressive overload.
import type { ExerciseSummary, Experience, GeneratedProgram, Goal, LoggedSet, PlannedExercise, Prescription, Profile, WorkoutDef } from './types.js';
import { round } from './util.js';

/** Equipment everyone has. */
export const FREE_EQUIPMENT = ['bodyweight', 'mat', 'wall'];

export const EQUIPMENT_PRESETS: Record<'gym' | 'home', string[]> = {
  gym: ['barbell', 'ez_bar', 'dumbbell', 'kettlebell', 'cable', 'machine', 'smith', 'bench', 'rack', 'pullup_bar', 'dip_station', 'band', 'plate', 'box', 'ball', 'ab_wheel', 'landmine', 'sled', 'rope', 'treadmill', 'bike', 'rower', 'elliptical', 'stair_climber', 'jump_rope', 'ghd'],
  home: ['dumbbell', 'band', 'bench', 'pullup_bar'],
};

// Equipment that can stand in for each other when the exercise lists several options.
const EQ_GROUPS = [['dumbbell', 'kettlebell'], ['cable', 'band'], ['plate', 'ball', 'dumbbell', 'kettlebell'], ['cable', 'machine'], ['bench', 'ball'], ['rope', 'cable'], ['barbell', 'ez_bar']];

export function equipmentSet(profile: Pick<Profile, 'equipment' | 'location'>): Set<string> {
  const base = profile.equipment?.length ? profile.equipment : EQUIPMENT_PRESETS[profile.location === 'home' ? 'home' : 'gym'];
  return new Set([...base, ...FREE_EQUIPMENT]);
}

export function exerciseAvailable(ex: Pick<ExerciseSummary, 'equipment'>, eq: Set<string>): boolean {
  return ex.equipment.every((x) => eq.has(x) || EQ_GROUPS.some((g) => g.includes(x) && ex.equipment.some((y) => y !== x && g.includes(y) && eq.has(y))));
}

/** Ordered candidate exercises for each programming slot; the first available one is chosen. */
export const SLOTS: Record<string, string[]> = {
  squat: ['barbell-back-squat', 'hack-squat', 'smith-machine-squat', 'leg-press', 'goblet-squat', 'split-squat', 'bodyweight-squat'],
  squat2: ['front-squat', 'hack-squat', 'leg-press', 'goblet-squat', 'smith-machine-squat', 'bulgarian-split-squat', 'bodyweight-squat'],
  legpress: ['leg-press', 'hack-squat', 'smith-machine-squat', 'goblet-squat', 'bulgarian-split-squat', 'step-up'],
  hinge: ['conventional-deadlift', 'romanian-deadlift', 'dumbbell-romanian-deadlift', 'cable-pull-through', 'kettlebell-swing', 'single-leg-glute-bridge'],
  rdl: ['romanian-deadlift', 'dumbbell-romanian-deadlift', 'good-morning', 'cable-pull-through', 'back-extension', 'single-leg-glute-bridge'],
  lunge: ['bulgarian-split-squat', 'walking-lunge', 'reverse-lunge', 'split-squat', 'step-up', 'glute-bridge'],
  quadiso: ['leg-extension', 'sissy-squat', 'wall-sit', 'split-squat'],
  hamcurl: ['seated-leg-curl', 'lying-leg-curl', 'standing-leg-curl', 'nordic-hamstring-curl', 'glute-ham-raise', 'single-leg-glute-bridge'],
  glute: ['hip-thrust', 'barbell-glute-bridge', 'cable-pull-through', 'single-leg-glute-bridge', 'glute-bridge'],
  calves: ['standing-calf-raise', 'leg-press-calf-raise', 'smith-machine-calf-raise', 'single-leg-calf-raise', 'seated-calf-raise'],
  calves2: ['seated-calf-raise', 'single-leg-calf-raise', 'donkey-calf-raise', 'leg-press-calf-raise'],
  hpush: ['barbell-bench-press', 'dumbbell-bench-press', 'machine-chest-press', 'smith-machine-bench-press', 'push-up', 'incline-push-up'],
  incpush: ['incline-dumbbell-press', 'incline-barbell-bench-press', 'incline-machine-chest-press', 'dumbbell-bench-press', 'push-up', 'incline-push-up'],
  chestfly: ['cable-fly', 'pec-deck', 'dumbbell-fly', 'low-to-high-cable-fly', 'push-up'],
  dip: ['chest-dip', 'assisted-triceps-dip', 'close-grip-bench-press', 'push-up'],
  vpush: ['seated-dumbbell-shoulder-press', 'machine-shoulder-press', 'standing-barbell-overhead-press', 'arnold-press', 'push-up'],
  ohp: ['standing-barbell-overhead-press', 'seated-barbell-shoulder-press', 'seated-dumbbell-shoulder-press', 'machine-shoulder-press'],
  hpull: ['seated-cable-row', 'chest-supported-row', 'dumbbell-single-arm-row', 'machine-row', 'inverted-row', 'barbell-bent-over-row'],
  hpull2: ['barbell-bent-over-row', 't-bar-row', 'dumbbell-single-arm-row', 'seal-row', 'chest-supported-row', 'inverted-row'],
  vpull: ['lat-pulldown', 'pull-up', 'assisted-pull-up', 'neutral-grip-lat-pulldown', 'chin-up', 'inverted-row'],
  vpull2: ['pull-up', 'chin-up', 'neutral-grip-pull-up', 'assisted-pull-up', 'neutral-grip-lat-pulldown', 'single-arm-lat-pulldown', 'inverted-row'],
  lataccess: ['straight-arm-pulldown', 'single-arm-lat-pulldown', 'dumbbell-pullover', 'underhand-lat-pulldown'],
  sidedelt: ['dumbbell-lateral-raise', 'cable-lateral-raise', 'machine-lateral-raise', 'leaning-lateral-raise'],
  reardelt: ['face-pull', 'reverse-pec-deck', 'rear-delt-cable-fly', 'reverse-dumbbell-fly', 'band-pull-apart'],
  traps: ['dumbbell-shrug', 'barbell-shrug'],
  biceps: ['ez-bar-curl', 'cable-curl', 'standing-barbell-curl', 'alternating-dumbbell-curl', 'hammer-curl'],
  biceps2: ['incline-dumbbell-curl', 'hammer-curl', 'preacher-curl', 'spider-curl', 'bayesian-cable-curl', 'concentration-curl'],
  triceps: ['rope-triceps-pushdown', 'straight-bar-triceps-pushdown', 'overhead-dumbbell-extension', 'skull-crusher', 'dumbbell-kickback', 'bench-dip'],
  triceps2: ['overhead-cable-extension', 'overhead-dumbbell-extension', 'ez-bar-lying-triceps-extension', 'single-arm-cable-extension', 'dumbbell-kickback'],
  closegrip: ['close-grip-bench-press', 'assisted-triceps-dip', 'push-up'],
  core: ['dead-bug', 'plank', 'pallof-press', 'bird-dog', 'side-plank'],
  core2: ['hanging-knee-raise', 'cable-crunch', 'kneeling-rope-crunch', 'reverse-crunch', 'ab-wheel-rollout', 'lying-leg-raise'],
  core3: ['pallof-press', 'side-plank', 'suitcase-carry', 'cable-woodchopper', 'hollow-body-hold', 'dead-bug'],
  cardio: ['incline-treadmill-walk', 'stationary-cycling', 'elliptical', 'rowing-machine', 'stair-climber', 'treadmill-walk', 'jogging', 'low-impact-intervals'],
  cond: ['rowing-machine', 'sled-push', 'battle-ropes', 'running-intervals', 'farmers-carry', 'low-impact-intervals', 'mountain-climber'],
};

interface TemplateDay {
  name: string;
  focus: string;
  slots: string[];
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  description: string;
  days: number;
  premium: boolean;
  strengthMain?: boolean;
  beginner?: boolean;
  /** Every session trains the whole body, so sessions should not fall on consecutive days. */
  fullBody?: boolean;
  workouts: TemplateDay[];
}

const T = (name: string, focus: string, slots: string[]): TemplateDay => ({ name, focus, slots });

export const TEMPLATES: WorkoutTemplate[] = [
  { id: 'beginner3', name: 'Three-day beginner training', days: 3, premium: false, beginner: true, fullBody: true, description: 'Two alternating whole-body sessions built from simple machine and dumbbell exercises.',
    workouts: [T('Workout A', 'Whole body', ['legpress', 'hpush', 'vpull', 'hamcurl', 'core']), T('Workout B', 'Whole body', ['squat', 'incpush', 'hpull', 'glute', 'core2'])] },
  { id: 'full3', name: 'Full body (3 days)', days: 3, premium: false, fullBody: true, description: 'Three full-body sessions a week. Great for busy schedules.',
    workouts: [T('Full body A', 'Squat, push, pull', ['squat', 'hpush', 'hpull', 'rdl', 'sidedelt', 'core']), T('Full body B', 'Hinge, overhead press, pull-down', ['hinge', 'vpush', 'vpull', 'lunge', 'biceps', 'triceps', 'core2']), T('Full body C', 'Legs, incline press, row', ['legpress', 'incpush', 'hpull2', 'hamcurl', 'reardelt', 'calves', 'core3'])] },
  { id: 'home_db', name: 'Home dumbbell training', days: 3, premium: false, fullBody: true, description: 'Dumbbells, bands and bodyweight. Adapts to the equipment you have.',
    workouts: [T('Home A', 'Legs and push', ['squat2', 'hpush', 'lunge', 'sidedelt', 'triceps', 'core']), T('Home B', 'Back and hinge', ['rdl', 'hpull', 'vpull2', 'reardelt', 'biceps', 'core2']), T('Home C', 'Full body', ['legpress', 'incpush', 'hpull2', 'glute', 'core3', 'cond'])] },
  { id: 'upper_lower4', name: 'Upper/lower (4 days)', days: 4, premium: true, description: 'Each muscle trained twice a week across two upper and two lower sessions.',
    workouts: [T('Upper A', 'Chest, back, shoulders, arms', ['hpush', 'hpull', 'vpush', 'vpull', 'sidedelt', 'biceps', 'triceps']), T('Lower A', 'Quads focus', ['squat', 'rdl', 'lunge', 'hamcurl', 'calves', 'core']), T('Upper B', 'Upper chest, lats, rear delts', ['incpush', 'vpull2', 'hpull2', 'chestfly', 'reardelt', 'biceps2', 'triceps2']), T('Lower B', 'Hamstrings and glutes focus', ['hinge', 'legpress', 'glute', 'hamcurl', 'calves2', 'core2'])] },
  { id: 'hypertrophy4', name: 'Four-day hypertrophy training', days: 4, premium: true, description: 'Push, pull, legs and an upper session. Higher weekly volume for muscle growth.',
    workouts: [T('Push', 'Chest, shoulders, triceps', ['hpush', 'incpush', 'vpush', 'sidedelt', 'chestfly', 'triceps']), T('Pull', 'Back, rear delts, biceps', ['vpull', 'hpull2', 'hpull', 'lataccess', 'reardelt', 'biceps']), T('Legs', 'Quads, hamstrings, calves', ['squat', 'rdl', 'legpress', 'hamcurl', 'calves', 'core2']), T('Upper', 'Upper body mix', ['incpush', 'vpull2', 'vpush', 'hpull', 'biceps2', 'triceps2'])] },
  { id: 'ppl6', name: 'Push/pull/legs (3 or 6 days)', days: 6, premium: true, description: 'Push, pull and legs, once or twice a week. Six days suits experienced lifters with good recovery.',
    workouts: [T('Push A', 'Heavy chest press', ['hpush', 'vpush', 'incpush', 'sidedelt', 'triceps', 'triceps2']), T('Pull A', 'Vertical pull emphasis', ['vpull2', 'hpull', 'lataccess', 'reardelt', 'biceps', 'traps']), T('Legs A', 'Squat emphasis', ['squat', 'rdl', 'legpress', 'hamcurl', 'calves', 'core']), T('Push B', 'Overhead and incline', ['ohp', 'incpush', 'chestfly', 'sidedelt', 'dip', 'triceps2']), T('Pull B', 'Row emphasis', ['hpull2', 'vpull', 'hpull', 'reardelt', 'biceps2', 'core2']), T('Legs B', 'Hinge emphasis', ['hinge', 'squat2', 'lunge', 'glute', 'calves2', 'core3'])] },
  { id: 'strength4', name: 'Strength focus (4 days)', days: 4, premium: true, strengthMain: true, description: 'Lower reps and longer rests on the big lifts, with supporting accessories.',
    workouts: [T('Squat day', 'Squat strength', ['squat', 'rdl', 'lunge', 'core']), T('Bench day', 'Bench strength', ['hpush', 'hpull2', 'closegrip', 'reardelt']), T('Deadlift day', 'Deadlift strength', ['hinge', 'squat2', 'hamcurl', 'core3']), T('Press day', 'Overhead strength', ['ohp', 'vpull2', 'incpush', 'biceps'])] },
  { id: 'fatloss4', name: 'Fat loss and muscle retention (4 days)', days: 4, premium: true, fullBody: true, description: 'Enough heavy training to keep muscle, plus easy cardio. Your nutrition drives fat loss.',
    workouts: [T('Full body 1', 'Strength and cardio', ['squat', 'hpush', 'hpull', 'sidedelt', 'core', 'cardio']), T('Full body 2', 'Strength and cardio', ['hinge', 'vpush', 'vpull', 'lunge', 'core2', 'cardio']), T('Full body 3', 'Strength and conditioning', ['legpress', 'incpush', 'hpull2', 'hamcurl', 'reardelt', 'cond']), T('Full body 4', 'Arms, core, cardio', ['rdl', 'vpull2', 'biceps', 'triceps', 'core3', 'cardio'])] },
];

export const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/** Default weekdays per number of sessions (Mon/Wed/Fri style spacing). */
export const DEFAULT_WEEKDAYS: Record<number, number[]> = { 1: [3], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };

export function recommendTemplate(p: Pick<Profile, 'equipment' | 'location' | 'experience' | 'goal' | 'trainingDays'>, premium: boolean): string {
  const eq = equipmentSet(p);
  const days = p.trainingDays.length || 3;
  let id: string;
  if (!eq.has('barbell') && !eq.has('cable') && !eq.has('machine')) id = 'home_db';
  else if (p.experience === 'beginner' && days <= 3) id = 'beginner3';
  else if (p.goal === 'strength' && days >= 4) id = 'strength4';
  else if (p.goal === 'fat_loss' && days >= 4) id = 'fatloss4';
  else if (days >= 6) id = 'ppl6';
  else if (days >= 4) id = p.goal === 'muscle_gain' ? 'hypertrophy4' : 'upper_lower4';
  else id = 'full3';
  if (!premium && TEMPLATE_BY_ID.get(id)?.premium) id = eq.has('barbell') || eq.has('machine') ? (p.experience === 'beginner' ? 'beginner3' : 'full3') : 'home_db';
  return id;
}

export function prescribe(ex: Pick<ExerciseSummary, 'logging' | 'category' | 'mechanic'>, role: 'main' | 'acc', goal: Goal, level: Experience, strengthMain = false): Prescription {
  const sets = role === 'main' ? (level === 'advanced' ? 4 : 3) : level === 'beginner' ? 2 : 3;
  let p: Omit<Prescription, 'sets'>;
  if (ex.logging === 'time') p = { mode: 'time', repMin: 20, repMax: 45, restSec: 60, rir: '2-3' };
  else if (ex.logging === 'distance_time') p = ex.category === 'cardio' ? { mode: 'distance_time', repMin: 15, repMax: 30, restSec: 0, rir: 'moderate' } : { mode: 'distance_time', repMin: 30, repMax: 60, restSec: 90, rir: 'moderate' };
  else if ((strengthMain || goal === 'strength') && role === 'main') p = { mode: ex.logging, repMin: 3, repMax: 6, restSec: 180, rir: '1-3' };
  else if (role === 'main') p = { mode: ex.logging, repMin: 6, repMax: 10, restSec: 150, rir: '1-3' };
  else if (ex.mechanic === 'compound') p = { mode: ex.logging, repMin: 8, repMax: 12, restSec: 105, rir: '1-2' };
  else p = { mode: ex.logging, repMin: 10, repMax: 15, restSec: 75, rir: level === 'beginner' ? '1-3' : '0-2' };
  if (ex.category === 'core' && ex.logging !== 'time') p = { ...p, repMin: 10, repMax: 15, restSec: 60 };
  if (ex.category === 'cardio') return { ...p, sets: 1 };
  return { ...p, sets };
}

/** Estimated session length in minutes, including warm-up and cool-down. */
export function estimateMinutes(exercises: (PlannedExercise & { category?: string })[]): number {
  let s = 8 * 60;
  for (const x of exercises) {
    if (x.mode === 'distance_time' && x.restSec === 0) {
      s += x.repMin * 60;
      continue;
    }
    const work = x.mode === 'time' ? (x.repMin + x.repMax) / 2 : x.mode === 'distance_time' ? 50 : 40;
    s += x.sets * (work + x.restSec) + 60;
  }
  return Math.round(s / 60 + 4);
}

export interface ProgramInput {
  profile: Pick<Profile, 'equipment' | 'location' | 'experience' | 'goal' | 'trainingDays' | 'sessionMinutes' | 'templatePref'>;
  exercises: Map<string, ExerciseSummary>;
  premium: boolean;
  /** Exercise ids the user asked to avoid. */
  avoid?: string[];
}

export function generateProgram({ profile, exercises, premium, avoid = [] }: ProgramInput): GeneratedProgram {
  let templateId = profile.templatePref && profile.templatePref !== 'auto' ? profile.templatePref : recommendTemplate(profile, premium);
  let tpl = TEMPLATE_BY_ID.get(templateId);
  if (!tpl || (tpl.premium && !premium)) {
    templateId = recommendTemplate(profile, premium);
    tpl = TEMPLATE_BY_ID.get(templateId)!;
  }
  const eq = equipmentSet(profile);
  const level = profile.experience || 'beginner';
  const maxMin = profile.sessionMinutes || 60;
  const usable = (id: string) => {
    const ex = exercises.get(id);
    return !!ex && (premium || !ex.premium) && !avoid.includes(id) && exerciseAvailable(ex, eq);
  };
  const workouts: WorkoutDef[] = tpl.workouts.map((d, di) => {
    const used = new Set<string>();
    const list: PlannedExercise[] = [];
    d.slots.forEach((slot, si) => {
      const id = (SLOTS[slot] || []).find((c) => !used.has(c) && usable(c));
      if (!id) return;
      used.add(id);
      const ex = exercises.get(id)!;
      const role = si === 0 || (si === 1 && ex.mechanic === 'compound' && !tpl!.beginner) ? 'main' : 'acc';
      list.push({ exerciseId: id, ...prescribe(ex, role, profile.goal, level, tpl!.strengthMain) });
    });
    if (level === 'beginner') while (list.length > 5) list.splice(list.length - 2, 1);
    // Trim accessories (keep the last finisher) until the session fits the time the user has.
    while (estimateMinutes(list) > maxMin && list.length > 3) list.splice(list.length - 2, 1);
    return { id: `w${di + 1}`, name: d.name, focus: d.focus, exercises: list };
  });
  const chosen = profile.trainingDays?.length ? [...profile.trainingDays] : DEFAULT_WEEKDAYS[tpl.days] || DEFAULT_WEEKDAYS[3];
  const weekdays = tpl.fullBody ? spreadDays(chosen, tpl.days) : sortMondayFirst(chosen);
  const schedule: Record<number, number | null> = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  weekdays.forEach((wd, i) => (schedule[wd] = i % workouts.length));
  return { templateId, name: tpl.name, workouts, schedule };
}

const sortMondayFirst = (days: number[]) => [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));

/**
 * For full-body programs: use at most `max` of the chosen days and avoid back-to-back sessions where the
 * chosen days allow it, so the same muscles are not trained on consecutive days.
 */
export function spreadDays(chosen: number[], max: number): number[] {
  const days = sortMondayFirst(chosen);
  const adjacent = (a: number, b: number) => Math.abs(a - b) === 1 || Math.abs(a - b) === 6;
  const picked: number[] = [];
  for (const d of days) if (picked.length < max && !picked.some((p) => adjacent(p, d))) picked.push(d);
  for (const d of days) if (picked.length < Math.min(max, days.length) && !picked.includes(d)) picked.push(d);
  return sortMondayFirst(picked);
}

/** Muscle-group labels for a list of exercises, most-trained first. */
export function muscleGroupsOf(exerciseIds: string[], exercises: Map<string, ExerciseSummary>): string[] {
  const count = new Map<string, number>();
  for (const id of exerciseIds) {
    const ex = exercises.get(id);
    if (!ex) continue;
    for (const g of ex.groups) if (!['bodyweight', 'full_body', 'mobility', 'cardio'].includes(g)) count.set(g, (count.get(g) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

export function substitutesFor(exId: string, exercises: Map<string, ExerciseSummary>, eq: Set<string>, premium: boolean, limit = 10): ExerciseSummary[] {
  const ex = exercises.get(exId);
  if (!ex) return [];
  const seen = new Set([exId]);
  const out: ExerciseSummary[] = [];
  const push = (id: string) => {
    const e = exercises.get(id);
    if (e && !seen.has(id)) {
      seen.add(id);
      out.push(e);
    }
  };
  ex.alternatives.forEach(push);
  Object.values(SLOTS).filter((c) => c.includes(exId)).forEach((c) => c.forEach(push));
  for (const e of exercises.values()) if (e.pattern === ex.pattern && e.category === ex.category) push(e.id);
  for (const e of exercises.values()) if (e.category !== 'mobility' && e.primary.some((m) => ex.primary.includes(m))) push(e.id);
  const score = (e: ExerciseSummary) => (exerciseAvailable(e, eq) ? 2 : 0) + (premium || !e.premium ? 1 : 0);
  return out.sort((a, b) => score(b) - score(a)).slice(0, limit);
}

/* ---------------- performance & progressive overload ---------------- */

/** Epley estimated one-rep max, only for 1-12 reps where the estimate is reasonable. */
export const e1rm = (w: number | null, r: number | null): number | null => (w && r && w > 0 && r > 0 && r <= 12 ? w * (1 + r / 30) : null);

export function roundLoad(kg: number, increment: number): number {
  const step = increment >= 2 ? (increment >= 5 ? 2.5 : increment / 2) : 0.5;
  return round(Math.round(kg / step) * step, 2);
}

export interface PastSession {
  sets: LoggedSet[];
  painReported: boolean;
}

export interface LoadSuggestion {
  type: 'increase' | 'hold' | 'reduce' | 'progress' | 'pain' | 'none';
  weightKg: number | null;
  note: string;
}

/**
 * Double progression. `history` is newest first and contains only completed sets for this exercise.
 * Never increases the load after failed planned work or reported pain.
 */
export function suggestLoad(ex: Pick<ExerciseSummary, 'increment' | 'logging' | 'name'>, presc: Prescription, history: PastSession[]): LoadSuggestion {
  const last = history[0];
  const sets = last?.sets.filter((s) => s.completed) ?? [];
  if (!last || !sets.length) return { type: 'none', weightKg: null, note: 'No previous sets yet. Pick a weight you could lift for 2–3 more reps than planned.' };
  if (last.painReported || last.sets.some((s) => s.pain)) {
    const w = Math.max(0, ...sets.map((s) => s.weightKg || 0)) || null;
    return { type: 'pain', weightKg: w, note: 'You reported pain last time, so the load has not been increased. Use a pain-free range and stop if pain is sharp.' };
  }
  if (presc.mode === 'weight_reps') {
    const w = Math.max(...sets.map((s) => s.weightKg || 0));
    if (!w) return { type: 'none', weightKg: null, note: 'Log a weight to get load suggestions.' };
    const hitTop = sets.length >= presc.sets && sets.every((s) => (s.reps || 0) >= presc.repMax && (s.weightKg || 0) >= w - 1e-6);
    if (hitTop) {
      const to = roundLoad(w + (ex.increment || 2.5), ex.increment || 2.5);
      return { type: 'increase', weightKg: to, note: `Every set reached ${presc.repMax} reps last time. Try ${to} kg and build the reps back up.` };
    }
    const failed = sets.length < presc.sets || sets.some((s) => (s.reps || 0) < presc.repMin);
    if (failed) {
      const prevFailed = history.slice(1, 3).filter((h) => {
        const hs = h.sets.filter((s) => s.completed);
        return hs.length && hs.some((s) => (s.reps || 0) < presc.repMin) && Math.max(...hs.map((s) => s.weightKg || 0)) >= w - 1e-6;
      }).length;
      if (prevFailed >= 2) {
        const to = roundLoad(w * 0.9, ex.increment || 2.5);
        return { type: 'reduce', weightKg: to, note: `Three sessions below ${presc.repMin} reps at ${w} kg. Drop to about ${to} kg and rebuild with good technique.` };
      }
      return { type: 'hold', weightKg: w, note: `Last time didn't reach the planned work, so stay at ${w} kg and aim for ${presc.repMin}+ reps on every set.` };
    }
    return { type: 'hold', weightKg: w, note: `Stay at ${w} kg and add a rep where you can. Increase once every set reaches ${presc.repMax}.` };
  }
  const top = sets.length >= presc.sets && sets.every((s) => ((presc.mode === 'time' ? s.durationSec : s.reps) || 0) >= presc.repMax);
  if (top) return { type: 'progress', weightKg: null, note: presc.mode === 'time' ? 'All holds hit the target. Add 5–10 seconds or try a harder version.' : `Every set reached ${presc.repMax}. Slow the lowering or move to a harder variation.` };
  return { type: 'hold', weightKg: null, note: 'Build gradually: add a rep or a few seconds per set while technique stays clean.' };
}

export interface PersonalRecord {
  exerciseId: string;
  kind: 'weight' | 'e1rm' | 'reps' | 'duration';
  value: number;
}

/** Records set in `current` compared with all previous completed sets for each exercise. */
export function detectRecords(current: LoggedSet[], previous: LoggedSet[]): PersonalRecord[] {
  const out: PersonalRecord[] = [];
  const byEx = new Map<string, LoggedSet[]>();
  for (const s of current.filter((s) => s.completed)) byEx.set(s.exerciseId, [...(byEx.get(s.exerciseId) || []), s]);
  for (const [exId, sets] of byEx) {
    const prior = previous.filter((s) => s.exerciseId === exId && s.completed);
    if (!prior.length) continue; // first log is a baseline, not a record
    const best = (xs: LoggedSet[], f: (s: LoggedSet) => number) => Math.max(0, ...xs.map(f));
    const checks: [PersonalRecord['kind'], (s: LoggedSet) => number][] = [
      ['weight', (s) => ((s.reps || 0) > 0 ? s.weightKg || 0 : 0)],
      ['e1rm', (s) => e1rm(s.weightKg, s.reps) || 0],
      ['reps', (s) => (s.weightKg ? 0 : s.reps || 0)],
      ['duration', (s) => s.durationSec || 0],
    ];
    for (const [kind, f] of checks) {
      const now = best(sets, f);
      if (now > 0 && now > best(prior, f) + 1e-6) out.push({ exerciseId: exId, kind, value: round(now, 1) });
    }
  }
  return out;
}

export function setVolume(sets: LoggedSet[]): number {
  return sets.filter((s) => s.completed).reduce((a, s) => a + (s.weightKg || 0) * (s.reps || 0), 0);
}
