// Landing pages: first-touch UTM attribution, a landing view count, and the TikTok pixel only after consent.
// Only page views and sign-up starts are ever sent to TikTok: never health, body, food or workout data.

const main = document.querySelector<HTMLElement>('main.landing');
const campaign = main?.dataset.campaign || '';
const pixelId = main?.dataset.pixel || '';
const CONSENT_KEY = 'kyvo_marketing_consent';

function readCookie(name: string): string | null {
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? m.slice(name.length + 1) : null;
}

// First touch wins: only store attribution when none exists yet (30 days).
const params = new URLSearchParams(location.search);
if (!readCookie('kyvo_attr')) {
  const attr: Record<string, string> = { landing_path: location.pathname.slice(0, 120), first_seen_at: new Date().toISOString() };
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const v = params.get(k);
    if (v) attr[k] = v.slice(0, 120);
  }
  if (!attr.utm_campaign && campaign) attr.utm_campaign = campaign;
  try {
    if (document.referrer) attr.referrer_host = new URL(document.referrer).host.slice(0, 120);
  } catch {
    /* ignore malformed referrer */
  }
  document.cookie = `kyvo_attr=${encodeURIComponent(JSON.stringify(attr))}; Max-Age=${30 * 86400}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}
try {
  if (campaign) sessionStorage.setItem('kyvo_campaign', campaign);
} catch {
  /* storage blocked: onboarding just uses defaults */
}

void fetch('/api/events/landing', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Kyvo-Request': '1' },
  body: JSON.stringify({ campaign: campaign || null }),
  credentials: 'same-origin',
}).catch(() => undefined);

type Ttq = { track: (e: string) => void; page: () => void };
function loadPixel(): Ttq | null {
  if (!pixelId) return null;
  const w = window as unknown as { ttq?: Ttq & { _q?: unknown[] } };
  if (w.ttq) return w.ttq;
  const queue: unknown[] = [];
  const stub = { _q: queue, track: (e: string) => queue.push(['track', e]), page: () => queue.push(['page']) };
  w.ttq = stub;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`;
  document.head.appendChild(s);
  stub.page();
  return stub;
}

function consent(): string | null {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function setConsent(v: 'yes' | 'no') {
  try {
    localStorage.setItem(CONSENT_KEY, v);
  } catch {
    /* ignore */
  }
}

if (pixelId) {
  const c = consent();
  if (c === 'yes') loadPixel();
  else if (c == null) {
    const bar = document.createElement('div');
    bar.className = 'consent-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Cookie choices');
    bar.innerHTML = `<p>KYVO uses a TikTok marketing cookie to measure which videos bring people here. It never receives your health, food or workout data. <a href="/legal/privacy">Privacy</a></p>
      <div class="row"><button class="btn btn-primary btn-sm" data-c="yes">Allow</button><button class="btn btn-secondary btn-sm" data-c="no">No thanks</button></div>`;
    bar.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c as 'yes' | 'no' | undefined;
      if (!v) return;
      setConsent(v);
      if (v === 'yes') loadPixel();
      bar.remove();
    });
    document.body.appendChild(bar);
  }
}

// Sign-up intent is the only conversion event, and only with consent.
document.querySelectorAll<HTMLAnchorElement>('a[href^="/signup"]').forEach((a) =>
  a.addEventListener('click', () => {
    if (consent() === 'yes') loadPixel()?.track('ClickButton');
  }),
);
