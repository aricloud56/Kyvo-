// Loads curated content (exercises, media, foods, recipes, workout templates) into the database. Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from './lib/db.js';
import { json } from './lib/db.js';
import { TEMPLATES } from '../core/workouts.js';

const read = (dir: string, f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

export async function seedContent(tx: Tx, dataDir: string): Promise<Record<string, number>> {
  const exercises = read(dataDir, 'exercises.json') as Record<string, any>[];
  for (const e of exercises) {
    await tx.exec(
      `insert into kyvo.exercises (id, name, category, groups, primary_muscles, secondary_muscles, equipment, difficulty, mechanic, logging, increment, pattern, premium, content)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
       on conflict (id) do update set name=excluded.name, category=excluded.category, groups=excluded.groups, primary_muscles=excluded.primary_muscles,
         secondary_muscles=excluded.secondary_muscles, equipment=excluded.equipment, difficulty=excluded.difficulty, mechanic=excluded.mechanic,
         logging=excluded.logging, increment=excluded.increment, pattern=excluded.pattern, premium=excluded.premium, content=excluded.content, updated_at=now()`,
      [e.id, e.name, e.category, e.groups, e.primary, e.secondary, e.equipment, e.difficulty, e.mechanic, e.logging, e.increment ?? 0, e.pattern, !!e.premium, json(e)],
    );
  }
  const media = read(dataDir, 'exercise_media.json') as Record<string, string>[];
  await tx.exec('delete from kyvo.exercise_media');
  for (const m of media) {
    await tx.exec('insert into kyvo.exercise_media (exercise_id, kind, ref, title, source, license, attribution, verified_note) values ($1,$2,$3,$4,$5,$6,$7,$8)', [
      m.exercise_id, m.kind, m.ref, m.title, m.source, m.license, m.attribution, m.verified_note,
    ]);
  }
  const foods = [...read(dataDir, 'foods.json'), ...(fs.existsSync(path.join(dataDir, 'foods_extra.json')) ? read(dataDir, 'foods_extra.json') : [])] as Record<string, any>[];
  for (const f of foods) {
    await tx.exec(
      `insert into kyvo.foods (id, owner_id, name, kcal, protein, carbs, fat, fibre, serving_label, serving_g, tags, source)
       values ($1, null, $2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set name=excluded.name, kcal=excluded.kcal, protein=excluded.protein, carbs=excluded.carbs, fat=excluded.fat,
         fibre=excluded.fibre, serving_label=excluded.serving_label, serving_g=excluded.serving_g, tags=excluded.tags, source=excluded.source`,
      [f.id, f.name, f.kcal, f.p, f.c, f.f, f.fib ?? 0, f.serving?.label ?? '100 g', f.serving?.g ?? 100, f.tags ?? [], f.src ?? 'KYVO curated generic value (approximate)'],
    );
  }
  const recipes = read(dataDir, 'recipes.json') as Record<string, any>[];
  for (const r of recipes) {
    await tx.exec(
      `insert into kyvo.recipes (id, name, description, servings, prep_min, cook_min, steps, storage, subs, meal_types, tags, premium, image)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13)
       on conflict (id) do update set name=excluded.name, description=excluded.description, servings=excluded.servings, prep_min=excluded.prep_min,
         cook_min=excluded.cook_min, steps=excluded.steps, storage=excluded.storage, subs=excluded.subs, meal_types=excluded.meal_types,
         tags=excluded.tags, premium=excluded.premium, updated_at=now()`,
      [r.id, r.name, r.desc ?? '', r.servings, r.prep, r.cook, json(r.steps), r.storage ?? '', json(r.subs ?? []), r.meal, r.tags ?? [], !r.free, null],
    );
    await tx.exec('delete from kyvo.recipe_ingredients where recipe_id = $1', [r.id]);
    let i = 0;
    for (const [foodId, grams] of r.ing as [string, number][]) {
      await tx.exec('insert into kyvo.recipe_ingredients (recipe_id, position, food_id, grams) values ($1,$2,$3,$4)', [r.id, i++, foodId, grams]);
    }
  }
  for (const t of TEMPLATES) {
    await tx.exec(
      `insert into kyvo.workout_templates (id, name, description, days, premium, definition) values ($1,$2,$3,$4,$5,$6::jsonb)
       on conflict (id) do update set name=excluded.name, description=excluded.description, days=excluded.days, premium=excluded.premium, definition=excluded.definition, updated_at=now()`,
      [t.id, t.name, t.description, t.days, t.premium, json(t)],
    );
  }
  return { exercises: exercises.length, media: media.length, foods: foods.length, recipes: recipes.length, templates: TEMPLATES.length };
}
