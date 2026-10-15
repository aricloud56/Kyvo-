// Tiny HTTP framework: routing, JSON bodies, cookies, security headers, CSRF and rate limiting.
import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request');
export const unauthorized = (msg = 'Please sign in to continue.') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have access to this.') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found.') => new HttpError(404, msg, 'not_found');
export const premiumRequired = (msg = 'This is a Premium feature.') => new HttpError(402, msg, 'premium_required');

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  sessionId: string;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: any;
  rawBody: Buffer | null;
  user: AuthUser | null;
  ip: string;
  requestId: string;
  cookies: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  opts: RouteOpts;
}

export interface RouteOpts {
  auth?: 'user' | 'admin' | 'none';
  raw?: boolean; // keep the raw body (Stripe webhook signature check)
  csrf?: boolean; // default true for mutating methods
  maxBody?: number;
}

export class Router {
  private routes: Route[] = [];
  add(method: string, path: string, handler: Handler, opts: RouteOpts = {}): this {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler, opts });
    return this;
  }
  get(p: string, h: Handler, o?: RouteOpts) { return this.add('GET', p, h, o); }
  post(p: string, h: Handler, o?: RouteOpts) { return this.add('POST', p, h, o); }
  put(p: string, h: Handler, o?: RouteOpts) { return this.add('PUT', p, h, o); }
  patch(p: string, h: Handler, o?: RouteOpts) { return this.add('PATCH', p, h, o); }
  delete(p: string, h: Handler, o?: RouteOpts) { return this.add('DELETE', p, h, o); }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(parts[i]);
        else if (r.parts[i] !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route: r, params };
    }
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const v = part.slice(i + 1).trim();
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(v);
    } catch {
      out[part.slice(0, i).trim()] = v;
    }
  }
  return out;
}

export function setCookie(res: ServerResponse, name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean; secure?: boolean } = {}): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

export async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new HttpError(413, 'Request is too large.', 'too_large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function securityHeaders(res: ServerResponse, opts: { tiktok: boolean; production: boolean }): void {
  const script = ["'self'"];
  const connect = ["'self'"];
  if (opts.tiktok) {
    script.push('https://analytics.tiktok.com');
    connect.push('https://analytics.tiktok.com');
  }
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src ${script.join(' ')}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://i.ytimg.com",
      "media-src 'self'",
      'frame-src https://www.youtube-nocookie.com',
      `connect-src ${connect.join(' ')}`,
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (opts.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data ?? null);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Fixed-window rate limiter kept in memory (per process). */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private limit: number, private windowMs: number) {}
  check(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.reset <= now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      if (this.hits.size > 50000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= this.limit;
  }
}

export const newRequestId = () => crypto.randomBytes(8).toString('hex');
