// The KYVO Daily Plan: greeting, today's progress, workout, meals, checklist and end-of-day summary.
import { api } from '../api.js';
import { go, state } from '../app.js';
import { $, html, onActions, raw, sheet, toast } from '../dom.js';
import { icon, meter, ring } from '../ui.js';
import { GOAL_LABEL, SLOT_LABEL, groupsText, longDate, prescriptionText, restText, wOut, wUnit, kcal } from '../format.js';
import { addDays } from '../../core/util.js';
import type { PlannedMeal } from '../../core/types.js';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const thumb = (d: { kind: string; ref: string } | null) =>
  d?.kind === 'youtube' && !api.demo ? html`<img src="https://i.ytimg.com/vi/${d.ref}/mqdefault.jpg" alt="" loading="lazy">` : d ? icon('play', 20) : icon('dumbbell', 22);

export async function todayScreen(view: HTMLElement, params: string[]) {
  const me = state.me!;
  const date = params[0] ?? me.today;
  const d = await api.get<any>(`/api/plan/${date}`);
  const p = d.plan;
  const t = p.targets;
  const name = d.displayName ? `, ${d.displayName}` : '';
  const required = d.checklist.filter((c: any) => !c.optional);
  const tasksDone = required.filter((c: any) => c.done).length;
  const mealSlots = ['breakfast', 'lunch', 'dinner'];
  const mealsLogged = mealSlots.filter((s) => d.loggedSlots.includes(s)).length;
  const workoutLabel = d.workoutStatus === 'completed' ? 'Done' : d.workoutStatus === 'rest' ? 'Rest day' : d.workoutStatus === 'in_progress' ? 'In progress' : 'To do';
  const message = d.summary ? d.summary.message : p.isRest ? 'Rest day today. Recovery is part of the plan.' : d.isPast ? 'Here is how this day was planned.' : 'Your plan is ready. Let’s make today count.';

  view.innerHTML = html`
  <header class="greet">
    <div class="row between"><p class="muted small" style="margin:0">${longDate(date)}${d.isToday ? '' : d.isPast ? ' · past day' : ' · upcoming'}</p>
      <nav class="row" aria-label="Change day"><a class="btn btn-ghost btn-sm" href="#/day/${addDays(date, -1)}" aria-label="Previous day">‹</a>${d.isToday ? '' : html`<a class="btn btn-ghost btn-sm" href="#/today">Today</a>`}<a class="btn btn-ghost btn-sm" href="#/day/${addDays(date, 1)}" aria-label="Next day">›</a></nav></div>
    <h1>${d.isToday ? `${greeting()}${name}` : `Plan for ${longDate(date).split(',')[0]}`}</h1>
    <p class="muted" style="margin:0">${message}</p>
    <div class="goal-pill"><span class="tag accent">Goal: ${GOAL_LABEL[d.goal] ?? d.goal}</span>${me.premium ? html`<span class="tag">Premium</span>` : ''}</div>
  </header>

  ${d.summary ? html`<section class="card summary-card" aria-labelledby="sum-h" style="margin-top:16px">
    <h2 id="sum-h">${d.isPast ? 'Day summary' : 'Today’s summary'}</h2>
    <div class="stat-grid">
      <div class="stat"><div class="v">${d.summary.workout === 'completed' ? 'Done' : d.summary.workout === 'rest' ? 'Rest' : '–'}</div><div class="k">Workout</div></div>
      <div class="stat"><div class="v">${d.summary.tasksDone}/${d.summary.tasksTotal}</div><div class="k">Tasks completed</div></div>
      <div class="stat"><div class="v">${d.summary.kcal.toLocaleString('en-AU')}</div><div class="k">kcal (${d.summary.kcalPct}% of target)</div></div>
      <div class="stat"><div class="v">${d.summary.proteinG} g</div><div class="k">protein (${d.summary.proteinPct}% of target)</div></div>
    </div>
    ${d.summary.records ? html`<p style="margin:12px 0 0">🏆 ${d.summary.records} personal record${d.summary.records > 1 ? 's' : ''} set.</p>` : ''}
  </section>` : ''}

  <section class="card" aria-labelledby="prog-h" style="margin-top:16px">
    <div class="card-head"><h2 id="prog-h">Today’s progress</h2><a class="small" href="#/nutrition/${date}">Food diary</a></div>
    <div class="progress-row">
      ${ring(d.eaten.kcal, t.kcal, Math.round(d.eaten.kcal).toLocaleString('en-AU'), `of ${t.kcal.toLocaleString('en-AU')} kcal`, 'Calories eaten')}
      <div class="macro-bars">${meter(d.eaten.p, t.proteinG, 'Protein')}${meter(d.eaten.c, t.carbsG, 'Carbs')}${meter(d.eaten.f, t.fatG, 'Fat')}</div>
    </div>
    <div class="mini-stats"><div><b>${workoutLabel}</b>Workout</div><div><b>${mealsLogged}/3</b>Meals logged</div><div><b>${tasksDone}/${required.length}</b>Tasks</div></div>
    ${d.hydrationEnabled ? html`<div class="row between" style="margin-top:12px"><span class="small muted">Water: <b class="num" style="color:var(--text)">${String(Math.round(d.hydrationMl / 50) / 20)} L</b> of ${String(Math.round(d.hydrationTargetMl / 50) / 20)} L</span><div class="row"><button class="btn btn-sm btn-secondary" data-action="water" data-ml="-250" aria-label="Remove 250 millilitres">−</button><button class="btn btn-sm" data-action="water" data-ml="250">+250 ml</button></div></div>` : ''}
    <p class="xs muted" style="margin:10px 0 0">Targets are estimates${t.source === 'manual' ? ' you set yourself' : ''}, not medical advice. <a href="#/profile">Adjust</a></p>
  </section>

  ${p.isRest ? html`<section class="card" aria-labelledby="w-h"><h2 id="w-h">Rest day</h2><p class="muted">No workout is planned today. Rest helps your muscles recover and adapt. A walk or some light stretching is a nice extra if you feel like it.</p>
    ${d.isPast ? '' : html`<button class="btn btn-secondary btn-sm" data-action="train-anyway">Train today anyway</button>`}</section>`
  : html`<section class="card workout-card" aria-labelledby="w-h">
    <div class="card-head"><h2 id="w-h">${p.workout.name}</h2><span class="tag">${d.workoutStatus === 'completed' ? 'Completed' : `~${p.workout.estMinutes} min`}</span></div>
    <p class="muted small" style="margin-top:-4px">${p.workout.focus} · ${groupsText(p.workout.muscleGroups) || 'Whole body'} · ${p.workout.exercises.length} exercises</p>
    <ul class="list ex-list">${p.workout.exercises.map((x: any) => html`<li>
      <a class="ex-thumb" href="#/exercise/${x.exerciseId}" aria-label="How to do ${x.name}">${thumb(d.demos?.[x.exerciseId] ?? null)}</a>
      <div class="grow"><a href="#/exercise/${x.exerciseId}" style="color:var(--text);font-weight:600;text-decoration:none">${x.name}</a>
      <div class="small muted num">${prescriptionText(x)}${x.mode === 'weight_reps' && x.suggestedWeightKg ? ` @ ${wOut(x.suggestedWeightKg)} ${wUnit()}` : ''} · ${restText(x.restSec)}</div>
      ${d.lastPerformance[x.exerciseId] ? html`<div class="xs muted">Last time: ${d.lastPerformance[x.exerciseId]}</div>` : ''}</div></li>`)}</ul>
    ${d.isPast && d.workoutStatus !== 'completed' ? '' : d.workoutStatus === 'completed'
      ? html`<a class="btn btn-secondary btn-block" href="#/session/${d.sessionId}">View workout summary</a>`
      : html`<button class="btn btn-primary btn-block btn-lg" data-action="start">${d.workoutStatus === 'in_progress' ? 'Resume workout' : 'Start workout'}</button>`}
    ${!d.isPast && d.workoutStatus === 'not_started' ? html`<button class="btn btn-ghost btn-sm" style="margin-top:6px" data-action="skip-today">Make today a rest day</button>` : ''}
  </section>`}

  <section aria-labelledby="m-h" style="margin-top:22px">
    <div class="row between"><h2 id="m-h" style="margin:0">Today’s meals</h2><span class="small muted num">Plan: ${p.plannedTotals.kcal.toLocaleString('en-AU')} kcal · ${Math.round(p.plannedTotals.p)} g protein</span></div>
    ${p.meals.length ? '' : html`<p class="notice warn" style="margin-top:10px">No meals match all your preferences. Try relaxing an exclusion in your profile, or log foods in your diary.</p>`}
    ${p.meals.map((m: PlannedMeal) => {
      const logged = d.loggedSlots.includes(m.slot);
      return html`<article class="card meal${logged ? ' logged' : ''}" style="margin-top:10px" aria-label="${SLOT_LABEL[m.slot]}">
        <div class="row between"><span class="meal-slot">${SLOT_LABEL[m.slot]}</span>${logged ? html`<span class="tag accent">${icon('check', 14)} Logged</span>` : ''}</div>
        <h3 style="margin:0">${m.name}</h3>
        <div class="small muted">${m.portion === 1 ? '1 serving' : `${m.portion} servings`}${m.prepMin ? ` · ${m.prepMin} min` : ''}</div>
        <div class="macros"><span><b>${m.kcal}</b> kcal</span><span><b>${Math.round(m.p)}</b> g protein</span><span><b>${Math.round(m.c)}</b> g carbs</span><span><b>${Math.round(m.f)}</b> g fat</span></div>
        <div class="row"><a class="btn btn-sm btn-secondary" href="#/recipe/${m.recipeId}">View recipe</a>
        ${d.isPast ? '' : html`${logged ? '' : html`<button class="btn btn-sm btn-primary" data-action="log" data-slot="${m.slot}">Log meal</button>`}<button class="btn btn-sm btn-ghost" data-action="swap" data-slot="${m.slot}">${icon('swap', 16)} Swap</button>`}</div>
      </article>`;
    })}
  </section>

  <section class="card" aria-labelledby="c-h" style="margin-top:22px">
    <h2 id="c-h">Daily checklist</h2>
    <ul class="list checklist">${d.checklist.map((c: any) => html`<li>
      <button class="tick" data-action="tick" data-key="${c.key}" aria-pressed="${c.done ? 'true' : 'false'}" aria-label="${c.done ? 'Mark not done' : 'Mark done'}: ${c.label}">${c.done ? icon('check', 16) : ''}</button>
      <span class="${c.done ? 'done-label' : ''}">${c.label}${c.optional ? html` <span class="xs muted">(optional)</span>` : ''}</span></li>`)}</ul>
  </section>

  ${d.isPast ? '' : html`<div class="row" style="margin-top:16px"><button class="btn btn-ghost btn-sm" data-action="regen-meals">New meal suggestions</button><a class="btn btn-ghost btn-sm" href="#/train">Edit training plan</a></div>`}`.value;

  const reload = () => todayScreen(view, params);
  onActions(view, {
    start: async () => {
      await api.post('/api/sessions', { date });
      go('#/workout');
    },
    log: async (el) => {
      await api.post(`/api/plan/${date}/meals/${el.dataset.slot}/log`);
      toast(`${SLOT_LABEL[el.dataset.slot!]} logged`);
      await reload();
    },
    tick: async (el) => {
      const done = el.getAttribute('aria-pressed') !== 'true';
      await api.post(`/api/plan/${date}/checklist/${el.dataset.key}`, { done });
      await reload();
      $<HTMLElement>(`[data-key="${el.dataset.key}"]`, view)?.focus();
    },
    water: async (el) => {
      await api.post(`/api/hydration/${date}`, { addMl: Number(el.dataset.ml) });
      await reload();
    },
    'regen-meals': async () => {
      await api.post(`/api/plan/${date}/regenerate`, { part: 'meals' });
      toast('New meal suggestions ready. Logged meals are unchanged.');
      await reload();
    },
    'skip-today': async () => {
      await api.put(`/api/schedule/date/${date}`, { workoutId: null });
      toast('Today is now a rest day.');
      await reload();
    },
    'train-anyway': async () => {
      const prog = await api.get<any>('/api/program');
      const close = sheet('Choose a workout', html`<ul class="list">${prog.workouts.map((w: any) => html`<li><button class="btn btn-secondary btn-block" data-w="${w.id}">${w.name} <span class="muted small">· ${w.exercises.length} exercises</span></button></li>`)}</ul>`, (el) => {
        el.querySelectorAll<HTMLElement>('[data-w]').forEach((b) => b.addEventListener('click', async () => {
          await api.put(`/api/schedule/date/${date}`, { workoutId: b.dataset.w });
          close();
          await reload();
        }));
      });
    },
    swap: async (el) => {
      const slot = el.dataset.slot!;
      const options = await api.get<PlannedMeal[]>(`/api/plan/${date}/meals/${slot}/swaps`);
      const current = p.meals.find((m: PlannedMeal) => m.slot === slot);
      const close = sheet(`Swap ${SLOT_LABEL[slot].toLowerCase()}`, html`
        <p class="small muted">Options portioned to about ${current ? kcal(current.kcal) : 'the same calories'}. Your daily targets stay the same.</p>
        ${options.length ? html`<ul class="list">${options.map((o) => html`<li><button class="choice" style="width:100%" data-r="${o.recipeId}"><strong>${o.name}</strong>
          <span class="small muted num">${o.portion === 1 ? '1 serving' : `${o.portion} servings`} · ${o.kcal} kcal · ${Math.round(o.p)} g protein · ${Math.round(o.c)} g carbs · ${Math.round(o.f)} g fat</span></button></li>`)}</ul>`
        : html`<p class="empty">No other recipes fit this meal with your current preferences.</p>`}`, (s) => {
        s.querySelectorAll<HTMLElement>('[data-r]').forEach((b) => b.addEventListener('click', async () => {
          b.setAttribute('aria-busy', 'true');
          await api.post(`/api/plan/${date}/meals/${slot}/swap`, { recipeId: b.dataset.r });
          close();
          toast('Meal swapped');
          await reload();
        }));
      });
      void close;
    },
  });
  void raw;
}
