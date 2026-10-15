// Server-side input validation helpers. Every handler validates its input with these before touching the database.
import { badRequest } from './http.js';
import { isIsoDate } from '../../core/util.js';

type Obj = Record<string, unknown>;

export function obj(v: unknown): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('Expected a JSON object.');
  return v as Obj;
}

export function str(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean; pattern?: RegExp } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw badRequest(`${name} is required.`);
  }
  if (typeof v !== 'string') throw badRequest(`${name} must be text.`);
  const s = v.trim();
  if (opts.min !== undefined && s.length < opts.min) throw badRequest(`${name} must be at least ${opts.min} characters.`);
  if (opts.max !== undefined && s.length > opts.max) throw badRequest(`${name} must be at most ${opts.max} characters.`);
  if (opts.pattern && !opts.pattern.test(s)) throw badRequest(`${name} is not valid.`);
  return s;
}

export function num(v: unknown, name: string, opts: { min?: number; max?: number; int?: boolean; optional?: boolean } = {}): number | null {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return null;
    throw badRequest(`${name} is required.`);
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw badRequest(`${name} must be a number.`);
  if (opts.int && !Number.isInteger(n)) throw badRequest(`${name} must be a whole number.`);
  if (opts.min !== undefined && n < opts.min) throw badRequest(`${name} must be at least ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw badRequest(`${name} must be at most ${opts.max}.`);
  return n;
}

export const reqNum = (v: unknown, name: string, opts: { min?: number; max?: number; int?: boolean } = {}): number => num(v, name, opts) as number;

export function bool(v: unknown, name: string, optional = false): boolean {
  if (v === undefined && optional) return false;
  if (typeof v !== 'boolean') throw badRequest(`${name} must be true or false.`);
  return v;
}

export function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[], fallback?: T): T {
  if ((v === undefined || v === null) && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw badRequest(`${name} must be one of: ${allowed.join(', ')}.`);
  return v as T;
}

export function strList(v: unknown, name: string, opts: { allowed?: readonly string[]; max?: number; itemMax?: number } = {}): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest(`${name} must be a list.`);
  if (v.length > (opts.max ?? 50)) throw badRequest(`${name} has too many items.`);
  return [...new Set(v.map((x) => {
    if (typeof x !== 'string' || x.length > (opts.itemMax ?? 60)) throw badRequest(`${name} contains an invalid item.`);
    if (opts.allowed && !opts.allowed.includes(x)) throw badRequest(`${name} contains an unknown value: ${x}.`);
    return x.trim();
  }).filter(Boolean))];
}

export function date(v: unknown, name = 'date'): string {
  if (!isIsoDate(v)) throw badRequest(`${name} must be a date in YYYY-MM-DD format.`);
  return v;
}

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uuid(v: unknown, name = 'id'): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw badRequest(`${name} is not valid.`);
  return v;
}

export function slug(v: unknown, name = 'id'): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw badRequest(`${name} is not valid.`);
  return v;
}
