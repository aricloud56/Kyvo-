// Shared domain types used by the plan engine, the server and the browser client.

export type Goal = 'muscle_gain' | 'fat_loss' | 'strength' | 'general';
export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type Sex = 'male' | 'female' | 'unspecified';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'high';
export type Diet = 'none' | 'vegetarian' | 'vegan' | 'pescatarian' | 'halal';
export type Allergen = 'peanut' | 'tree_nut' | 'dairy' | 'egg' | 'fish' | 'shellfish' | 'soy' | 'gluten' | 'sesame';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type TrainingLocation = 'gym' | 'home' | 'both';
export type Units = 'metric' | 'imperial';
export type AgeRange = '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+';
export type LoggingMode = 'weight_reps' | 'reps' | 'time' | 'distance_time';

export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export interface Profile {
  displayName: string;
  ageRange: AgeRange | null;
  sex: Sex;
  heightCm: number | null;
  weightKg: number | null;
  goal: Goal;
  experience: Experience;
  location: TrainingLocation;
  equipment: string[];
  /** Weekdays the user wants to train, 0 = Sunday … 6 = Saturday. */
  trainingDays: number[];
  sessionMinutes: number;
  trainingStyle: 'balanced' | 'machines' | 'free_weights';
  diet: Diet;
  allergies: Allergen[];
  /** Free-text food exclusions, matched against ingredient names and ids. */
  exclusions: string[];
  units: Units;
  activity: Activity;
  hydrationEnabled: boolean;
  hydrationTargetMl: number;
  /** Workout template id, or 'auto' to let the engine choose. */
  templatePref: string;
}

export interface Targets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  source: 'estimated' | 'manual';
  /** Notes explaining limits on the estimate (never medical advice). */
  notes: string[];
}

export interface ExerciseSummary {
  id: string;
  name: string;
  category: string;
  groups: string[];
  primary: string[];
  secondary: string[];
  equipment: string[];
  difficulty: Experience;
  mechanic: 'compound' | 'isolation';
  logging: LoggingMode;
  increment: number;
  pattern: string;
  alternatives: string[];
  progressions: string[];
  premium: boolean;
}

export interface Prescription {
  sets: number;
  repMin: number;
  repMax: number;
  restSec: number;
  mode: LoggingMode;
  rir: string;
}

export interface PlannedExercise extends Prescription {
  exerciseId: string;
  /** Optional target load in kg chosen by the user in the planner. */
  weightKg?: number | null;
}

export interface WorkoutDef {
  id: string;
  name: string;
  focus: string;
  exercises: PlannedExercise[];
}

export interface GeneratedProgram {
  templateId: string;
  name: string;
  workouts: WorkoutDef[];
  /** weekday (0-6) -> index into workouts, or null for a rest day */
  schedule: Record<number, number | null>;
}

export interface FoodItem {
  id: string;
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  fib?: number;
  serving: { label: string; g: number };
  tags: string[];
  src?: string;
}

export interface Recipe {
  id: string;
  name: string;
  desc?: string;
  servings: number;
  prep: number;
  cook: number;
  ing: [string, number][];
  steps: string[];
  storage?: string;
  subs?: string[];
  meal: MealSlot[];
  tags: string[];
  free: boolean;
}

export interface Macros {
  kcal: number;
  p: number;
  c: number;
  f: number;
}

export interface PlannedMeal extends Macros {
  slot: MealSlot;
  recipeId: string;
  name: string;
  /** Portion multiplier relative to one recipe serving. */
  portion: number;
  prepMin: number;
}

export interface PlannedWorkoutExercise extends PlannedExercise {
  name: string;
  suggestedWeightKg: number | null;
  suggestionNote: string | null;
}

export interface PlannedWorkout {
  workoutId: string;
  name: string;
  focus: string;
  muscleGroups: string[];
  estMinutes: number;
  exercises: PlannedWorkoutExercise[];
}

export interface ChecklistItemDef {
  key: string;
  label: string;
  optional?: boolean;
}

export interface DailyPlan {
  date: string;
  isRest: boolean;
  workout: PlannedWorkout | null;
  meals: PlannedMeal[];
  targets: Targets;
  checklist: ChecklistItemDef[];
  /** Planned totals (sum of meals), shown next to targets so differences are visible. */
  plannedTotals: Macros;
}

export interface LoggedSet {
  exerciseId: string;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  completed: boolean;
  pain?: boolean;
}
