// Preview entry: loads the real content files, swaps in the in-browser DemoApi, then starts the normal app.
import { setApi } from '../api.js';
import { DemoApi } from './demoApi.js';
import { toast } from '../dom.js';

// Server pages (legal pages, data export, sign-out) don't exist in the preview, so links to them stay put.
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]');
  if (!a) return;
  e.preventDefault();
  toast('That page is part of the full KYVO site, not this preview.');
});

const load = (f: string) => fetch(`data/${f}`).then((r) => {
  if (!r.ok) throw new Error(`Could not load ${f}`);
  return r.json();
});

document.body.classList.add('app');

try {
  const [exercises, media, foods, foodsExtra, recipes] = await Promise.all(['exercises.json', 'exercise_media.json', 'foods.json', 'foods_extra.json', 'recipes.json'].map(load));
  setApi(new DemoApi({ exercises, media, foods: [...foods, ...foodsExtra], recipes }));
  await import('../main.js');
} catch (e) {
  document.getElementById('app')!.innerHTML = `<div class="card" style="margin:24px"><h1>Preview failed to load</h1><p class="muted">${String((e as Error).message).replace(/</g, '&lt;')}</p></div>`;
}
