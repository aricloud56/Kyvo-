// Profile, preferences, targets, privacy and account; Premium and billing.
import { api } from '../api.js';
import { go, refreshMe, state } from '../app.js';
import { confirmSheet, formData, html, numOrNull, onActions, raw, sheet, toast } from '../dom.js';
import { GOAL_LABEL, kcal, longDate, setUnits, wIn, wOut, wUnit } from '../format.js';
import { ALLERGEN_LABELS, validateManualTargets } from '../../core/nutrition.js';
import { FREE_FEATURES, PREMIUM_FEATURES, PRICES, formatPrice } from '../../core/plans.js';
import { WEEKDAY_SHORT } from '../../core/util.js';

const sel = (name: string, cur: string, opts: [string, string][]) =>
  html`<select id="p-${name}" name="${name}">${opts.map(([v, l]) => html`<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`)}</select>`;

export async function profileScreen(view: HTMLElement) {
  const me = (await refreshMe())!;
  const p = me.profile;
  const t = me.targets;
  const tg = await api.get<any>('/api/targets');

  view.innerHTML = html`<h1>Profile</h1>
  <p class="muted">${me.user.email} · ${me.premium ? html`<span class="tag accent">Premium</span>` : html`Free plan · <a href="#/premium">See Premium</a>`}</p>

  <form class="card" id="pf" aria-labelledby="pf-h"><h2 id="pf-h">About you and your plan</h2>
    <div class="row"><div class="field grow"><label for="p-displayName">First name</label><input id="p-displayName" name="displayName" maxlength="60" value="${p.displayName}"></div>
      <div class="field grow"><label for="p-ageRange">Age range</label>${sel('ageRange', p.ageRange ?? '', [['', 'Not set'], ...['18-24', '25-34', '35-44', '45-54', '55-64', '65+'].map((a) => [a, a] as [string, string])])}</div></div>
    <div class="row"><div class="field grow"><label for="p-sex">Sex (for calorie estimates)</label>${sel('sex', p.sex, [['female', 'Female'], ['male', 'Male'], ['unspecified', 'Prefer not to say']])}</div>
      <div class="field grow"><label for="p-heightCm">Height (cm)</label><input id="p-heightCm" name="heightCm" type="number" min="120" max="230" value="${p.heightCm ?? ''}"></div>
      <div class="field grow"><label for="p-weight">Weight (${wUnit()})</label><input id="p-weight" name="weight" type="number" step="0.1" value="${p.weightKg == null ? '' : wOut(p.weightKg)}"></div></div>
    <div class="row"><div class="field grow"><label for="p-goal">Goal</label>${sel('goal', p.goal, Object.entries(GOAL_LABEL))}</div>
      <div class="field grow"><label for="p-experience">Experience</label>${sel('experience', p.experience, [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']])}</div>
      <div class="field grow"><label for="p-activity">Daily activity outside training</label>${sel('activity', p.activity, [['sedentary', 'Mostly sitting'], ['light', 'Lightly active'], ['moderate', 'On my feet a lot'], ['high', 'Physical job']])}</div></div>
    <fieldset class="field" style="border:0;padding:0;margin:0 0 12px"><legend class="label">Training days</legend><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map((d) => html`<label class="chip"><input type="checkbox" name="day-${d}" ${p.trainingDays.includes(d) ? 'checked' : ''}> ${WEEKDAY_SHORT[d]}</label>`)}</div></fieldset>
    <div class="row"><div class="field grow"><label for="p-location">Training location</label>${sel('location', p.location, [['gym', 'Gym'], ['home', 'Home'], ['both', 'Both']])}</div>
      <div class="field grow"><label for="p-sessionMinutes">Session length</label>${sel('sessionMinutes', String(p.sessionMinutes), [30, 45, 60, 75, 90].map((m) => [String(m), `${m} min`] as [string, string]))}</div></div>
    <div class="row"><div class="field grow"><label for="p-diet">Diet</label>${sel('diet', p.diet, [['none', 'No restrictions'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['pescatarian', 'Pescatarian'], ['halal', 'Halal']])}</div>
      <div class="field grow"><label for="p-exclusions">Foods to avoid <span class="muted">(comma separated)</span></label><input id="p-exclusions" name="exclusions" value="${p.exclusions.join(', ')}"></div></div>
    <fieldset class="field" style="border:0;padding:0;margin:0 0 12px"><legend class="label">Allergies</legend><div class="chips">${Object.entries(ALLERGEN_LABELS).map(([k, l]) => html`<label class="chip"><input type="checkbox" name="al-${k}" ${(p.allergies as string[]).includes(k) ? 'checked' : ''}> ${l}</label>`)}</div>
      <p class="hint">KYVO filters recipes by ingredient, but always check labels if you have a serious allergy.</p></fieldset>
    <div class="row"><div class="field grow"><label for="p-units">Units</label>${sel('units', p.units, [['metric', 'kg and cm'], ['imperial', 'lb and in']])}</div>
      <div class="field grow"><label for="p-hydration">Water tracking</label>${sel('hydrationEnabled', p.hydrationEnabled ? 'on' : 'off', [['on', 'On'], ['off', 'Off']])}</div>
      <div class="field grow"><label for="p-hydrationTargetMl">Water target (ml)</label><input id="p-hydrationTargetMl" name="hydrationTargetMl" type="number" min="500" max="6000" step="250" value="${p.hydrationTargetMl}"></div></div>
    <button class="btn btn-primary" type="submit">Save changes</button></form>

  <section class="card" aria-labelledby="tg-h"><h2 id="tg-h">Daily targets</h2>
    ${t ? html`<p><b>${kcal(t.kcal)}</b> · ${t.proteinG} g protein · ${t.carbsG} g carbs · ${t.fatG} g fat <span class="tag">${t.source === 'manual' ? 'Set by you' : 'Estimated'}</span></p>
      ${t.notes?.length ? html`<ul class="small muted">${t.notes.map((n: string) => html`<li>${n}</li>`)}</ul>` : ''}` : html`<p class="muted">No targets yet.</p>`}
    <div class="row"><button class="btn btn-secondary btn-sm" data-action="manual">Set my own targets</button>${tg.estimate ? html`<button class="btn btn-ghost btn-sm" data-action="estimate">Use KYVO’s estimate (${kcal(tg.estimate.kcal)})</button>` : ''}</div>
    <p class="xs muted">Targets are general estimates, not medical or dietetic advice. If you are pregnant, have a medical condition or a history of disordered eating, speak to a GP or Accredited Practising Dietitian first.</p></section>

  <section class="card" aria-labelledby="pv-h"><h2 id="pv-h">Privacy and account</h2>
    <label class="check"><input type="checkbox" id="consent" ${me.user.analyticsConsent ? 'checked' : ''}> Allow privacy-friendly usage measurement. KYVO never shares your health, food, body or workout data with advertisers.</label>
    <div class="row" style="margin-top:10px"><a class="btn btn-secondary btn-sm" href="/api/account/export" download>Download my data</a><button class="btn btn-secondary btn-sm" data-action="password">Change password</button>
      <button class="btn btn-ghost btn-sm" data-action="logout">Sign out</button><button class="btn btn-ghost btn-sm" data-action="delete" style="color:var(--danger)">Delete account</button></div></section>

  <p class="small muted"><a href="/legal/privacy">Privacy</a> · <a href="/legal/terms">Terms</a> · <a href="/legal/subscription">Subscription terms</a> · <a href="/legal/disclaimer">Health disclaimer</a> · <a href="/legal/contact">Contact</a>${me.user.role === 'admin' ? html` · <a href="#/admin">Admin</a>` : ''}</p>`.value;

  view.querySelector<HTMLFormElement>('#pf')!.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = formData(ev.target as HTMLFormElement);
    const units = f.units as 'metric' | 'imperial';
    const weightEntered = numOrNull(f.weight);
    const body = {
      displayName: f.displayName, ageRange: f.ageRange || null, sex: f.sex, heightCm: numOrNull(f.heightCm), weightKg: weightEntered == null ? null : wIn(weightEntered),
      goal: f.goal, experience: f.experience, activity: f.activity, location: f.location, sessionMinutes: Number(f.sessionMinutes), diet: f.diet,
      trainingDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => f[`day-${d}`]),
      allergies: Object.keys(ALLERGEN_LABELS).filter((k) => f[`al-${k}`]),
      exclusions: (f.exclusions || '').split(',').map((s) => s.trim()).filter(Boolean),
      units, hydrationEnabled: f.hydrationEnabled === 'on', hydrationTargetMl: Number(f.hydrationTargetMl) || 2500,
    };
    try {
      const r = await api.put<any>('/api/profile', body);
      setUnits(units);
      toast('Profile saved');
      const parts = r.affects;
      if (parts.workouts || parts.meals) {
        const part = parts.workouts && parts.meals ? 'all' : parts.workouts ? 'workout' : 'meals';
        const what = part === 'all' ? 'workouts and meals' : part === 'workout' ? 'workouts' : 'meals';
        if (await confirmSheet(`Update your ${what}?`, `These changes affect your ${what}. KYVO can rebuild your plan from today. Past days and your history stay as they were.`, 'Update from today')) {
          await api.post(`/api/plan/${me.today}/regenerate`, { part });
          toast('Your plan has been updated');
        }
      }
      await profileScreen(view);
    } catch (x) {
      toast((x as Error).message, 'err');
    }
  });
  view.querySelector<HTMLInputElement>('#consent')!.addEventListener('change', async (e) => {
    await api.post('/api/consent', { analytics: (e.target as HTMLInputElement).checked });
    toast('Preference saved');
  });

  onActions(view, {
    estimate: async () => {
      await api.put('/api/targets', { mode: 'estimate' });
      toast('Targets updated');
      await profileScreen(view);
    },
    manual: () => {
      const cur = t ?? tg.estimate ?? { kcal: 2000, proteinG: 120, carbsG: 220, fatG: 65 };
      const close = sheet('Set your own targets', html`<form>
        <div class="row"><div class="field grow"><label for="tk">Calories</label><input id="tk" name="kcal" type="number" min="1200" max="6000" value="${cur.kcal}" required></div><div class="field grow"><label for="tp">Protein (g)</label><input id="tp" name="proteinG" type="number" min="0" value="${cur.proteinG}" required></div></div>
        <div class="row"><div class="field grow"><label for="tc">Carbs (g)</label><input id="tc" name="carbsG" type="number" min="0" value="${cur.carbsG}" required></div><div class="field grow"><label for="tf">Fat (g)</label><input id="tf" name="fatG" type="number" min="0" value="${cur.fatG}" required></div></div>
        <p class="error-text" id="terr" role="alert" hidden></p><button class="btn btn-primary btn-block" type="submit">Save targets</button></form>`, (sh) => {
        sh.querySelector('form')!.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const f = formData(ev.target as HTMLFormElement);
          const v = { kcal: Number(f.kcal), proteinG: Number(f.proteinG), carbsG: Number(f.carbsG), fatG: Number(f.fatG) };
          const err = validateManualTargets(v);
          const el = sh.querySelector<HTMLElement>('#terr')!;
          if (err) {
            el.textContent = err;
            el.hidden = false;
            return;
          }
          try {
            await api.put('/api/targets', v);
            close();
            toast('Targets saved');
            await profileScreen(view);
          } catch (x) {
            el.textContent = (x as Error).message;
            el.hidden = false;
          }
        });
      });
    },
    password: () => {
      const close = sheet('Change password', html`<form><div class="field"><label for="cp">Current password</label><input id="cp" name="current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="np">New password</label><input id="np" name="next" type="password" autocomplete="new-password" minlength="10" required><p class="hint">At least 10 characters. You’ll be signed out everywhere.</p></div>
        <button class="btn btn-primary btn-block" type="submit">Change password</button></form>`, (sh) => {
        sh.querySelector('form')!.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try {
            await api.post('/api/auth/password', formData(ev.target as HTMLFormElement));
            close();
            state.me = null;
            toast('Password changed. Please sign in again.');
            go('#/login');
          } catch (x) {
            toast((x as Error).message, 'err');
          }
        });
      });
    },
    logout: async () => {
      await api.post('/api/auth/logout');
      state.me = null;
      location.href = '/';
    },
    delete: () => {
      const close = sheet('Delete your account', html`<form><p>This permanently deletes your account, plans, workouts, food diary, measurements and photos.${me.premium ? raw(' <b>Your Premium subscription will be cancelled immediately.</b>') : ''} This can’t be undone.</p>
        <p class="small muted">You can download your data first from Profile.</p>
        <div class="field"><label for="dp">Enter your password to confirm</label><input id="dp" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-danger btn-block" type="submit">Delete my account</button></form>`, (sh) => {
        sh.querySelector('form')!.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try {
            await api.post('/api/account/delete', formData(ev.target as HTMLFormElement));
            close();
            state.me = null;
            location.href = '/?deleted=1';
          } catch (x) {
            toast((x as Error).message, 'err');
          }
        });
      });
    },
  });
}

export async function premiumScreen(view: HTMLElement) {
  const b = await api.get<any>('/api/billing');
  const q = new URLSearchParams(location.hash.split('?')[1] ?? location.search);
  const result = q.get('checkout');
  if (result === 'success') await refreshMe();
  const sub = b.subscription;
  const annualSaving = Math.round((1 - PRICES.annual.amountCents / (PRICES.monthly.amountCents * 12)) * 100);

  view.innerHTML = html`<h1>KYVO Premium</h1>
  ${result === 'success' ? html`<div class="notice" role="status">${b.premium ? 'Payment confirmed. Premium is now active. Thank you!' : 'Payment received. Premium will switch on as soon as Stripe confirms it, usually within a minute. Refresh this page shortly.'}</div>` : ''}
  ${result === 'cancelled' ? html`<div class="notice" role="status">Checkout was cancelled. You have not been charged.</div>` : ''}
  ${b.premium ? html`<section class="card"><h2>You have Premium</h2>
      <p>${sub?.interval === 'annual' ? 'Annual' : 'Monthly'} plan · ${sub?.cancelAtPeriodEnd ? `ends on ${longDate(String(sub.currentPeriodEnd).slice(0, 10))}` : `renews on ${longDate(String(sub?.currentPeriodEnd).slice(0, 10))}`}${sub?.status === 'past_due' ? html` · <b style="color:var(--warning)">payment failed, please update your card</b>` : ''}</p>
      <button class="btn btn-secondary" data-action="portal">Manage billing, cancel or change plan</button></section>`
  : html`<p class="muted">Everything in Free, plus the full KYVO library and smarter plans.</p>
    ${sub?.status === 'past_due' || sub?.status === 'unpaid' ? html`<div class="notice">Your last payment didn’t go through. <button class="btn btn-ghost btn-sm" data-action="portal">Update payment method</button></div>` : ''}
    <div class="price-grid">
      <section class="card"><h2>Monthly</h2><p style="font-size:28px;margin:4px 0"><b>${formatPrice(PRICES.monthly.amountCents)}</b><span class="small muted"> / month</span></p><button class="btn btn-primary btn-block" data-action="checkout" data-interval="monthly">Choose monthly</button></section>
      <section class="card" style="border-color:var(--accent)"><h2>Annual <span class="tag accent">Save ${annualSaving}%</span></h2><p style="font-size:28px;margin:4px 0"><b>${formatPrice(PRICES.annual.amountCents)}</b><span class="small muted"> / year</span></p><button class="btn btn-primary btn-block" data-action="checkout" data-interval="annual">Choose annual</button></section>
    </div>
    <p class="xs muted">Prices in Australian dollars. Renews automatically until cancelled; cancel any time from the billing portal and keep Premium until the end of the period you paid for. See the <a href="/legal/subscription">subscription terms</a>.</p>
    ${b.configured ? '' : html`<p class="notice small">Payments are not switched on in this environment yet.</p>`}`}
  <div class="price-grid" style="margin-top:16px">
    <section class="card"><h2>Free</h2><ul class="small">${FREE_FEATURES.map((f) => html`<li>${f}</li>`)}</ul></section>
    <section class="card"><h2>Premium</h2><ul class="small">${PREMIUM_FEATURES.map((f) => html`<li>${f}</li>`)}</ul></section>
  </div>`.value;

  onActions(view, {
    checkout: async (el) => {
      try {
        const r = await api.post<any>('/api/billing/checkout', { interval: el.dataset.interval });
        location.href = r.url;
      } catch (x) {
        toast((x as Error).message, 'err');
      }
    },
    portal: async () => {
      try {
        const r = await api.post<any>('/api/billing/portal');
        location.href = r.url;
      } catch (x) {
        toast((x as Error).message, 'err');
      }
    },
  });
}
