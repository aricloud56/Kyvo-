// Transaction helpers that set the Row Level Security context for every request.
import { PgPool, type PgConfig, type PgConnection, json } from './pg.js';

export { json };

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
  maybeOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string, params?: unknown[]): Promise<number>;
}

function wrap(c: PgConnection): Tx {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await c.query<T>(sql, params)).rows;
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const r = (await c.query<T>(sql, params)).rows;
      if (!r.length) throw new NotFoundError();
      return r[0];
    },
    async maybeOne<T>(sql: string, params: unknown[] = []) {
      return (await c.query<T>(sql, params)).rows[0] ?? null;
    },
    async exec(sql: string, params: unknown[] = []) {
      return (await c.query(sql, params)).rowCount;
    },
  };
}

export class NotFoundError extends Error {
  status = 404;
  constructor(message = 'Not found') {
    super(message);
  }
}

export class Db {
  readonly pool: PgPool;
  constructor(cfg: PgConfig, max = 10) {
    this.pool = new PgPool(cfg, max);
  }

  private async run<T>(ctx: { userId: string | null; system: boolean }, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const c = await this.pool.acquire();
    try {
      await c.query('begin');
      await c.query("select set_config('app.user_id', $1, true), set_config('app.system', $2, true)", [ctx.userId ?? '', ctx.system ? 'on' : 'off']);
      const out = await fn(wrap(c));
      await c.query('commit');
      return out;
    } catch (e) {
      try {
        await c.query('rollback');
      } catch {
        /* connection may be gone */
      }
      throw e;
    } finally {
      this.pool.release(c);
    }
  }

  /** Run as a signed-in user: Row Level Security limits every statement to that user's rows. */
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!userId) throw new Error('asUser requires a user id');
    return this.run({ userId, system: false }, fn);
  }

  /** Run as anonymous: only public content is visible. */
  asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run({ userId: null, system: false }, fn);
  }

  /** Trusted server operations only (sign-in lookup, webhooks, admin aggregates, seeding). */
  asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run({ userId: null, system: true }, fn);
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
