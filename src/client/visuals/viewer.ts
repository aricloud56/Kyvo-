// Reusable exercise demonstration viewer. One component for every exercise: it picks the best media the exercise
// has (a 3D demo video or image from public/data/demos.json or an imported licensed pack, a photo, a linked video,
// or the KYVO movement illustration) and gives it the same controls, camera angles, loading state and fallback.
// Media lives in data files, never in this code, so assets can be replaced without touching the viewer.
import { assetUrl, exercisePhotos, figureFor, packDemo, curatedDemo, photoCredit, type DemoAngle } from './assets.js';
import { figureSVG } from './figure.js';
import { muscleName } from './muscles.js';

export type Source = 'demo' | 'movement' | 'photo';
export interface ViewerState { source: Source | null; angle: number; speed: 1 | 0.5; paused: boolean }
export const newViewerState = (): ViewerState => ({ source: null, angle: 0, speed: 1, paused: false });

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const I = {
  play: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  replay: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" fill="currentColor"/></svg>',
};

export function demoAngles(id: string): DemoAngle[] {
  return curatedDemo(id) ?? packDemo(id) ?? [];
}

export function availableSources(id: string): Source[] {
  const out: Source[] = [];
  if (demoAngles(id).length) out.push('demo');
  if (figureFor(id)) out.push('movement');
  if (exercisePhotos(id).length) out.push('photo');
  return out;
}

const SOURCE_LABEL: Record<Source, string> = { demo: 'Demo', movement: 'Movement', photo: 'Photo' };

function stage(x: { id: string; name: string }, st: ViewerState, src: Source | undefined): string {
  if (src === 'demo') {
    const angles = demoAngles(x.id);
    const a = angles[Math.min(st.angle, angles.length - 1)];
    if (a.video) {
      return `<div class="vw-stage" data-kind="video">
        <video class="vw-media" playsinline muted loop preload="metadata" ${a.poster ? `poster="${assetUrl(a.poster)}"` : ''} aria-label="${esc(`${x.name} demonstration, ${a.label} view`)}">
          ${a.video.map((v) => `<source src="${assetUrl(v.src)}" type="${v.type}">`).join('')}
        </video>
        <div class="vw-loading" role="status"><span class="spin" aria-hidden="true"></span><span>Loading demo…</span></div>
        <div class="vw-fallback" hidden>${figureFallback(x)}<p>The demo video could not be loaded. The movement illustration and written steps below still apply.</p></div>
      </div>`;
    }
    return `<div class="vw-stage" data-kind="image"><img class="vw-media" src="${assetUrl(a.image!)}" alt="${esc(`${x.name}, ${a.label} view`)}" loading="eager"><div class="vw-fallback" hidden>${figureFallback(x)}<p>The demo image could not be loaded.</p></div>
      ${a.still ? '<span class="vw-badge">Still image</span>' : ''}</div>`;
  }
  if (src === 'photo') {
    const p = exercisePhotos(x.id)[0];
    return `<div class="vw-stage" data-kind="image"><img class="vw-media cover" src="${assetUrl(p.file)}" alt="${esc(x.name)}" width="${p.w}" height="${p.h}"><span class="vw-badge">Photo</span></div>`;
  }
  if (src === 'movement') {
    const f = figureFor(x.id)!;
    return `<div class="vw-stage fig-stage" data-kind="svg">${figureSVG(f, { label: `${x.name}: animated start and end position`, dur: 2.6 / st.speed })}</div>`;
  }
  return `<div class="vw-stage" data-kind="none">${figureFallback(x)}<p>No demonstration yet. Follow the written steps below.</p></div>`;
}

function figureFallback(x: { id: string; name: string }): string {
  const f = figureFor(x.id);
  return f ? `<div class="vw-fig">${figureSVG(f, { label: `${x.name} movement`, animate: false, t: 1 })}</div>` : '';
}

function caption(x: { id: string }, src: Source | undefined, st: ViewerState): string {
  if (src === 'demo') {
    const a = demoAngles(x.id)[Math.min(st.angle, demoAngles(x.id).length - 1)];
    return `${a.sample ? '<b>Sample asset.</b> ' : ''}${esc(a.credit)}`;
  }
  if (src === 'photo') return photoCredit(exercisePhotos(x.id)[0]);
  if (src === 'movement') return figureFor(x.id)?.approx ? 'Illustration of a closely related movement. Follow the written steps for this exact version.' : 'KYVO movement illustration: start and end position.';
  return '';
}

/** Markup for the whole viewer. Call wireViewer() on the container after inserting it. */
export function exerciseViewer(x: { id: string; name: string; primary?: string[]; secondary?: string[] }, st: ViewerState): string {
  const sources = availableSources(x.id);
  const src = st.source && sources.includes(st.source) ? st.source : sources[0];
  const angles = src === 'demo' ? demoAngles(x.id) : [];
  const animated = src === 'movement' || (src === 'demo' && !!angles[Math.min(st.angle, angles.length - 1)]?.video);
  const primary = x.primary ?? [], secondary = (x.secondary ?? []).filter((m) => !primary.includes(m));
  return `<div class="viewer" data-src="${src ?? 'none'}">
    ${stage(x, st, src)}
    ${animated ? `<div class="vw-controls" role="group" aria-label="Playback">
      <button type="button" class="vw-btn" data-vw="toggle" aria-label="${st.paused ? 'Play' : 'Pause'}">${st.paused ? I.play : I.pause}</button>
      <button type="button" class="vw-btn" data-vw="replay" aria-label="Replay from the start">${I.replay}</button>
      <button type="button" class="vw-btn vw-speed" data-vw="speed" aria-pressed="${st.speed === 0.5}" aria-label="Slow motion">${st.speed === 0.5 ? '0.5×' : '1×'}</button>
    </div>` : ''}
    ${sources.length > 1 || angles.length > 1 ? `<div class="vw-pickers">
      ${sources.length > 1 ? `<div class="hero-switch" role="group" aria-label="Demonstration type">${sources.map((s) => `<button type="button" data-vw="source" data-v="${s}" aria-pressed="${s === src}">${SOURCE_LABEL[s]}</button>`).join('')}</div>` : ''}
      ${angles.length > 1 ? `<div class="hero-switch" role="group" aria-label="Camera angle">${angles.map((a, i) => `<button type="button" data-vw="angle" data-v="${i}" aria-pressed="${i === Math.min(st.angle, angles.length - 1)}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>` : ''}
    <p class="hero-note">${caption(x, src, st)}</p>
    ${primary.length ? `<div class="vw-legend" aria-label="Muscles highlighted">
      <span class="lg"><i class="pri" aria-hidden="true"></i>Main: ${primary.map(muscleName).join(', ')}</span>
      ${secondary.length ? `<span class="lg"><i class="sec" aria-hidden="true"></i>Assisting: ${secondary.map(muscleName).join(', ')}</span>` : ''}
      <span class="xs muted">Highlighting is illustrative. It shows the muscles this exercise mainly trains, not measured muscle activity.</span>
    </div>` : ''}
  </div>`;
}

/** Hooks up playback, speed, angle and source controls. onChange re-renders the viewer with the new state. */
export function wireViewer(root: HTMLElement, st: ViewerState, onChange: () => void): void {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const video = root.querySelector<HTMLVideoElement>('video.vw-media');
  const svg = root.querySelector<SVGSVGElement>('.vw-stage svg.fig');
  if (reduce && st.paused === false && !root.dataset.vwInit) st.paused = true;
  root.dataset.vwInit = '1';
  if (video) {
    const loading = root.querySelector<HTMLElement>('.vw-loading');
    const fail = () => {
      video.hidden = true;
      if (loading) loading.hidden = true;
      root.querySelector<HTMLElement>('.vw-fallback')!.hidden = false;
      root.querySelector<HTMLElement>('.vw-controls')?.setAttribute('hidden', '');
    };
    video.playbackRate = st.speed;
    video.addEventListener('loadeddata', () => { if (loading) loading.hidden = true; video.playbackRate = st.speed; }, { once: true });
    video.addEventListener('error', fail, { once: true });
    video.querySelector('source:last-of-type')?.addEventListener('error', fail, { once: true });
    if (!st.paused) video.play().catch(() => { st.paused = true; setToggle(root, true); });
  }
  const img = root.querySelector<HTMLImageElement>('.vw-stage[data-kind="image"] img.vw-media');
  img?.addEventListener('error', () => { img.hidden = true; const f = root.querySelector<HTMLElement>('.vw-fallback'); if (f) f.hidden = false; }, { once: true });
  if (svg && st.paused) svg.pauseAnimations?.();
  root.querySelectorAll<HTMLButtonElement>('[data-vw]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.vw;
    if (k === 'toggle') {
      st.paused = !st.paused;
      if (video) { if (st.paused) video.pause(); else void video.play(); }
      if (svg) { if (st.paused) svg.pauseAnimations(); else svg.unpauseAnimations(); }
      setToggle(root, st.paused);
    } else if (k === 'replay') {
      if (video) { video.currentTime = 0; void video.play(); }
      if (svg) { svg.setCurrentTime(0); svg.unpauseAnimations(); }
      st.paused = false;
      setToggle(root, false);
    } else if (k === 'speed') {
      st.speed = st.speed === 1 ? 0.5 : 1;
      if (video) { video.playbackRate = st.speed; b.textContent = st.speed === 0.5 ? '0.5×' : '1×'; b.setAttribute('aria-pressed', String(st.speed === 0.5)); }
      else onChange();
    } else if (k === 'angle') { st.angle = Number(b.dataset.v); onChange(); }
    else if (k === 'source') { st.source = b.dataset.v as Source; st.angle = 0; onChange(); }
  }));
}

function setToggle(root: HTMLElement, paused: boolean) {
  const t = root.querySelector<HTMLButtonElement>('[data-vw="toggle"]');
  if (!t) return;
  t.innerHTML = paused ? I.play : I.pause;
  t.setAttribute('aria-label', paused ? 'Play' : 'Pause');
}
