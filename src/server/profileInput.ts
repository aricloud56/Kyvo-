// Validation for onboarding and profile updates.
import type { Profile } from '../core/types.js';
import { EQUIPMENT_PRESETS, TEMPLATE_BY_ID } from '../core/workouts.js';
import { badRequest } from './lib/http.js';
import { bool, num, obj, oneOf, str, strList } from './lib/validate.js';

export const GOALS = ['muscle_gain', 'fat_loss', 'strength', 'general'] as const;
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const AGE_RANGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
export const DIETS = ['none', 'vegetarian', 'vegan', 'pescatarian', 'halal'] as const;
export const ALLERGENS = ['peanut', 'tree_nut', 'dairy', 'egg', 'fish', 'shellfish', 'soy', 'gluten', 'sesame'] as const;
export const ALL_EQUIPMENT = [...new Set([...EQUIPMENT_PRESETS.gym, 'bodyweight', 'mat', 'wall'])];

/** Parse a (partial) profile. With `full`, all core fields are required (onboarding). */
export function parseProfile(input: unknown, full: boolean): Partial<Profile> {
  const b = obj(input);
  const out: Partial<Profile> = {};
  const has = (k: string) => full || b[k] !== undefined;
  if (has('displayName')) out.displayName = str(b.displayName, 'Name', { max: 60, optional: true });
  if (has('ageRange')) out.ageRange = b.ageRange == null && !full ? null : oneOf(b.ageRange, 'Age range', AGE_RANGES);
  if (has('sex')) out.sex = oneOf(b.sex, 'Sex', ['male', 'female', 'unspecified'] as const, 'unspecified');
  if (has('heightCm')) out.heightCm = num(b.heightCm, 'Height', { min: 120, max: 230, optional: true });
  if (has('weightKg')) out.weightKg = num(b.weightKg, 'Weight', { min: 35, max: 300, optional: true });
  if (has('goal')) out.goal = oneOf(b.goal, 'Goal', GOALS);
  if (has('experience')) out.experience = oneOf(b.experience, 'Experience', LEVELS);
  if (has('location')) out.location = oneOf(b.location, 'Training location', ['gym', 'home', 'both'] as const);
  if (has('equipment')) out.equipment = strList(b.equipment, 'Equipment', { allowed: ALL_EQUIPMENT, max: 40 });
  if (has('trainingDays')) {
    if (!Array.isArray(b.trainingDays)) throw badRequest('Training days must be a list.');
    const days = [...new Set(b.trainingDays.map((d) => num(d, 'Training day', { min: 0, max: 6, int: true }) as number))];
    if (full && days.length === 0) throw badRequest('Pick at least one training day.');
    out.trainingDays = days.sort();
  }
  if (has('sessionMinutes')) out.sessionMinutes = num(b.sessionMinutes ?? 60, 'Session length', { min: 15, max: 150, int: true }) as number;
  if (has('trainingStyle')) out.trainingStyle = oneOf(b.trainingStyle, 'Training style', ['balanced', 'machines', 'free_weights'] as const, 'balanced');
  if (has('diet')) out.diet = oneOf(b.diet, 'Diet', DIETS, 'none');
  if (has('allergies')) out.allergies = strList(b.allergies, 'Allergies', { allowed: ALLERGENS }) as Profile['allergies'];
  if (has('exclusions')) out.exclusions = strList(b.exclusions, 'Food exclusions', { max: 30, itemMax: 40 });
  if (has('units')) out.units = oneOf(b.units, 'Units', ['metric', 'imperial'] as const, 'metric');
  if (has('activity')) out.activity = oneOf(b.activity, 'Activity level', ['sedentary', 'light', 'moderate', 'high'] as const, 'light');
  if (has('hydrationEnabled')) out.hydrationEnabled = b.hydrationEnabled === undefined ? false : bool(b.hydrationEnabled, 'Hydration');
  if (has('hydrationTargetMl')) out.hydrationTargetMl = num(b.hydrationTargetMl ?? 2500, 'Hydration target', { min: 500, max: 6000, int: true }) as number;
  if (has('templatePref')) {
    const t = b.templatePref ?? 'auto';
    if (t !== 'auto' && !TEMPLATE_BY_ID.has(String(t))) throw badRequest('Unknown workout template.');
    out.templatePref = String(t);
  }
  return out;
}

const COLUMNS: Record<keyof Profile, string> = {
  displayName: 'display_name', ageRange: 'age_range', sex: 'sex', heightCm: 'height_cm', weightKg: 'weight_kg', goal: 'goal', experience: 'experience', location: 'location',
  equipment: 'equipment', trainingDays: 'training_days', sessionMinutes: 'session_minutes', trainingStyle: 'training_style', diet: 'diet', allergies: 'allergies',
  exclusions: 'exclusions', units: 'units', activity: 'activity', hydrationEnabled: 'hydration_enabled', hydrationTargetMl: 'hydration_target_ml', templatePref: 'template_pref',
};

export function profileUpdateSql(p: Partial<Profile>): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(p)) {
    const col = COLUMNS[k as keyof Profile];
    if (!col) continue;
    values.push(v);
    sets.push(`${col} = $${values.length + 1}`);
  }
  return { sets, values };
}

/** Which parts of the plan a profile change affects. */
export function affectedParts(p: Partial<Profile>): { workouts: boolean; meals: boolean; targets: boolean } {
  const k = Object.keys(p);
  return {
    workouts: k.some((x) => ['goal', 'experience', 'location', 'equipment', 'trainingDays', 'sessionMinutes', 'trainingStyle', 'templatePref'].includes(x)),
    meals: k.some((x) => ['diet', 'allergies', 'exclusions'].includes(x)),
    targets: k.some((x) => ['ageRange', 'sex', 'heightCm', 'weightKg', 'goal', 'activity', 'trainingDays'].includes(x)),
  };
}
