// Exercise library: search, filters, favourites and the exercise detail page.
import { api } from '../api.js';
import { lockedCard } from '../app.js';
import { html, onActions, raw, sheet, toast } from '../dom.js';
import { EQUIPMENT_LABEL, GROUP_LABEL, groupsText, shortDate, wOut, wUnit } from '../format.js';
import { icon } from '../ui.js';

const STEP_LABEL: Record<string, string> = {
  start: 'Starting position', setup: 'Equipment setup', feet: 'Feet', grip: 'Grip or hand position', posture: 'Posture', brace: 'Brace',
  initiate: 'Start the movement', concentric: 'Lifting phase', breathing: 'Breathing', eccentric: 'Lowering phase', rom: 'Range of motion',
  tempo: 'Tempo', finish: 'Finish', exit: 'Re-rack or exit safely',
};
const DIFFICULTY = ['beginner', 'intermediate', 'advanced'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const filters = { q: '', group: '', equipment: '', difficulty: '', favourites: false };

export async function libraryScreen(view: HTMLElement) {
  view.innerHTML = html`<p class="muted small"><a href="#/train">‹ Train</a></p><h1>Exercise library</h1>
  <div class="card" role="search">
    <input type="search" id="lq" placeholder="Search by name, e.g. bench press" aria-label="Search exercises" value="${filters.q}">
    <div class="row" style="margin-top:10px">
      <select id="lg" aria-label="Muscle group" style="flex:1;min-width:140px"><option value="">All muscle groups</option>${Object.entries(GROUP_LABEL).map(([k, v]) => html`<option value="${k}" ${filters.group === k ? 'selected' : ''}>${v}</option>`)}</select>
      <select id="le" aria-label="Equipment" style="flex:1;min-width:140px"><option value="">Any equipment</option>${Object.entries(EQUIPMENT_LABEL).map(([k, v]) => html`<option value="${k}" ${filters.equipment === k ? 'selected' : ''}>${v}</option>`)}</select>
      <select id="ld" aria-label="Difficulty" style="flex:1;min-width:120px"><option value="">Any level</option>${DIFFICULTY.map((d) => html`<option value="${d}" ${filters.difficulty === d ? 'selected' : ''}>${cap(d)}</option>`)}</select>
    </div>
    <label class="check" style="margin-top:8px"><input type="checkbox" id="lf" ${filters.favourites ? 'checked' : ''}> Favourites only</label>
  </div>
  <p class="small muted" id="lcount" aria-live="polite"></p>
  <ul class="list card" id="lres"></ul>`.value;

  const res = view.querySelector<HTMLElement>('#lres')!;
  const count = view.querySelector<HTMLElement>('#lcount')!;
  const load = async () => {
    const p = new URLSearchParams();
    if (filters.q) p.set('q', filters.q);
    if (filters.group) p.set('group', filters.group);
    if (filters.equipment) p.set('equipment', filters.equipment);
    if (filters.difficulty) p.set('difficulty', filters.difficulty);
    if (filters.favourites) p.set('favourites', '1');
    const r = await api.get<any>(`/api/exercises?${p}`);
    count.textContent = `${r.count} of ${r.total} exercises`;
    res.innerHTML = r.exercises.length
      ? html`${r.exercises.map((x: any) => html`<li><a href="#/exercise/${x.id}" class="row between" style="color:var(--text);text-decoration:none;gap:10px">
          <span><b>${x.name}</b>${x.favourite ? html` <span aria-label="Favourite">★</span>` : ''}<br><span class="small muted">${groupsText(x.groups) || GROUP_LABEL[x.groups[0]] || ''} · ${cap(x.difficulty)}${x.available ? '' : ' · needs equipment you don’t have'}</span></span>
          <span class="row" style="gap:6px">${x.hasVideo ? html`<span class="tag" title="Video demonstration">${icon('play', 14)} Video</span>` : ''}${x.locked ? html`<span class="tag accent">Premium</span>` : ''}</span></a></li>`)}`.value
      : html`<li class="empty">No exercises match. Try clearing a filter.</li>`.value;
  };
  let t: number;
  view.querySelector<HTMLInputElement>('#lq')!.addEventListener('input', (e) => {
    filters.q = (e.target as HTMLInputElement).value.trim();
    clearTimeout(t);
    t = window.setTimeout(load, 200);
  });
  const bind = (id: string, key: 'group' | 'equipment' | 'difficulty') =>
    view.querySelector<HTMLSelectElement>(id)!.addEventListener('change', (e) => {
      filters[key] = (e.target as HTMLSelectElement).value;
      void load();
    });
  bind('#lg', 'group');
  bind('#le', 'equipment');
  bind('#ld', 'difficulty');
  view.querySelector<HTMLInputElement>('#lf')!.addEventListener('change', (e) => {
    filters.favourites = (e.target as HTMLInputElement).checked;
    void load();
  });
  await load();
}

function mediaBlock(media: any[]) {
  const m = media.find((x) => x.kind === 'video') ?? media.find((x) => x.kind === 'youtube');
  if (!m) return html`<div class="video-fallback card">${icon('dumbbell', 28)}<p style="margin:6px 0 0"><b>Video demonstration unavailable</b></p><p class="small muted" style="margin:0">Follow the written steps below.</p></div>`;
  const player = m.kind === 'youtube' && api.demo
    ? html`<a class="video-fallback card row" style="gap:12px;text-decoration:none" href="https://www.youtube.com/watch?v=${m.ref}" target="_blank" rel="noopener">${icon('play', 28)}<span><b>Watch the demonstration on YouTube</b><br><span class="small muted">${m.title}. The app plays this inside the page; the preview opens it in a new tab.</span></span></a>`
    : m.kind === 'youtube'
    ? html`<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${m.ref}?rel=0" title="${m.title || 'Exercise demonstration'}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
    : html`<div class="video"><video src="${m.ref}" controls muted loop playsinline preload="metadata" aria-label="${m.title || 'Exercise demonstration'}"></video></div>`;
  return html`${player}<p class="xs muted" style="margin:6px 0 0">${m.attribution}. ${m.license}.${m.source && m.source.startsWith('https://') ? html` <a href="${m.source}" target="_blank" rel="noopener">Source</a>` : ''}</p>`;
}

export async function exerciseScreen(view: HTMLElement, params: string[]) {
  const x = await api.get<any>(`/api/exercises/${params[0]}`);
  const back = html`<p class="muted small"><a href="#/library">‹ Exercise library</a></p>`;
  const header = html`${back}<div class="row between"><h1 style="margin:0">${x.name}</h1>
    <button class="btn btn-ghost btn-sm" data-action="fav" aria-pressed="${x.favourite ? 'true' : 'false'}">${x.favourite ? '★ Saved' : '☆ Save'}</button></div>
    <p class="muted">${groupsText(x.groups) || GROUP_LABEL[x.groups[0]]} · ${cap(x.difficulty)} · ${x.equipment.map((e: string) => EQUIPMENT_LABEL[e] ?? e).join(', ')}</p>`;
  if (x.locked) {
    view.innerHTML = html`${header}${raw(lockedCard(x.name))}
    ${x.alternatives.length ? html`<section class="card"><h2>Free alternatives</h2><ul class="list">${x.alternatives.filter((a: any) => !a.locked).map((a: any) => html`<li><a href="#/exercise/${a.id}">${a.name}</a></li>`)}</ul></section>` : ''}`.value;
  } else {
    const c = x.content;
    const prog = c.programming ?? {};
    const hist = x.history;
    view.innerHTML = html`${header}
    ${mediaBlock(x.media)}
    <div class="row" style="margin:14px 0"><button class="btn btn-primary btn-sm" data-action="add">+ Add to a workout</button></div>
    <section class="card"><h2>Muscles worked</h2><p class="small">${x.musclesText}</p></section>
    <section class="card"><h2>How to do it</h2><ol class="steps">${Object.entries(STEP_LABEL).filter(([k]) => c.steps[k]).map(([k, label]) => html`<li><b>${label}.</b> ${c.steps[k]}</li>`)}</ol></section>
    ${c.cues?.length ? html`<section class="card"><h2>Coaching cues</h2><ul>${c.cues.map((q: string) => html`<li>${q}</li>`)}</ul></section>` : ''}
    ${c.mistakes?.length ? html`<section class="card"><h2>Common mistakes</h2><ul>${c.mistakes.map((m: any) => html`<li><b>${m.m}.</b> ${m.fix}</li>`)}</ul></section>` : ''}
    <section class="card"><h2>Safety</h2>${c.checks?.length ? html`<p class="small muted" style="margin:0 0 4px">Before you start</p><ul>${c.checks.map((q: string) => html`<li>${q}</li>`)}</ul>` : ''}
      <ul>${(c.safety ?? []).map((q: string) => html`<li>${q}</li>`)}</ul>${c.reduceLoad ? html`<p class="small"><b>Reduce the load if:</b> ${c.reduceLoad}</p>` : ''}
      <p class="xs muted">General information only. Stop if you feel sharp pain, and see a health professional about injuries.</p></section>
    <section class="card"><h2>Sets, reps and progression</h2>
      <table class="data"><thead><tr><th>Goal</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Reps in reserve</th></tr></thead><tbody>
      ${(['muscle', 'strength', 'endurance'] as const).filter((g) => prog[g]).map((g) => html`<tr><td>${g === 'muscle' ? 'Build muscle' : cap(g)}</td><td>${prog[g].sets}</td><td>${prog[g].reps}</td><td>${prog[g].rest}</td><td>${prog[g].rir}</td></tr>`)}</tbody></table>
      ${prog.initialLoad ? html`<p class="small"><b>Starting weight:</b> ${prog.initialLoad}</p>` : ''}
      ${prog.progression ? html`<p class="small"><b>Progression:</b> ${prog.progression}</p>` : ''}
      ${prog.maintain ? html`<p class="small"><b>When to hold or reduce:</b> ${prog.maintain}</p>` : ''}</section>
    ${x.alternatives.length ? html`<section class="card"><h2>Alternatives</h2><ul class="list">${x.alternatives.map((a: any) => html`<li><a href="#/exercise/${a.id}">${a.name}</a>${a.locked ? html` <span class="tag accent">Premium</span>` : ''}</li>`)}</ul></section>` : ''}
    <section class="card"><h2>Your history</h2>
      ${Object.keys(hist.records).length ? html`<p class="small">${hist.records.e1rm ? html`Best estimated 1RM <b>${wOut(hist.records.e1rm)} ${wUnit()}</b>. ` : ''}${hist.records.weight ? html`Heaviest set <b>${wOut(hist.records.weight)} ${wUnit()}</b>. ` : ''}${hist.records.reps ? html`Most reps <b>${hist.records.reps}</b>.` : ''}</p>` : ''}
      ${hist.sessions.length ? html`<ul class="list">${hist.sessions.slice(0, 8).map((s: any) => html`<li><a href="#/session/${s.sessionId}">${shortDate(s.date)}</a> <span class="small muted num">${s.sets.map((st: any) => (st.weightKg != null ? `${wOut(st.weightKg)}×${st.reps}` : st.reps != null ? `${st.reps} reps` : st.durationSec != null ? `${st.durationSec}s` : '')).join(', ')}</span></li>`)}</ul>`
        : html`<p class="small muted">You haven’t logged this exercise yet.</p>`}</section>`.value;
  }

  onActions(view, {
    fav: async (el) => {
      const on = el.getAttribute('aria-pressed') !== 'true';
      await api.post('/api/favourites', { kind: 'exercise', refId: x.id, on });
      el.setAttribute('aria-pressed', String(on));
      el.textContent = on ? '★ Saved' : '☆ Save';
      toast(on ? 'Added to favourites' : 'Removed from favourites');
    },
    add: async () => {
      const prog = await api.get<any>('/api/program');
      const close = sheet('Add to which workout?', prog.workouts.length
        ? html`<ul class="list">${prog.workouts.map((w: any) => html`<li><button class="btn btn-secondary btn-block" data-w="${w.id}">${w.name}</button></li>`)}</ul>`
        : html`<p class="muted">You don’t have any workouts yet. <a href="#/train/workout/new">Create one</a>.</p>`, (sh) => {
        sh.querySelectorAll<HTMLElement>('[data-w]').forEach((b) => b.addEventListener('click', async () => {
          const w = prog.workouts.find((y: any) => y.id === b.dataset.w);
          const time = x.logging === 'time';
          const exercises = [...w.exercises.map(({ name: _n, ...e }: any) => e), { exerciseId: x.id, sets: 3, repMin: time ? 20 : 8, repMax: time ? 45 : 12, restSec: 90, mode: x.logging, rir: '1-3', weightKg: null }];
          try {
            await api.put(`/api/workouts/${w.id}`, { name: w.name, focus: w.focus, exercises });
            close();
            toast(`Added to ${w.name}`);
          } catch (e) {
            toast((e as Error).message, 'err');
          }
        }));
      });
    },
  });
}
