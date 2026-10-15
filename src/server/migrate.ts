// Applies SQL files in db/migrations in order, once each, recording them in public.kyvo_migrations.
import fs from 'node:fs';
import path from 'node:path';
import { PgConnection, type PgConfig } from './lib/pg.js';

export async function migrate(cfg: PgConfig, dir: string, log: (s: string) => void = console.log): Promise<string[]> {
  const c = await PgConnection.connect(cfg);
  try {
    await c.simple('create table if not exists public.kyvo_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query<{ name: string }>('select name from public.kyvo_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await c.simple('begin');
      try {
        await c.simple(sql);
        await c.query('insert into public.kyvo_migrations (name) values ($1)', [f]);
        await c.simple('commit');
      } catch (e) {
        await c.simple('rollback');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
      log(`applied ${f}`);
      applied.push(f);
    }
    return applied;
  } finally {
    c.end();
  }
}
