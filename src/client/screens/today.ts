// The KYVO Daily Plan: greeting, today's progress, workout, meals, checklist and end-of-day summary.
import { api } from '../api.js';
import { go, state } from '../app.js';
import { $, html, onActions, raw, sheet, toast } from '../dom.js';
import { icon, meter, ring } from '../ui.js';
import { assetUrl, exerciseTile, loadVisuals, recipePhoto } from '../visuals/assets.js';
import { respectReducedMotion } from '../visuals/figure.js';
import { GOAL_LABEL, SLOT_LABEL, longDate, wOut, wUnit, kcal } from '../format.js';
import { WEEKDAY_NAMES, addDays, weekdayOf } from '../../core/util.js';
import type { PlannedMeal } from '../../core/types.js';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export async function todayScreen(view: HTMLElement, params: string[]) {
  const me = state.me!;
  const date = params[0] ?? me.today;
  const [d] = await Promise.all([api.get<any>(`/api/plan/${date}`), loadVisuals()]);
  const [prog, metrics, photos] = await Promise.all([
    d.plan.isRest ? api.get<any>('/api/program').catch(() => null) : Promise.resolve(null),
    api.get<any>('/api/progress?days=30').catch(() => null),
    api.get<any[]>('/api/photos').catch(() => []),
  ]);
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
  <header class="greet kyvo-today-hero">
    <div class="row between"><p class="muted small" style="margin:0">${longDate(date)}${d.isToday ? '' : d.isPast ? ' · past day' : ' · upcoming'}</p>
      <nav class="row" aria-label="Change day"><a class="btn btn-ghost btn-sm" href="#/day/${addDays(date, -1)}" aria-label="Previous day">‹</a>${d.isToday ? '' : html`<a class="btn btn-ghost btn-sm" href="#/today">Today</a>`}<a class="btn btn-ghost btn-sm" href="#/day/${addDays(date, 1)}" aria-label="Next day">›</a></nav></div>
    <h1>${d.isToday ? `${greeting()}${name}` : `Plan for ${longDate(date).split(',')[0]}`}</h1>
    <p class="muted" style="margin:0">${message}</p>
    <div class="goal-pill"><span class="tag accent">Goal: ${GOAL_LABEL[d.goal] ?? d.goal}</span>${me.premium ? html`<span class="tag">Premium</span>` : ''}</div>
  </header>

  ${nextCard(d, prog)}

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

  <section class="card kyvo-today-progress" aria-labelledby="prog-h" style="margin-top:16px">
    <div class="card-head"><h2 id="prog-h">Today’s progress</h2><a class="small" href="#/nutrition/${date}">Food diary</a></div>
    <div class="progress-row">
      ${ring(d.eaten.kcal, t.kcal, Math.round(d.eaten.kcal).toLocaleString('en-AU'), `of ${t.kcal.toLocaleString('en-AU')} kcal`, 'Calories eaten')}
      <div class="macro-bars">${meter(d.eaten.p, t.proteinG, 'Protein')}${meter(d.eaten.c, t.carbsG, 'Carbs')}${meter(d.eaten.f, t.fatG, 'Fat')}</div>
    </div>
    <div class="mini-stats"><div><b>${workoutLabel}</b>Workout</div><div><b>${mealsLogged}/3</b>Meals logged</div><div><b>${tasksDone}/${required.length}</b>Tasks</div></div>
    ${d.hydrationEnabled ? html`<div class="row between" style="margin-top:12px"><span class="small muted">Water: <b class="num" style="color:var(--text)">${String(Math.round(d.hydrationMl / 50) / 20)} L</b> of ${String(Math.round(d.hydrationTargetMl / 50) / 20)} L</span><div class="row"><button class="btn btn-sm btn-secondary" data-action="water" data-ml="-250" aria-label="Remove 250 millilitres">−</button><button class="btn btn-sm" data-action="water" data-ml="250">+250 ml</button></div></div>` : ''}
    <p class="xs muted" style="margin:10px 0 0">Targets are estimates${t.source === 'manual' ? ' you set yourself' : ''}, not medical advice. <a href="#/profile">Adjust</a></p>
  </section>

  ${quickActions(date, metrics, photos)}

  <section aria-labelledby="m-h" style="margin-top:22px">
    <div class="row between"><h2 id="m-h" style="margin:0">Today’s meals</h2><span class="small muted num">Plan: ${p.plannedTotals.kcal.toLocaleString('en-AU')} kcal · ${Math.round(p.plannedTotals.p)} g protein</span></div>
    ${p.meals.length ? '' : html`<p class="notice warn" style="margin-top:10px">No meals match all your preferences. Try relaxing an exclusion in your profile, or log foods in your diary.</p>`}
    ${p.meals.map((m: PlannedMeal) => {
      const logged = d.loggedSlots.includes(m.slot);
      return html`<article class="card meal${logged ? ' logged' : ''}" style="margin-top:10px" aria-label="${SLOT_LABEL[m.slot]}">
        <div class="meal-row">${mealThumb(m.recipeId, m.name)}<div class="grow" style="min-width:0">
        <div class="row between"><span class="meal-slot">${SLOT_LABEL[m.slot]}</span>${logged ? html`<span class="tag accent">${icon('check', 14)} Logged</span>` : ''}</div>
        <h3 style="margin:0">${m.name}</h3>
        <div class="small muted">${m.portion === 1 ? '1 serving' : `${m.portion} servings`}${m.prepMin ? ` · ${m.prepMin} min` : ''}</div></div></div>
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

  respectReducedMotion(view);
  const reload = () => todayScreen(view, params);
  onActions(view, {
    more: (el) => {
      const hidden = view.querySelectorAll<HTMLElement>('.plan-rows li[hidden], .plan-rows li.extra');
      const open = el.getAttribute('aria-expanded') !== 'true';
      hidden.forEach((li) => {
        li.classList.add('extra');
        li.hidden = !open;
      });
      el.setAttribute('aria-expanded', String(open));
      el.innerHTML = open ? 'Show less ▴' : `Show ${hidden.length} more ▾`;
    },
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

function mealThumb(recipeId: string, name: string) {
  const ph = recipePhoto(recipeId);
  return ph ? html`<img class="meal-thumb" src="${assetUrl(ph.file)}" alt="" loading="lazy" title="Serving suggestion: ${name}">` : html`<span class="meal-thumb ph" aria-hidden="true">${icon('food', 26)}</span>`;
}

function weekBar(d: any) {
  const w = d.week;
  if (!w || !w.planned) return '';
  const pct = Math.min(100, Math.round((w.done / w.planned) * 100));
  return html`<div class="bar-row"><div class="bar" role="progressbar" aria-label="Workouts this week" aria-valuemin="0" aria-valuemax="${w.planned}" aria-valuenow="${w.done}"><span style="width:${pct}%"></span></div><b>${pct}%</b></div>
    <div class="xs muted">${w.done} of ${w.planned} workouts done this week</div>`;
}

/** The "Next up" card: today's workout, or on a rest day the next scheduled one. */
function nextCard(d: any, prog: any) {
  const p = d.plan;
  const w = d.week ?? { week: 1, day: null };
  if (!p.isRest) {
    const ex = p.workout.exercises;
    const first = ex[0];
    const status = d.workoutStatus;
    const eyebrow = status === 'completed' ? 'Completed today' : `${d.isToday ? 'Today' : 'Planned'} · Week ${w.week}${w.day ? ` · Day ${w.day}` : ''}`;
    return html`<section class="next-card" aria-labelledby="w-h">
      <div class="next-top">${first ? raw(exerciseTile(first.exerciseId, first.name)) : ''}<div style="min-width:0">
        <div class="next-eyebrow">${eyebrow}</div><h2 class="next-title" id="w-h">${p.workout.name}</h2>
        <div class="next-sub">${d.programName ?? p.workout.focus} · about ${p.workout.estMinutes} min</div></div></div>
      ${weekBar(d)}
      <ul class="plan-rows">${ex.map((x: any, i: number) => html`<li ${i >= 3 ? 'hidden' : ''}><a href="#/exercise/${x.exerciseId}"><span class="nm">${x.name}</span></a>
        <span class="rx">${rxText(x)}</span></li>`)}</ul>
      ${ex.length > 3 ? html`<button class="more-btn" data-action="more" aria-expanded="false">Show ${ex.length - 3} more ▾</button>` : ''}
      ${d.isPast && status !== 'completed' ? '' : status === 'completed'
        ? html`<a class="btn btn-secondary btn-block btn-start" href="#/session/${d.sessionId}">View workout summary</a>`
        : html`<button class="btn btn-primary btn-start" data-action="start">${icon('play', 20)} ${status === 'in_progress' ? 'Resume workout' : 'Start workout'}</button>`}
      ${!d.isPast && status === 'not_started' ? html`<button class="btn btn-ghost btn-sm" style="margin-top:6px" data-action="skip-today">Make today a rest day</button>` : ''}
    </section>`;
  }
  const next = prog ? nextScheduled(d.date, prog) : null;
  return html`<section class="next-card" aria-labelledby="w-h">
    <div class="next-top"><div class="fig-tile" style="display:grid;place-items:center;color:#1c1c1c">${icon('today', 34)}</div><div>
      <div class="next-eyebrow">Rest day · Week ${w.week}</div><h2 class="next-title" id="w-h">Recover and recharge</h2>
      <div class="next-sub">${next ? `Next up: ${next.name}, ${next.when}` : 'No workout is planned today.'}</div></div></div>
    ${weekBar(d)}
    <p class="small muted" style="margin:12px 0 0">Rest helps your muscles recover and adapt. A walk or light stretching is a nice extra if you feel like it.</p>
    ${next ? html`<ul class="plan-rows">${next.exercises.slice(0, 3).map((x: any) => html`<li><a href="#/exercise/${x.exerciseId}"><span class="nm">${x.name}</span></a><span class="rx">${rxText(x)}</span></li>`)}</ul>` : ''}
    ${d.isPast ? '' : html`<button class="btn btn-secondary btn-block btn-start" data-action="train-anyway">${icon('play', 18)} Train today anyway</button>`}
  </section>`;
}

const rxText = (x: any) => {
  const reps = x.repMin === x.repMax ? `${x.repMin}` : `${x.repMin}-${x.repMax}`;
  return raw(`<b>${x.sets}</b> sets · <b>${reps}</b> ${x.mode === 'time' ? 's' : 'reps'}`);
};

function nextScheduled(date: string, prog: any): { name: string; when: string; exercises: any[] } | null {
  for (let i = 1; i <= 7; i++) {
    const day = addDays(date, i);
    const o = prog.overrides?.find((x: any) => x.date === day);
    const id = o ? o.workoutId : prog.schedule[weekdayOf(day)];
    const w = id && prog.workouts.find((x: any) => x.id === id);
    if (w) return { name: w.name, when: i === 1 ? 'tomorrow' : `on ${WEEKDAY_NAMES[weekdayOf(day)]}`, exercises: w.exercises };
  }
  return null;
}

function spark(points: { date: string; value: number }[]) {
  if (points.length < 2) return '';
  const ys = points.map((p) => p.value), mid = (Math.min(...ys) + Math.max(...ys)) / 2, span = Math.max(Math.max(...ys) - Math.min(...ys), 3), min = mid - span / 2;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * 200, 8 + (1 - (p.value - min) / span) * 54]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return raw(`<svg class="spark" viewBox="0 0 200 70" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="${line}L200,70L0,70Z" fill="url(#spk)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`);
}

function quickActions(date: string, metrics: any, photos: any[]) {
  const pts = metrics?.trend?.length ? metrics.trend : metrics?.weights ?? [];
  const last = metrics?.weights?.length ? metrics.weights[metrics.weights.length - 1] : null;
  return html`<h2 class="section-label">Quick actions</h2>
  <div class="quick-grid">
    <a class="quick wide" href="#/nutrition/${date}">${icon('food', 22)} Log food</a>
    <a class="quick" href="#/library">${icon('folder', 22)} Exercise library</a>
    <a class="quick" href="#/train/workout/new">${icon('pencil', 22)} Create workout</a>
    <a class="quick tall" href="#/progress" aria-label="Body weight${last ? `: ${wOut(last.value)} ${wUnit()}` : ''}. Open progress"><span class="qh">${icon('scale', 22)} Bodyweight</span>
      ${last ? html`<span class="small muted num">${wOut(last.value)} ${wUnit()}</span>` : html`<span class="small muted">Log your first weigh-in</span>`}${spark(pts)}</a>
    <a class="quick tall" href="#/progress#photos"><span class="qh">${icon('camera', 22)} Progress pics</span>
      <span class="photo-slots">${[0, 1, 2, 3].map((i) => (photos[i] && !api.demo ? html`<span><img src="/api/photos/${photos[i].id}/image" alt="" loading="lazy"></span>` : html`<span></span>`))}</span></a>
  </div>`;
}
