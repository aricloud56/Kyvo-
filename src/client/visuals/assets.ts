// Loads the static illustration data (movement figures and licensed photos) once and renders tiles from it.
import { api } from '../api.js';
import { figureSVG, type FigureDef } from './figure.js';

export interface Photo { file: string; w: number; h: number; by: string; license: string; source: string; note?: string }
interface PhotoData { exercises: Record<string, Photo[]>; recipes: Record<string, Photo> }

let figures: Record<string, FigureDef & { approx?: boolean }> = {};
let photos: PhotoData = { exercises: {}, recipes: {} };
let loading: Promise<void> | null = null;

/** Static files live next to the page in the preview and at the site root in the app. */
export const assetUrl = (p: string) => (api.demo ? p.replace(/^\//, '') : `/${p.replace(/^\//, '')}`);

export function loadVisuals(): Promise<void> {
  loading ??= Promise.all([
    fetch(assetUrl('data/figures.json')).then((r) => (r.ok ? r.json() : {})),
    fetch(assetUrl('data/photos.json')).then((r) => (r.ok ? r.json() : { exercises: {}, recipes: {} })),
  ]).then(([f, p]) => {
    figures = f;
    photos = p;
  }).catch(() => undefined);
  return loading;
}

export const figureFor = (id: string) => figures[id];
export const exercisePhotos = (id: string): Photo[] => photos.exercises[id] ?? [];
export const recipePhoto = (id: string): Photo | undefined => photos.recipes[id];

/** Square illustration tile for an exercise; static unless animate is set. */
export function exerciseTile(id: string, name: string, primary: string[] = [], opts: { animate?: boolean; photo?: boolean; className?: string } = {}): string {
  const ph = opts.photo ? exercisePhotos(id)[0] : undefined;
  if (ph) return `<div class="fig-tile photo ${opts.className ?? ''}"><img src="${assetUrl(ph.file)}" alt="${esc(name)}" loading="lazy"></div>`;
  const f = figures[id];
  if (!f) return `<div class="fig-tile empty ${opts.className ?? ''}" aria-hidden="true"></div>`;
  return `<div class="fig-tile ${opts.className ?? ''}">${figureSVG(f, { label: `${name} movement`, animate: opts.animate ?? false, t: 1, primary })}</div>`;
}

export const photoCredit = (p: Photo) =>
  `Photo: ${esc(p.by)}, ${esc(p.license)}, via <a href="${esc(p.source)}" target="_blank" rel="noopener">Wikimedia Commons</a>.${p.note ? ` ${esc(p.note)}` : ''}`;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
