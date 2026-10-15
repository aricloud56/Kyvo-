// DOM helpers: escaped HTML templates, event delegation, toasts and bottom sheets.

export class Raw {
  constructor(public value: string) {}
  toString() {
    return this.value;
  }
}
export const raw = (s: string) => new Raw(s);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function render(v: unknown): string {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(String(v));
}

/** Tagged template: interpolated values are HTML-escaped unless wrapped in raw() or produced by html``. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];

export type ActionHandler = (el: HTMLElement, ev: Event) => void | Promise<void>;

const delegated = new WeakMap<HTMLElement, (ev: Event) => void>();

/**
 * Delegate clicks on [data-action] elements inside root to handlers. Calling it again on the same root
 * (a screen re-rendering itself) replaces the previous handlers, so stale closures never run.
 */
export function onActions(root: HTMLElement, handlers: Record<string, ActionHandler>): void {
  const previous = delegated.get(root);
  if (previous) root.removeEventListener('click', previous);
  const listener = (ev: Event) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || !root.contains(el)) return;
    const h = handlers[el.dataset.action!];
    if (!h) return;
    ev.preventDefault();
    if (el.getAttribute('aria-busy') === 'true') return;
    const r = h(el, ev);
    if (r instanceof Promise) {
      el.setAttribute('aria-busy', 'true');
      r.catch(showError).finally(() => el.removeAttribute('aria-busy'));
    }
  };
  delegated.set(root, listener);
  root.addEventListener('click', listener);
}

let toastTimer: number | undefined;
export function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast${kind === 'err' ? ' err' : ''}`;
  t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  t.textContent = message;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), kind === 'err' ? 5000 : 2600);
}

export function showError(e: unknown): void {
  const msg = e instanceof Error ? e.message : 'Something went wrong.';
  toast(msg, 'err');
}

/** Open an accessible bottom sheet. Returns a close function. */
export function sheet(title: string, body: Raw, onMount?: (el: HTMLElement, close: () => void) => void): () => void {
  const prev = document.activeElement as HTMLElement | null;
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = html`<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="row between"><h2 id="sheet-title">${title}</h2><button class="btn btn-ghost icon-btn" data-close aria-label="Close">✕</button></div><div class="sheet-body">${body}</div></div>`.value;
  const close = () => {
    window.removeEventListener('hashchange', close);
    back.remove();
    document.removeEventListener('keydown', onKey);
    prev?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const f = $$<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])', back).filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  back.addEventListener('click', (e) => {
    if (e.target === back || (e.target as HTMLElement).closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close, { once: true });
  document.body.appendChild(back);
  const sheetEl = back.querySelector<HTMLElement>('.sheet')!;
  onMount?.(sheetEl, close);
  (sheetEl.querySelector<HTMLElement>('input, select, textarea, .btn-primary') ?? sheetEl.querySelector<HTMLElement>('[data-close]'))?.focus();
  return close;
}

export function confirmSheet(title: string, message: string, confirmLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const close = sheet(title, html`<p class="muted">${message}</p><div class="row"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${confirmLabel}</button><button class="btn btn-secondary" data-close>Cancel</button></div>`, (el) => {
      el.querySelector('[data-yes]')!.addEventListener('click', () => {
        answered = true;
        close();
        resolve(true);
      });
      const obs = new MutationObserver(() => {
        if (!el.isConnected) {
          obs.disconnect();
          if (!answered) resolve(false);
        }
      });
      obs.observe(document.body, { childList: true });
    });
  });
}

export function formData(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((v, k) => (out[k] = String(v)));
  return out;
}

export const numOrNull = (s: string | undefined | null): number | null => (s == null || s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
