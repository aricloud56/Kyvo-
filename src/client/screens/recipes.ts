// Recipe library and recipe detail with serving scaling.
import { api } from '../api.js';
import { lockedCard, state } from '../app.js';
import { html, numOrNull, onActions, raw, sheet, toast } from '../dom.js';
import { SLOT_LABEL, kcal } from '../format.js';
import { ALLERGEN_LABELS } from '../../core/nutrition.js';
import { MEAL_SLOTS } from '../../core/types.js';
import { icon } from '../ui.js';
import { assetUrl, loadVisuals, photoCredit, recipePhoto } from '../visuals/assets.js';

const TAGS: Record<string, string> = { 'high-protein': 'High protein', vegetarian: 'Vegetarian', vegan: 'Vegan', quick: 'Quick', budget: 'Budget', 'meal-prep': 'Meal prep', shake: 'Shakes', 'halal-friendly': 'Halal-friendly' };
const filters = { q: '', meal: '', tag: '', favourites: false };

export async function recipesScreen(view: HTMLElement) {
  await loadVisuals();
  view.innerHTML = html`<p class="muted small"><a href="#/nutrition">‹ Nutrition</a></p><h1>Recipes</h1>
  <div class="card" role="search"><input type="search" id="rq" placeholder="Search recipes" aria-label="Search recipes" value="${filters.q}">
    <div class="row" style="margin-top:10px">
      <select id="rm" aria-label="Meal" style="flex:1"><option value="">Any meal</option>${MEAL_SLOTS.map((s) => html`<option value="${s}" ${filters.meal === s ? 'selected' : ''}>${SLOT_LABEL[s]}</option>`)}</select>
      <select id="rt" aria-label="Type" style="flex:1"><option value="">Any type</option>${Object.entries(TAGS).map(([k, v]) => html`<option value="${k}" ${filters.tag === k ? 'selected' : ''}>${v}</option>`)}</select></div>
    <label class="check"><input type="checkbox" id="rf" ${filters.favourites ? 'checked' : ''}> Favourites only</label></div>
  <ul class="list card" id="rres" aria-live="polite"></ul>`.value;
  const res = view.querySelector<HTMLElement>('#rres')!;
  const load = async () => {
    const p = new URLSearchParams();
    if (filters.q) p.set('q', filters.q);
    if (filters.meal) p.set('meal', filters.meal);
    if (filters.tag) p.set('tag', filters.tag);
    if (filters.favourites) p.set('favourites', '1');
    const list = await api.get<any[]>(`/api/recipes?${p}`);
    res.innerHTML = list.length
      ? html`${list.map((x) => { const ph = recipePhoto(x.id); return html`<li><a href="#/recipe/${x.id}" class="row" style="color:var(--text);text-decoration:none;gap:12px;flex-wrap:nowrap">${ph ? html`<img class="meal-thumb" style="width:56px;height:56px" src="${assetUrl(ph.file)}" alt="" loading="lazy">` : html`<span class="meal-thumb ph" style="width:56px;height:56px" aria-hidden="true">${icon('food', 22)}</span>`}<span class="grow" style="min-width:0"><b>${x.name}</b>${x.favourite ? ' ★' : ''}<br>
          <span class="small muted">${Math.round(x.perServing.kcal)} kcal · ${Math.round(x.perServing.p)} g protein · ${x.prep + x.cook} min</span></span>${x.locked ? html`<span class="tag accent">Premium</span>` : ''}</a></li>`; })}`.value
      : html`<li class="empty">No recipes match those filters.</li>`.value;
  };
  let t: number;
  view.querySelector<HTMLInputElement>('#rq')!.addEventListener('input', (e) => {
    filters.q = (e.target as HTMLInputElement).value.trim();
    clearTimeout(t);
    t = window.setTimeout(load, 200);
  });
  view.querySelector<HTMLSelectElement>('#rm')!.addEventListener('change', (e) => { filters.meal = (e.target as HTMLSelectElement).value; void load(); });
  view.querySelector<HTMLSelectElement>('#rt')!.addEventListener('change', (e) => { filters.tag = (e.target as HTMLSelectElement).value; void load(); });
  view.querySelector<HTMLInputElement>('#rf')!.addEventListener('change', (e) => { filters.favourites = (e.target as HTMLInputElement).checked; void load(); });
  await load();
}

export async function recipeScreen(view: HTMLElement, params: string[], servings?: number) {
  const [x] = await Promise.all([api.get<any>(`/api/recipes/${params[0]}${servings ? `?servings=${servings}` : ''}`), loadVisuals()]);
  const ph = recipePhoto(x.id);
  const head = html`<p class="muted small"><a href="#/recipes">‹ Recipes</a></p>
  ${ph ? html`<figure style="margin:0 0 14px"><img class="meal-photo" src="${assetUrl(ph.file)}" alt="${x.name}, serving suggestion" width="${ph.w}" height="${ph.h}"><figcaption class="hero-note">${raw(photoCredit(ph))}</figcaption></figure>` : ''}
  <div class="row between"><h1 style="margin:0">${x.name}</h1><button class="btn btn-ghost btn-sm" data-action="fav" aria-pressed="${x.favourite ? 'true' : 'false'}">${x.favourite ? '★ Saved' : '☆ Save'}</button></div>
  <p class="muted">${x.desc}</p>
  <p class="small">${x.meal.map((m: string) => SLOT_LABEL[m]).join(', ')} · Prep ${x.prep} min · Cook ${x.cook} min · Makes ${x.servings}</p>
  <div class="stat-grid"><div class="stat"><b>${Math.round(x.perServing.kcal)}</b><span>kcal per serve</span></div><div class="stat"><b>${Math.round(x.perServing.p)} g</b><span>protein</span></div>
    <div class="stat"><b>${Math.round(x.perServing.c)} g</b><span>carbs</span></div><div class="stat"><b>${Math.round(x.perServing.f)} g</b><span>fat</span></div></div>
  <p class="small" style="margin-top:10px">${x.allergens.length ? html`<b>Contains:</b> ${x.allergens.map((a: string) => (ALLERGEN_LABELS as Record<string, string>)[a] ?? a).join(', ')}. ` : 'No common allergens found in the ingredient list. '}<span class="muted">Always check product labels.</span></p>`;
  if (x.locked) {
    view.innerHTML = html`${head}${raw(lockedCard('This recipe'))}`.value;
  } else {
    view.innerHTML = html`${head}
    <section class="card"><div class="card-head"><h2 style="margin:0">Ingredients</h2>
      <label class="row small" style="gap:6px;margin:0">Servings <input type="number" id="sv" min="0.5" max="20" step="0.5" value="${x.chosenServings}" style="width:80px"></label></div>
      <ul>${x.ingredients.map((i: any) => html`<li>${i.name} <span class="muted num">${i.grams} g</span></li>`)}</ul>
      <p class="small muted">For ${x.chosenServings} serve${x.chosenServings === 1 ? '' : 's'}: ${kcal(x.totalForServings.kcal)} · P ${x.totalForServings.p} g · C ${x.totalForServings.c} g · F ${x.totalForServings.f} g</p></section>
    <section class="card"><h2>Method</h2><ol class="steps">${x.steps.map((s: string) => html`<li>${s}</li>`)}</ol></section>
    ${x.storage ? html`<section class="card"><h2>Storage</h2><p class="small">${x.storage}</p></section>` : ''}
    ${x.subs?.length ? html`<section class="card"><h2>Swaps</h2><ul>${x.subs.map((s: string) => html`<li>${s}</li>`)}</ul></section>` : ''}
    <button class="btn btn-primary btn-block" data-action="log">Add to my diary</button>
    <p class="xs muted">${x.source}</p>`.value;
    const sv = view.querySelector<HTMLInputElement>('#sv')!;
    sv.addEventListener('change', () => {
      const n = numOrNull(sv.value);
      if (n && n >= 0.5 && n <= 20) void recipeScreen(view, params, n);
    });
  }
  onActions(view, {
    fav: async (el) => {
      const on = el.getAttribute('aria-pressed') !== 'true';
      await api.post('/api/favourites', { kind: 'recipe', refId: x.id, on });
      el.setAttribute('aria-pressed', String(on));
      el.textContent = on ? '★ Saved' : '☆ Save';
    },
    log: () => {
      const close = sheet(`Log ${x.name}`, html`<form><div class="field"><label for="ls">Meal</label><select id="ls" name="slot">${MEAL_SLOTS.map((s) => html`<option value="${s}" ${x.meal[0] === s ? 'selected' : ''}>${SLOT_LABEL[s]}</option>`)}</select></div>
        <div class="field"><label for="lp">Servings eaten</label><input id="lp" name="portion" type="number" min="0.25" max="6" step="0.25" value="1"></div>
        <button class="btn btn-primary btn-block" type="submit">Log it</button></form>`, (sh) => {
        sh.querySelector('form')!.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const fd = new FormData(ev.target as HTMLFormElement);
          try {
            await api.post(`/api/diary/${state.me!.today}`, { slot: fd.get('slot'), recipeId: x.id, portion: numOrNull(String(fd.get('portion'))) ?? 1 });
            close();
            toast('Added to today’s diary');
          } catch (e) {
            toast((e as Error).message, 'err');
          }
        });
      });
    },
  });
}
