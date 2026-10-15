// App state, hash router and the shell (navigation). Screens render into #view.
import { api, ApiError } from './api.js';
import { html, raw, showError } from './dom.js';
import { icon } from './ui.js';
import { setUnits } from './format.js';
import type { Profile, Targets } from '../core/types.js';

export interface Me {
  user: { id: string; email: string; role: 'user' | 'admin'; analyticsConsent: boolean };
  profile: Profile & { timezone: string; onboarded: boolean };
  onboarded: boolean;
  premium: boolean;
  targets: Targets | null;
  today: string;
  tiktokPixelId: string | null;
}

export const state: { me: Me | null } = { me: null };

export async function refreshMe(): Promise<Me | null> {
  try {
    state.me = await api.get<Me>('/api/me');
    setUnits(state.me.profile.units);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) state.me = null;
    else throw e;
  }
  return state.me;
}

export type Screen = (view: HTMLElement, params: string[]) => Promise<void> | void;
const routes: [RegExp, () => Promise<Screen>, { public?: boolean; tab?: string; bare?: boolean }][] = [];
export function route(re: RegExp, load: () => Promise<Screen>, opts: { public?: boolean; tab?: string; bare?: boolean } = {}) {
  routes.push([re, load, opts]);
}

export const go = (hash: string) => {
  if (location.hash === hash) void renderRoute();
  else location.hash = hash;
};

const TABS = [
  ['today', '#/today', 'Today'],
  ['train', '#/train', 'Train'],
  ['food', '#/nutrition', 'Nutrition'],
  ['progress', '#/progress', 'Progress'],
  ['profile', '#/profile', 'Profile'],
] as const;

function shell(tab: string | undefined, bare: boolean) {
  const root = document.getElementById('app')!;
  if (bare) {
    root.innerHTML = html`${api.demo ? raw('<div class="demo-banner">Preview with sample data. Nothing you enter leaves this browser.</div>') : ''}<main id="view" class="shell" tabindex="-1"></main>`.value;
  } else {
    root.innerHTML = html`${api.demo ? raw('<div class="demo-banner">Preview with sample data. Nothing you enter leaves this browser.</div>') : ''}
    <nav class="tabbar" aria-label="Main"><span class="tab-brand wordmark">KYVO</span>${TABS.map(([k, href, label]) => html`<a href="${href}" ${tab === k ? raw('aria-current="page"') : ''}>${icon(k === 'food' ? 'food' : k)}<span>${label}</span></a>`)}</nav>
    <main id="view" class="shell" tabindex="-1"></main>`.value;
  }
  return document.getElementById('view')!;
}

let renderSeq = 0;
export async function renderRoute(): Promise<void> {
  const seq = ++renderSeq;
  let hash = location.hash.replace(/^#/, '') || '';
  if (!hash) {
    const p = location.pathname;
    hash = p === '/login' ? '/login' : p === '/signup' ? '/signup' : p.startsWith('/app/premium') ? '/premium' : '/today';
  }
  hash = hash.split('?')[0];
  const match = routes.find(([re]) => re.test(hash));
  if (!match) return go('#/today');
  const [re, load, opts] = match;
  if (!opts.public && !state.me) {
    await refreshMe();
    if (!state.me) return go('#/login');
  }
  if (state.me && !state.me.onboarded && !opts.public && !hash.startsWith('/onboarding')) return go('#/onboarding');
  const view = shell(opts.tab, !!opts.bare || !state.me);
  try {
    const screen = await load();
    if (seq !== renderSeq) return;
    await screen(view, (hash.match(re) ?? []).slice(1));
    if (seq === renderSeq) {
      document.title = `${view.querySelector('h1')?.textContent ?? 'KYVO'} | KYVO`;
      view.focus({ preventScroll: true });
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      state.me = null;
      return go('#/login');
    }
    showError(e);
    view.innerHTML = html`<div class="card"><h1>Something went wrong</h1><p class="muted">${e instanceof Error ? e.message : ''}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`.value;
  }
}

export function start() {
  window.addEventListener('hashchange', () => void renderRoute());
  void renderRoute();
}

/** Reusable "Premium" lock message for gated content. */
export function lockedCard(what: string): string {
  return html`<div class="card"><p class="badge-premium">PREMIUM</p><h2>${what} is part of Premium</h2><p class="muted">Upgrade to unlock the full library. Your free plan keeps working either way.</p><a class="btn btn-primary" href="#/premium">See Premium</a></div>`.value;
}
