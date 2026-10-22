// Live workout mode (large controls, minimal typing, rest timer) and workout summaries with editable sets.
import { api } from '../api.js';
import { go } from '../app.js';
import { $, $$, confirmSheet, html, numOrNull, onActions, sheet, toast } from '../dom.js';
import { prescriptionText, restText, shortDate, wIn, wOut, wUnit } from '../format.js';
import { icon } from '../ui.js';

let timer: { end: number; handle: number } | null = null;

function startRest(seconds: number) {
  stopRest();
  if (!seconds) return;
  timer = { end: Date.now() + seconds * 1000, handle: window.setInterval(tickRest, 250) };
  tickRest();
}
function stopRest() {
  if (timer) clearInterval(timer.handle);
  timer = null;
  const el = document.getElementById('rest');
  if (el) el.hidden = true;
}
function tickRest() {
  const el = document.getElementById('rest');
  if (!el || !timer) return;
  const left = Math.max(0, Math.round((timer.end - Date.now()) / 1000));
  el.hidden = false;
  el.querySelector('.t')!.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  if (left === 0) {
    stopRest();
    navigator.vibrate?.(300);
    toast('Rest over. Next set!');
  }
}

const valueLabel = (mode: string) => (mode === 'time' ? 'Seconds' : mode === 'distance_time' ? 'Minutes' : 'Reps');

export async function liveWorkoutScreen(view: HTMLElement) {
  const s = await api.get<any>('/api/sessions/active');
  if (!s) {
    toast('No workout in progress.');
    return go('#/today');
  }
  const started = new Date(s.startedAt).getTime();
  const setsFor = (exId: string) => s.sets.filter((x: any) => x.exerciseId === exId);

  view.innerHTML = html`
  <div class="topbar kyvo-live-header"><div><p class="eyebrow" style="margin:0">WORKOUT IN PROGRESS</p><h1 style="margin:0">${s.name}</h1><p class="small muted num" style="margin:0" id="elapsed"></p></div>
    <button class="btn btn-primary" data-action="finish">Finish</button></div>
  <div id="rest" class="timer kyvo-live-rest" role="timer" aria-live="off" hidden><span>Rest <span class="t">0:00</span></span><span class="row"><button class="btn btn-sm" data-action="rest-add">+15 s</button><button class="btn btn-sm" data-action="rest-skip">Skip</button></span></div>
  ${s.planned.length ? '' : html`<p class="empty">No exercises yet. Add one to start logging.</p>`}
  ${s.planned.map((x: any) => {
    const logged = setsFor(x.exerciseId);
    const rows = Math.max(x.sets, logged.length ? Math.max(...logged.map((l: any) => l.setIndex)) + 1 : 0);
    const prev = s.previous[x.exerciseId] as any[] | undefined;
    const isW = x.mode === 'weight_reps';
    return html`<section class="card kyvo-live-exercise" style="margin-top:14px" data-ex="${x.exerciseId}" data-mode="${x.mode}" data-rest="${x.restSec}">
      <div class="card-head"><h2 style="font-size:18px"><a href="#/exercise/${x.exerciseId}" style="color:var(--text)">${x.name}</a></h2><button class="btn btn-ghost btn-sm" data-action="replace" data-ex="${x.exerciseId}">${icon('swap', 16)} Replace</button></div>
      <p class="small muted num" style="margin-top:-6px">${prescriptionText(x)} · ${restText(x.restSec)}${isW && x.weightKg ? ` · suggested ${wOut(x.weightKg)} ${wUnit()}` : ''}</p>
      ${prev?.length ? html`<p class="xs muted">Last time: ${prev.map((p) => (isW ? `${wOut(p.weightKg)}×${p.reps ?? 0}` : x.mode === 'time' ? `${p.durationSec ?? 0}s` : `${p.reps ?? 0}`)).join(', ')}</p>` : ''}
      <div class="set-head" aria-hidden="true"><span>Set</span><span>${isW ? wUnit() : x.mode === 'distance_time' ? 'Distance (m)' : ''}</span><span>${valueLabel(x.mode)}</span><span>Done</span></div>
      ${Array.from({ length: rows }, (_, i) => {
        const l = logged.find((z: any) => z.setIndex === i);
        const prevSet = prev?.[i] ?? prev?.[prev.length - 1];
        const w = l?.weightKg ?? x.weightKg ?? prevSet?.weightKg ?? null;
        const v = x.mode === 'time' ? l?.durationSec : x.mode === 'distance_time' ? (l?.durationSec != null ? Math.round(l.durationSec / 60) : null) : l?.reps;
        const done = !!l?.completed;
        return html`<div class="set-row" data-i="${i}">
          <span class="idx">${i + 1}</span>
          ${isW ? html`<input type="number" inputmode="decimal" step="0.5" min="0" aria-label="Set ${i + 1} weight in ${wUnit()}" data-f="w" value="${w == null ? '' : wOut(w)}">`
            : x.mode === 'distance_time' ? html`<input type="number" inputmode="numeric" min="0" aria-label="Set ${i + 1} distance in metres" data-f="d" value="${l?.distanceM ?? ''}">` : html`<span></span>`}
          <input type="number" inputmode="numeric" min="0" aria-label="Set ${i + 1} ${valueLabel(x.mode).toLowerCase()}" data-f="v" value="${v ?? ''}" placeholder="${x.repMax}">
          <button class="done kyvo-set-complete" data-action="done" aria-pressed="${String(done)}" aria-label="Set ${i + 1} ${done ? 'completed, tap to undo' : 'mark complete'}">${done ? '✓' : ''}</button></div>`;
      })}
      <button class="btn btn-ghost btn-sm" data-action="add-set" data-ex="${x.exerciseId}" data-rows="${rows}">+ Add set</button>
    </section>`;
  })}
  <div class="row" style="margin-top:16px"><button class="btn btn-secondary" data-action="add-ex">+ Add exercise</button><button class="btn btn-ghost" data-action="discard">Discard workout</button></div>
  <p class="xs muted" style="margin-top:14px">Stop if you feel sharp pain, numbness or dizziness. Every completed set is saved straight away, so you can close the app and come back.</p>`.value;

  const elapsed = $('#elapsed', view)!;
  const tickElapsed = () => {
    if (!elapsed.isConnected) return clearInterval(eh);
    const m = Math.floor((Date.now() - started) / 60000);
    elapsed.textContent = `${m} min elapsed`;
  };
  const eh = window.setInterval(tickElapsed, 15000);
  tickElapsed();
  const reload = () => liveWorkoutScreen(view);

  async function saveRow(row: HTMLElement, completed: boolean) {
    const card = row.closest<HTMLElement>('[data-ex]')!;
    const mode = card.dataset.mode!;
    const v = numOrNull(row.querySelector<HTMLInputElement>('[data-f=v]')!.value ?? '') ?? (completed ? Number(row.querySelector<HTMLInputElement>('[data-f=v]')!.placeholder) : null);
    const w = row.querySelector<HTMLInputElement>('[data-f=w]');
    const d = row.querySelector<HTMLInputElement>('[data-f=d]');
    await api.put(`/api/sessions/${s.id}/sets`, {
      exerciseId: card.dataset.ex, setIndex: Number(row.dataset.i), completed,
      weightKg: w ? wIn(numOrNull(w.value)) : null,
      reps: mode === 'weight_reps' || mode === 'reps' ? v : null,
      durationSec: mode === 'time' ? v : mode === 'distance_time' && v != null ? v * 60 : null,
      distanceM: d ? numOrNull(d.value) : null,
    });
  }

  onActions(view, {
    done: async (el) => {
      const row = el.closest<HTMLElement>('.set-row')!;
      const completing = el.getAttribute('aria-pressed') !== 'true';
      await saveRow(row, completing);
      el.setAttribute('aria-pressed', String(completing));
      el.textContent = completing ? '✓' : '';
      if (completing) {
        const vInput = row.querySelector<HTMLInputElement>('[data-f=v]')!;
        if (!vInput.value) vInput.value = vInput.placeholder;
        // Carry the weight forward to the next empty row to save typing.
        const next = row.nextElementSibling as HTMLElement | null;
        const w = row.querySelector<HTMLInputElement>('[data-f=w]');
        const nw = next?.querySelector<HTMLInputElement>('[data-f=w]');
        if (w && nw && !nw.value) nw.value = w.value;
        startRest(Number(row.closest<HTMLElement>('[data-ex]')!.dataset.rest));
      }
    },
    'add-set': async (el) => {
      const card = el.closest<HTMLElement>('[data-ex]')!;
      const rows = $$('.set-row', card);
      const last = rows[rows.length - 1];
      const clone = last.cloneNode(true) as HTMLElement;
      const i = rows.length;
      clone.dataset.i = String(i);
      clone.querySelector('.idx')!.textContent = String(i + 1);
      const done = clone.querySelector('.done')!;
      done.setAttribute('aria-pressed', 'false');
      done.textContent = '';
      clone.querySelector<HTMLInputElement>('[data-f=v]')!.value = '';
      last.after(clone);
    },
    'rest-add': () => {
      if (timer) timer.end += 15000;
    },
    'rest-skip': () => stopRest(),
    replace: async (el) => {
      const ex = el.dataset.ex!;
      const subs = await api.get<any[]>(`/api/exercises/${ex}/substitutes`);
      const close = sheet('Replace exercise', html`<p class="small muted">Similar exercises, ones that suit your equipment first. Sets already logged are kept.</p><ul class="list">${subs.map((x) => html`<li><button class="btn btn-secondary btn-block" data-sub="${x.id}" ${x.locked ? 'disabled' : ''}>${x.name}${x.locked ? ' (Premium)' : ''}</button></li>`)}</ul>`, (sh) => {
        sh.querySelectorAll<HTMLElement>('[data-sub]').forEach((b) => b.addEventListener('click', async () => {
          await api.post(`/api/sessions/${s.id}/exercises`, { exerciseId: b.dataset.sub, replace: ex });
          close();
          await reload();
        }));
      });
    },
    'add-ex': async () => {
      const close = sheet('Add exercise', html`<input type="search" placeholder="Search exercises" aria-label="Search exercises" id="exq"><ul class="list" id="exres" style="margin-top:10px"></ul>`, (sh) => {
        const q = sh.querySelector<HTMLInputElement>('#exq')!;
        const res = sh.querySelector<HTMLElement>('#exres')!;
        const search = async () => {
          const r = await api.get<any>(`/api/exercises?q=${encodeURIComponent(q.value)}`);
          res.innerHTML = html`${r.exercises.slice(0, 30).map((x: any) => html`<li><button class="btn btn-secondary btn-block" data-add="${x.id}" ${x.locked ? 'disabled' : ''}>${x.name}${x.locked ? ' (Premium)' : ''}</button></li>`)}`.value;
          res.querySelectorAll<HTMLElement>('[data-add]').forEach((b) => b.addEventListener('click', async () => {
            await api.post(`/api/sessions/${s.id}/exercises`, { exerciseId: b.dataset.add });
            close();
            await reload();
          }));
        };
        let t: number;
        q.addEventListener('input', () => {
          clearTimeout(t);
          t = window.setTimeout(search, 200);
        });
        void search();
      });
    },
    finish: async () => {
      const close = sheet('Finish workout', html`<form id="fin"><div class="field"><label for="notes">Notes <span class="muted">(optional)</span></label><textarea id="notes" name="notes" maxlength="2000" placeholder="How did it feel?"></textarea></div>
        <label class="check"><input type="checkbox" name="pain"> I felt pain or discomfort (KYVO won’t suggest heavier weights for these exercises next time)</label>
        <button class="btn btn-primary btn-block" type="submit">Save workout</button></form>`, (sh) => {
        sh.querySelector('form')!.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target as HTMLFormElement;
          try {
            await api.post(`/api/sessions/${s.id}/finish`, { notes: (f.elements.namedItem('notes') as HTMLTextAreaElement).value, painReported: (f.elements.namedItem('pain') as HTMLInputElement).checked });
            stopRest();
            close();
            go(`#/session/${s.id}`);
          } catch (err) {
            toast((err as Error).message, 'err');
          }
        });
      });
    },
    discard: async () => {
      if (!(await confirmSheet('Discard this workout?', 'Logged sets will not be saved to your history.', 'Discard workout', true))) return;
      await api.post(`/api/sessions/${s.id}/discard`);
      stopRest();
      go('#/today');
    },
  });
}

export async function sessionScreen(view: HTMLElement, params: string[]) {
  const s = await api.get<any>(`/api/sessions/${params[0]}`);
  if (s.status === 'in_progress') return go('#/workout');
  const mins = s.finishedAt ? Math.max(1, Math.round((new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)) : null;
  const ids = [...new Set([...s.planned.map((p: any) => p.exerciseId), ...s.sets.map((x: any) => x.exerciseId)])];
  const nameOf = (id: string) => s.planned.find((p: any) => p.exerciseId === id)?.name ?? id;
  const kindLabel: Record<string, string> = { weight: 'Heaviest weight', e1rm: 'Best estimated 1-rep max', reps: 'Most reps', duration: 'Longest time' };
  view.innerHTML = html`<p class="muted small"><a href="#/train/history">‹ Workout history</a></p>
  <h1>${s.name}</h1><p class="muted">${shortDate(s.date)}${mins ? ` · ${mins} min` : ''} · ${s.sets.filter((x: any) => x.completed).length} sets · ${wOut(s.volumeKg)} ${wUnit()} total volume</p>
  ${s.records.length ? html`<section class="card summary-card"><h2>🏆 Personal records</h2><ul class="list">${s.records.map((r: any) => html`<li>${nameOf(r.exerciseId)}: ${kindLabel[r.kind]} ${r.kind === 'reps' ? r.value : r.kind === 'duration' ? `${r.value} s` : `${wOut(r.value)} ${wUnit()}`}</li>`)}</ul></section>` : ''}
  ${s.painReported ? html`<p class="notice warn">You reported pain. KYVO will keep the load the same next time. If pain persists, see a physiotherapist or doctor.</p>` : ''}
  ${ids.map((id) => {
    const sets = s.sets.filter((x: any) => x.exerciseId === id);
    if (!sets.length) return '';
    return html`<section class="card" data-ex="${id}"><h2 style="font-size:18px">${nameOf(id)}</h2><table class="data"><thead><tr><th>Set</th><th>${wUnit()}</th><th>Reps / s</th><th></th></tr></thead><tbody>
      ${sets.map((x: any) => html`<tr data-i="${x.setIndex}"><td>${x.setIndex + 1}</td><td><input type="number" step="0.5" aria-label="Weight" data-f="w" value="${x.weightKg == null ? '' : wOut(x.weightKg)}" style="min-height:40px;width:90px"></td>
        <td><input type="number" aria-label="Reps or seconds" data-f="v" value="${x.reps ?? x.durationSec ?? ''}" style="min-height:40px;width:80px" data-kind="${x.durationSec != null && x.reps == null ? 'time' : 'reps'}"></td>
        <td><button class="btn btn-sm btn-ghost" data-action="save-set">Save</button><button class="btn btn-sm btn-ghost" data-action="del-set" aria-label="Delete set">✕</button></td></tr>`)}
    </tbody></table></section>`;
  })}
  <section class="card"><h2>Notes</h2><textarea id="notes" aria-label="Workout notes" maxlength="2000">${s.notes}</textarea><button class="btn btn-sm btn-secondary" style="margin-top:8px" data-action="notes">Save notes</button></section>
  <a class="btn btn-primary btn-block" style="margin-top:16px" href="#/today">Back to today</a>`.value;
  onActions(view, {
    'save-set': async (el) => {
      const tr = el.closest<HTMLElement>('tr')!;
      const ex = el.closest<HTMLElement>('[data-ex]')!.dataset.ex;
      const v = tr.querySelector<HTMLInputElement>('[data-f=v]')!;
      const isTime = v.dataset.kind === 'time';
      await api.put(`/api/sessions/${s.id}/sets`, { exerciseId: ex, setIndex: Number(tr.dataset.i), completed: true, weightKg: wIn(numOrNull(tr.querySelector<HTMLInputElement>('[data-f=w]')!.value)), reps: isTime ? null : numOrNull(v.value), durationSec: isTime ? numOrNull(v.value) : null });
      toast('Set updated');
      await sessionScreen(view, params);
    },
    'del-set': async (el) => {
      const tr = el.closest<HTMLElement>('tr')!;
      await api.post(`/api/sessions/${s.id}/sets/delete`, { exerciseId: el.closest<HTMLElement>('[data-ex]')!.dataset.ex, setIndex: Number(tr.dataset.i) });
      await sessionScreen(view, params);
    },
    notes: async () => {
      await api.patch(`/api/sessions/${s.id}`, { notes: $<HTMLTextAreaElement>('#notes', view)!.value });
      toast('Notes saved');
    },
  });
}
