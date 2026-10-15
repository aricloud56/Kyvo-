// Unit tests for the plan engine and shared rules (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../src/server/paths.js';
import type { ExerciseSummary, FoodItem, LoggedSet, Profile, Recipe } from '../../src/core/types.js';
import { MEAL_SLOTS } from '../../src/core/types.js';
import { estimateTargets, validateManualTargets, recipeNutrition, scaleIngredients, allergensIn, ALLERGEN_TAGS } from '../../src/core/nutrition.js';
import { buildRecipeInfo, planMeals, swapMeal, swapOptions, plannedTotals } from '../../src/core/meals.js';
import { TEMPLATES, equipmentSet, exerciseAvailable, generateProgram, spreadDays, suggestLoad, detectRecords, recommendTemplate } from '../../src/core/workouts.js';
import { buildDailyPlan, summariseDay } from '../../src/core/dailyPlan.js';
import { isPremium, PRICES, formatPrice } from '../../src/core/plans.js';
import { addDays, weekdayOf } from '../../src/core/util.js';
import { verifyStripeSignature, signStripePayload, intervalOf } from '../../src/server/services/billing.js';

const read = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const rawExercises = read('exercises.json') as any[];
const exercises = new Map<string, ExerciseSummary>(rawExercises.map((e) => [e.id, { ...e, alternatives: e.alternatives ?? [], progressions: e.progressions ?? [], premium: !!e.premium }]));
const foods = new Map<string, FoodItem>([...read('foods.json'), ...read('foods_extra.json')].map((f: FoodItem) => [f.id, f]));
const recipes = (read('recipes.json') as any[]).map((r) => ({ ...r, description: r.desc })) as Recipe[];
const recipeInfo = buildRecipeInfo(recipes, foods);

const profile: Profile = {
  displayName: 'T', ageRange: '25-34', sex: 'male', heightCm: 180, weightKg: 80, goal: 'muscle_gain', experience: 'intermediate', location: 'gym',
  equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bench', 'rack', 'pullup_bar', 'plate', 'bodyweight', 'mat', 'ez_bar', 'smith', 'dip_station'],
  trainingDays: [1, 3, 5], sessionMinutes: 60, trainingStyle: 'balanced', diet: 'none', allergies: [], exclusions: [], units: 'metric', activity: 'light',
  hydrationEnabled: false, hydrationTargetMl: 2500, templatePref: 'auto',
};

test('content: at least 150 unique exercises and 30 recipes with complete fields', () => {
  assert.ok(exercises.size >= 150, `only ${exercises.size} exercises`);
  assert.equal(new Set(rawExercises.map((e) => e.name.toLowerCase())).size, rawExercises.length, 'duplicate exercise names');
  for (const e of rawExercises) {
    for (const k of ['id', 'name', 'groups', 'equipment', 'difficulty', 'logging', 'steps', 'cues', 'mistakes', 'safety', 'programming', 'musclesText']) assert.ok(e[k], `${e.id} missing ${k}`);
    for (const a of e.alternatives ?? []) assert.ok(exercises.has(a), `${e.id} alternative ${a} missing`);
  }
  assert.ok(recipes.length >= 30);
  for (const r of recipeInfo) assert.equal(recipeNutrition(r.recipe, foods).missing.length, 0, `${r.recipe.id} has unknown ingredients`);
});

test('targets: Mifflin-St Jeor estimate is sensible and respects goals and floors', () => {
  const t = estimateTargets(profile)!;
  // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780; activity 1.375 + 0.075 training -> 2581; +8% -> ~2790
  assert.ok(t.kcal > 2650 && t.kcal < 2900, `kcal ${t.kcal}`);
  assert.equal(t.proteinG, 144);
  const loss = estimateTargets({ ...profile, goal: 'fat_loss' })!;
  assert.ok(loss.kcal < t.kcal);
  const tiny = estimateTargets({ ...profile, sex: 'female', weightKg: 45, heightCm: 150, ageRange: '65+', activity: 'sedentary', trainingDays: [], goal: 'fat_loss' })!;
  assert.ok(tiny.kcal >= 1000);
  const under = estimateTargets({ ...profile, weightKg: 52, heightCm: 180, goal: 'fat_loss' })!;
  assert.ok(under.notes.some((n) => n.includes('BMI is under 18.5')));
  assert.equal(estimateTargets({ ...profile, heightCm: null }), null);
});

test('targets: manual values are validated', () => {
  assert.equal(validateManualTargets({ kcal: 2000, proteinG: 150, carbsG: 200, fatG: 67 }), null);
  assert.match(validateManualTargets({ kcal: 900, proteinG: 50, carbsG: 100, fatG: 30 })!, /1,200/);
  assert.match(validateManualTargets({ kcal: 2000, proteinG: 300, carbsG: 300, fatG: 100 })!, /15%/);
});

test('meals: planner respects diet, allergies and exclusions for every slot', () => {
  const targets = estimateTargets(profile)!;
  for (const [diet, allergies, exclusions] of [['vegan', [], []], ['vegetarian', ['dairy'], []], ['halal', ['peanut'], ['salmon']], ['none', ['gluten', 'egg'], ['chicken']]] as const) {
    for (let d = 0; d < 7; d++) {
      const meals = planMeals({ date: addDays('2026-10-01', d), userId: 'u1', targets, recipes: recipeInfo, filter: { diet, allergies: [...allergies], exclusions: [...exclusions], premium: true }, recent: [] });
      assert.ok(meals.length >= 3, `${diet}: only ${meals.length} meals`);
      for (const m of meals) {
        const info = recipeInfo.find((r) => r.recipe.id === m.recipeId)!;
        const tags = info.ingredientTags.flat();
        for (const a of allergies) assert.ok(!ALLERGEN_TAGS[a].some((t) => tags.includes(t)), `${m.name} contains ${a}`);
        for (const x of exclusions) assert.ok(!info.ingredientFoods.some((f) => f.name.toLowerCase().includes(x) || f.id.includes(x)), `${m.name} contains ${x}`);
        if (diet === 'vegan') assert.ok(!tags.some((t) => ['meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey'].includes(t)), `${m.name} is not vegan`);
      }
    }
  }
});

test('meals: daily plan lands near calorie and protein targets', () => {
  const targets = estimateTargets(profile)!;
  let worst = 0;
  for (let d = 0; d < 14; d++) {
    const meals = planMeals({ date: addDays('2026-10-01', d), userId: 'u2', targets, recipes: recipeInfo, filter: { diet: 'none', allergies: [], exclusions: [], premium: true }, recent: [] });
    const tot = plannedTotals(meals);
    worst = Math.max(worst, Math.abs(tot.kcal - targets.kcal) / targets.kcal);
    assert.ok(tot.p >= targets.proteinG * 0.75, `protein ${tot.p} vs ${targets.proteinG}`);
  }
  assert.ok(worst < 0.15, `calories off by ${Math.round(worst * 100)}%`);
});

test('meals: free users only get free recipes; swaps keep the slot and respect filters', () => {
  const targets = estimateTargets(profile)!;
  const filter = { diet: 'none' as const, allergies: [], exclusions: [], premium: false };
  const meals = planMeals({ date: '2026-10-05', userId: 'u3', targets, recipes: recipeInfo, filter, recent: [] });
  for (const m of meals) assert.ok(recipeInfo.find((r) => r.recipe.id === m.recipeId)!.recipe.free);
  const lunch = meals.find((m) => m.slot === 'lunch')!;
  const opts = swapOptions('lunch', lunch, targets, recipeInfo, filter);
  assert.ok(opts.length > 0 && opts.every((o) => o.recipeId !== lunch.recipeId));
  const swapped = swapMeal(meals, 'lunch', recipeInfo.find((r) => r.recipe.id === opts[0].recipeId)!, targets);
  assert.equal(swapped.find((m) => m.slot === 'lunch')!.recipeId, opts[0].recipeId);
  assert.deepEqual(swapped.map((m) => m.slot), MEAL_SLOTS.filter((s) => meals.some((m) => m.slot === s)));
});

test('recipes: ingredient scaling and allergen detection', () => {
  const r = recipes.find((x) => x.id === 'overnight-oats')!;
  const doubled = scaleIngredients(r, r.servings * 2);
  r.ing.forEach(([id, g], i) => {
    assert.equal(doubled[i][0], id);
    assert.ok(Math.abs(doubled[i][1] - g * 2) <= 1, `${id}: ${doubled[i][1]} vs ${g * 2}`);
  });
  const withPeanut = recipeInfo.filter((x) => x.ingredientTags.flat().some((t) => ALLERGEN_TAGS.peanut.includes(t)));
  for (const x of withPeanut) assert.ok(allergensIn(recipeNutrition(x.recipe, foods).tags).includes('peanut'), `${x.recipe.id} should list peanut`);
});

test('workouts: every template generates usable workouts with a premium user', () => {
  for (const t of TEMPLATES) {
    const days = t.days >= 6 ? [1, 2, 3, 4, 5, 6] : t.days === 4 ? [1, 2, 4, 5] : [1, 3, 5];
    const prog = generateProgram({ profile: { ...profile, templatePref: t.id, trainingDays: days, sessionMinutes: 90 }, exercises, premium: true });
    assert.equal(prog.templateId, t.id);
    for (const w of prog.workouts) {
      assert.ok(w.exercises.length >= 3, `${t.id}/${w.name} has ${w.exercises.length}`);
      assert.equal(new Set(w.exercises.map((x) => x.exerciseId)).size, w.exercises.length);
    }
    assert.ok(Object.values(prog.schedule).filter((v) => v != null).length >= 1);
  }
});

test('workouts: home dumbbell users only get exercises they can do', () => {
  const home = { ...profile, location: 'home' as const, equipment: ['dumbbell', 'bench', 'bodyweight', 'mat'], templatePref: 'home_db' };
  const prog = generateProgram({ profile: home, exercises, premium: false });
  for (const w of prog.workouts) for (const x of w.exercises) {
    const ex = exercises.get(x.exerciseId)!;
    assert.ok(exerciseAvailable(ex, equipmentSet(home)), `${ex.name} needs ${ex.equipment}`);
    assert.ok(!ex.equipment.some((e) => ['barbell', 'cable', 'machine', 'smith', 'rack'].includes(e)), `${ex.name} needs gym kit`);
    assert.ok(!ex.premium);
  }
});

test('workouts: free users never get premium templates, and full-body days are spread out', () => {
  assert.ok(!TEMPLATES.find((t) => t.id === recommendTemplate({ ...profile, trainingDays: [1, 2, 3, 4, 5, 6] }, false))!.premium);
  const prog = generateProgram({ profile: { ...profile, trainingDays: [0, 1, 2, 3, 4, 5, 6] }, exercises, premium: false });
  const used = Object.entries(prog.schedule).filter(([, v]) => v != null).map(([k]) => Number(k)).sort();
  assert.ok(used.length <= 3, `full body on ${used.length} days`);
  for (let i = 1; i < used.length; i++) assert.ok(used[i] - used[i - 1] > 1, 'back-to-back full-body days');
  assert.deepEqual(spreadDays([1, 2, 3, 4, 5], 3), [1, 3, 5]);
});

const set = (w: number, reps: number, i = 0, extra: Partial<LoggedSet> = {}): LoggedSet => ({ exerciseId: 'barbell-bench-press', setIndex: i, weightKg: w, reps, durationSec: null, distanceM: null, completed: true, ...extra });
const bench = exercises.get('barbell-bench-press')!;
const presc = { sets: 3, repMin: 6, repMax: 10, restSec: 150, mode: 'weight_reps' as const, rir: '1-3' };

test('progression: increases only after all planned work hits the top of the range', () => {
  const up = suggestLoad(bench, presc, [{ sets: [set(60, 10, 0), set(60, 10, 1), set(60, 10, 2)], painReported: false }]);
  assert.equal(up.type, 'increase');
  assert.equal(up.weightKg, 62.5);
  const hold = suggestLoad(bench, presc, [{ sets: [set(60, 10, 0), set(60, 9, 1), set(60, 8, 2)], painReported: false }]);
  assert.equal(hold.type, 'hold');
  assert.equal(hold.weightKg, 60);
});

test('progression: never increases after failed planned work or reported pain', () => {
  const failed = suggestLoad(bench, presc, [{ sets: [set(60, 10, 0), set(60, 5, 1), set(60, 4, 2)], painReported: false }]);
  assert.ok(failed.weightKg! <= 60);
  const missingSet = suggestLoad(bench, presc, [{ sets: [set(60, 10, 0), set(60, 10, 1)], painReported: false }]);
  assert.ok(missingSet.weightKg! <= 60);
  const pain = suggestLoad(bench, presc, [{ sets: [set(60, 10, 0), set(60, 10, 1), set(60, 10, 2)], painReported: true }]);
  assert.equal(pain.type, 'pain');
  assert.ok(pain.weightKg! <= 60);
  const painSet = suggestLoad(bench, presc, [{ sets: [set(60, 10, 0), set(60, 10, 1, { pain: true }), set(60, 10, 2)], painReported: false }]);
  assert.ok(painSet.weightKg! <= 60);
  const repeated = suggestLoad(bench, presc, [5, 5, 4].map(() => ({ sets: [set(60, 5, 0), set(60, 5, 1), set(60, 4, 2)], painReported: false })));
  assert.equal(repeated.type, 'reduce');
  assert.ok(repeated.weightKg! < 60);
});

test('records: first log is a baseline; heavier sets are records', () => {
  assert.equal(detectRecords([set(60, 8)], []).length, 0);
  const recs = detectRecords([set(65, 6)], [set(60, 8)]);
  assert.ok(recs.some((r) => r.kind === 'weight' && r.value === 65));
});

test('daily plan: rest days have no workout requirement; training days do', () => {
  const targets = estimateTargets(profile)!;
  const base = { userId: 'u', profile, targets, exercises, history: new Map(), recipes: recipeInfo, recentRecipeIds: [], premium: false };
  const rest = buildDailyPlan({ ...base, date: '2026-10-04', workout: null });
  assert.equal(rest.isRest, true);
  assert.equal(rest.workout, null);
  assert.ok(!rest.checklist.some((c) => c.key === 'workout'));
  assert.ok(rest.checklist.filter((c) => c.key === 'recover').every((c) => c.optional));
  assert.ok(rest.meals.length >= 3);
  const prog = generateProgram({ profile, exercises, premium: false });
  const train = buildDailyPlan({ ...base, date: '2026-10-05', workout: prog.workouts[0] });
  assert.equal(train.isRest, false);
  assert.ok(train.checklist.some((c) => c.key === 'workout' && !c.optional));
  const sum = summariseDay(rest, { kcal: targets.kcal, p: targets.proteinG }, new Set(['meal_breakfast', 'meal_lunch', 'meal_dinner', 'review']), false, 0);
  assert.equal(sum.tasksDone, sum.tasksTotal);
  assert.equal(weekdayOf('2026-10-04'), 0);
});

test('entitlements: premium only for active/trialing within the period, short grace for past_due', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  const future = '2026-11-14T00:00:00Z';
  assert.equal(isPremium(null, now), false);
  assert.equal(isPremium({ status: 'active', currentPeriodEnd: future, cancelAtPeriodEnd: false }, now), true);
  assert.equal(isPremium({ status: 'active', currentPeriodEnd: future, cancelAtPeriodEnd: true }, now), true);
  assert.equal(isPremium({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00Z', cancelAtPeriodEnd: true }, now), false);
  assert.equal(isPremium({ status: 'canceled', currentPeriodEnd: future, cancelAtPeriodEnd: false }, now), false);
  assert.equal(isPremium({ status: 'past_due', currentPeriodEnd: '2026-10-12T00:00:00Z', cancelAtPeriodEnd: false }, now), true);
  assert.equal(isPremium({ status: 'past_due', currentPeriodEnd: '2026-10-01T00:00:00Z', cancelAtPeriodEnd: false }, now), false);
  assert.equal(isPremium({ status: 'incomplete', currentPeriodEnd: future, cancelAtPeriodEnd: false }, now), false);
});

test('pricing is configured in one place', () => {
  assert.equal(formatPrice(PRICES.monthly.amountCents), 'A$9.99');
  assert.equal(formatPrice(PRICES.annual.amountCents), 'A$79.99');
  assert.equal(intervalOf('year'), 'annual');
  assert.equal(intervalOf('month'), 'monthly');
});

test('stripe signatures: valid, tampered, wrong secret and stale timestamps', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'x' });
  const header = signStripePayload(payload, 'whsec_a');
  assert.equal(verifyStripeSignature(Buffer.from(payload), header, 'whsec_a'), true);
  assert.equal(verifyStripeSignature(Buffer.from(payload + ' '), header, 'whsec_a'), false);
  assert.equal(verifyStripeSignature(Buffer.from(payload), header, 'whsec_b'), false);
  assert.equal(verifyStripeSignature(Buffer.from(payload), undefined, 'whsec_a'), false);
  const old = signStripePayload(payload, 'whsec_a', Math.floor(Date.now() / 1000) - 3600);
  assert.equal(verifyStripeSignature(Buffer.from(payload), old, 'whsec_a'), false);
});
