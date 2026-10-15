// Loads the static illustration data (movement figures and licensed photos) once and renders tiles from it.
import { api } from '../api.js';
import { figureSVG, type FigureDef } from './figure.js';
import type { Model3D } from './viewer3d.js';

export interface Photo { file: string; w: number; h: number; by: string; license: string; source: string; note?: string }
interface PhotoData { exercises: Record<string, Photo[]>; recipes: Record<string, Photo> }

/** One camera angle of a demonstration. A video angle lists sources (MP4/WebM) and a poster; an image angle has image. */
export interface DemoAngle { label: string; video?: { src: string; type: string }[]; poster?: string; image?: string; still?: boolean; credit: string; sample?: boolean }
interface DemoData { exercises: Record<string, { angles?: DemoAngle[]; model3d?: Model3D }> }
interface PackData { vendor: string; license: string; exercises: Record<string, { file: string; kind: 'video' | 'image'; still?: boolean; title: string }> }

let figures: Record<string, FigureDef & { approx?: boolean }> = {};
let photos: PhotoData = { exercises: {}, recipes: {} };
let demos: DemoData = { exercises: {} };
let pack: PackData | null = null;
let loading: Promise<void> | null = null;

/** Static files live next to the page in the preview and at the site root in the app. */
export const assetUrl = (p: string) => (api.demo ? p.replace(/^\//, '') : `/${p.replace(/^\//, '')}`);

export function loadVisuals(): Promise<void> {
  loading ??= Promise.all([
    fetch(assetUrl('data/figures.json')).then((r) => (r.ok ? r.json() : {})),
    fetch(assetUrl('data/photos.json')).then((r) => (r.ok ? r.json() : { exercises: {}, recipes: {} })),
    // Hand-picked demos (demos.json) and an imported licensed pack (media-pack.json, created by
    // scripts/media/import-pack.mjs). Either may be missing; the viewer then falls back to illustrations.
    fetch(assetUrl('data/demos.json')).then((r) => (r.ok ? r.json() : { exercises: {} })).catch(() => ({ exercises: {} })),
    fetch(assetUrl('data/media-pack.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]).then(([f, p, d, k]) => {
    figures = f;
    photos = p;
    demos = d;
    pack = k;
  }).catch(() => undefined);
  return loading;
}

export const figureFor = (id: string) => figures[id];
export const exercisePhotos = (id: string): Photo[] => photos.exercises[id] ?? [];
export const model3dFor = (id: string): Model3D | undefined => demos.exercises[id]?.model3d;
export const curatedDemo = (id: string): DemoAngle[] | undefined => demos.exercises[id]?.angles;
export function packDemo(id: string): DemoAngle[] | undefined {
  const m = pack?.exercises[id];
  if (!m || !pack) return undefined;
  const credit = `Demonstration: ${pack.vendor}. ${pack.license}.`;
  if (m.kind === 'video') return [{ label: 'Default', video: [{ src: m.file, type: m.file.endsWith('.webm') ? 'video/webm' : 'video/mp4' }], credit }];
  return [{ label: 'Default', image: m.file, still: !!m.still, credit }];
}
export const recipePhoto = (id: string): Photo | undefined => photos.recipes[id];

/** Square illustration tile for an exercise; static unless animate is set. */
export function exerciseTile(id: string, name: string, primary: string[] = [], opts: { animate?: boolean; photo?: boolean; className?: string } = {}): string {
  const d = (curatedDemo(id) ?? packDemo(id))?.[0];
  const still = d?.poster ?? d?.image;
  if (still) return `<div class="fig-tile photo demo ${opts.className ?? ''}"><img src="${assetUrl(still)}" alt="${esc(name)}" loading="lazy"></div>`;
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
