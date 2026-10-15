// Guided onboarding: collects what the plan engine needs, shows the target estimate, then generates the first plan.
import { api } from '../api.js';
import { go, refreshMe, state } from '../app.js';
import { html, numOrNull, onActions, raw, showError } from '../dom.js';
import { EQUIPMENT_LABEL, GOAL_LABEL } from '../format.js';
import { estimateTargets, ALLERGEN_LABELS, validateManualTargets } from '../../core/nutrition.js';
import { EQUIPMENT_PRESETS } from '../../core/workouts.js';
import { WEEKDAY_SHORT, round, lbToKg, kgToLb } from '../../core/util.js';
import type { Allergen, Profile } from '../../core/types.js';
import { CAMPAIGN_BY_SLUG } from '../../core/campaigns.js';

const STEPS = ['About you', 'Your goal', 'Training', 'Food', 'Your targets'];

export async function onboardingScreen(view: HTMLElement) {
  const me = state.me!;
  const campaign = CAMPAIGN_BY_SLUG.get(sessionStorageGet('kyvo_campaign') ?? '');
  const existing = me.profile;
  const p: Profile = {
    ...existing,
    goal: existing.onboarded ? existing.goal : campaign?.goal ?? existing.goal,
    experience: existing.onboarded ? existing.experience : campaign?.experience ?? existing.experience,
    equipment: existing.equipment.length ? existing.equipment : EQUIPMENT_PRESETS.gym,
  };
  let step = 0;
  let manual: { kcal: number; proteinG: number; carbsG: number; fatG: number } | null = null;
  let errorMsg = '';

  const choice = (field: string, value: string, title: string, sub = '') =>
    html`<button type="button" class="choice" data-action="set" data-field="${field}" data-value="${value}" aria-pressed="${String((p as any)[field] === value)}"><strong>${title}</strong>${sub ? html`<span class="small muted">${sub}</span>` : ''}</button>`;

  function body() {
    const imperial = p.units === 'imperial';
    switch (step) {
      case 0: return html`
        <div class="field"><label for="name">First name <span class="muted">(optional)</span></label><input id="name" data-input="displayName" value="${p.displayName}" maxlength="60" autocomplete="given-name"></div>
        <p class="label">Units</p><div class="chips" style="margin-bottom:14px">${(['metric', 'imperial'] as const).map((u) => html`<button type="button" class="chip" data-action="set" data-field="units" data-value="${u}" aria-pressed="${String(p.units === u)}">${u === 'metric' ? 'kg / cm' : 'lb / ft'}</button>`)}</div>
        <p class="label">Age range</p><div class="chips" style="margin-bottom:14px">${['18-24', '25-34', '35-44', '45-54', '55-64', '65+'].map((a) => html`<button type="button" class="chip" data-action="set" data-field="ageRange" data-value="${a}" aria-pressed="${String(p.ageRange === a)}">${a}</button>`)}</div>
        <p class="label">Sex <span class="muted small">(only used to estimate calories)</span></p><div class="chips" style="margin-bottom:14px">${[['female', 'Female'], ['male', 'Male'], ['unspecified', 'Prefer not to say']].map(([v, l]) => html`<button type="button" class="chip" data-action="set" data-field="sex" data-value="${v}" aria-pressed="${String(p.sex === v)}">${l}</button>`)}</div>
        <div class="row">${imperial ? html`
          <div class="field grow"><label for="hft">Height (ft)</label><input id="hft" type="number" inputmode="numeric" data-input="hft" value="${p.heightCm ? Math.floor(p.heightCm / 30.48) : ''}"></div>
          <div class="field grow"><label for="hin">(in)</label><input id="hin" type="number" inputmode="numeric" data-input="hin" value="${p.heightCm ? Math.round((p.heightCm / 2.54) % 12) : ''}"></div>
          <div class="field grow"><label for="w">Weight (lb)</label><input id="w" type="number" inputmode="decimal" data-input="wlb" value="${p.weightKg ? round(kgToLb(p.weightKg), 1) : ''}"></div>`
        : html`<div class="field grow"><label for="h">Height (cm)</label><input id="h" type="number" inputmode="numeric" data-input="heightCm" value="${p.heightCm ?? ''}"></div>
          <div class="field grow"><label for="w">Weight (kg)</label><input id="w" type="number" inputmode="decimal" data-input="weightKg" value="${p.weightKg ?? ''}"></div>`}</div>
        <p class="hint">Height, weight and age range let KYVO estimate your calorie target. You can skip them and enter your own targets later.</p>`;
      case 1: return html`
        <p class="label">Primary goal</p><div class="choice-grid" style="margin-bottom:16px">
          ${choice('goal', 'muscle_gain', 'Build muscle', 'Gain size and shape')}${choice('goal', 'fat_loss', 'Lose fat', 'Keep muscle, lose fat')}${choice('goal', 'strength', 'Get stronger', 'Lift heavier')}${choice('goal', 'general', 'General fitness', 'Feel fitter and healthier')}</div>
        <p class="label">Training experience</p><div class="choice-grid">
          ${choice('experience', 'beginner', 'Beginner', 'New or returning, under 6 months')}${choice('experience', 'intermediate', 'Intermediate', '6 months to 2 years of steady training')}${choice('experience', 'advanced', 'Advanced', '2+ years, comfortable with heavy lifts')}</div>`;
      case 2: {
        const all = [...new Set([...EQUIPMENT_PRESETS.gym])];
        return html`
        <p class="label">Where do you train?</p><div class="choice-grid" style="margin-bottom:16px">${choice('location', 'gym', 'Gym')}${choice('location', 'home', 'Home')}${choice('location', 'both', 'Both')}</div>
        <p class="label">Which days can you train?</p><div class="chips" role="group" aria-label="Training days" style="margin-bottom:6px">${[1, 2, 3, 4, 5, 6, 0].map((d) => html`<button type="button" class="chip" data-action="day" data-day="${d}" aria-pressed="${String(p.trainingDays.includes(d))}">${WEEKDAY_SHORT[d]}</button>`)}</div>
        <p class="hint" style="margin-bottom:16px">${p.trainingDays.length} day${p.trainingDays.length === 1 ? '' : 's'} a week. Other days become rest days.</p>
        <p class="label">Session length</p><div class="chips" style="margin-bottom:16px">${[30, 45, 60, 75, 90].map((m) => html`<button type="button" class="chip" data-action="minutes" data-value="${m}" aria-pressed="${String(p.sessionMinutes === m)}">${m} min</button>`)}</div>
        <p class="label">Training preference</p><div class="chips" style="margin-bottom:16px">${[['balanced', 'Balanced'], ['machines', 'Mostly machines'], ['free_weights', 'Mostly free weights']].map(([v, l]) => html`<button type="button" class="chip" data-action="set" data-field="trainingStyle" data-value="${v}" aria-pressed="${String(p.trainingStyle === v)}">${l}</button>`)}</div>
        <details ${p.location === 'home' ? raw('open') : ''}><summary>Equipment you have (${p.equipment.length} selected)</summary>
          <div class="row" style="margin:8px 0"><button type="button" class="btn btn-sm btn-secondary" data-action="preset" data-value="gym">Full gym</button><button type="button" class="btn btn-sm btn-secondary" data-action="preset" data-value="home">Home: dumbbells and bands</button></div>
          <div class="chips">${all.map((e) => html`<button type="button" class="chip" data-action="equip" data-value="${e}" aria-pressed="${String(p.equipment.includes(e))}">${EQUIPMENT_LABEL[e] ?? e}</button>`)}</div></details>`;
      }
      case 3: return html`
        <p class="label">Dietary preference</p><div class="chips" style="margin-bottom:16px">${[['none', 'No preference'], ['halal', 'Halal'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['pescatarian', 'Pescatarian']].map(([v, l]) => html`<button type="button" class="chip" data-action="set" data-field="diet" data-value="${v}" aria-pressed="${String(p.diet === v)}">${l}</button>`)}</div>
        <p class="label">Allergies <span class="muted small">(optional)</span></p><div class="chips" style="margin-bottom:6px">${(Object.keys(ALLERGEN_LABELS) as Allergen[]).map((a) => html`<button type="button" class="chip" data-action="allergy" data-value="${a}" aria-pressed="${String(p.allergies.includes(a))}">${ALLERGEN_LABELS[a]}</button>`)}</div>
        <p class="hint" style="margin-bottom:16px">Meals containing these are left out of your plan. Always check labels: KYVO’s allergen information comes from generic ingredients.</p>
        <div class="field"><label for="ex">Foods to avoid <span class="muted small">(optional, separate with commas)</span></label><input id="ex" data-input="exclusions" value="${p.exclusions.join(', ')}" placeholder="e.g. mushrooms, tuna"></div>
        <p class="label">Daily activity outside workouts</p><div class="choice-grid" style="margin-bottom:16px">${choice('activity', 'sedentary', 'Mostly sitting')}${choice('activity', 'light', 'Some walking')}${choice('activity', 'moderate', 'On my feet a lot')}${choice('activity', 'high', 'Physical job')}</div>
        <label class="check"><input type="checkbox" data-check="hydrationEnabled" ${p.hydrationEnabled ? raw('checked') : ''}> Add a daily water target to my checklist</label>`;
      default: {
        const est = estimateTargets(p);
        const t = manual ?? est;
        return html`
        ${est ? html`<p class="muted">Based on your details, here is a starting point for <b>${GOAL_LABEL[p.goal]}</b>. These are estimates, not medical advice.</p>` : html`<p class="notice warn">Without height, weight and age range KYVO can’t estimate your needs. Enter your own targets below, or go back and add them.</p>`}
        ${t ? html`<div class="stat-grid" style="margin:12px 0"><div class="stat"><div class="v">${t.kcal.toLocaleString('en-AU')}</div><div class="k">kcal a day</div></div><div class="stat"><div class="v">${t.proteinG} g</div><div class="k">protein</div></div><div class="stat"><div class="v">${t.carbsG} g</div><div class="k">carbohydrate</div></div><div class="stat"><div class="v">${t.fatG} g</div><div class="k">fat</div></div></div>` : ''}
        ${est?.notes.slice(1).map((n) => html`<p class="notice warn">${n}</p>`)}
        <details ${!est || manual ? raw('open') : ''}><summary>Set my own targets instead</summary>
          <div class="row" style="margin-top:8px">${[['kcal', 'Calories (kcal)'], ['proteinG', 'Protein (g)'], ['carbsG', 'Carbs (g)'], ['fatG', 'Fat (g)']].map(([k, l]) => html`<div class="field grow" style="min-width:120px"><label for="m-${k}">${l}</label><input id="m-${k}" type="number" inputmode="numeric" data-manual="${k}" value="${manual ? (manual as any)[k] : est ? (est as any)[k] : ''}"></div>`)}</div>
          <button type="button" class="btn btn-sm btn-secondary" data-action="use-manual">Use these targets</button>${manual ? html` <button type="button" class="btn btn-sm btn-ghost" data-action="use-estimate">Use the estimate</button>` : ''}
        </details>
        <p class="hint" style="margin-top:14px">If you are pregnant, have a medical condition or a history of disordered eating, please check targets with a doctor or Accredited Practising Dietitian.</p>`;
      }
    }
  }

  function draw() {
    view.innerHTML = html`<div style="max-width:620px;margin:0 auto">
      <div class="row between"><span class="wordmark">KYVO</span><span class="small muted">Step ${step + 1} of ${STEPS.length}</span></div>
      <div class="meter" style="margin:12px 0 20px" role="progressbar" aria-label="Onboarding progress" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${step + 1}"><span style="width:${((step + 1) / STEPS.length) * 100}%"></span></div>
      <h1>${STEPS[step]}</h1>
      <form class="card" novalidate>${body()}
        ${errorMsg ? html`<p class="error-text" role="alert">${errorMsg}</p>` : ''}
        <div class="row between" style="margin-top:18px">${step ? html`<button type="button" class="btn btn-ghost" data-action="back">Back</button>` : html`<span></span>`}
          ${step < STEPS.length - 1 ? html`<button type="submit" class="btn btn-primary">Continue</button>` : html`<button type="submit" class="btn btn-primary btn-lg">Create my plan</button>`}</div>
      </form>
      <p class="xs muted" style="text-align:center">You can change all of this later in your profile. Optional questions can be skipped.</p></div>`.value;
    view.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      void next();
    });
  }

  function readInputs() {
    view.querySelectorAll<HTMLInputElement>('[data-input]').forEach((i) => {
      const k = i.dataset.input!;
      if (k === 'displayName') p.displayName = i.value.trim();
      if (k === 'heightCm') p.heightCm = numOrNull(i.value);
      if (k === 'weightKg') p.weightKg = numOrNull(i.value);
      if (k === 'wlb') p.weightKg = numOrNull(i.value) == null ? null : round(lbToKg(Number(i.value)), 1);
      if (k === 'exclusions') p.exclusions = i.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);
    });
    const ft = view.querySelector<HTMLInputElement>('[data-input=hft]');
    if (ft) {
      const inch = numOrNull(view.querySelector<HTMLInputElement>('[data-input=hin]')!.value) ?? 0;
      p.heightCm = numOrNull(ft.value) == null ? null : round((Number(ft.value) * 12 + inch) * 2.54, 0);
    }
    view.querySelectorAll<HTMLInputElement>('[data-check]').forEach((c) => ((p as any)[c.dataset.check!] = c.checked));
  }

  function validate(): string {
    if (step === 0) {
      if (p.heightCm != null && (p.heightCm < 120 || p.heightCm > 230)) return 'Height should be between 120 and 230 cm.';
      if (p.weightKg != null && (p.weightKg < 35 || p.weightKg > 300)) return 'Weight should be between 35 and 300 kg.';
      if (!p.ageRange) return 'Please choose your age range. KYVO is for adults 18 and over.';
    }
    if (step === 2 && !p.trainingDays.length) return 'Pick at least one training day.';
    return '';
  }

  async function next() {
    readInputs();
    errorMsg = validate();
    if (errorMsg) return draw();
    if (step < STEPS.length - 1) {
      step++;
      return draw();
    }
    const est = estimateTargets(p);
    if (!est && !manual) {
      errorMsg = 'Enter your own targets, or go back and add height, weight and age range.';
      return draw();
    }
    const btn = view.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    btn.textContent = 'Building your plan…';
    try {
      const { displayName, ageRange, sex, heightCm, weightKg, goal, experience, location, equipment, trainingDays, sessionMinutes, trainingStyle, diet, allergies, exclusions, units, activity, hydrationEnabled, hydrationTargetMl, templatePref } = p;
      await api.post('/api/onboarding', {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        profile: { displayName, ageRange, sex, heightCm, weightKg, goal, experience, location, equipment, trainingDays, sessionMinutes, trainingStyle, diet, allergies, exclusions, units, activity, hydrationEnabled, hydrationTargetMl, templatePref: existing.onboarded ? 'auto' : templatePref },
        manualTargets: manual,
      });
      await refreshMe();
      go('#/today');
    } catch (e) {
      showError(e);
      btn.disabled = false;
      btn.textContent = 'Create my plan';
    }
  }

  const toggle = (arr: any[], v: any) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  onActions(view, {
    set: (el) => {
      readInputs();
      (p as any)[el.dataset.field!] = el.dataset.value;
      if (el.dataset.field === 'location') p.equipment = el.dataset.value === 'home' ? [...EQUIPMENT_PRESETS.home] : [...EQUIPMENT_PRESETS.gym];
      draw();
    },
    day: (el) => { p.trainingDays = toggle(p.trainingDays, Number(el.dataset.day)).sort(); draw(); },
    minutes: (el) => { p.sessionMinutes = Number(el.dataset.value); draw(); },
    equip: (el) => { p.equipment = toggle(p.equipment, el.dataset.value); draw(); view.querySelector('details')?.setAttribute('open', ''); },
    preset: (el) => { p.equipment = [...EQUIPMENT_PRESETS[el.dataset.value as 'gym' | 'home']]; draw(); view.querySelector('details')?.setAttribute('open', ''); },
    allergy: (el) => { readInputs(); p.allergies = toggle(p.allergies, el.dataset.value); draw(); },
    back: () => { readInputs(); errorMsg = ''; step--; draw(); },
    'use-manual': () => {
      const v = Object.fromEntries([...view.querySelectorAll<HTMLInputElement>('[data-manual]')].map((i) => [i.dataset.manual, Number(i.value)])) as any;
      const err = validateManualTargets(v);
      errorMsg = err ?? '';
      if (!err) manual = v;
      draw();
    },
    'use-estimate': () => { manual = null; draw(); },
  });
  draw();
}

function sessionStorageGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
