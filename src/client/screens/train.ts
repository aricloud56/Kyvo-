// Workout planner: weekly schedule, workouts (create, edit, duplicate, reorder), programs and history.
import { api } from '../api.js';
import { go, state } from '../app.js';
import { confirmSheet, html, numOrNull, onActions, sheet, toast } from '../dom.js';
import { prescriptionText, shortDate, wIn, wOut, wUnit } from '../format.js';
import { WEEKDAY_NAMES } from '../../core/util.js';

export async function trainScreen(view: HTMLElement) {
  const prog = await api.get<any>('/api/program');
  const active = await api.get<any>('/api/sessions/active');
  const days = [1, 2, 3, 4, 5, 6, 0];
  view.innerHTML = html`<h1>Train</h1>
  ${active ? html`<div class="notice" style="margin-bottom:14px">You have a workout in progress. <a href="#/workout">Resume it</a></div>` : ''}
  <div class="row" style="margin-bottom:14px"><a class="btn btn-secondary btn-sm" href="#/library">Exercise library</a><a class="btn btn-secondary btn-sm" href="#/train/history">History</a><a class="btn btn-secondary btn-sm" href="#/train/workout/new">+ New workout</a></div>
  <section class="card" aria-labelledby="wk-h"><h2 id="wk-h">Your week</h2>
    <ul class="list">${days.map((d) => html`<li class="row between"><label for="day-${d}" style="margin:0;min-width:110px">${WEEKDAY_NAMES[d]}</label>
      <select id="day-${d}" data-day="${d}" style="max-width:260px"><option value="">Rest day</option>${prog.workouts.map((w: any) => html`<option value="${w.id}" ${prog.schedule[d] === w.id ? 'selected' : ''}>${w.name}</option>`)}</select></li>`)}</ul>
    <p class="xs muted">Changes apply from today. Past days and your history are never changed.</p></section>
  <section style="margin-top:20px" aria-labelledby="wo-h"><div class="row between"><h2 id="wo-h" style="margin:0">Workouts</h2><button class="btn btn-ghost btn-sm" data-action="program">Change program</button></div>
    ${prog.workouts.map((w: any) => html`<article class="card" style="margin-top:10px"><div class="card-head"><h3 style="margin:0">${w.name}</h3><span class="tag">${w.source === 'custom' ? 'Custom' : 'Program'}</span></div>
      <p class="small muted">${w.focus}</p>
      <ol class="small" style="padding-left:20px;margin:6px 0 10px">${w.exercises.map((x: any) => html`<li>${x.name} <span class="muted num">${prescriptionText(x)}</span></li>`)}</ol>
      <div class="row"><button class="btn btn-sm btn-primary" data-action="start" data-id="${w.id}">Start now</button><a class="btn btn-sm btn-secondary" href="#/train/workout/${w.id}">Edit</a><button class="btn btn-sm btn-ghost" data-action="dup" data-id="${w.id}">Duplicate</button><button class="btn btn-sm btn-ghost" data-action="del" data-id="${w.id}">Delete</button></div></article>`)}
  </section>`.value;

  view.querySelectorAll<HTMLSelectElement>('select[data-day]').forEach((s) => s.addEventListener('change', async () => {
    try {
      await api.put(`/api/schedule/${s.dataset.day}`, { workoutId: s.value || null });
      toast(`${WEEKDAY_NAMES[Number(s.dataset.day)]} updated`);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }));
  onActions(view, {
    start: async (el) => {
      await api.post('/api/sessions', { workoutId: el.dataset.id });
      go('#/workout');
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
  view.innerHTML = html`<p class="muted small"><a href="#/train">‹ Train</a></p><h1>Workout history</h1>
  ${state.me?.premium ? '' : html`<p class="small muted">Free accounts show the last 90 days. <a href="#/premium">Premium</a> keeps your full history.</p>`}
  ${list.length ? html`<ul class="list card">${list.map((s) => html`<li><a href="#/session/${s.id}" class="row between" style="color:var(--text);text-decoration:none"><span><b>${s.name}</b><br><span class="small muted">${shortDate(s.date)} · ${s.sets} sets · ${wOut(s.volumeKg)} ${wUnit()}</span></span>${s.records ? html`<span class="tag accent">🏆 ${s.records}</span>` : ''}</a></li>`)}</ul>`
  : html`<div class="card empty">No completed workouts yet. Your first one will show up here.</div>`}`.value;
}
