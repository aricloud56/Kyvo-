// Reusable UI pieces: icons, progress rings and meters, and accessible SVG charts with hover tooltips.
import { html, raw, type Raw } from './dom.js';

const P: Record<string, string> = {
  today: '<path d="M4 5h16v15H4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 9h16M8 3v4M16 3v4" stroke="currentColor" stroke-width="2"/>',
  train: '<path d="M2 12h3M19 12h3M6 8v8M18 8v8M9 10v4M15 10v4M9 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  food: '<path d="M7 3v8a2 2 0 0 1-2 2v8M7 3v6M4 3v6M10 3v6M17 3c-2 0-3 3-3 7h3v11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  progress: '<path d="M4 19l5-6 4 3 7-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  profile: '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  check: '<path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  starOn: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  scale: '<rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 9a5 5 0 0 1 8 0l-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 16l5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  dumbbell: '<path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
};

export function icon(name: keyof typeof P | string, size = 20, label?: string): Raw {
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} focusable="false">${P[name] ?? ''}</svg>`);
}

export function ring(value: number, target: number, labelTop: string, labelBottom: string, title: string): Raw {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const r = 36, c = 2 * Math.PI * r;
  const over = target > 0 && value > target * 1.1;
  return html`<div class="ring" role="img" aria-label="${title}: ${Math.round(value)} of ${Math.round(target)}">
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="8"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${over ? 'var(--warning)' : 'var(--accent)'}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}"/></svg>
    <div class="ring-label" aria-hidden="true"><div><strong>${labelTop}</strong>${labelBottom}</div></div></div>`;
}

export function meter(value: number, target: number, label: string, unit = 'g'): Raw {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target > 0 && value > target * 1.1;
  return html`<div><div class="lbl"><span>${label}</span><span><b>${Math.round(value)}</b> / ${Math.round(target)} ${unit}</span></div>
  <div class="meter${over ? ' over' : ''}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${Math.round(target)}" aria-valuenow="${Math.round(value)}"><span style="width:${pct.toFixed(1)}%"></span></div></div>`;
}

export interface Series {
  name: string;
  color: string;
  points: { x: string; y: number | null }[];
  dashed?: boolean;
  dots?: boolean;
}

const W = 640, H = 220, PAD = { l: 44, r: 12, t: 12, b: 28 };

function niceTicks(min: number, max: number, n = 4): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step0 = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)!;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/** Line chart with a crosshair tooltip; a data table is rendered alongside for screen readers. */
export function lineChart(id: string, title: string, series: Series[], fmt: (n: number) => string, labelFmt: (x: string) => string, opts: { zero?: boolean } = {}): Raw {
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const ys = series.flatMap((s) => s.points.map((p) => p.y).filter((y): y is number => y != null));
  if (!xs.length || !ys.length) return html`<p class="empty">No data yet.</p>`;
  const ticks = niceTicks(opts.zero ? 0 : Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const sx = (i: number) => PAD.l + (xs.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (xs.length - 1)) * (W - PAD.l - PAD.r));
  const sy = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const grid = ticks.map((t) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(t)}" y2="${sy(t)}"/><text class="axis" x="${PAD.l - 6}" y="${sy(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('');
  const labelIdx = xs.length <= 6 ? xs.map((_, i) => i) : [0, Math.floor(xs.length / 2), xs.length - 1];
  const xl = labelIdx.map((i) => `<text class="axis" x="${sx(i)}" y="${H - 8}" text-anchor="middle">${labelFmt(xs[i])}</text>`).join('');
  const paths = series.map((s) => {
    const pts = s.points.filter((p) => p.y != null).map((p) => [sx(xs.indexOf(p.x)), sy(p.y!)] as const);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const dots = s.dots ? pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('') : '';
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }).join('');
  const data = JSON.stringify({ xs, series: series.map((s) => ({ name: s.name, color: s.color, ys: xs.map((x) => s.points.find((p) => p.x === x)?.y ?? null) })), sx: xs.map((_, i) => sx(i)) });
  return html`<figure class="chart-wrap" style="margin:0" data-chart="${id}" data-chart-data="${data}">
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><title>${title}</title>${raw(grid)}${raw(xl)}${raw(paths)}<line class="xhair" y1="${PAD.t}" y2="${H - PAD.b}" stroke="var(--text-3)" stroke-width="1" visibility="hidden"/></svg>
  ${series.length > 1 ? html`<div class="legend">${series.map((s) => html`<span><i style="background:${s.color}"></i>${s.name}</span>`)}</div>` : ''}
  <details><summary>Show data table</summary><table class="data"><thead><tr><th>Date</th>${series.map((s) => html`<th>${s.name}</th>`)}</tr></thead><tbody>${xs.map((x) => html`<tr><td>${labelFmt(x)}</td>${series.map((s) => { const y = s.points.find((p) => p.x === x)?.y; return html`<td>${y == null ? '–' : fmt(y)}</td>`; })}</tr>`)}</tbody></table></details>
  </figure>`;
}

/** Vertical bar chart (one series) with per-bar hover tooltip. */
export function barChart(title: string, bars: { label: string; value: number; tip: string }[], fmt: (n: number) => string, color = 'var(--chart-1)', target?: number): Raw {
  if (!bars.length) return html`<p class="empty">No data yet.</p>`;
  const max = Math.max(...bars.map((b) => b.value), target ?? 0, 1);
  const ticks = niceTicks(0, max, 3);
  const top = ticks[ticks.length - 1];
  const sy = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const bw = (W - PAD.l - PAD.r) / bars.length;
  const grid = ticks.map((t) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(t)}" y2="${sy(t)}"/><text class="axis" x="${PAD.l - 6}" y="${sy(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('');
  const rects = bars.map((b, i) => {
    const x = PAD.l + i * bw + 2, w = Math.max(2, bw - 4), y = sy(b.value), h = Math.max(0, H - PAD.b - y);
    const r = Math.min(4, w / 2, h);
    const path = h > 0 ? `M${x},${H - PAD.b}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${H - PAD.b}Z` : '';
    const show = bars.length <= 8 || i % Math.ceil(bars.length / 6) === 0 || i === bars.length - 1;
    return `<g class="bar" data-tip="${b.tip.replace(/"/g, '&quot;')}"><rect x="${PAD.l + i * bw}" y="${PAD.t}" width="${bw}" height="${H - PAD.t - PAD.b}" fill="transparent"/><path d="${path}" fill="${color}"/>${show ? `<text class="axis" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${b.label}</text>` : ''}</g>`;
  }).join('');
  const tline = target ? `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(target)}" y2="${sy(target)}" stroke="var(--text-2)" stroke-dasharray="4 4"/>` : '';
  return html`<figure class="chart-wrap" style="margin:0" data-bars><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><title>${title}</title>${raw(grid)}${raw(rects)}${raw(tline)}</svg>
  <details><summary>Show data table</summary><table class="data"><tbody>${bars.map((b) => html`<tr><td>${b.label}</td><td>${b.tip}</td></tr>`)}</tbody></table></details></figure>`;
}

/** Attach hover/touch tooltips to charts rendered inside root. */
export function wireCharts(root: HTMLElement, fmt: Record<string, (n: number) => string> = {}, labelFmt: (x: string) => string = (x) => x): void {
  for (const fig of root.querySelectorAll<HTMLElement>('[data-chart]')) {
    const d = JSON.parse(fig.dataset.chartData!);
    const svg = fig.querySelector('svg')!;
    const xh = svg.querySelector('.xhair') as SVGLineElement;
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    fig.appendChild(tip);
    const f = fmt[fig.dataset.chart!] ?? ((n: number) => String(n));
    const move = (clientX: number) => {
      const r = svg.getBoundingClientRect();
      const vx = ((clientX - r.left) / r.width) * W;
      let best = 0;
      d.sx.forEach((x: number, i: number) => (Math.abs(x - vx) < Math.abs(d.sx[best] - vx) ? (best = i) : 0));
      xh.setAttribute('x1', d.sx[best]);
      xh.setAttribute('x2', d.sx[best]);
      xh.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `<b>${labelFmt(d.xs[best])}</b><br>` + d.series.map((s: any) => `${s.name}: ${s.ys[best] == null ? '–' : f(s.ys[best])}`).join('<br>');
      tip.style.left = `${(d.sx[best] / W) * r.width}px`;
      tip.style.top = `${r.height * 0.25}px`;
    };
    svg.addEventListener('pointermove', (e) => move(e.clientX));
    svg.addEventListener('pointerleave', () => {
      tip.hidden = true;
      xh.setAttribute('visibility', 'hidden');
    });
  }
  for (const fig of root.querySelectorAll<HTMLElement>('[data-bars]')) {
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    fig.appendChild(tip);
    fig.querySelectorAll<SVGGElement>('.bar').forEach((g) => {
      g.addEventListener('pointerenter', () => {
        const r = fig.getBoundingClientRect(), b = g.getBoundingClientRect();
        tip.textContent = g.dataset.tip!;
        tip.hidden = false;
        tip.style.left = `${b.left - r.left + b.width / 2}px`;
        tip.style.top = `${r.height * 0.2}px`;
      });
      g.addEventListener('pointerleave', () => (tip.hidden = true));
    });
  }
}
