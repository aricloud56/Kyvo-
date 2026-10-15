// Progress: weight trend, measurements, training volume, nutrition consistency, records and private photos.
import { api } from '../api.js';
import { state } from '../app.js';
import { confirmSheet, formData, html, numOrNull, onActions, sheet, toast } from '../dom.js';
import { getUnits, kcal, shortDate, wIn, wOut, wUnit } from '../format.js';
import { barChart, lineChart, wireCharts } from '../ui.js';
import { cmToIn, inToCm } from '../../core/util.js';

let rangeDays = 30;
const RECORD_LABEL: Record<string, string> = { weight: 'Heaviest set', e1rm: 'Estimated 1RM', reps: 'Most reps', duration: 'Longest hold' };
const lenUnit = () => (getUnits() === 'imperial' ? 'in' : 'cm');
const lenOut = (cm: number | null) => (cm == null ? '–' : String(getUnits() === 'imperial' ? Math.round(cmToIn(cm) * 10) / 10 : cm));
const lenIn = (v: number | null) => (v == null ? null : getUnits() === 'imperial' ? Math.round(inToCm(v) * 10) / 10 : v);

export async function progressScreen(view: HTMLElement) {
  const d = await api.get<any>(`/api/progress?days=${rangeDays}`);
  const photos = await api.get<any[]>('/api/photos');
  const recordValue = (r: any) => (r.kind === 'reps' ? `${r.value} reps` : r.kind === 'duration' ? `${r.value} s` : `${wOut(r.value)} ${wUnit()}`);
  const w = d.weekly, m = d.monthly;

  view.innerHTML = html`<h1>Progress</h1>
  <div class="seg" role="group" aria-label="Date range" style="margin-bottom:14px">${[[30, '30 days'], [90, '90 days'], [365, '1 year']].map(([n, l]) => html`<button data-action="range" data-days="${n}" aria-pressed="${rangeDays === n ? 'true' : 'false'}">${l}</button>`)}</div>
  ${d.limitedTo ? html`<p class="notice small">Free accounts show the last ${d.limitedTo} days. <a href="#/premium">Premium</a> unlocks your full history.</p>` : ''}

  <section class="card" aria-labelledby="sum-h"><h2 id="sum-h">This week</h2>
    <div class="stat-grid"><div class="stat"><b>${w.workouts}</b><span>workouts</span></div><div class="stat"><b>${w.daysLogged}</b><span>days of food logged</span></div>
      <div class="stat"><b>${w.avgKcal == null ? '–' : w.avgKcal}</b><span>average kcal</span></div><div class="stat"><b>${w.avgProteinG == null ? '–' : `${w.avgProteinG} g`}</b><span>average protein</span></div></div>
    <p class="small muted" style="margin:10px 0 0">Last 30 days: ${m.workouts} workouts, ${wOut(m.volumeKg)} ${wUnit()} lifted, food logged on ${m.daysLogged} days.</p></section>

  <section class="card" aria-labelledby="wt-h"><div class="card-head"><h2 id="wt-h" style="margin:0">Body weight</h2><button class="btn btn-secondary btn-sm" data-action="metrics">+ Log weight or measurements</button></div>
    ${d.weights.length ? lineChart('weight', 'Body weight and 7-day average', [
      { name: 'Weigh-ins', color: 'var(--chart-2)', points: d.weights.map((p: any) => ({ x: p.date, y: Number(wOut(p.value)) })), dots: true },
      { name: '7-day average', color: 'var(--chart-1)', points: d.trend.map((p: any) => ({ x: p.date, y: Number(wOut(p.value)) })) },
    ], (n) => `${n}`, shortDate) : html`<p class="empty">No weigh-ins in this range yet.</p>`}
    ${d.weightChange != null ? html`<p class="small">Trend change: <b>${d.weightChange > 0 ? '+' : ''}${wOut(d.weightChange)} ${wUnit()}</b> over this range.</p>` : ''}
    <p class="xs muted">${d.weightNote}</p></section>

  <section class="card" aria-labelledby="ms-h"><h2 id="ms-h">Measurements</h2>
    ${d.measurements.length ? html`<div class="table-scroll"><table class="data"><thead><tr><th>Date</th><th>Weight (${wUnit()})</th><th>Waist</th><th>Chest</th><th>Hips</th><th>Arm</th><th>Thigh</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${[...d.measurements].reverse().slice(0, 20).map((r: any) => html`<tr><td>${shortDate(r.date)}</td><td>${r.weightKg == null ? '–' : wOut(r.weightKg)}</td><td>${lenOut(r.waistCm)}</td><td>${lenOut(r.chestCm)}</td><td>${lenOut(r.hipsCm)}</td><td>${lenOut(r.armCm)}</td><td>${lenOut(r.thighCm)}</td>
        <td><button class="btn btn-ghost btn-sm" data-action="delmetric" data-id="${r.id}" aria-label="Delete entry for ${shortDate(r.date)}">✕</button></td></tr>`)}</tbody></table></div><p class="xs muted">Lengths in ${lenUnit()}.</p>`
    : html`<p class="small muted">Waist, chest, hips, arm and thigh measurements show change that the scale can miss.</p>`}</section>

  <section class="card" aria-labelledby="tr-h"><h2 id="tr-h">Training</h2>
    <h3 class="small muted">Workouts per week</h3>
    ${barChart('Workouts per week', d.weeks.map((x: any) => ({ label: shortDate(x.week), value: x.workouts, tip: `Week of ${shortDate(x.week)}: ${x.workouts} of ${x.planned} planned` })), (n) => String(n), 'var(--chart-1)', d.weeks[0]?.planned || undefined)}
    <p class="xs muted">Dashed line: workouts planned per week.</p>
    <h3 class="small muted">Weekly volume (${wUnit()} lifted)</h3>
    ${barChart('Weekly volume', d.weeks.map((x: any) => ({ label: shortDate(x.week), value: Number(wOut(x.volumeKg)), tip: `Week of ${shortDate(x.week)}: ${wOut(x.volumeKg)} ${wUnit()}` })), (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n)), 'var(--chart-2)')}</section>

  <section class="card" aria-labelledby="nu-h"><h2 id="nu-h">Nutrition</h2>
    <div class="stat-grid"><div class="stat"><b>${d.calorieConsistency == null ? '–' : `${d.calorieConsistency}%`}</b><span>days within 10% of calorie target</span></div>
      <div class="stat"><b>${d.proteinConsistency == null ? '–' : `${d.proteinConsistency}%`}</b><span>days at 90%+ of protein target</span></div>
      <div class="stat"><b>${d.tasksCompleted}</b><span>Daily Plan tasks completed</span></div></div>
    ${d.nutrition.length ? lineChart('kcal', 'Calories eaten against target', [
      { name: 'Eaten', color: 'var(--chart-1)', points: d.nutrition.map((n: any) => ({ x: n.date, y: n.kcal })), dots: d.nutrition.length < 20 },
      { name: 'Target', color: 'var(--text-2)', points: d.nutrition.map((n: any) => ({ x: n.date, y: n.targetKcal })), dashed: true },
    ], (n) => String(Math.round(n)), shortDate, { zero: true }) : html`<p class="empty">Log food to see calories over time.</p>`}</section>

  <section class="card" aria-labelledby="pr-h"><h2 id="pr-h">Personal records</h2>
    ${d.records.length ? html`<ul class="list">${d.records.slice(0, 12).map((r: any) => html`<li class="row between"><span><a href="#/exercise/${r.exerciseId}">${r.name}</a><br><span class="small muted">${RECORD_LABEL[r.kind] ?? r.kind} · ${shortDate(r.date)}</span></span><b class="num">${recordValue(r)}</b></li>`)}</ul>`
    : html`<p class="small muted">Records appear automatically when you beat a previous best.</p>`}</section>

  <section class="card" aria-labelledby="ph-h"><div class="card-head"><h2 id="ph-h" style="margin:0">Progress photos</h2>
    <label class="btn btn-secondary btn-sm" style="margin:0">+ Add photo<input type="file" id="photo" accept="image/jpeg,image/png,image/webp" class="sr-only"></label></div>
    <p class="xs muted">Private to you. Photos are stored securely and are never used for advertising.</p>
    ${photos.length ? html`<div class="photo-grid">${photos.map((p) => html`<figure><img src="/api/photos/${p.id}/image" alt="Progress photo from ${shortDate(p.date)}" loading="lazy"><figcaption class="row between xs muted">${shortDate(p.date)}<button class="btn btn-ghost btn-sm" data-action="delphoto" data-id="${p.id}" aria-label="Delete photo from ${shortDate(p.date)}">✕</button></figcaption></figure>`)}</div>`
    : html`<p class="small muted">No photos yet.</p>`}</section>`.value;

  wireCharts(view, { weight: (n) => `${n} ${wUnit()}`, kcal: (n) => kcal(n) }, shortDate);
  const reload = () => progressScreen(view);

  view.querySelector<HTMLInputElement>('#photo')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) return toast('Images must be 5 MB or smaller.', 'err');
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    try {
      await api.post('/api/photos', { dataBase64: btoa(bin), date: state.me!.today });
      toast('Photo saved');
      await reload();
    } catch (x) {
      toast((x as Error).message, 'err');
    }
  });

  onActions(view, {
    range: async (el) => {
      rangeDays = Number(el.dataset.days);
      await reload();
    },
    delmetric: async (el) => {
      if (!(await confirmSheet('Delete this entry?', 'This weigh-in and its measurements will be removed.', 'Delete', true))) return;
      await api.del(`/api/metrics/${el.dataset.id}`);
      await reload();
    },
    delphoto: async (el) => {
      if (!(await confirmSheet('Delete this photo?', 'It will be permanently deleted.', 'Delete', true))) return;
      await api.del(`/api/photos/${el.dataset.id}`);
      await reload();
    },
    metrics: () => {
      const L = lenUnit();
      const close = sheet('Log weight and measurements', html`<form>
        <div class="row"><div class="field" style="flex:1"><label for="md">Date</label><input id="md" name="date" type="date" value="${state.me!.today}" max="${state.me!.today}" required></div>
          <div class="field" style="flex:1"><label for="mw">Weight (${wUnit()})</label><input id="mw" name="weight" type="number" step="0.1" min="30" inputmode="decimal"></div></div>
        <p class="small muted">Measurements are optional (${L}).</p>
        <div class="row">${[['waistCm', 'Waist'], ['chestCm', 'Chest'], ['hipsCm', 'Hips'], ['armCm', 'Arm'], ['thighCm', 'Thigh']].map(([k, l]) => html`<div class="field" style="width:calc(50% - 6px)"><label for="m-${k}">${l}</label><input id="m-${k}" name="${k}" type="number" step="0.1" min="0" inputmode="decimal"></div>`)}</div>
        <button class="btn btn-primary btn-block" type="submit">Save</button></form>`, (sh) => {
        sh.querySelector('form')!.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const f = formData(ev.target as HTMLFormElement);
          const body: Record<string, unknown> = { date: f.date, weightKg: wIn(numOrNull(f.weight)) };
          for (const k of ['waistCm', 'chestCm', 'hipsCm', 'armCm', 'thighCm']) body[k] = lenIn(numOrNull(f[k]));
          try {
            await api.post('/api/metrics', body);
            close();
            toast('Saved');
            await reload();
          } catch (x) {
            toast((x as Error).message, 'err');
          }
        });
      });
    },
  });
}
