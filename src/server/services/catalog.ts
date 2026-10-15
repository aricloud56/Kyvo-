// In-memory cache of shared content (exercises, media, foods, recipes). Reloaded after admin edits.
import type { Db } from '../lib/db.js';
import type { ExerciseSummary, FoodItem, Recipe } from '../../core/types.js';
import { buildRecipeInfo, type RecipeInfo } from '../../core/meals.js';

export interface MediaRow {
  id: number;
  exercise_id: string;
  kind: 'youtube' | 'video' | 'image';
  ref: string;
  title: string;
  source: string;
  license: string;
  attribution: string;
  verified_note: string;
  status: string;
}

export class Catalog {
  exercises = new Map<string, ExerciseSummary>();
  exerciseContent = new Map<string, Record<string, any>>();
  media = new Map<string, MediaRow[]>();
  foods = new Map<string, FoodItem>();
  recipes = new Map<string, Recipe & { description: string; premium: boolean }>();
  recipeInfo: RecipeInfo[] = [];
  loadedAt = 0;

  constructor(private db: Db) {}

  async load(): Promise<void> {
    await this.db.asAnon(async (tx) => {
      const ex = await tx.query<any>('select * from kyvo.exercises where published order by name');
      this.exercises = new Map();
      this.exerciseContent = new Map();
      for (const e of ex) {
        const c = e.content;
        this.exercises.set(e.id, {
          id: e.id, name: e.name, category: e.category, groups: e.groups, primary: e.primary_muscles, secondary: e.secondary_muscles,
          equipment: e.equipment, difficulty: e.difficulty, mechanic: e.mechanic, logging: e.logging, increment: Number(e.increment),
          pattern: e.pattern, alternatives: c.alternatives ?? [], progressions: c.progressions ?? [], premium: e.premium,
        });
        this.exerciseContent.set(e.id, c);
      }
      const media = await tx.query<MediaRow>("select * from kyvo.exercise_media where status = 'active' order by id");
      this.media = new Map();
      for (const m of media) this.media.set(m.exercise_id, [...(this.media.get(m.exercise_id) ?? []), m]);
      const foods = await tx.query<any>('select * from kyvo.foods where owner_id is null');
      this.foods = new Map(foods.map((f) => [f.id, rowToFood(f)]));
      const recipes = await tx.query<any>('select * from kyvo.recipes where published order by name');
      const ing = await tx.query<{ recipe_id: string; food_id: string; grams: number }>('select recipe_id, food_id, grams from kyvo.recipe_ingredients order by recipe_id, position');
      this.recipes = new Map();
      for (const r of recipes) {
        this.recipes.set(r.id, {
          id: r.id, name: r.name, desc: r.description, description: r.description, servings: r.servings, prep: r.prep_min, cook: r.cook_min,
          ing: ing.filter((i) => i.recipe_id === r.id).map((i) => [i.food_id, Number(i.grams)] as [string, number]),
          steps: r.steps, storage: r.storage, subs: r.subs, meal: r.meal_types, tags: r.tags, free: !r.premium, premium: r.premium,
        });
      }
      this.recipeInfo = buildRecipeInfo([...this.recipes.values()], this.foods);
    });
    this.loadedAt = Date.now();
  }
}

export function rowToFood(f: any): FoodItem & { ownerId?: string | null } {
  return {
    id: f.id, name: f.name, kcal: Number(f.kcal), p: Number(f.protein), c: Number(f.carbs), f: Number(f.fat), fib: Number(f.fibre),
    serving: { label: f.serving_label, g: Number(f.serving_g) }, tags: f.tags, src: f.source, ownerId: f.owner_id,
  };
}
