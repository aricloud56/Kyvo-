// Usage: DATABASE_ADMIN_URL=... node dist/src/server/cli/seed.js  (loads exercises, media, foods, recipes, templates)
import { loadConfig } from '../config.js';
import { Db } from '../lib/db.js';
import { seedContent } from '../seed.js';
import { DATA_DIR } from '../paths.js';

const cfg = loadConfig();
const db = new Db(cfg.adminDb ?? cfg.db, 1);
const counts = await db.asSystem((tx) => seedContent(tx, DATA_DIR));
const verify = await db.asSystem((tx) => tx.one<{ n: number; u: number }>('select count(*)::int as n, count(distinct lower(name))::int as u from kyvo.exercises'));
console.log('Seeded', counts, `| exercises in database: ${verify.n} (${verify.u} distinct names)`);
await db.close();
