// The KYVO Daily Plan: one function that turns a profile, a weekly program and history into today's plan.
import { addDays, weekStart, weekdayOf } from './util.js';
import type { ChecklistItemDef, DailyPlan, ExerciseSummary, MealSlot, PlannedMeal, PlannedWorkout, Profile, Targets, WorkoutDef } from './types.js';
import { MEAL_SLOTS } from './types.js';
import { type PastSession, estimateMinutes, muscleGroupsOf, suggestLoad } from './workouts.js';
import { type MealFilter, type RecipeInfo, planMeals, plannedTotals } from './meals.js';

export interface DailyPlanInput {
  userId: string;
  date: string;
  profile: Pick<Profile, 'diet' | 'allergies' | 'exclusions' | 'hydrationEnabled' | 'hydrationTargetMl'>;
  targets: Targets;
  /** The workout scheduled for this date, or null for a rest day. */
  workout: WorkoutDef | null;
  exercises: Map<string, ExerciseSummary>;
  /** Completed history per exercise id, newest first. */
  history: Map<string, PastSession[]>;
  recipes: RecipeInfo[];
  recentRecipeIds: string[];
  premium: boolean;
}

export function buildChecklist(isRest: boolean, hydrationEnabled: boolean, hydrationTargetMl: number): ChecklistItemDef[] {
  const items: ChecklistItemDef[] = [];
  if (isRest) items.push({ key: 'recover', label: 'Rest day: an easy walk or stretch if you feel like it', optional: true });
  else items.push({ key: 'workout', label: "Complete today's workout" });
  items.push({ key: 'meal_breakfast', label: 'Log breakfast' }, { key: 'meal_lunch', label: 'Log lunch' }, { key: 'meal_dinner', label: 'Log dinner' });
  if (hydrationEnabled) items.push({ key: 'hydration', label: `Drink ${(hydrationTargetMl / 1000).toFixed(1)} L of water` });
  items.push({ key: 'review', label: "Review today's progress" });
  return items;
}

export function plannedWorkoutFor(workout: WorkoutDef, exercises: Map<string, ExerciseSummary>, history: Map<string, PastSession[]>): PlannedWorkout {
  const list = workout.exercises
    .filter((x) => exercises.has(x.exerciseId))
    .map((x) => {
      const ex = exercises.get(x.exerciseId)!;
      const s = suggestLoad(ex, x, history.get(x.exerciseId) ?? []);
      const suggested = x.weightKg ?? s.weightKg;
      return { ...x, name: ex.name, suggestedWeightKg: suggested ?? null, suggestionNote: x.weightKg != null ? 'Weight set in your plan.' : s.note };
    });
  return {
    workoutId: workout.id,
    name: workout.name,
    focus: workout.focus,
    muscleGroups: muscleGroupsOf(list.map((x) => x.exerciseId), exercises),
    estMinutes: estimateMinutes(list),
    exercises: list,
  };
}

export function buildDailyPlan(input: DailyPlanInput): DailyPlan {
  const isRest = !input.workout || input.workout.exercises.length === 0;
  const workout = isRest ? null : plannedWorkoutFor(input.workout!, input.exercises, input.history);
  const filter: MealFilter = { diet: input.profile.diet, allergies: input.profile.allergies, exclusions: input.profile.exclusions, premium: input.premium };
  const meals = planMeals({ date: input.date, userId: input.userId, targets: input.targets, recipes: input.recipes, filter, recent: input.recentRecipeIds });
  return {
    date: input.date,
    isRest,
    workout,
    meals,
    targets: input.targets,
    checklist: buildChecklist(isRest, input.profile.hydrationEnabled, input.profile.hydrationTargetMl),
    plannedTotals: plannedTotals(meals),
  };
}

/** Re-plan only the meals (e.g. after a diet or target change), keeping the workout and the date. */
export function regenerateMeals(plan: DailyPlan, input: Omit<DailyPlanInput, 'workout' | 'history' | 'exercises'>, slots: MealSlot[] = MEAL_SLOTS): DailyPlan {
  const filter: MealFilter = { diet: input.profile.diet, allergies: input.profile.allergies, exclusions: input.profile.exclusions, premium: input.premium };
  const kept = plan.meals.filter((m) => !slots.includes(m.slot));
  const fresh = planMeals({ date: input.date, userId: input.userId + ':regen:' + Date.now(), targets: input.targets, recipes: input.recipes, filter, recent: input.recentRecipeIds, slots });
  const meals: PlannedMeal[] = [...kept, ...fresh].sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot));
  return { ...plan, targets: input.targets, meals, plannedTotals: plannedTotals(meals) };
}

export interface DaySummary {
  workout: 'completed' | 'rest' | 'not_done';
  kcal: number;
  proteinG: number;
  kcalPct: number;
  proteinPct: number;
  tasksDone: number;
  tasksTotal: number;
  records: number;
  message: string;
}

/** End-of-day summary with a positive, non-judgemental message. */
export function summariseDay(plan: Pick<DailyPlan, 'isRest' | 'targets' | 'checklist'>, eaten: { kcal: number; p: number }, done: Set<string>, workoutDone: boolean, records: number): DaySummary {
  const required = plan.checklist.filter((c) => !c.optional);
  const tasksDone = required.filter((c) => done.has(c.key)).length;
  const kcalPct = plan.targets.kcal ? Math.round((eaten.kcal / plan.targets.kcal) * 100) : 0;
  const proteinPct = plan.targets.proteinG ? Math.round((eaten.p / plan.targets.proteinG) * 100) : 0;
  let message: string;
  if (workoutDone && proteinPct >= 90) message = 'Strong day. You trained and fuelled it well.';
  else if (workoutDone) message = 'Workout done. Every session counts.';
  else if (plan.isRest) message = 'Rest days are part of the plan. Recovery is where progress happens.';
  else if (tasksDone > 0) message = 'You showed up for part of the plan today, and that still counts. Tomorrow is a fresh start.';
  else message = 'Busy day? No problem. Your plan will be ready tomorrow.';
  return { workout: workoutDone ? 'completed' : plan.isRest ? 'rest' : 'not_done', kcal: Math.round(eaten.kcal), proteinG: Math.round(eaten.p), kcalPct, proteinPct, tasksDone, tasksTotal: required.length, records, message };
}

export interface WeekProgress {
  /** Training days scheduled this week (Monday to Sunday). */
  planned: number;
  /** Workouts completed this week. */
  done: number;
  /** Week number since the first completed workout (1 for a new user). */
  week: number;
  /** Which training day of the week this date is (1-based), or null on a rest day. */
  day: number | null;
}

export function weekProgress(date: string, scheduledWeekdays: number[], completedDates: string[], firstWorkout: string | null): WeekProgress {
  const start = weekStart(date);
  const end = addDays(start, 6);
  const order = (wd: number) => (wd + 6) % 7; // Monday first
  const days = [...new Set(scheduledWeekdays)].sort((a, b) => order(a) - order(b));
  const wd = weekdayOf(date);
  const idx = days.indexOf(wd);
  const done = new Set(completedDates.filter((d) => d >= start && d <= end)).size;
  const week = firstWorkout && firstWorkout <= date ? Math.floor((Date.parse(start) - Date.parse(weekStart(firstWorkout))) / (7 * 86400000)) + 1 : 1;
  return { planned: days.length, done, week, day: idx >= 0 ? idx + 1 : null };
}
