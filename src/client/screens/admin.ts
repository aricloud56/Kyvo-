// Admin dashboard. Every call here is checked server-side for the admin role; the UI is only a view.
import { api } from '../api.js';
import { state } from '../app.js';
import { html, onActions, sheet, toast } from '../dom.js';
import { GROUP_LABEL } from '../format.js';

let tab = 'overview';

export async function adminScreen(view: HTMLElement) {
  if (state.me?.user.role !== 'admin') {
    view.innerHTML = html`<h1>Admin</h1><p class="muted">You don’t have access to this page.</p>`.value;
    return;
  }
  const tabs: [string, string][] = [['overview', 'Overview'], ['quality', 'Content quality'], ['exercises', 'Exercises'], ['recipes', 'Recipes'], ['system', 'Errors and billing']];
  view.innerHTML = html`<h1>Admin</h1>
  <div class="seg" role="group" aria-label="Admin sections" style="margin-bottom:14px;flex-wrap:wrap">${tabs.map(([k, l]) => html`<button data-action="tab" data-tab="${k}" aria-pressed="${tab === k ? 'true' : 'false'}">${l}</button>`)}</div>
  <div id="ad"></div>`.value;
  const el = view.querySelector<HTMLElement>('#ad')!;
  onActions(view, {
    tab: async (b) => {
      tab = b.dataset.tab!;
      await adminScreen(view);
    },
  });

  if (tab === 'overview') {
    const o = await api.get<any>('/api/admin/overview');
    const ev = (name: string) => o.funnel.find((f: any) => f.name === name)?.users ?? 0;
    el.innerHTML = html`<div class="stat-grid"><div class="stat"><b>${o.users.total}</b><span>accounts</span></div><div class="stat"><b>${o.users.week}</b><span>new this week</span></div>
      <div class="stat"><b>${o.onboarded}</b><span>finished onboarding</span></div><div class="stat"><b>${o.activeLast7Days}</b><span>trained in last 7 days</span></div></div>
    <section class="card" style="margin-top:14px"><h2>Funnel, last 30 days (people)</h2><table class="data"><tbody>
      <tr><td>Landing page views</td><td>${o.funnel.find((f: any) => f.name === 'landing_view')?.n ?? 0} views</td></tr>
      ${[['signup', 'Signed up'], ['onboarding_complete', 'Finished onboarding'], ['first_workout', 'Completed a first workout'], ['first_meal_log', 'Logged a first meal'], ['checkout_started', 'Started checkout'], ['subscribed', 'Subscribed']].map(([k, l]) => html`<tr><td>${l}</td><td>${ev(k)}</td></tr>`)}</tbody></table></section>
    <section class="card"><h2>Subscriptions</h2>${o.subscriptions.length ? html`<table class="data"><thead><tr><th>Status</th><th>Plan</th><th>Count</th></tr></thead><tbody>${o.subscriptions.map((s: any) => html`<tr><td>${s.status}</td><td>${s.plan_interval ?? '–'}</td><td>${s.n}</td></tr>`)}</tbody></table>` : html`<p class="muted small">No subscriptions yet.</p>`}
      <p class="small muted">Stripe ${o.billingConfigured ? 'is configured' : 'is not configured in this environment'}.</p></section>
    <section class="card"><h2>Campaigns (UTM)</h2><div class="table-scroll"><table class="data"><thead><tr><th>Campaign</th><th>Sign-ups</th><th>Onboarded</th><th>Premium</th></tr></thead><tbody>
      ${o.campaigns.map((c: any) => html`<tr><td>${c.campaign}</td><td>${c.signups}</td><td>${c.onboarded}</td><td>${c.premium}</td></tr>`)}</tbody></table></div></section>`.value;
  } else if (tab === 'quality') {
    const q = await api.get<any>('/api/admin/quality');
    el.innerHTML = html`<p>${q.exercises} exercises · ${q.recipes} recipes · ${q.foods} foods · <b>${q.issues.length}</b> issues</p>
    <div class="table-scroll"><table class="data"><thead><tr><th>Type</th><th>Item</th><th>Issue</th></tr></thead><tbody>${q.issues.slice(0, 300).map((i: any) => html`<tr><td>${i.kind}</td><td>${i.kind === 'exercise' ? html`<a href="#/exercise/${i.id}">${i.name}</a>` : html`<a href="#/recipe/${i.id}">${i.name}</a>`}</td><td>${i.issue}</td></tr>`)}</tbody></table></div>`.value;
  } else if (tab === 'exercises') {
    const list = await api.get<any[]>('/api/admin/exercises');
    el.innerHTML = html`<p class="small muted">${list.length} exercises. Choose one to edit its name, access level, cues and safety notes, or to add a demonstration.</p>
    <ul class="list card">${list.map((x) => html`<li class="row between"><span><b>${x.name}</b><br><span class="small muted">${x.groups.map((g: string) => GROUP_LABEL[g] ?? g).join(', ')} · ${x.media} media${x.premium ? ' · Premium' : ''}</span></span><button class="btn btn-secondary btn-sm" data-action="editex" data-id="${x.id}">Edit</button></li>`)}</ul>`.value;
    onActions(el, { editex: (b) => editExercise(b.dataset.id!, () => adminScreen(view)) });
  } else if (tab === 'recipes') {
    const list = await api.get<any[]>('/api/admin/recipes');
    el.innerHTML = html`<ul class="list card">${list.map((x) => html`<li class="row between"><span><b>${x.name}</b><br><span class="small muted">${x.meal_types.join(', ')}${x.premium ? ' · Premium' : ''}${x.published ? '' : ' · Hidden'}</span></span><button class="btn btn-secondary btn-sm" data-action="editrc" data-id="${x.id}">Edit</button></li>`)}</ul>`.value;
    onActions(el, {
      editrc: (b) => {
        const x = list.find((r) => r.id === b.dataset.id);
        const close = sheet(`Edit ${x.name}`, html`<form><div class="field"><label for="rn">Name</label><input id="rn" name="name" value="${x.name}" required></div>
          <div class="field"><label for="rd">Description</label><textarea id="rd" name="description" rows="3">${x.description ?? ''}</textarea></div>
          <label class="check"><input type="checkbox" name="premium" ${x.premium ? 'checked' : ''}> Premium only</label><label class="check"><input type="checkbox" name="published" ${x.published ? 'checked' : ''}> Published</label>
          <p class="hint">Ingredients and nutrition come from the seed data so values stay traceable; edit data/recipes.json and re-seed to change them.</p>
          <button class="btn btn-primary btn-block" type="submit">Save</button></form>`, (sh) => {
          sh.querySelector('form')!.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const f = new FormData(ev.target as HTMLFormElement);
            try {
              await api.put(`/api/admin/recipes/${x.id}`, { name: f.get('name'), description: f.get('description'), premium: f.get('premium') === 'on', published: f.get('published') === 'on' });
              close();
              toast('Recipe saved');
              await adminScreen(view);
            } catch (e) {
              toast((e as Error).message, 'err');
            }
          });
        });
      },
    });
  } else {
    const [errors, events] = await Promise.all([api.get<any[]>('/api/admin/errors'), api.get<any[]>('/api/admin/billing-events')]);
    el.innerHTML = html`<section class="card"><h2>Recent errors</h2>${errors.length ? html`<div class="table-scroll"><table class="data"><thead><tr><th>When</th><th>Route</th><th>Message</th><th>Request</th></tr></thead><tbody>${errors.map((e) => html`<tr><td>${String(e.created_at).slice(0, 16).replace('T', ' ')}</td><td>${e.route}</td><td>${e.message}</td><td class="xs">${e.request_id}</td></tr>`)}</tbody></table></div>` : html`<p class="muted small">No errors logged.</p>`}</section>
    <section class="card"><h2>Stripe webhook events</h2>${events.length ? html`<div class="table-scroll"><table class="data"><thead><tr><th>Received</th><th>Type</th><th>Processed</th></tr></thead><tbody>${events.map((e) => html`<tr><td>${String(e.received_at).slice(0, 16).replace('T', ' ')}</td><td>${e.type}</td><td>${e.processed_at ? 'Yes' : 'No'}</td></tr>`)}</tbody></table></div>` : html`<p class="muted small">No webhook events received.</p>`}</section>`.value;
  }
}

async function editExercise(id: string, done: () => Promise<void>) {
  const d = await api.get<any>(`/api/admin/exercises/${id}`);
  const e = d.exercise;
  const close = sheet(`Edit ${e.name}`, html`<form id="exf"><div class="field"><label for="en">Name</label><input id="en" name="name" value="${e.name}" required></div>
    <label class="check"><input type="checkbox" name="premium" ${e.premium ? 'checked' : ''}> Premium only</label><label class="check"><input type="checkbox" name="published" ${e.published ? 'checked' : ''}> Published</label>
    <div class="field"><label for="ec">Coaching cues (one per line)</label><textarea id="ec" name="cues" rows="4">${(e.content.cues ?? []).join('\n')}</textarea></div>
    <div class="field"><label for="es">Safety notes (one per line)</label><textarea id="es" name="safety" rows="4">${(e.content.safety ?? []).join('\n')}</textarea></div>
    <button class="btn btn-primary btn-block" type="submit">Save exercise</button></form>
    <h3 style="margin-top:18px">Demonstrations</h3>
    <ul class="list">${d.media.map((m: any) => html`<li><b>${m.kind}</b> ${m.ref}<br><span class="xs muted">${m.attribution} · ${m.license} · ${m.verified_note ?? ''}</span><br>
      <select data-media="${m.id}" aria-label="Status of ${m.ref}">${['active', 'hidden', 'broken'].map((s) => html`<option ${m.status === s ? 'selected' : ''}>${s}</option>`)}</select></li>`)}</ul>
    <details><summary>Add a demonstration</summary><form id="mf"><p class="hint">Only add media you have checked plays and that you are licensed to use.</p>
      <div class="field"><label for="mk">Type</label><select id="mk" name="kind"><option value="youtube">YouTube video id</option><option value="video">Video file path or URL</option><option value="image">Image path or URL</option></select></div>
      <div class="field"><label for="mr">Video id or URL</label><input id="mr" name="ref" required></div>
      <div class="field"><label for="mt">Title</label><input id="mt" name="title"></div>
      <div class="field"><label for="ms">Source page</label><input id="ms" name="source" required></div>
      <div class="field"><label for="ml">Licence</label><input id="ml" name="license" required></div>
      <div class="field"><label for="ma">Attribution</label><input id="ma" name="attribution" required></div>
      <button class="btn btn-secondary btn-block" type="submit">Add demonstration</button></form></details>`, (sh) => {
    const lines = (s: FormDataEntryValue | null) => String(s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    sh.querySelector<HTMLFormElement>('#exf')!.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target as HTMLFormElement);
      try {
        await api.put(`/api/admin/exercises/${id}`, { name: f.get('name'), premium: f.get('premium') === 'on', published: f.get('published') === 'on', cues: lines(f.get('cues')), safety: lines(f.get('safety')) });
        close();
        toast('Exercise saved');
        await done();
      } catch (x) {
        toast((x as Error).message, 'err');
      }
    });
    sh.querySelector<HTMLFormElement>('#mf')!.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target as HTMLFormElement));
      try {
        await api.post(`/api/admin/exercises/${id}/media`, f);
        close();
        toast('Demonstration added');
        await done();
      } catch (x) {
        toast((x as Error).message, 'err');
      }
    });
    sh.querySelectorAll<HTMLSelectElement>('[data-media]').forEach((s) => s.addEventListener('change', async () => {
      await api.put(`/api/admin/media/${s.dataset.media}`, { status: s.value });
      toast('Status updated');
    }));
  });
}
