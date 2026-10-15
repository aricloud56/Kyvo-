// Exercise library: search, filters, favourites and the exercise detail page.
import { api } from '../api.js';
import { lockedCard } from '../app.js';
import { html, onActions, raw, sheet, toast } from '../dom.js';
import { EQUIPMENT_LABEL, GROUP_LABEL, groupsText, longDate, shortDate, wOut, wUnit } from '../format.js';
import { barChart, icon, lineChart, wireCharts } from '../ui.js';
import { figureSVG, respectReducedMotion } from '../visuals/figure.js';
import { muscleMap, muscleName } from '../visuals/muscles.js';
import { exerciseTile, figureFor, loadVisuals } from '../visuals/assets.js';
import { exerciseViewer, newViewerState, wireViewer, type ViewerState } from '../visuals/viewer.js';

const STEP_LABEL: Record<string, string> = {
  start: 'Starting position', setup: 'Equipment setup', feet: 'Feet', grip: 'Grip or hand position', posture: 'Posture', brace: 'Brace',
  initiate: 'Start the movement', concentric: 'Lifting phase', breathing: 'Breathing', eccentric: 'Lowering phase', rom: 'Range of motion',
  tempo: 'Tempo', finish: 'Finish', exit: 'Re-rack or exit safely',
};
const DIFFICULTY = ['beginner', 'intermediate', 'advanced'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const filters = { q: '', group: '', equipment: '', difficulty: '', favourites: false };

export async function libraryScreen(view: HTMLElement) {
  await loadVisuals();
  const groupChips = [['', 'All'], ...Object.entries(GROUP_LABEL).filter(([k]) => k !== 'bodyweight')];
  const filtersOn = () => [filters.equipment, filters.difficulty].filter(Boolean).length + (filters.favourites ? 1 : 0);
  view.innerHTML = html`<nav class="head-tabs" aria-label="Train sections"><a href="#/train">Train</a><a href="#/library" aria-current="page">Library</a><a href="#/train/history">History</a></nav>
  <div role="search">
    <div class="search-row"><input type="search" id="lq" placeholder="Search exercises, e.g. bench press" aria-label="Search exercises" value="${filters.q}">
      <button class="icon-btn" style="border:1px solid var(--border-strong);border-radius:12px;width:48px;height:48px" data-action="filters" aria-expanded="false" aria-controls="fp" aria-label="More filters">${icon('filter', 22)}</button></div>
    <div class="chip-scroll" role="group" aria-label="Muscle group">${groupChips.map(([k, v]) => html`<button type="button" class="chip" data-action="group" data-group="${k}" aria-pressed="${filters.group === k}">${v}</button>`)}</div>
    <div class="card filter-panel" id="fp" hidden>
      <div class="row">
        <select id="le" aria-label="Equipment" style="flex:1;min-width:140px"><option value="">Any equipment</option>${Object.entries(EQUIPMENT_LABEL).map(([k, v]) => html`<option value="${k}" ${filters.equipment === k ? 'selected' : ''}>${v}</option>`)}</select>
        <select id="ld" aria-label="Difficulty" style="flex:1;min-width:120px"><option value="">Any level</option>${DIFFICULTY.map((d) => html`<option value="${d}" ${filters.difficulty === d ? 'selected' : ''}>${cap(d)}</option>`)}</select>
      </div>
      <label class="check" style="margin-top:8px"><input type="checkbox" id="lf" ${filters.favourites ? 'checked' : ''}> Favourites only</label>
    </div>
  </div>
  <p class="small muted" id="lcount" aria-live="polite" style="margin:10px 0 0"></p>
  <ul class="ex-rows" id="lres"></ul>`.value;

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
    count.textContent = `${r.count} of ${r.total} exercises${filtersOn() ? ` · ${filtersOn()} extra filter${filtersOn() > 1 ? 's' : ''} on` : ''}`;
    res.innerHTML = r.exercises.length
      ? html`${r.exercises.map((x: any) => html`<li><a href="#/exercise/${x.id}">${raw(exerciseTile(x.id, x.name, [], { className: 'ex-thumb' }))}
          <span class="grow"><span class="nm">${x.name}</span>${x.favourite ? html` <span aria-label="Favourite" style="color:var(--accent)">★</span>` : ''}<br><span class="meta">${groupsText(x.groups) || GROUP_LABEL[x.groups[0]] || ''} · ${cap(x.difficulty)}${x.available ? '' : ' · needs equipment you don’t have'}</span></span>
          <span class="row" style="gap:6px;flex:none">${x.hasVideo ? html`<span class="tag" title="Video demonstration">${icon('play', 12)} Video</span>` : ''}${x.locked ? html`<span class="tag accent">Premium</span>` : ''}</span></a></li>`)}`.value
      : html`<li class="empty">No exercises match. Try clearing a filter.</li>`.value;
  };
  let t: number;
  view.querySelector<HTMLInputElement>('#lq')!.addEventListener('input', (e) => {
    filters.q = (e.target as HTMLInputElement).value.trim();
    clearTimeout(t);
    t = window.setTimeout(load, 200);
  });
  const bind = (id: string, key: 'equipment' | 'difficulty') =>
    view.querySelector<HTMLSelectElement>(id)!.addEventListener('change', (e) => {
      filters[key] = (e.target as HTMLSelectElement).value;
      void load();
    });
  bind('#le', 'equipment');
  bind('#ld', 'difficulty');
  view.querySelector<HTMLInputElement>('#lf')!.addEventListener('change', (e) => {
    filters.favourites = (e.target as HTMLInputElement).checked;
    void load();
  });
  onActions(view, {
    group: (el) => {
      filters.group = el.dataset.group ?? '';
      view.querySelectorAll<HTMLElement>('[data-action="group"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      void load();
    },
    filters: (el) => {
      const fp = view.querySelector<HTMLElement>('#fp')!;
      fp.hidden = !fp.hidden;
      el.setAttribute('aria-expanded', String(!fp.hidden));
    },
  });
  if (filtersOn()) view.querySelector<HTMLElement>('#fp')!.hidden = false;
  await load();
}

function videoCard(x: any) {
  const m = (x.media ?? []).find((v: any) => v.kind === 'video') ?? (x.media ?? []).find((v: any) => v.kind === 'youtube');
  if (!m) return '';
  const player = m.kind === 'youtube' && api.demo
    ? html`<a class="fig-tile video-link" href="https://www.youtube.com/watch?v=${m.ref}" target="_blank" rel="noopener">${icon('play', 40)}<span><b>Watch on YouTube</b><br><span class="small">${m.title}. The app plays this inside the page; the preview opens it in a new tab.</span></span></a>`
    : m.kind === 'youtube'
    ? html`<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${m.ref}?rel=0" title="${m.title || 'Exercise demonstration'}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
    : html`<div class="video"><video src="${m.ref}" controls muted loop playsinline preload="metadata" aria-label="${m.title || 'Exercise demonstration'}"></video></div>`;
  return html`<section class="card"><h2>Coach video</h2>${player}<p class="hero-note">${m.attribution}. ${m.license}.${m.source && m.source.startsWith('https://') ? html` <a href="${m.source}" target="_blank" rel="noopener">Source</a>` : ''}</p></section>`;
}

const TABS = ['guide', 'history', 'records', 'charts'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { guide: 'Guide', history: 'History', records: 'Records', charts: 'Charts' };

const setText = (st: any) => (st.weightKg != null ? `${wOut(st.weightKg)} ${wUnit()} × ${st.reps}` : st.reps != null ? `${st.reps} reps` : st.durationSec != null ? `${st.durationSec} s` : st.distanceM != null ? `${st.distanceM} m` : '–');
const e1rm = (st: any) => (st.weightKg && st.reps ? st.weightKg * (1 + Math.min(st.reps, 12) / 30) : 0);

function guideTab(x: any) {
  const c = x.content;
  const prog = c.programming ?? {};
  const primary: string[] = x.primary ?? c.primary ?? [];
  const secondary: string[] = x.secondary ?? c.secondary ?? [];
  return html`
    <section class="card"><h2>Muscles worked</h2>${raw(muscleMap(primary, secondary))}
      <div class="legend-dots"><span><i></i>Primary</span><span><i class="sec"></i>Secondary</span></div>
      <p class="small muted" style="margin:12px 0 0">${x.musclesText}</p></section>
    <section class="card"><h2>How to do it</h2><ol class="steps">${Object.entries(STEP_LABEL).filter(([k]) => c.steps[k]).map(([k, label]) => html`<li><b>${label}.</b> ${c.steps[k]}</li>`)}</ol></section>
    ${c.cues?.length ? html`<section class="card"><h2>Coaching cues</h2><ul>${c.cues.map((q: string) => html`<li>${q}</li>`)}</ul></section>` : ''}
    ${c.mistakes?.length ? html`<section class="card"><h2>Common mistakes</h2><ul>${c.mistakes.map((m: any) => html`<li><b>${m.m}.</b> ${m.fix}</li>`)}</ul></section>` : ''}
    <section class="card"><h2>Safety</h2>${c.checks?.length ? html`<p class="small muted" style="margin:0 0 4px">Before you start</p><ul>${c.checks.map((q: string) => html`<li>${q}</li>`)}</ul>` : ''}
      <ul>${(c.safety ?? []).map((q: string) => html`<li>${q}</li>`)}</ul>${c.reduceLoad ? html`<p class="small"><b>Reduce the load if:</b> ${c.reduceLoad}</p>` : ''}
      <p class="xs muted">General information only. Stop if you feel sharp pain, and see a health professional about injuries.</p></section>
    <section class="card"><h2>Sets, reps and progression</h2>
      <div class="table-scroll"><table class="data"><thead><tr><th>Goal</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Reps in reserve</th></tr></thead><tbody>
      ${(['muscle', 'strength', 'endurance'] as const).filter((g) => prog[g]).map((g) => html`<tr><td>${g === 'muscle' ? 'Build muscle' : cap(g)}</td><td>${prog[g].sets}</td><td>${prog[g].reps}</td><td>${prog[g].rest}</td><td>${prog[g].rir}</td></tr>`)}</tbody></table></div>
      ${prog.initialLoad ? html`<p class="small"><b>Starting weight:</b> ${prog.initialLoad}</p>` : ''}
      ${prog.progression ? html`<p class="small"><b>Progression:</b> ${prog.progression}</p>` : ''}
      ${prog.maintain ? html`<p class="small"><b>When to hold or reduce:</b> ${prog.maintain}</p>` : ''}</section>
    ${x.alternatives.length ? html`<section class="card"><h2>Alternatives</h2><ul class="ex-rows">${x.alternatives.map((a: any) => html`<li><a href="#/exercise/${a.id}">${raw(exerciseTile(a.id, a.name, [], { className: 'ex-thumb' }))}<span class="grow"><span class="nm">${a.name}</span></span>${a.locked ? html`<span class="tag accent">Premium</span>` : ''}</a></li>`)}</ul></section>` : ''}`;
}

function historyTab(x: any) {
  const hist = x.history;
  if (!hist.sessions.length) return html`<div class="card empty-state"><p style="margin:0"><b>No sessions yet</b></p><p class="small muted" style="margin:4px 0 0">Your sets appear here after you finish a workout with ${x.name}.</p></div>`;
  return html`${hist.sessions.slice(0, 20).map((s: any) => html`<article class="card"><div class="row between"><h3 style="margin:0">${longDate(s.date)}</h3><a class="small" href="#/session/${s.sessionId}">Workout</a></div>
    <table class="set-table" style="margin-top:8px"><thead><tr><th>Set</th><th>Completed</th>${x.logging === 'weight_reps' ? html`<th>Est. 1RM</th>` : ''}</tr></thead><tbody>
    ${s.sets.map((st: any, i: number) => html`<tr><td>${i + 1}</td><td>${setText(st)}</td>${x.logging === 'weight_reps' ? html`<td class="muted">${e1rm(st) ? `${wOut(Math.round(e1rm(st) * 2) / 2)} ${wUnit()}` : '–'}</td>` : ''}</tr>`)}</tbody></table></article>`)}
    ${x.historyLimited ? html`<p class="xs muted">Free accounts show the last 90 days.</p>` : ''}`;
}

function recordsTab(x: any) {
  const r = x.history.records;
  const sets = x.history.sessions.flatMap((s: any) => s.sets.map((st: any) => ({ ...st, date: s.date })));
  const best = (f: (st: any) => number) => sets.reduce((b: any, st: any) => (f(st) > (b ? f(b) : 0) ? st : b), null);
  const heavy = best((st) => st.weightKg ?? 0), most = best((st) => st.reps ?? 0), longest = best((st) => st.durationSec ?? 0), top = best(e1rm);
  const tiles = [
    top && e1rm(top) ? ['Best estimated 1RM', `${wOut(Math.round((r.e1rm ?? e1rm(top)) * 2) / 2)} ${wUnit()}`, shortDate(top.date)] : null,
    heavy?.weightKg ? ['Heaviest set', `${wOut(r.weight ?? heavy.weightKg)} ${wUnit()}`, `${heavy.reps} reps · ${shortDate(heavy.date)}`] : null,
    most?.reps ? ['Most reps in a set', String(r.reps ?? most.reps), most.weightKg ? `at ${wOut(most.weightKg)} ${wUnit()} · ${shortDate(most.date)}` : shortDate(most.date)] : null,
    longest?.durationSec ? ['Longest set', `${r.duration ?? longest.durationSec} s`, shortDate(longest.date)] : null,
    sets.length ? ['Sets logged', String(sets.length), `${x.history.sessions.length} session${x.history.sessions.length === 1 ? '' : 's'}`] : null,
  ].filter(Boolean) as string[][];
  if (!tiles.length) return html`<div class="card empty-state"><p style="margin:0"><b>No records yet</b></p><p class="small muted" style="margin:4px 0 0">Personal records are worked out from the sets you log.</p></div>`;
  return html`<div class="rec-grid">${tiles.map(([k, v, sub]) => html`<div class="rec"><div class="k">${k}</div><div class="v num">${v}</div><div class="xs muted">${sub}</div></div>`)}</div>
    <p class="xs muted" style="margin-top:10px">Estimated 1RM uses the Epley formula and is a guide, not a tested maximum.</p>`;
}

function chartsTab(x: any) {
  const sessions = [...x.history.sessions].reverse();
  if (sessions.length < 2) return html`<div class="card empty-state"><p style="margin:0"><b>Not enough data yet</b></p><p class="small muted" style="margin:4px 0 0">Charts appear after two sessions with this exercise.</p></div>`;
  if (x.logging === 'weight_reps') {
    const pts = sessions.map((s: any) => ({ x: s.date, y: Math.max(...s.sets.map(e1rm)) || null }));
    const top = sessions.map((s: any) => ({ x: s.date, y: Math.max(...s.sets.map((st: any) => st.weightKg ?? 0)) || null }));
    const vol = sessions.map((s: any) => ({ label: shortDate(s.date).split(' ').slice(0, 2).join(' '), value: s.sets.reduce((a: number, st: any) => a + (st.weightKg ?? 0) * (st.reps ?? 0), 0), tip: '' }));
    vol.forEach((v: any) => (v.tip = `${v.label}: ${Math.round(Number(wOut(v.value))).toLocaleString('en-AU')} ${wUnit()}`));
    return html`<section class="card"><h2>Strength trend</h2>${lineChart('e1rm', 'Estimated 1RM and heaviest set per session', [
      { name: 'Estimated 1RM', color: 'var(--chart-1)', points: pts.map((p: any) => ({ x: p.x, y: p.y == null ? null : Number(wOut(p.y)) })), dots: true },
      { name: 'Heaviest set', color: 'var(--chart-2)', points: top.map((p: any) => ({ x: p.x, y: p.y == null ? null : Number(wOut(p.y)) })), dots: true },
    ], (n) => `${n} ${wUnit()}`, (d) => shortDate(d))}</section>
    <section class="card"><h2>Volume per session</h2>${barChart('Volume per session (weight × reps)', vol, (n) => Math.round(Number(wOut(n))).toLocaleString('en-AU'))}</section>`;
  }
  const key = x.logging === 'time' ? 'durationSec' : 'reps';
  return html`<section class="card"><h2>${key === 'reps' ? 'Best set (reps)' : 'Longest set (seconds)'}</h2>${lineChart('best', 'Best set per session', [
    { name: key === 'reps' ? 'Reps' : 'Seconds', color: 'var(--chart-1)', points: sessions.map((s: any) => ({ x: s.date, y: Math.max(...s.sets.map((st: any) => st[key] ?? 0)) || null })), dots: true },
  ], (n) => String(n), (d) => shortDate(d))}</section>`;
}

const pageState: { id: string; tab: Tab; viewer: ViewerState } = { id: '', tab: 'guide', viewer: newViewerState() };

export async function exerciseScreen(view: HTMLElement, params: string[]) {
  const [x] = await Promise.all([api.get<any>(`/api/exercises/${params[0]}`), loadVisuals()]);
  if (pageState.id !== x.id) Object.assign(pageState, { id: x.id, tab: 'guide', viewer: newViewerState() });
  const primary: string[] = x.primary ?? [];
  const header = html`<div class="sheet-head"><a class="icon-btn" href="#/library" aria-label="Back to the exercise library">${icon('back', 22)}</a><h1>${x.name}</h1>
    <button class="icon-btn" data-action="fav" aria-pressed="${x.favourite ? 'true' : 'false'}" aria-label="${x.favourite ? 'Remove from favourites' : 'Save to favourites'}">${icon(x.favourite ? 'starOn' : 'star', 22)}</button></div>`;
  const meta = html`<div class="ex-meta">${primary.slice(0, 3).map((m) => html`<span class="tag accent">${muscleName(m)}</span>`)}<span class="tag">${cap(x.difficulty)}</span>${x.equipment.slice(0, 3).map((e: string) => html`<span class="tag">${EQUIPMENT_LABEL[e] ?? e}</span>`)}</div>`;
  if (x.locked) {
    view.innerHTML = html`${header}${figureFor(x.id) ? html`<div class="ex-hero"><div class="fig-tile">${raw(figureSVG(figureFor(x.id)!, { label: `${x.name} movement` }))}</div></div>` : ''}${meta}${raw(lockedCard(x.name))}
    ${x.alternatives.length ? html`<section class="card"><h2>Free alternatives</h2><ul class="ex-rows">${x.alternatives.filter((a: any) => !a.locked).map((a: any) => html`<li><a href="#/exercise/${a.id}">${raw(exerciseTile(a.id, a.name, [], { className: 'ex-thumb' }))}<span class="grow nm">${a.name}</span></a></li>`)}</ul></section>` : ''}`.value;
  } else {
    const tab = pageState.tab;
    const body = tab === 'history' ? historyTab(x) : tab === 'records' ? recordsTab(x) : tab === 'charts' ? chartsTab(x) : guideTab(x);
    view.innerHTML = html`${header}<div class="ex-hero" id="viewer">${raw(exerciseViewer(x, pageState.viewer))}</div>${meta}
    <div class="row" style="margin:14px 0 0"><button class="btn btn-primary btn-sm" data-action="add">${icon('plus', 16)} Add to a workout</button></div>
    <div class="tabs" role="tablist" aria-label="Exercise details">${TABS.map((t) => html`<button role="tab" id="tab-${t}" aria-controls="tabpanel" aria-selected="${t === tab}" tabindex="${t === tab ? 0 : -1}" data-action="tab" data-tab="${t}">${TAB_LABEL[t]}</button>`)}</div>
    <div id="tabpanel" role="tabpanel" aria-labelledby="tab-${tab}">${body}</div>
    ${tab === 'guide' ? videoCard(x) : ''}`.value;
    if (tab === 'charts') wireCharts(view, {}, (d) => shortDate(d));
  }
  respectReducedMotion(view);
  const viewerEl = view.querySelector<HTMLElement>('#viewer');
  const wire = () => viewerEl && wireViewer(viewerEl, pageState.viewer, () => {
    viewerEl.innerHTML = exerciseViewer(x, pageState.viewer);
    wire();
  });
  wire();
  const rerender = () => exerciseScreen(view, params);
  onActions(view, {
    fav: async (el) => {
      const on = el.getAttribute('aria-pressed') !== 'true';
      await api.post('/api/favourites', { kind: 'exercise', refId: x.id, on });
      el.setAttribute('aria-pressed', String(on));
      el.setAttribute('aria-label', on ? 'Remove from favourites' : 'Save to favourites');
      el.innerHTML = icon(on ? 'starOn' : 'star', 22).value;
      toast(on ? 'Added to favourites' : 'Removed from favourites');
    },
    tab: async (el) => {
      pageState.tab = el.dataset.tab as Tab;
      await rerender();
      view.querySelector<HTMLElement>(`#tab-${pageState.tab}`)?.focus();
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
