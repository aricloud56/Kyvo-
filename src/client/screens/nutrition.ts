// Food diary: totals against targets, entries by meal, fast logging, edits, copy and saved meals.
import { api } from '../api.js';
import { state } from '../app.js';
import { confirmSheet, formData, html, numOrNull, onActions, sheet, toast } from '../dom.js';
import { SLOT_LABEL, kcal, longDate } from '../format.js';
import { meter, ring } from '../ui.js';
import { MEAL_SLOTS } from '../../core/types.js';
import type { MealSlot } from '../../core/types.js';
import { addDays } from '../../core/util.js';

const amountText = (e: any) => (e.grams != null ? `${Math.round(e.grams)} g` : e.portion != null ? `${e.portion} serving${e.portion === 1 ? '' : 's'}` : 'manual entry');
const macroText = (m: { p: number; c: number; f: number }) => `P ${Math.round(m.p)} g · C ${Math.round(m.c)} g · F ${Math.round(m.f)} g`;

export async function nutritionScreen(view: HTMLElement, params: string[]) {
  const date = params[0] ?? state.me!.today;
  const d = await api.get<any>(`/api/diary/${date}`);
  const t = d.targets;
  const isToday = date === state.me!.today;

  view.innerHTML = html`<div class="row between"><h1 style="margin:0">Nutrition</h1>
    <nav class="row" aria-label="Change day"><a class="btn btn-ghost btn-sm" href="#/nutrition/${addDays(date, -1)}" aria-label="Previous day">‹</a>${isToday ? '' : html`<a class="btn btn-ghost btn-sm" href="#/nutrition">Today</a>`}<a class="btn btn-ghost btn-sm" href="#/nutrition/${addDays(date, 1)}" aria-label="Next day">›</a></nav></div>
  <p class="muted">${longDate(date)}</p>
  <section class="card" aria-labelledby="tot-h"><h2 id="tot-h" class="sr-only">Totals</h2>
    ${t ? html`<div class="row" style="gap:18px;align-items:center">${ring(d.totals.kcal, t.kcal, String(Math.round(d.totals.kcal)), `of ${t.kcal} kcal`, 'Calories eaten')}
      <div style="flex:1;min-width:180px;display:grid;gap:10px">${meter(d.totals.p, t.proteinG, 'Protein')}${meter(d.totals.c, t.carbsG, 'Carbs')}${meter(d.totals.f, t.fatG, 'Fat')}</div></div>
      <p class="small" style="margin:12px 0 0">${d.remaining.kcal >= 0 ? html`<b>${kcal(d.remaining.kcal)}</b> and <b>${Math.max(0, d.remaining.p)} g protein</b> left today.` : html`You are <b>${kcal(-d.remaining.kcal)}</b> over your target today. That’s fine occasionally; tomorrow is a fresh start.`}</p>`
    : html`<p>${kcal(d.totals.kcal)} · ${macroText(d.totals)}</p><p class="small muted">Set your targets in <a href="#/profile">Profile</a> to see what’s left.</p>`}
  </section>
  <div class="row" style="margin:12px 0"><button class="btn btn-secondary btn-sm" data-action="copy">Copy yesterday</button><a class="btn btn-ghost btn-sm" href="#/recipes">Recipes</a></div>
  ${MEAL_SLOTS.map((slot) => {
    const list = d.bySlot[slot] as any[];
    const sub = list.reduce((a, e) => a + e.kcal, 0);
    return html`<section class="card" aria-labelledby="h-${slot}"><div class="card-head"><h2 id="h-${slot}" style="margin:0">${SLOT_LABEL[slot]}</h2><span class="small muted num">${Math.round(sub)} kcal</span></div>
      ${list.length ? html`<ul class="list">${list.map((e) => html`<li class="row between" style="gap:8px"><span><b>${e.name}</b>${e.fromPlan ? html` <span class="tag">From plan</span>` : ''}<br><span class="small muted">${amountText(e)} · ${Math.round(e.kcal)} kcal · ${macroText(e)}</span></span>
        <span class="row" style="gap:4px"><button class="btn btn-ghost btn-sm" data-action="edit" data-id="${e.id}" aria-label="Edit ${e.name}">Edit</button><button class="btn btn-ghost btn-sm" data-action="del" data-id="${e.id}" aria-label="Delete ${e.name}">✕</button></span></li>`)}</ul>` : html`<p class="small muted" style="margin:4px 0">Nothing logged yet.</p>`}
      <div class="row" style="margin-top:8px"><button class="btn btn-primary btn-sm" data-action="add" data-slot="${slot}">+ Add food</button>${list.length ? html`<button class="btn btn-ghost btn-sm" data-action="save" data-slot="${slot}">Save as meal</button>` : ''}</div></section>`;
  })}
  <p class="xs muted">Nutrition values are estimates based on generic foods. Check product labels when accuracy matters.</p>`.value;

  const reload = () => nutritionScreen(view, [date]);
  onActions(view, {
    add: (el) => {
      addFoodSheet(date, el.dataset.slot as MealSlot, reload);
    },
    copy: async () => {
      const r = await api.post<any>(`/api/diary/${date}/copy`, { fromDate: addDays(date, -1) });
      toast(r.copied ? `Copied ${r.copied} item${r.copied === 1 ? '' : 's'} from yesterday` : 'Nothing was logged yesterday');
      await reload();
    },
    del: async (el) => {
      if (!(await confirmSheet('Delete this entry?', 'It will be removed from your diary.', 'Delete', true))) return;
      await api.del(`/api/diary/entry/${el.dataset.id}`);
      toast('Entry deleted');
      await reload();
    },
    edit: (el) => {
      const e = d.entries.find((x: any) => x.id === el.dataset.id);
      const field = e.foodId ? html`<div class="field"><label for="ea">Amount (g)</label><input id="ea" name="grams" type="number" min="1" max="3000" step="1" value="${e.grams}" required></div>`
        : e.recipeId ? html`<div class="field"><label for="ea">Servings</label><input id="ea" name="portion" type="number" min="0.25" max="6" step="0.25" value="${e.portion}" required></div>`
        : html`<div class="row"><div class="field" style="flex:1"><label for="ek">Calories</label><input id="ek" name="kcal" type="number" min="0" value="${Math.round(e.kcal)}"></div><div class="field" style="flex:1"><label for="ep">Protein g</label><input id="ep" name="p" type="number" min="0" value="${e.p}"></div></div>
          <div class="row"><div class="field" style="flex:1"><label for="ec">Carbs g</label><input id="ec" name="c" type="number" min="0" value="${e.c}"></div><div class="field" style="flex:1"><label for="ef">Fat g</label><input id="ef" name="f" type="number" min="0" value="${e.f}"></div></div>`;
      const close = sheet(`Edit ${e.name}`, html`<form>${field}<div class="field"><label for="es">Meal</label><select id="es" name="slot">${MEAL_SLOTS.map((s) => html`<option value="${s}" ${s === e.slot ? 'selected' : ''}>${SLOT_LABEL[s]}</option>`)}</select></div>
        <button class="btn btn-primary btn-block" type="submit">Save changes</button></form>`, (sh) => {
        sh.querySelector('form')!.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const f = formData(ev.target as HTMLFormElement);
          const body: Record<string, unknown> = { slot: f.slot };
          for (const k of ['grams', 'portion', 'kcal', 'p', 'c', 'f']) if (f[k] !== undefined) body[k] = numOrNull(f[k]) ?? 0;
          try {
            await api.patch(`/api/diary/entry/${e.id}`, body);
            close();
            toast('Entry updated');
            await reload();
          } catch (x) {
            toast((x as Error).message, 'err');
          }
        });
      });
    },
    save: (el) => {
      const slot = el.dataset.slot as MealSlot;
      const close = sheet('Save as a meal', html`<form><p class="small muted">Saves everything in ${SLOT_LABEL[slot].toLowerCase()} so you can log it again in one tap.</p>
        <div class="field"><label for="mn">Name</label><input id="mn" name="name" maxlength="60" required value="My ${SLOT_LABEL[slot].toLowerCase()}"></div><button class="btn btn-primary btn-block" type="submit">Save meal</button></form>`, (sh) => {
        sh.querySelector('form')!.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try {
            await api.post('/api/saved-meals', { name: formData(ev.target as HTMLFormElement).name, entryIds: d.bySlot[slot].map((x: any) => x.id) });
            close();
            toast('Meal saved');
          } catch (x) {
            toast((x as Error).message, 'err');
          }
        });
      });
    },
  });
}

/** The add-food sheet: search, recent, favourites, saved meals, manual entry and custom foods. */
export function addFoodSheet(date: string, slot: MealSlot, done: () => void | Promise<void>) {
  const close = sheet(`Add to ${SLOT_LABEL[slot].toLowerCase()}`, html`
    <div class="seg" role="tablist" aria-label="Add food by">
      <button role="tab" data-tab="search" aria-selected="true">Search</button><button role="tab" data-tab="quick" aria-selected="false">Recent and saved</button><button role="tab" data-tab="manual" aria-selected="false">Manual</button></div>
    <div data-pane="search"><input type="search" id="fq" placeholder="Search foods and recipes" aria-label="Search foods and recipes" style="margin-top:10px"><ul class="list" id="fr" style="margin-top:8px"></ul></div>
    <div data-pane="quick" hidden><div id="qk" style="margin-top:10px"></div></div>
    <div data-pane="manual" hidden>
      <form id="mf" style="margin-top:10px"><p class="small muted">Quick add calories and macros for something not in the list.</p>
        <div class="field"><label for="mfn">Name</label><input id="mfn" name="name" maxlength="80" required></div>
        <div class="row"><div class="field" style="flex:1"><label for="mfk">Calories</label><input id="mfk" name="kcal" type="number" min="0" max="5000" required></div><div class="field" style="flex:1"><label for="mfp">Protein g</label><input id="mfp" name="p" type="number" min="0" step="0.1"></div></div>
        <div class="row"><div class="field" style="flex:1"><label for="mfc">Carbs g</label><input id="mfc" name="c" type="number" min="0" step="0.1"></div><div class="field" style="flex:1"><label for="mff">Fat g</label><input id="mff" name="f" type="number" min="0" step="0.1"></div></div>
        <button class="btn btn-primary btn-block" type="submit">Log it</button></form>
      <details style="margin-top:14px"><summary>Create a custom food (per 100 g)</summary>
      <form id="cf" style="margin-top:10px"><div class="field"><label for="cfn">Name</label><input id="cfn" name="name" maxlength="80" required></div>
        <div class="row"><div class="field" style="flex:1"><label for="cfk">kcal / 100 g</label><input id="cfk" name="kcal" type="number" min="0" max="950" required></div><div class="field" style="flex:1"><label for="cfp">Protein</label><input id="cfp" name="p" type="number" min="0" max="100" step="0.1" required></div></div>
        <div class="row"><div class="field" style="flex:1"><label for="cfc">Carbs</label><input id="cfc" name="c" type="number" min="0" max="100" step="0.1" required></div><div class="field" style="flex:1"><label for="cff">Fat</label><input id="cff" name="f" type="number" min="0" max="100" step="0.1" required></div></div>
        <div class="field"><label for="cfs">Usual serving (g)</label><input id="cfs" name="servingG" type="number" min="1" max="2000" value="100"></div>
        <button class="btn btn-secondary btn-block" type="submit">Save food</button></form></details>
    </div>`, (sh) => {
    const finish = async (msg: string) => {
      close();
      toast(msg);
      await done();
    };
    const logFood = (f: { id: string; name: string; serving?: { label: string; g: number } }, grams?: number | null) => {
      const g = grams ?? f.serving?.g ?? 100;
      const c2 = sheet(f.name, html`<form><div class="field"><label for="fg">Amount (g)</label><input id="fg" name="grams" type="number" min="1" max="3000" value="${g}" required>
        ${f.serving ? html`<p class="hint">One serving is ${f.serving.label} (${f.serving.g} g).</p>` : ''}</div><button class="btn btn-primary btn-block" type="submit">Log ${SLOT_LABEL[slot].toLowerCase()}</button></form>`, (s2) => {
        s2.querySelector('form')!.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try {
            await api.post(`/api/diary/${date}`, { slot, foodId: f.id, grams: numOrNull(formData(ev.target as HTMLFormElement).grams) });
            c2();
            await finish(`${f.name} logged`);
          } catch (x) {
            toast((x as Error).message, 'err');
          }
        });
      });
    };
    const logRecipe = async (id: string, name: string, portion = 1) => {
      try {
        await api.post(`/api/diary/${date}`, { slot, recipeId: id, portion });
        await finish(`${name} logged`);
      } catch (x) {
        toast((x as Error).message, 'err');
      }
    };

    sh.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      sh.querySelectorAll<HTMLElement>('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      sh.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
      if (b.dataset.tab === 'quick') void loadQuick();
    }));

    const q = sh.querySelector<HTMLInputElement>('#fq')!;
    const res = sh.querySelector<HTMLElement>('#fr')!;
    let foods: any[] = [];
    const search = async () => {
      const r = await api.get<any>(`/api/foods?q=${encodeURIComponent(q.value)}`);
      foods = r.foods;
      res.innerHTML = html`${r.recipes.slice(0, q.value ? 8 : 4).map((x: any) => html`<li><button class="btn btn-secondary btn-block" style="justify-content:space-between" data-recipe="${x.id}" data-name="${x.name}"><span>${x.name} <span class="tag">Recipe</span></span><span class="small muted">${Math.round(x.kcal)} kcal / serve</span></button></li>`)}
        ${r.foods.slice(0, 30).map((f: any) => html`<li><button class="btn btn-secondary btn-block" style="justify-content:space-between" data-food="${f.id}"><span>${f.name}</span><span class="small muted">${Math.round(f.kcal)} kcal / 100 g</span></button></li>`)}
        ${!r.foods.length && !r.recipes.length ? html`<li class="empty">No matches. Try the Manual tab.</li>` : ''}`.value;
    };
    res.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.food) logFood(foods.find((f) => f.id === b.dataset.food));
      else if (b.dataset.recipe) void logRecipe(b.dataset.recipe, b.dataset.name!);
    });
    let timer: number;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(search, 200);
    });
    void search();

    const qk = sh.querySelector<HTMLElement>('#qk')!;
    const loadQuick = async () => {
      const r = await api.get<any>('/api/foods/quick');
      qk.innerHTML = html`<h3>Recent</h3>${r.recent.length ? html`<ul class="list">${r.recent.map((x: any, i: number) => html`<li><button class="btn btn-secondary btn-block" data-recent="${i}">${x.name} <span class="small muted">${x.grams != null ? `${Math.round(x.grams)} g` : `${x.portion} serve`}</span></button></li>`)}</ul>` : html`<p class="small muted">Foods you log will appear here.</p>`}
        <h3>Saved meals</h3>${r.saved.length ? html`<ul class="list">${r.saved.map((s: any) => html`<li class="row between"><button class="btn btn-secondary" style="flex:1" data-saved="${s.id}">${s.name} <span class="small muted">${Math.round(s.kcal)} kcal</span></button><button class="btn btn-ghost btn-sm" data-unsave="${s.id}" aria-label="Delete saved meal ${s.name}">✕</button></li>`)}</ul>` : html`<p class="small muted">Use “Save as meal” on a meal you eat often.</p>`}`.value;
      qk.onclick = async (ev) => {
        const b = (ev.target as HTMLElement).closest<HTMLElement>('button');
        if (!b) return;
        try {
          if (b.dataset.recent) {
            const x = r.recent[Number(b.dataset.recent)];
            if (x.recipeId) await logRecipe(x.recipeId, x.name, x.portion ?? 1);
            else {
              await api.post(`/api/diary/${date}`, { slot, foodId: x.foodId, grams: x.grams });
              await finish(`${x.name} logged`);
            }
          } else if (b.dataset.saved) {
            await api.post(`/api/saved-meals/${b.dataset.saved}/log`, { date, slot });
            await finish('Saved meal logged');
          } else if (b.dataset.unsave) {
            await api.del(`/api/saved-meals/${b.dataset.unsave}`);
            await loadQuick();
          }
        } catch (x) {
          toast((x as Error).message, 'err');
        }
      };
    };

    sh.querySelector<HTMLFormElement>('#mf')!.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = formData(ev.target as HTMLFormElement);
      try {
        await api.post(`/api/diary/${date}`, { slot, name: f.name, kcal: numOrNull(f.kcal), p: numOrNull(f.p) ?? 0, c: numOrNull(f.c) ?? 0, f: numOrNull(f.f) ?? 0 });
        await finish(`${f.name} logged`);
      } catch (x) {
        toast((x as Error).message, 'err');
      }
    });
    sh.querySelector<HTMLFormElement>('#cf')!.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = formData(ev.target as HTMLFormElement);
      try {
        const food = await api.post<any>('/api/foods', { name: f.name, kcal: numOrNull(f.kcal), p: numOrNull(f.p), c: numOrNull(f.c), f: numOrNull(f.f), servingG: numOrNull(f.servingG) ?? 100 });
        toast('Food saved');
        logFood(food);
      } catch (x) {
        toast((x as Error).message, 'err');
      }
    });
  });
  return close;
}

