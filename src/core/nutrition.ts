// Nutrition maths: target estimates, food scaling and recipe nutrition from ingredient data.
import type { Allergen, Diet, FoodItem, Macros, Profile, Recipe, Targets } from './types.js';
import { round } from './util.js';

export const ACTIVITY_FACTORS = { sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725 } as const;

const AGE_MIDPOINT: Record<string, number> = { '18-24': 21, '25-34': 30, '35-44': 40, '45-54': 50, '55-64': 60, '65+': 70 };

/** Calorie floors we never suggest going below without professional guidance. */
export const KCAL_FLOOR = { male: 1500, female: 1200, unspecified: 1350 } as const;

/**
 * Estimate daily targets with the Mifflin-St Jeor equation, an activity factor and a goal adjustment.
 * Returns null when the profile lacks height, weight or age, so the caller can offer manual targets instead.
 */
export function estimateTargets(p: Pick<Profile, 'ageRange' | 'sex' | 'heightCm' | 'weightKg' | 'goal' | 'activity' | 'trainingDays'>): Targets | null {
  if (!p.weightKg || !p.heightCm || !p.ageRange) return null;
  const age = AGE_MIDPOINT[p.ageRange] ?? 30;
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * age;
  // Unspecified sex uses the midpoint of the two equations.
  const bmr = p.sex === 'male' ? base + 5 : p.sex === 'female' ? base - 161 : base - 78;
  const activity = ACTIVITY_FACTORS[p.activity] ?? ACTIVITY_FACTORS.light;
  const training = Math.min(0.15, (p.trainingDays?.length ?? 3) * 0.025);
  const tdee = bmr * (activity + training);
  const bmi = p.weightKg / (p.heightCm / 100) ** 2;
  const underweight = bmi < 18.5;
  // No deficit is applied for an underweight BMI.
  const adj = underweight && p.goal === 'fat_loss' ? 0 : ({ fat_loss: -0.18, muscle_gain: 0.08, strength: 0.05, general: 0 }[p.goal] ?? 0);
  const floor = KCAL_FLOOR[p.sex] ?? KCAL_FLOOR.unspecified;
  const kcal = Math.round(Math.max(tdee * (1 + adj), Math.min(tdee, Math.max(floor, bmr))) / 10) * 10;
  // For higher BMI, base protein on a reference weight so targets stay realistic.
  const refWeight = bmi > 30 ? (25 * (p.heightCm / 100) ** 2 + p.weightKg) / 2 : p.weightKg;
  const proteinG = Math.round(refWeight * (p.goal === 'fat_loss' ? 2.0 : 1.8));
  const fatG = Math.round(Math.max((kcal * 0.25) / 9, p.weightKg * 0.6));
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  const notes = ['These are estimates from a standard equation, not medical or dietetic advice. Adjust them if your weight trend over 2–3 weeks says otherwise.'];
  if (underweight && p.goal === 'fat_loss') notes.push('Your BMI is under 18.5, so we have not applied a calorie deficit. Please speak to a doctor or accredited practising dietitian.');
  if (p.goal === 'fat_loss' && !underweight && kcal <= floor + 50) notes.push('Your target sits at the minimum KYVO will suggest. Losing weight faster than about 0.5–1% of body weight per week risks muscle loss.');
  return { kcal, proteinG, carbsG, fatG, source: 'estimated', notes };
}

/** Validate manually entered targets so they stay within safe, sensible bounds. */
export function validateManualTargets(t: { kcal: number; proteinG: number; carbsG: number; fatG: number }): string | null {
  if (!Number.isFinite(t.kcal) || t.kcal < 1200 || t.kcal > 6000) return 'Calories must be between 1,200 and 6,000 kcal. For lower targets, please work with a doctor or dietitian.';
  for (const [k, v, max] of [['Protein', t.proteinG, 400], ['Carbohydrate', t.carbsG, 900], ['Fat', t.fatG, 300]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > max) return `${k} must be between 0 and ${max} g.`;
  }
  const fromMacros = t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9;
  if (Math.abs(fromMacros - t.kcal) > t.kcal * 0.15) return `Your macros add up to about ${Math.round(fromMacros)} kcal, which is more than 15% away from your calorie target.`;
  return null;
}

export function scaleFood(food: Pick<FoodItem, 'kcal' | 'p' | 'c' | 'f'>, grams: number): Macros {
  const k = grams / 100;
  return { kcal: food.kcal * k, p: food.p * k, c: food.c * k, f: food.f * k };
}

export function roundMacros(m: Macros): Macros {
  return { kcal: Math.round(m.kcal), p: round(m.p, 1), c: round(m.c, 1), f: round(m.f, 1) };
}

export function addMacros(a: Macros, b: Macros): Macros {
  return { kcal: a.kcal + b.kcal, p: a.p + b.p, c: a.c + b.c, f: a.f + b.f };
}

export const ZERO: Macros = { kcal: 0, p: 0, c: 0, f: 0 };

export function totalMacros(items: Macros[]): Macros {
  return items.reduce(addMacros, { ...ZERO });
}

export interface RecipeNutrition {
  perServing: Macros;
  total: Macros;
  tags: string[];
  missing: string[];
}

/** Recipe nutrition calculated from ingredient weights and per-100 g food values. */
export function recipeNutrition(recipe: Pick<Recipe, 'ing' | 'servings'>, foods: Map<string, FoodItem>): RecipeNutrition {
  let total = { ...ZERO };
  const tags = new Set<string>();
  const missing: string[] = [];
  for (const [id, g] of recipe.ing) {
    const f = foods.get(id);
    if (!f) {
      missing.push(id);
      continue;
    }
    total = addMacros(total, scaleFood(f, g));
    f.tags.forEach((t) => tags.add(t));
  }
  const s = Math.max(1, recipe.servings);
  const perServing = { kcal: total.kcal / s, p: total.p / s, c: total.c / s, f: total.f / s };
  return { perServing: roundMacros(perServing), total: roundMacros(total), tags: [...tags], missing };
}

/** Ingredient list for a chosen number of servings. */
export function scaleIngredients(recipe: Pick<Recipe, 'ing' | 'servings'>, servings: number): [string, number][] {
  const k = servings / Math.max(1, recipe.servings);
  return recipe.ing.map(([id, g]) => [id, Math.round(g * k)]);
}

export const ALLERGEN_TAGS: Record<Allergen, string[]> = {
  peanut: ['peanut'],
  tree_nut: ['tree-nut', 'tree-nut-check'],
  dairy: ['dairy'],
  egg: ['egg'],
  fish: ['fish'],
  shellfish: ['shellfish'],
  soy: ['soy'],
  gluten: ['gluten', 'gluten-check'],
  sesame: ['sesame'],
};

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  peanut: 'Peanut', tree_nut: 'Tree nuts', dairy: 'Dairy', egg: 'Egg', fish: 'Fish', shellfish: 'Shellfish', soy: 'Soy', gluten: 'Gluten', sesame: 'Sesame',
};

export function allergensIn(tags: string[]): Allergen[] {
  return (Object.keys(ALLERGEN_TAGS) as Allergen[]).filter((a) => ALLERGEN_TAGS[a].some((t) => tags.includes(t)));
}

/** Whether a food or recipe (by its ingredient tags) fits the dietary preference. */
export function dietAllows(diet: Diet, ingredientTags: string[][]): boolean {
  for (const tags of ingredientTags) {
    const meat = tags.includes('meat');
    const seafood = tags.includes('fish') || tags.includes('shellfish');
    if (tags.includes('pork') || tags.includes('alcohol')) {
      if (diet === 'halal') return false;
    }
    if (diet === 'vegan' && !tags.includes('vegan')) return false;
    if (diet === 'vegetarian' && (meat || seafood)) return false;
    if (diet === 'pescatarian' && meat) return false;
  }
  return true;
}

export function matchesExclusion(food: Pick<FoodItem, 'id' | 'name'>, exclusions: string[]): boolean {
  const hay = `${food.id} ${food.name}`.toLowerCase();
  return exclusions.some((x) => {
    const k = x.trim().toLowerCase();
    return k.length >= 3 && hay.includes(k);
  });
}
