// Animated movement illustrations. Each exercise has a START and an END pose (side or front view); the figure
// swings between them with SVG animation, so it plays without scripts and can be paused for reduced motion.
// Body segments that carry the exercise's primary muscles are drawn in the accent colour.

export type Pt = [number, number];
export type Pose = Record<string, Pt>;
export interface Equip { t: 'plate' | 'db' | 'bar' | 'cable' | 'platform' | 'ball' | 'wheel'; at: string; r?: number; to?: Pt }
export interface Scene { r?: [number, number, number, number]; l?: [number, number, number, number]; c?: [number, number, number] }
export interface FigureDef { poses: [Pose, Pose]; equip?: Equip[]; scene?: Scene[]; front?: boolean; hi?: string[] }

const FLOOR = 185;
const FRAMES = 12;
// Parent joint for each joint, so limbs rotate about their parent and keep their length mid-movement.
const PARENT_SIDE: Record<string, string> = { s: 'p', h: 's', e: 's', w: 'e', k: 'p', a: 'k', t: 'a', k2: 'p', a2: 'k2' };
const PARENT_FRONT: Record<string, string> = { n: 'p', s: 'n', h: 'n', e: 's', w: 'e', s2: 'n', e2: 's2', w2: 'e2', k: 'p', a: 'k', t: 'a', k2: 'p', a2: 'k2' };

/** Joint positions at time tt (0 = start pose, 1 = end pose). */
export function poseAt(def: FigureDef, tt: number): Pose {
  const [A, B] = def.poses;
  const par = A.n ? PARENT_FRONT : PARENT_SIDE;
  const P: Pose = {};
  const lin = (u: Pt, v: Pt): Pt => [u[0] + (v[0] - u[0]) * tt, u[1] + (v[1] - u[1]) * tt];
  const place = (k: string): Pt => {
    if (P[k]) return P[k];
    const b = B[k] ?? A[k];
    const q = par[k];
    if (!q || !A[q]) return (P[k] = lin(A[k], b));
    const pa = A[q], pb = B[q] ?? A[q], pp = place(q);
    const va = [A[k][0] - pa[0], A[k][1] - pa[1]], vb = [b[0] - pb[0], b[1] - pb[1]];
    const la = Math.hypot(va[0], va[1]), lb = Math.hypot(vb[0], vb[1]);
    const aa = Math.atan2(va[1], va[0]);
    let d = Math.atan2(vb[1], vb[0]) - aa;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    const an = aa + d * tt, ln = la + (lb - la) * tt;
    return (P[k] = [pp[0] + Math.cos(an) * ln, pp[1] + Math.sin(an) * ln]);
  };
  for (const k in A) place(k);
  return P;
}

// Which body segments light up for each muscle key.
const SEGMENTS: Record<string, string[]> = {
  chest: ['torso'], lats: ['torso'], upper_back: ['torso'], traps: ['torso', 'neck'], lower_back: ['torso'], abs: ['torso'], obliques: ['torso'],
  front_delts: ['uarm'], side_delts: ['uarm'], rear_delts: ['uarm'], rotator_cuff: ['uarm'], biceps: ['uarm'], triceps: ['uarm'], forearms: ['farm'],
  glutes: ['thigh'], quads: ['thigh'], hamstrings: ['thigh'], adductors: ['thigh'], hip_flexors: ['thigh'], calves: ['shin'], cardio: [],
};
export function highlightSegments(primary: string[]): string[] {
  return [...new Set(primary.flatMap((m) => SEGMENTS[m] ?? []))];
}

interface Prim { tag: string; a: Record<string, number | string> }

function primitives(def: FigureDef, P: Pose, hi: Set<string>): Prim[] {
  const out: Prim[] = [];
  const line = (a: Pt | undefined, b: Pt | undefined, w: number, seg: string, extra: Record<string, string | number> = {}) => {
    if (!a || !b) return;
    out.push({ tag: 'line', a: { x1: a[0], y1: a[1], x2: b[0], y2: b[1], 'stroke-width': w, class: hi.has(seg) ? 'fg hi' : 'fg', ...extra } });
  };
  const toe = (a: Pt, t?: Pt): Pt | undefined => t ?? (def.front ? undefined : [a[0] + 12, a[1]]);
  for (const e of def.equip ?? []) if (e.t === 'cable' && e.to && P[e.at]) out.push({ tag: 'line', a: { x1: P[e.at][0], y1: P[e.at][1], x2: e.to[0], y2: e.to[1], class: 'cable' } });
  if (P.k2) {
    const back = def.front ? '' : ' back';
    line(P.p, P.k2, 13, 'thigh', { class: `fg${hi.has('thigh') ? ' hi' : ''}${back}` });
    line(P.k2, P.a2, 11, 'shin', { class: `fg${hi.has('shin') ? ' hi' : ''}${back}` });
    const t2 = toe(P.a2);
    if (t2) line(P.a2, t2, 8, 'foot', { class: `fg${back}` });
  }
  if (P.s2) {
    line(P.n, P.s2, 10, 'neck');
    line(P.s2, P.e2, 10, 'uarm');
    line(P.e2, P.w2, 8, 'farm');
  }
  line(P.n ?? P.s, P.p, 18, 'torso');
  if (P.n) line(P.n, P.s, 10, 'neck');
  line(P.p, P.k, 14, 'thigh');
  line(P.k, P.a, 12, 'shin');
  const t1 = toe(P.a, P.t);
  if (t1) line(P.a, t1, 8, 'foot');
  out.push({ tag: 'circle', a: { cx: P.h[0], cy: P.h[1], r: 12, class: 'fg head' } });
  // Near arm with a halo so it reads in front of the body.
  if (P.e) {
    out.push({ tag: 'line', a: { x1: P.s[0], y1: P.s[1], x2: P.e[0], y2: P.e[1], 'stroke-width': 14, class: 'halo' } });
    out.push({ tag: 'line', a: { x1: P.e[0], y1: P.e[1], x2: P.w[0], y2: P.w[1], 'stroke-width': 13, class: 'halo' } });
    line(P.s, P.e, 10, 'uarm');
    line(P.e, P.w, 9, 'farm');
  }
  for (const e of def.equip ?? []) {
    const at = P[e.at];
    if (!at) continue;
    const [x, y] = at;
    if (e.t === 'plate') {
      const r = e.r ?? 16;
      out.push({ tag: 'circle', a: { cx: x, cy: y, r, class: 'eq' } }, { tag: 'circle', a: { cx: x, cy: y, r: r * 0.3, class: 'eq-hole' } });
    } else if (e.t === 'db') {
      out.push({ tag: 'rect', a: { x: x - 9, y: y - 3, width: 18, height: 6, rx: 2, class: 'eq' } }, { tag: 'rect', a: { x: x - 12, y: y - 7, width: 6, height: 14, rx: 2, class: 'eq' } }, { tag: 'rect', a: { x: x + 6, y: y - 7, width: 6, height: 14, rx: 2, class: 'eq' } });
    } else if (e.t === 'bar') {
      out.push({ tag: 'line', a: { x1: x - 16, y1: y, x2: x + 16, y2: y, 'stroke-width': 5, class: 'eq-line' } });
    } else if (e.t === 'ball') {
      out.push({ tag: 'circle', a: { cx: x, cy: y, r: e.r ?? 14, class: 'eq' } });
    } else if (e.t === 'wheel') {
      out.push({ tag: 'circle', a: { cx: x, cy: y, r: 10, class: 'eq-ring' } });
    } else if (e.t === 'platform') {
      out.push({ tag: 'line', a: { x1: x - 8, y1: y - 18, x2: x + 10, y2: y + 14, 'stroke-width': 6, class: 'eq-line' } });
    }
  }
  return out;
}

const n1 = (v: number | string) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
const attrs = (a: Record<string, number | string>) => Object.entries(a).map(([k, v]) => `${k}="${n1(v)}"`).join(' ');
const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

export interface FigureOptions {
  /** Accessible name, e.g. "Barbell back squat movement". */
  label: string;
  /** Animate between the poses (default true). */
  animate?: boolean;
  /** Static frame to show when not animating: 0 start, 1 end. */
  t?: number;
  /** Seconds for one start-to-end-and-back cycle. */
  dur?: number;
  /** Muscle keys to highlight on the body. */
  primary?: string[];
  className?: string;
}

/** SVG markup for an exercise figure. Styling comes from the .fig rules in kyvo.css. */
export function figureSVG(def: FigureDef, o: FigureOptions): string {
  const hi = new Set(def.hi ?? highlightSegments(o.primary ?? []));
  const animate = o.animate !== false;
  const frames = animate ? Array.from({ length: FRAMES + 1 }, (_, i) => primitives(def, poseAt(def, ease(i / FRAMES)), hi)) : [primitives(def, poseAt(def, o.t ?? 0), hi)];
  // Ping-pong: start → end → start.
  const seq = animate ? [...frames, ...frames.slice(0, -1).reverse()] : frames;
  const dur = o.dur ?? 2.6;
  let scene = `<line class="floor" x1="0" y1="${FLOOR + 3}" x2="200" y2="${FLOOR + 3}"/>`;
  for (const s of def.scene ?? []) {
    if (s.r) scene += `<rect class="prop" x="${s.r[0]}" y="${s.r[1]}" width="${s.r[2]}" height="${s.r[3]}" rx="3"/>`;
    if (s.c) scene += `<circle class="prop" cx="${s.c[0]}" cy="${s.c[1]}" r="${s.c[2]}"/>`;
    if (s.l) scene += `<line class="prop-line" x1="${s.l[0]}" y1="${s.l[1]}" x2="${s.l[2]}" y2="${s.l[3]}"/>`;
  }
  const body = frames[0].map((p, i) => {
    let anim = '';
    if (animate) {
      for (const key of Object.keys(p.a)) {
        if (typeof p.a[key] !== 'number') continue;
        const values = seq.map((f) => n1(f[i].a[key]));
        if (values.every((v) => v === values[0])) continue;
        anim += `<animate attributeName="${key}" dur="${dur}s" repeatCount="indefinite" values="${values.join(';')}"/>`;
      }
    }
    return anim ? `<${p.tag} ${attrs(p.a)}>${anim}</${p.tag}>` : `<${p.tag} ${attrs(p.a)}/>`;
  }).join('');
  const label = o.label.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<svg class="fig${o.className ? ` ${o.className}` : ''}" viewBox="0 -26 200 218" role="img" aria-label="${label}" focusable="false">${scene}${body}</svg>`;
}

/** Pause figure animations when the viewer prefers reduced motion. */
export function respectReducedMotion(root: ParentNode): void {
  if (typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll<SVGSVGElement>('svg.fig').forEach((s) => s.pauseAnimations?.());
}
