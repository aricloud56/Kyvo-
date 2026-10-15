// Server-rendered public pages: landing, campaign landings, legal pages and the app shell.
import fs from 'node:fs';
import path from 'node:path';
import { CAMPAIGNS, CAMPAIGN_BY_SLUG, type Campaign } from '../core/campaigns.js';
import { FREE_FEATURES, PREMIUM_FEATURES, PRICES, formatPrice } from '../core/plans.js';
import { LEGAL_DIR } from './paths.js';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string, opts: { description?: string; scripts?: string[]; bodyClass?: string } = {}): string {
  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#111111">
<meta name="description" content="${esc(opts.description ?? 'KYVO tells you what to train, what to eat and how you are progressing, in one personalised daily fitness plan.')}">
<title>${esc(title)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/css/kyvo.css">
</head><body class="${opts.bodyClass ?? 'site'}">
${body}
${(opts.scripts ?? []).map((s) => `<script type="module" src="${s}"></script>`).join('\n')}
</body></html>`;
}

const header = `<header class="site-head"><a class="wordmark" href="/" aria-label="KYVO home">KYVO</a><nav><a href="/login">Sign in</a><a class="btn btn-primary btn-sm" href="/signup">Start free</a></nav></header>`;
export const footer = `<footer class="site-foot"><p class="wordmark">KYVO</p><p class="muted">Train smarter. Get stronger.</p>
<nav aria-label="Legal"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="/legal/subscription">Subscription terms</a><a href="/legal/disclaimer">Health disclaimer</a><a href="/legal/contact">Contact</a></nav>
<p class="muted small">KYVO provides general fitness and nutrition information, not medical advice. KYVO is a provisional name.</p></footer>`;

function planCards(): string {
  return `<section class="pricing" aria-labelledby="pricing-h"><h2 id="pricing-h">Plans</h2><div class="price-grid">
  <div class="card price"><h3>Free</h3><p class="amount">A$0</p><ul>${FREE_FEATURES.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn btn-secondary" href="/signup">Start free</a></div>
  <div class="card price featured"><h3>Premium</h3><p class="amount">${formatPrice(PRICES.monthly.amountCents)}<span>/month</span></p><p class="muted">or ${formatPrice(PRICES.annual.amountCents)}/year. Prices in AUD. Cancel anytime.</p><ul>${PREMIUM_FEATURES.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn btn-primary" href="/signup">Start free, upgrade anytime</a></div>
  </div></section>`;
}

export function landingPage(c?: Campaign, pixelId: string | null = null): string {
  const headline = c?.headline ?? 'Your training. Your progress. Your potential.';
  const sub = c?.sub ?? 'KYVO tells you what to train, what to eat and how you are progressing, all in one personalised Daily Plan.';
  const bullets = c?.bullets ?? ['Today’s workout with sets, reps, weights and rest', 'Breakfast, lunch, dinner and snacks portioned to your targets', 'Calories and protein that update as you log', 'A daily checklist and progress you can see'];
  const signup = c ? `/signup?campaign=${encodeURIComponent(c.slug)}` : '/signup';
  return layout(c ? `KYVO: ${c.headline}` : 'KYVO: Train smarter. Get stronger.', `${header}
<main id="main" class="landing" data-campaign="${esc(c?.slug ?? '')}" data-pixel="${esc(pixelId ?? '')}">
<section class="hero">
<p class="eyebrow">TRAIN SMARTER. GET STRONGER.</p>
<h1>${esc(headline)}</h1>
<p class="lead">${esc(sub)}</p>
<a class="btn btn-primary btn-lg" href="${signup}">${esc(c?.cta ?? 'Get my free Daily Plan')}</a>
<p class="muted small">Free plan available. No card needed.</p>
</section>
<section class="how" aria-labelledby="how-h"><h2 id="how-h">What you get every day</h2><ul class="ticks">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>
<section class="steps" aria-labelledby="steps-h"><h2 id="steps-h">How it works</h2><ol>
<li><strong>Tell us about you.</strong> Goal, experience, equipment, schedule and food preferences. About two minutes.</li>
<li><strong>Get your plan.</strong> A weekly program and today’s workout, meals and targets, ready straight away.</li>
<li><strong>Tick it off.</strong> Log sets and meals in a tap. Your totals and progress update as you go.</li></ol></section>
${planCards()}
<section class="note"><p class="muted small">Calorie and macro targets are estimates based on standard equations. They are not medical advice. If you have a medical condition, are pregnant or have a history of disordered eating, speak to a doctor or Accredited Practising Dietitian first.</p></section>
</main>${footer}`, { scripts: ['/js/client/landing.js'], description: sub });
}

export function campaignPage(slug: string, pixelId: string | null = null): string | null {
  const c = CAMPAIGN_BY_SLUG.get(slug);
  return c ? landingPage(c, pixelId) : null;
}

export const LEGAL_PAGES: Record<string, string> = { privacy: 'Privacy Policy', terms: 'Terms of Service', subscription: 'Subscription terms', disclaimer: 'Fitness and nutrition disclaimer', contact: 'Contact' };

export function legalPage(page: string): string | null {
  if (!(page in LEGAL_PAGES)) return null;
  const file = path.join(LEGAL_DIR, `${page}.html`);
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `<h1>${esc(LEGAL_PAGES[page])}</h1><p>Coming soon.</p>`;
  return layout(`${LEGAL_PAGES[page]} | KYVO`, `${header}<main id="main" class="legal">${content}</main>${footer}`);
}

export function appShell(): string {
  return layout('KYVO', `<a class="skip" href="#view">Skip to content</a><div id="app" aria-live="polite"><p class="boot">Loading KYVO…</p></div><noscript><p class="boot">KYVO needs JavaScript enabled.</p></noscript>`, {
    scripts: ['/js/client/main.js'], bodyClass: 'app',
  });
}

export function campaignSlugs(): string[] {
  return CAMPAIGNS.map((c) => c.slug);
}
