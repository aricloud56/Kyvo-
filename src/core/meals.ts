// Meal planning: choose recipes and portions per slot to approach the day's calorie and protein targets.
import type { Diet, FoodItem, Macros, MealSlot, PlannedMeal, Profile, Recipe, Targets } from './types.js';
import { MEAL_SLOTS } from './types.js';
import { ALLERGEN_TAGS, dietAllows, matchesExclusion, recipeNutrition, roundMacros, totalMacros } from './nutrition.js';
import { seededRandom } from './util.js';

export const SLOT_SHARE: Record<MealSlot, number> = { breakfast: 0.25, lunch: 0.3, dinner: 0.3, snack: 0.15 };
export const PORTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export interface RecipeInfo {
  recipe: Recipe;
  perServing: Macros;
  ingredientTags: string[][];
  ingredientFoods: FoodItem[];
}

export function buildRecipeInfo(recipes: Recipe[], foods: Map<string, FoodItem>): RecipeInfo[] {
  return recipes.map((recipe) => {
    const n = recipeNutrition(recipe, foods);
    const ingredientFoods = recipe.ing.map(([id]) => foods.get(id)).filter((f): f is FoodItem => !!f);
    return { recipe, perServing: n.perServing, ingredientTags: ingredientFoods.map((f) => f.tags), ingredientFoods };
  });
}

export interface MealFilter {
  diet: Diet;
  allergies: Profile['allergies'];
  exclusions: string[];
  premium: boolean;
}

/** Whether a recipe suits the user's diet, allergies, exclusions and plan tier. */
export function recipeSuitable(info: RecipeInfo, f: MealFilter): boolean {
  if (!f.premium && !info.recipe.free) return false;
  if (!dietAllows(f.diet, info.ingredientTags)) return false;
  const tags = info.ingredientTags.flat();
  if (f.allergies.some((a) => ALLERGEN_TAGS[a]?.some((t) => tags.includes(t)))) return false;
  if (info.ingredientFoods.some((food) => matchesExclusion(food, f.exclusions))) return false;
  return true;
}

function bestPortion(per: Macros, kcalTarget: number): number {
  let best = 1;
  let err = Infinity;
  for (const p of PORTIONS) {
    const e = Math.abs(per.kcal * p - kcalTarget);
    if (e < err) {
      err = e;
      best = p;
    }
  }
  return best;
}

export function plannedMeal(slot: MealSlot, info: RecipeInfo, portion: number): PlannedMeal {
  const m = roundMacros({ kcal: info.perServing.kcal * portion, p: info.perServing.p * portion, c: info.perServing.c * portion, f: info.perServing.f * portion });
  return { slot, recipeId: info.recipe.id, name: info.recipe.name, portion, prepMin: info.recipe.prep + info.recipe.cook, ...m };
}

export interface MealPlanInput {
  date: string;
  userId: string;
  targets: Targets;
  recipes: RecipeInfo[];
  filter: MealFilter;
  /** Recipe ids planned on the previous few days, to keep variety. */
  recent: string[];
  /** Restrict to these slots (defaults to all four). */
  slots?: MealSlot[];
}

/**
 * Greedy planner: fills slots in order, each aiming at its share of the calories that remain,
 * and favours protein-dense recipes when protein is behind. Deterministic for a given user and date.
 */
export function planMeals(input: MealPlanInput): PlannedMeal[] {
  const rand = seededRandom(`${input.userId}:${input.date}:meals`);
  const slots = input.slots ?? MEAL_SLOTS;
  const out: PlannedMeal[] = [];
  let kcalLeft = input.targets.kcal;
  let proteinLeft = input.targets.proteinG;
  let shareLeft = slots.reduce((a, s) => a + SLOT_SHARE[s], 0);
  const usedToday = new Set<string>();
  for (const slot of slots) {
    const share = SLOT_SHARE[slot] / shareLeft;
    const kcalTarget = Math.max(150, kcalLeft * share);
    const proteinTarget = Math.max(0, proteinLeft * share);
    const candidates = input.recipes.filter((r) => r.recipe.meal.includes(slot) && recipeSuitable(r, input.filter) && !usedToday.has(r.recipe.id));
    let best: { info: RecipeInfo; portion: number; score: number } | null = null;
    for (const info of candidates) {
      const portion = bestPortion(info.perServing, kcalTarget);
      const kcal = info.perServing.kcal * portion;
      const protein = info.perServing.p * portion;
      let score = Math.abs(kcal - kcalTarget) / kcalTarget;
      score += Math.max(0, proteinTarget - protein) / Math.max(20, proteinTarget) * 0.8;
      score += Math.max(0, protein - proteinTarget * 1.4) / Math.max(20, proteinTarget) * 0.3;
      if (input.recent.includes(info.recipe.id)) score += 0.35;
      if ((slot === 'breakfast' || slot === 'lunch') && info.recipe.prep + info.recipe.cook > 40) score += 0.15;
      score += rand() * 0.25;
      if (!best || score < best.score) best = { info, portion, score };
    }
    if (!best) continue;
    const meal = plannedMeal(slot, best.info, best.portion);
    usedToday.add(meal.recipeId);
    out.push(meal);
    kcalLeft -= meal.kcal;
    proteinLeft -= meal.p;
    shareLeft -= SLOT_SHARE[slot];
  }
  return out;
}

/** Ranked swap options for one slot: similar calories and protein to the slot's planned share. */
export function swapOptions(slot: MealSlot, current: PlannedMeal | undefined, targets: Targets, recipes: RecipeInfo[], filter: MealFilter, limit = 8): PlannedMeal[] {
  const kcalTarget = current?.kcal ?? targets.kcal * SLOT_SHARE[slot];
  const proteinTarget = current?.p ?? targets.proteinG * SLOT_SHARE[slot];
  return recipes
    .filter((r) => r.recipe.meal.includes(slot) && r.recipe.id !== current?.recipeId && recipeSuitable(r, filter))
    .map((info) => plannedMeal(slot, info, bestPortion(info.perServing, kcalTarget)))
    .sort((a, b) => Math.abs(a.kcal - kcalTarget) / kcalTarget + Math.abs(a.p - proteinTarget) / 40 - (Math.abs(b.kcal - kcalTarget) / kcalTarget + Math.abs(b.p - proteinTarget) / 40))
    .slice(0, limit);
}

/** Replace one slot with a chosen recipe, portioned to that slot's calories. */
export function swapMeal(meals: PlannedMeal[], slot: MealSlot, info: RecipeInfo, targets: Targets): PlannedMeal[] {
  const current = meals.find((m) => m.slot === slot);
  const kcalTarget = current?.kcal ?? targets.kcal * SLOT_SHARE[slot];
  const next = plannedMeal(slot, info, bestPortion(info.perServing, kcalTarget));
  const rest = meals.filter((m) => m.slot !== slot);
  return [...rest, next].sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot));
}

export function plannedTotals(meals: PlannedMeal[]): Macros {
  return roundMacros(totalMacros(meals));
}
