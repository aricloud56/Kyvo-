// Food diary: logging foods, recipes and planned meals, edits, recent/favourite foods, saved meals, custom foods.
import crypto from 'node:crypto';
import type { Tx } from '../lib/db.js';
import { json } from '../lib/db.js';
import type { Catalog } from './catalog.js';
import { rowToFood } from './catalog.js';
import type { PlanService } from './plan.js';
import { currentTargets, loadProfile, premiumFor, rowToLog } from './plan.js';
import type { FoodItem, Macros, MealSlot } from '../../core/types.js';
import { MEAL_SLOTS } from '../../core/types.js';
import { recipeNutrition, roundMacros, scaleFood } from '../../core/nutrition.js';
import { FREE_LIMITS } from '../../core/plans.js';
import { badRequest, notFound, premiumRequired } from '../lib/http.js';
import { num, oneOf, slug, str } from '../lib/validate.js';

export class NutritionService {
  constructor(private catalog: Catalog, private plans: PlanService) {}

  async food(tx: Tx, id: string): Promise<FoodItem> {
    const cached = this.catalog.foods.get(id);
    if (cached) return cached;
    const r = await tx.maybeOne('select * from kyvo.foods where id = $1', [id]); // RLS: only curated or own foods are visible
    if (!r) throw notFound('Food not found.');
    return rowToFood(r);
  }

  async search(tx: Tx, userId: string, q: string) {
    const term = q.trim().toLowerCase();
    const own = (await tx.query<any>('select * from kyvo.foods where owner_id = $1 order by name', [userId])).map(rowToFood);
    const all = [...own, ...this.catalog.foods.values()];
    const foods = term ? all.filter((f) => f.name.toLowerCase().includes(term) || f.id.includes(term)) : all;
    const recipes = [...this.catalog.recipes.values()].filter((r) => !term || r.name.toLowerCase().includes(term)).map((r) => ({ id: r.id, name: r.name, premium: r.premium, ...recipeNutrition(r, this.catalog.foods).perServing }));
    return { foods: foods.slice(0, 60), recipes: recipes.slice(0, 20) };
  }

  async quick(tx: Tx, userId: string) {
    const recent = await tx.query<any>(
      `select distinct on (coalesce(food_id, recipe_id)) food_id, recipe_id, name, grams, portion, created_at
       from kyvo.food_logs where user_id = $1 and (food_id is not null or recipe_id is not null) and log_date >= current_date - 30
       order by coalesce(food_id, recipe_id), created_at desc`,
      [userId],
    );
    recent.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const favs = await tx.query<{ kind: string; ref_id: string }>("select kind, ref_id from kyvo.favourites where user_id = $1 and kind in ('food','recipe')", [userId]);
    const saved = await tx.query<any>('select id, name, items from kyvo.saved_meals where user_id = $1 order by created_at desc', [userId]);
    return {
      recent: recent.slice(0, 12).map((r) => ({ foodId: r.food_id, recipeId: r.recipe_id, name: r.name, grams: r.grams == null ? null : Number(r.grams), portion: r.portion == null ? null : Number(r.portion) })),
      favourites: favs,
      saved: saved.map((s) => ({ id: s.id, name: s.name, items: s.items, ...roundMacros(sumItems(s.items)) })),
    };
  }

  async diary(tx: Tx, userId: string, date: string) {
    const logs = (await tx.query<any>('select * from kyvo.food_logs where user_id = $1 and log_date = $2 order by created_at', [userId, date])).map(rowToLog);
    const totals = roundMacros(sumItems(logs));
    const targets = await currentTargets(tx, userId);
    const bySlot = Object.fromEntries(MEAL_SLOTS.map((s) => [s, logs.filter((l) => l.slot === s)]));
    return { date, entries: logs, bySlot, totals, targets, remaining: targets ? { kcal: targets.kcal - totals.kcal, p: Math.round(targets.proteinG - totals.p), c: Math.round(targets.carbsG - totals.c), f: Math.round(targets.fatG - totals.f) } : null };
  }

  private async insertLog(tx: Tx, userId: string, date: string, slot: MealSlot, v: { foodId?: string | null; recipeId?: string | null; name: string; grams?: number | null; portion?: number | null; m: Macros; fromPlan?: boolean }): Promise<string> {
    const r = await tx.one<{ id: string }>(
      'insert into kyvo.food_logs (user_id, log_date, meal_slot, food_id, recipe_id, name, grams, portion, kcal, protein, carbs, fat, from_plan) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id',
      [userId, date, slot, v.foodId ?? null, v.recipeId ?? null, v.name, v.grams ?? null, v.portion ?? null, Math.round(v.m.kcal * 10) / 10, round1(v.m.p), round1(v.m.c), round1(v.m.f), !!v.fromPlan],
    );
    if (slot !== 'snack') await this.plans.autoCheck(tx, userId, date, `meal_${slot}`);
    const first = await tx.one<{ n: number }>('select count(*)::int as n from kyvo.food_logs where user_id = $1', [userId]);
    if (first.n === 1) await tx.exec("insert into kyvo.product_events (user_id, name) values ($1, 'first_meal_log')", [userId]);
    return r.id;
  }

  private async recipeMacros(tx: Tx, userId: string, recipeId: string, portion: number) {
    const r = this.catalog.recipes.get(recipeId);
    if (!r) throw notFound('Recipe not found.');
    if (r.premium && !(await premiumFor(tx, userId))) throw premiumRequired(`${r.name} is part of the Premium recipe library.`);
    const per = recipeNutrition(r, this.catalog.foods).perServing;
    return { r, m: { kcal: per.kcal * portion, p: per.p * portion, c: per.c * portion, f: per.f * portion } };
  }

  /** body: {slot, foodId, grams} | {slot, recipeId, portion} | {slot, name, kcal, p, c, f} */
  async log(tx: Tx, userId: string, date: string, body: any): Promise<string> {
    const slot = oneOf(body.slot, 'slot', MEAL_SLOTS);
    if (body.foodId) {
      const food = await this.food(tx, slug(body.foodId, 'foodId'));
      const grams = num(body.grams, 'grams', { min: 1, max: 3000 }) as number;
      return this.insertLog(tx, userId, date, slot, { foodId: food.id, name: food.name, grams, m: scaleFood(food, grams) });
    }
    if (body.recipeId) {
      const portion = num(body.portion, 'portion', { min: 0.25, max: 6 }) as number;
      const { r, m } = await this.recipeMacros(tx, userId, slug(body.recipeId, 'recipeId'), portion);
      return this.insertLog(tx, userId, date, slot, { recipeId: r.id, name: r.name, portion, m });
    }
    const name = str(body.name, 'name', { min: 1, max: 80 });
    const m = {
      kcal: num(body.kcal, 'kcal', { min: 0, max: 5000 }) as number,
      p: num(body.p ?? 0, 'protein', { min: 0, max: 500 }) as number,
      c: num(body.c ?? 0, 'carbohydrate', { min: 0, max: 1000 }) as number,
      f: num(body.f ?? 0, 'fat', { min: 0, max: 500 }) as number,
    };
    return this.insertLog(tx, userId, date, slot, { name, m });
  }

  /** One tap: log the planned meal for a slot exactly as planned. */
  async logPlanned(tx: Tx, userId: string, date: string, slot: MealSlot): Promise<string> {
    const plan = await this.plans.getOrCreatePlan(tx, userId, date);
    const meal = plan.meals.find((m) => m.slot === slot);
    if (!meal) throw badRequest('There is no planned meal for that slot.');
    const { r, m } = await this.recipeMacros(tx, userId, meal.recipeId, meal.portion);
    return this.insertLog(tx, userId, date, slot, { recipeId: r.id, name: r.name, portion: meal.portion, m, fromPlan: true });
  }

  /** Change the amount or slot of an entry; nutrition is recalculated from the underlying food or recipe. */
  async update(tx: Tx, userId: string, id: string, body: any): Promise<void> {
    const e = await tx.maybeOne<any>('select * from kyvo.food_logs where id = $1 and user_id = $2', [id, userId]);
    if (!e) throw notFound('Diary entry not found.');
    const slot = body.slot ? oneOf(body.slot, 'slot', MEAL_SLOTS) : e.meal_slot;
    let grams = e.grams == null ? null : Number(e.grams);
    let portion = e.portion == null ? null : Number(e.portion);
    let m: Macros = { kcal: Number(e.kcal), p: Number(e.protein), c: Number(e.carbs), f: Number(e.fat) };
    if (e.food_id && body.grams !== undefined) {
      grams = num(body.grams, 'grams', { min: 1, max: 3000 }) as number;
      m = scaleFood(await this.food(tx, e.food_id), grams);
    } else if (e.recipe_id && body.portion !== undefined) {
      portion = num(body.portion, 'portion', { min: 0.25, max: 6 }) as number;
      m = (await this.recipeMacros(tx, userId, e.recipe_id, portion)).m;
    } else if (!e.food_id && !e.recipe_id && body.kcal !== undefined) {
      m = { kcal: num(body.kcal, 'kcal', { min: 0, max: 5000 }) as number, p: num(body.p ?? 0, 'protein', { min: 0, max: 500 }) as number, c: num(body.c ?? 0, 'carbohydrate', { min: 0, max: 1000 }) as number, f: num(body.f ?? 0, 'fat', { min: 0, max: 500 }) as number };
    }
    await tx.exec('update kyvo.food_logs set meal_slot = $3, grams = $4, portion = $5, kcal = $6, protein = $7, carbs = $8, fat = $9 where id = $1 and user_id = $2', [
      id, userId, slot, grams, portion, Math.round(m.kcal * 10) / 10, round1(m.p), round1(m.c), round1(m.f),
    ]);
  }

  async remove(tx: Tx, userId: string, id: string): Promise<void> {
    const n = await tx.exec('delete from kyvo.food_logs where id = $1 and user_id = $2', [id, userId]);
    if (!n) throw notFound('Diary entry not found.');
  }

  /** Copy a meal slot (or a whole day) from another date. */
  async copy(tx: Tx, userId: string, toDate: string, fromDate: string, slot: MealSlot | null): Promise<number> {
    return tx.exec(
      `insert into kyvo.food_logs (user_id, log_date, meal_slot, food_id, recipe_id, name, grams, portion, kcal, protein, carbs, fat)
       select user_id, $2, meal_slot, food_id, recipe_id, name, grams, portion, kcal, protein, carbs, fat from kyvo.food_logs
       where user_id = $1 and log_date = $3 and ($4::text is null or meal_slot = $4)`,
      [userId, toDate, fromDate, slot],
    );
  }

  async createFood(tx: Tx, userId: string, body: any): Promise<FoodItem> {
    const id = `u-${crypto.randomBytes(6).toString('hex')}`;
    const name = str(body.name, 'name', { min: 2, max: 80 });
    const f = {
      kcal: num(body.kcal, 'kcal per 100 g', { min: 0, max: 950 }) as number,
      p: num(body.p, 'protein per 100 g', { min: 0, max: 100 }) as number,
      c: num(body.c, 'carbohydrate per 100 g', { min: 0, max: 100 }) as number,
      f: num(body.f, 'fat per 100 g', { min: 0, max: 100 }) as number,
    };
    const servingG = num(body.servingG ?? 100, 'serving size', { min: 1, max: 2000 }) as number;
    await tx.exec("insert into kyvo.foods (id, owner_id, name, kcal, protein, carbs, fat, serving_label, serving_g, tags, source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}','Entered by you')", [
      id, userId, name, f.kcal, f.p, f.c, f.f, str(body.servingLabel ?? `${servingG} g`, 'serving label', { max: 40 }), servingG,
    ]);
    return { id, name, ...f, serving: { label: `${servingG} g`, g: servingG }, tags: [], src: 'Entered by you' };
  }

  async saveMeal(tx: Tx, userId: string, name: string, entryIds: string[]): Promise<string> {
    if (!(await premiumFor(tx, userId))) {
      const n = await tx.one<{ n: number }>('select count(*)::int as n from kyvo.saved_meals where user_id = $1', [userId]);
      if (n.n >= FREE_LIMITS.savedMeals) throw premiumRequired(`Free accounts can keep ${FREE_LIMITS.savedMeals} saved meals.`);
    }
    const rows = await tx.query<any>('select * from kyvo.food_logs where user_id = $1 and id = any($2)', [userId, entryIds]);
    if (!rows.length) throw badRequest('Choose at least one diary entry to save.');
    const items = rows.map(rowToLog).map(({ foodId, recipeId, name: n, grams, portion, kcal, p, c, f }) => ({ foodId, recipeId, name: n, grams, portion, kcal, p, c, f }));
    const r = await tx.one<{ id: string }>('insert into kyvo.saved_meals (user_id, name, items) values ($1,$2,$3::jsonb) returning id', [userId, name, json(items)]);
    return r.id;
  }

  async logSaved(tx: Tx, userId: string, savedId: string, date: string, slot: MealSlot): Promise<number> {
    const s = await tx.maybeOne<any>('select items from kyvo.saved_meals where id = $1 and user_id = $2', [savedId, userId]);
    if (!s) throw notFound('Saved meal not found.');
    for (const it of s.items) await this.insertLog(tx, userId, date, slot, { foodId: it.foodId, recipeId: it.recipeId, name: it.name, grams: it.grams, portion: it.portion, m: { kcal: it.kcal, p: it.p, c: it.c, f: it.f } });
    return s.items.length;
  }

  async addWater(tx: Tx, userId: string, date: string, ml: number): Promise<number> {
    const r = await tx.one<{ ml: number }>(
      'insert into kyvo.hydration_logs (user_id, log_date, ml) values ($1,$2,greatest(0,$3)) on conflict (user_id, log_date) do update set ml = greatest(0, kyvo.hydration_logs.ml + $3) returning ml',
      [userId, date, ml],
    );
    const profile = await loadProfile(tx, userId);
    if (profile.hydrationEnabled && r.ml >= profile.hydrationTargetMl) await this.plans.autoCheck(tx, userId, date, 'hydration');
    return r.ml;
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function sumItems(items: { kcal: number; p: number; c: number; f: number }[]): Macros {
  return items.reduce((a, b) => ({ kcal: a.kcal + Number(b.kcal), p: a.p + Number(b.p), c: a.c + Number(b.c), f: a.f + Number(b.f) }), { kcal: 0, p: 0, c: 0, f: 0 });
}
