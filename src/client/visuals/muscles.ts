// Front and back body map with the exercise's primary muscles in the accent colour and secondary muscles tinted.

type Shape = string; // SVG element markup without class
const mirror = (shapes: Shape[]) => shapes.flatMap((s) => [s, `<g transform="translate(100 0) scale(-1 1)">${s}</g>`]);
const e = (cx: number, cy: number, rx: number, ry: number, rot = 0) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`;
const path = (d: string) => `<path d="${d}"/>`;

const SILHOUETTE = [
  e(50, 14, 9, 11),
  path('M45 23h10v9H45z'),
  path('M36 32 Q50 27 64 32 L70 36 Q74 44 71 56 L66 58 Q64 80 62 92 L64 104 Q63 108 50 110 Q37 108 36 104 L38 92 Q36 80 34 58 L29 56 Q26 44 30 36 Z'),
  ...mirror([
    path('M29 38 Q22 46 22 62 Q20 78 18 96 L24 98 Q28 80 30 66 Q34 54 34 44 Z'),
    e(21, 103, 4, 6),
    path('M37 102 Q34 130 37 150 L36 182 Q37 192 41 194 L45 194 Q47 170 47 150 Q49 128 49 106 Z'),
    e(41, 198, 6, 3.5),
  ]),
].join('');

/** Muscle key -> shapes on the front view and on the back view. */
const FRONT: Record<string, Shape[]> = {
  traps: mirror([path('M45 29 L37 33 L45 35 Z')]),
  front_delts: mirror([e(31, 41, 6.5, 8, -15)]),
  side_delts: mirror([e(28, 44, 4, 7, -10)]),
  chest: mirror([path('M50 37 C45 34 38 35 36 42 C35 50 42 55 50 54 Z')]),
  biceps: mirror([e(27, 61, 4.5, 11, 10)]),
  forearms: mirror([e(23, 84, 4, 12, 8)]),
  abs: [path('M44 57h12v34q-6 4-12 0z')],
  obliques: mirror([path('M37 58 L43 59 L43 88 L39 84 Q37 72 37 58 Z')]),
  hip_flexors: mirror([path('M42 94 L48 100 L46 108 L40 101 Z')]),
  quads: mirror([e(41, 124, 6.5, 19, 4)]),
  adductors: mirror([e(47, 118, 2.4, 11, -4)]),
  calves: mirror([e(39, 164, 3.5, 13, 3)]),
};
const BACK: Record<string, Shape[]> = {
  traps: [path('M50 26 L38 34 L44 38 L50 56 L56 38 L62 34 Z')],
  rear_delts: mirror([e(31, 41, 6.5, 8, 15)]),
  side_delts: mirror([e(28, 44, 4, 7, -10)]),
  rotator_cuff: mirror([e(40, 46, 5, 3.5, 20)]),
  upper_back: mirror([path('M44 40 L50 58 L46 62 L38 52 Z')]),
  lats: mirror([path('M36 50 L46 64 L46 84 L39 80 Q35 64 36 50 Z')]),
  triceps: mirror([e(27, 60, 4.5, 11, 10)]),
  forearms: mirror([e(23, 84, 4, 12, 8)]),
  lower_back: [path('M45 66h10v24h-10z')],
  glutes: mirror([e(43, 100, 7.5, 8.5)]),
  hamstrings: mirror([e(42, 130, 6, 18, 3)]),
  adductors: mirror([e(47, 118, 2.4, 11, -4)]),
  calves: mirror([e(40, 162, 5, 13, 2)]),
};

const NAMES: Record<string, string> = {
  chest: 'Chest', front_delts: 'Front shoulders', side_delts: 'Side shoulders', rear_delts: 'Rear shoulders', rotator_cuff: 'Rotator cuff', traps: 'Traps',
  upper_back: 'Upper back', lats: 'Lats', lower_back: 'Lower back', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', abs: 'Abs', obliques: 'Obliques',
  glutes: 'Glutes', quads: 'Quads', hamstrings: 'Hamstrings', adductors: 'Adductors', hip_flexors: 'Hip flexors', calves: 'Calves', cardio: 'Heart and lungs',
};
export const muscleName = (k: string) => NAMES[k] ?? k.replace(/_/g, ' ');

function view(map: Record<string, Shape[]>, primary: Set<string>, secondary: Set<string>, x: number, label: string): string {
  let regions = '';
  for (const [k, shapes] of Object.entries(map)) {
    const cls = primary.has(k) ? 'm-pri' : secondary.has(k) ? 'm-sec' : 'm-off';
    regions += `<g class="${cls}">${shapes.join('')}</g>`;
  }
  return `<g transform="translate(${x} 0)"><g class="m-body">${SILHOUETTE}</g>${regions}<text x="50" y="216" text-anchor="middle" class="m-lbl">${label}</text></g>`;
}

/** Front and back body map. Primary muscles are solid accent, secondary are tinted. */
export function muscleMap(primary: string[], secondary: string[]): string {
  const p = new Set(primary), s = new Set(secondary.filter((m) => !p.has(m)));
  const desc = `Primary: ${primary.map(muscleName).join(', ') || 'none'}. Secondary: ${[...s].map(muscleName).join(', ') || 'none'}.`;
  return `<svg class="muscle-map" viewBox="0 0 210 222" role="img" aria-label="Muscles worked. ${desc}">${view(FRONT, p, s, 0, 'Front')}${view(BACK, p, s, 110, 'Back')}</svg>`;
}
