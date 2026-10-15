// Workout planner: weekly schedule, workouts (create, edit, duplicate, reorder), programs and history.
import { api } from '../api.js';
import { go, state } from '../app.js';
import { confirmSheet, html, numOrNull, onActions, raw, sheet, toast } from '../dom.js';
import { shortDate, wIn, wOut, wUnit } from '../format.js';
import { WEEKDAY_NAMES } from '../../core/util.js';
import { icon } from '../ui.js';
import { figureSVG, respectReducedMotion } from '../visuals/figure.js';
import { exerciseTile, figureFor, loadVisuals } from '../visuals/assets.js';

const COVER: Record<string, { code: string; ex: string; hue: string; level: string }> = {
  beginner3: { code: 'START', ex: 'goblet-squat', hue: '#1f3b2a', level: 'Beginner' },
  full3: { code: 'FULL', ex: 'barbell-back-squat', hue: '#203046', level: 'Beg – Int' },
  home_db: { code: 'HOME', ex: 'dumbbell-bench-press', hue: '#3d2c1c', level: 'Beg – Int' },
  upper_lower4: { code: 'U/L', ex: 'barbell-bench-press', hue: '#2f2140', level: 'Intermediate' },
  hypertrophy4: { code: 'GROW', ex: 'incline-dumbbell-press', hue: '#3f1f25', level: 'Intermediate' },
  ppl6: { code: 'PPL', ex: 'pull-up', hue: '#16363a', level: 'Int – Adv' },
  strength4: { code: 'STR', ex: 'conventional-deadlift', hue: '#3a3416', level: 'Int – Adv' },
  fatloss4: { code: 'LEAN', ex: 'kettlebell-swing', hue: '#40221a', level: 'All levels' },
};

/** Cover art for a program: brand gradient, a large movement figure and a bold short code. */
export function programCover(templateId: string, name: string) {
  const c = COVER[templateId] ?? { code: 'KYVO', ex: 'push-up', hue: '#262626', level: '' };
  const fig = figureFor(c.ex);
  return html`<div class="prog-cover" style="background:radial-gradient(120% 100% at 80% 0%, ${c.hue} 0%, #141414 75%)" aria-hidden="true">
    ${fig ? raw(figureSVG(fig, { label: name, animate: false, t: 1, className: 'cover-fig' })) : ''}
    <span class="cover-code">${c.code}</span><span class="cover-mark">KYVO</span></div>`;
}

export async function trainScreen(view: HTMLElement) {
  const [prog, active] = await Promise.all([api.get<any>('/api/program'), api.get<any>('/api/sessions/active'), loadVisuals()]);
  const days = [1, 2, 3, 4, 5, 6, 0];
  const me = state.me!;
  const currentTpl = prog.workouts.find((w: any) => w.template_id)?.template_id ?? prog.templatePref ?? null;
  const trainDays = days.filter((d) => prog.schedule[d]).length;
  const card = (t: any, current: boolean) => html`<article class="prog-card${current ? ' current' : ''}">
    <button class="prog-main" style="all:unset;display:flex;gap:14px;padding:14px;cursor:pointer;width:calc(100% - 28px)" data-action="pick" data-t="${t.id}" ${t.locked ? 'data-locked="1"' : ''} aria-label="${current ? 'Current program' : 'Switch to'} ${t.name}${t.locked ? ' (Premium)' : ''}">
      <span style="position:relative">${t.locked ? html`<span class="prog-badge pro">PREMIUM</span>` : html`<span class="prog-badge">FREE</span>`}${programCover(t.id, t.name)}</span>
      <span class="prog-body"><span class="pt">${t.name}</span><span class="by">KYVO program</span>
        <span class="prog-chips"><span>${COVER[t.id]?.level ?? 'All levels'}</span><span>${t.days} days a week</span></span></span></button>
    <div class="prog-foot"><span>${current ? html`<b>Your program</b> · ${trainDays} training days scheduled` : t.description}</span></div></article>`;

  view.innerHTML = html`<nav class="head-tabs" aria-label="Train sections"><a href="#/train" aria-current="page">Train</a><a href="#/library">Library</a><a href="#/train/history">History</a><span class="spacer"></span>${me.premium ? '' : html`<a class="pro-pill" href="#/premium">Try <b>PRO</b></a>`}</nav>
  ${active ? html`<div class="notice" style="margin-bottom:14px">You have a workout in progress. <a href="#/workout">Resume it</a></div>` : ''}
  <section aria-labelledby="wo-h"><div class="row between"><h2 id="wo-h" style="margin:0">Your workouts</h2><a class="btn btn-ghost btn-sm" href="#/train/workout/new">${icon('plus', 16)} New</a></div>
    ${prog.workouts.map((w: any) => html`<article class="card" style="margin-top:10px"><div class="next-top">${w.exercises[0] ? raw(exerciseTile(w.exercises[0].exerciseId, w.exercises[0].name)) : ''}<div style="min-width:0;flex:1">
      <div class="next-eyebrow">${w.source === 'custom' ? 'Custom workout' : 'Program workout'}</div><h3 style="margin:2px 0 0;font-size:18px">${w.name}</h3><p class="small muted" style="margin:2px 0 0">${w.focus || `${w.exercises.length} exercises`}</p></div></div>
      <p class="small muted" style="margin:10px 0 12px">${w.exercises.map((x: any) => x.name).join(' · ')}</p>
      <div class="row"><button class="btn btn-sm btn-primary" data-action="start" data-id="${w.id}">${icon('play', 14)} Start</button><a class="btn btn-sm btn-secondary" href="#/train/workout/${w.id}">Edit</a><button class="btn btn-sm btn-ghost" data-action="wmore" data-id="${w.id}" aria-label="More actions for ${w.name}">•••</button><button hidden data-action="dup" data-hidden-action="dup" data-id="${w.id}"></button><button hidden data-action="del" data-hidden-action="del" data-id="${w.id}"></button></div></article>`)}
  </section>
  <section aria-labelledby="pg-h" style="margin-top:24px"><div class="row between"><h2 id="pg-h" style="margin:0">Programs</h2><button class="btn btn-ghost btn-sm" data-action="program">Recommended for me</button></div>
    <p class="small muted" style="margin:4px 0 0">Every program adapts to your equipment, experience and training days.</p>
    ${[...prog.templates].sort((a: any, b: any) => (a.id === currentTpl ? -1 : b.id === currentTpl ? 1 : 0)).map((t: any) => card(t, t.id === currentTpl))}
  </section>
  <section class="card" aria-labelledby="wk-h" style="margin-top:20px"><h2 id="wk-h">Your week</h2>
    <ul class="list">${days.map((d) => html`<li class="row between"><label for="day-${d}" style="margin:0;min-width:110px">${WEEKDAY_NAMES[d]}</label>
      <select id="day-${d}" data-day="${d}" style="max-width:260px"><option value="">Rest day</option>${prog.workouts.map((w: any) => html`<option value="${w.id}" ${prog.schedule[d] === w.id ? 'selected' : ''}>${w.name}</option>`)}</select></li>`)}</ul>
    <p class="xs muted">Changes apply from today. Past days and your history are never changed.</p></section>`.value;
  respectReducedMotion(view);

  view.querySelectorAll<HTMLSelectElement>('select[data-day]').forEach((s) => s.addEventListener('change', async () => {
    try {
      await api.put(`/api/schedule/${s.dataset.day}`, { workoutId: s.value || null });
      toast(`${WEEKDAY_NAMES[Number(s.dataset.day)]} updated`);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }));
  onActions(view, {
    pick: async (el) => {
      if (el.dataset.locked) return go('#/premium');
      if (el.dataset.t === currentTpl) return;
      if (!(await confirmSheet('Switch program?', 'KYVO builds new workouts for this program from today. Your custom workouts and history are kept.', 'Switch program'))) return;
      await api.post('/api/program/generate', { templateId: el.dataset.t });
      toast('New program ready');
      await trainScreen(view);
    },
    start: async (el) => {
      await api.post('/api/sessions', { workoutId: el.dataset.id });
      go('#/workout');
    },
    wmore: (el) => {
      const w = prog.workouts.find((x: any) => x.id === el.dataset.id);
      const close = sheet(w.name, html`<div class="row"><button class="btn btn-secondary" data-m="dup">Duplicate</button><button class="btn btn-danger" data-m="del">Delete</button></div>`, (sh) => {
        sh.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', () => {
          close();
          view.querySelector<HTMLElement>(`[data-hidden-action="${b.dataset.m}"][data-id="${w.id}"]`)?.click();
        }));
      });
    },
    dup: async (el) => {
      await api.post(`/api/workouts/${el.dataset.id}/duplicate`);
      toast('Workout duplicated');
      await trainScreen(view);
    },
    del: async (el) => {
      if (!(await confirmSheet('Delete this workout?', 'It will be removed from your schedule. Completed sessions stay in your history.', 'Delete', true))) return;
      await api.del(`/api/workouts/${el.dataset.id}`);
      await trainScreen(view);
    },
    program: () => {
      const close = sheet('Choose a program', html`<p class="small muted">KYVO builds new workouts from your equipment, experience and schedule. Your custom workouts and history are kept.</p>
        <button class="choice" style="width:100%;margin-bottom:8px" data-t="auto"><strong>Recommended for me</strong><span class="small muted">Picks the best fit for your goal and training days.</span></button>
        ${prog.templates.map((t: any) => html`<button class="choice" style="width:100%;margin-bottom:8px" data-t="${t.id}" ${t.locked ? 'disabled' : ''}><strong>${t.name}${t.locked ? ' · Premium' : ''}</strong><span class="small muted">${t.description}</span></button>`)}`, (sh) => {
        sh.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', async () => {
          try {
            await api.post('/api/program/generate', b.dataset.t === 'auto' ? {} : { templateId: b.dataset.t });
            close();
            toast('New program ready');
            await trainScreen(view);
          } catch (e) {
            toast((e as Error).message, 'err');
          }
        }));
      });
    },
  });
}

export async function editWorkoutScreen(view: HTMLElement, params: string[]) {
  const isNew = params[0] === 'new';
  const prog = await api.get<any>('/api/program');
  const w = isNew ? { name: '', focus: '', exercises: [] as any[] } : prog.workouts.find((x: any) => x.id === params[0]);
  if (!w) return go('#/train');
  const list = w.exercises.map((x: any) => ({ ...x }));

  function draw() {
    view.innerHTML = html`<p class="muted small"><a href="#/train">‹ Train</a></p><h1>${isNew ? 'New workout' : 'Edit workout'}</h1>
    <div class="card"><div class="field"><label for="wn">Name</label><input id="wn" value="${w.name}" maxlength="60" required></div>
    <div class="field"><label for="wf">Focus <span class="muted">(optional)</span></label><input id="wf" value="${w.focus}" maxlength="80"></div></div>
    ${list.map((x: any, i: number) => html`<section class="card" data-i="${i}"><div class="card-head"><h3 style="margin:0">${i + 1}. ${x.name}</h3>
      <div class="row"><button class="btn btn-ghost btn-sm" data-action="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn btn-ghost btn-sm" data-action="down" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="btn btn-ghost btn-sm" data-action="remove" aria-label="Remove ${x.name}">✕</button></div></div>
      <div class="row">
        <div class="field" style="width:90px"><label>Sets</label><input type="number" min="1" max="10" data-k="sets" value="${x.sets}"></div>
        <div class="field" style="width:90px"><label>${x.mode === 'time' ? 'Min s' : 'Min reps'}</label><input type="number" min="1" data-k="repMin" value="${x.repMin}"></div>
        <div class="field" style="width:90px"><label>${x.mode === 'time' ? 'Max s' : 'Max reps'}</label><input type="number" min="1" data-k="repMax" value="${x.repMax}"></div>
        <div class="field" style="width:90px"><label>Rest (s)</label><input type="number" min="0" max="600" data-k="restSec" value="${x.restSec}"></div>
        ${x.mode === 'weight_reps' ? html`<div class="field" style="width:110px"><label>Weight (${wUnit()})</label><input type="number" min="0" step="0.5" data-k="weightKg" value="${x.weightKg == null ? '' : wOut(x.weightKg)}" placeholder="auto"></div>` : ''}
      </div></section>`)}
    <button class="btn btn-secondary" data-action="add" style="margin-top:12px">+ Add exercise</button>
    <div class="row" style="margin-top:18px"><button class="btn btn-primary" data-action="save">Save workout</button><a class="btn btn-ghost" href="#/train">Cancel</a></div>`.value;
  }
  function read() {
    w.name = (view.querySelector<HTMLInputElement>('#wn')!.value || '').trim();
    w.focus = (view.querySelector<HTMLInputElement>('#wf')!.value || '').trim();
    view.querySelectorAll<HTMLElement>('[data-i]').forEach((sec) => {
      const x = list[Number(sec.dataset.i)];
      sec.querySelectorAll<HTMLInputElement>('[data-k]').forEach((inp) => {
        const v = numOrNull(inp.value);
        x[inp.dataset.k!] = inp.dataset.k === 'weightKg' ? wIn(v) : v ?? x[inp.dataset.k!];
      });
    });
  }
  onActions(view, {
    up: (el) => { read(); const i = Number(el.closest<HTMLElement>('[data-i]')!.dataset.i); [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); },
    down: (el) => { read(); const i = Number(el.closest<HTMLElement>('[data-i]')!.dataset.i); [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); },
    remove: (el) => { read(); list.splice(Number(el.closest<HTMLElement>('[data-i]')!.dataset.i), 1); draw(); },
    add: () => {
      read();
      pickExercise((ex) => {
        list.push({ exerciseId: ex.id, name: ex.name, sets: 3, repMin: ex.logging === 'time' ? 20 : 8, repMax: ex.logging === 'time' ? 45 : 12, restSec: 90, mode: ex.logging, rir: '1-3', weightKg: null });
        draw();
      });
    },
    save: async () => {
      read();
      if (!w.name) return toast('Give the workout a name.', 'err');
      const body = { name: w.name, focus: w.focus, exercises: list.map(({ name: _n, ...x }: any) => x) };
      if (isNew) await api.post('/api/workouts', body);
      else await api.put(`/api/workouts/${params[0]}`, body);
      toast('Workout saved');
      go('#/train');
    },
  });
  draw();
}

/** Search sheet for choosing an exercise (with the logging mode needed for prescriptions). */
export function pickExercise(onPick: (ex: { id: string; name: string; logging: string }) => void) {
  const close = sheet('Add exercise', html`<input type="search" placeholder="Search 170 exercises" aria-label="Search exercises" id="pq"><ul class="list" id="pr" style="margin-top:10px"></ul>`, (sh) => {
    const q = sh.querySelector<HTMLInputElement>('#pq')!;
    const res = sh.querySelector<HTMLElement>('#pr')!;
    const search = async () => {
      const r = await api.get<any>(`/api/exercises?q=${encodeURIComponent(q.value)}`);
      res.innerHTML = html`${r.exercises.slice(0, 40).map((x: any) => html`<li><button class="btn btn-secondary btn-block" data-id="${x.id}" ${x.locked ? 'disabled' : ''}>${x.name}${x.locked ? ' (Premium)' : ''}</button></li>`)}`.value;
      res.querySelectorAll<HTMLElement>('[data-id]').forEach((b) => b.addEventListener('click', async () => {
        const d = await api.get<any>(`/api/exercises/${b.dataset.id}`);
        close();
        onPick({ id: d.id, name: d.name, logging: d.logging });
      }));
    };
    let t: number;
    q.addEventListener('input', () => {
      clearTimeout(t);
      t = window.setTimeout(search, 200);
    });
    void search();
  });
}

export async function historyScreen(view: HTMLElement) {
  const list = await api.get<any[]>('/api/sessions');
  view.innerHTML = html`<nav class="head-tabs" aria-label="Train sections"><a href="#/train">Train</a><a href="#/library">Library</a><a href="#/train/history" aria-current="page">History</a></nav><h1 class="sr-only">Workout history</h1>
  ${state.me?.premium ? '' : html`<p class="small muted">Free accounts show the last 90 days. <a href="#/premium">Premium</a> keeps your full history.</p>`}
  ${list.length ? html`<ul class="list card">${list.map((s) => html`<li><a href="#/session/${s.id}" class="row between" style="color:var(--text);text-decoration:none"><span><b>${s.name}</b><br><span class="small muted">${shortDate(s.date)} · ${s.sets} sets · ${wOut(s.volumeKg)} ${wUnit()}</span></span>${s.records ? html`<span class="tag accent">🏆 ${s.records}</span>` : ''}</a></li>`)}</ul>`
  : html`<div class="card empty">No completed workouts yet. Your first one will show up here.</div>`}`.value;
}
