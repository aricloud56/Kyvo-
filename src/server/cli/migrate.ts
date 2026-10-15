// Usage: DATABASE_ADMIN_URL=postgres://owner:pw@host/db node dist/src/server/cli/migrate.js
import { loadConfig } from '../config.js';
import { migrate } from '../migrate.js';
import { MIGRATIONS_DIR } from '../paths.js';

const cfg = loadConfig();
const applied = await migrate(cfg.adminDb ?? cfg.db, MIGRATIONS_DIR);
console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
