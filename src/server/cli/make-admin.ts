// Usage: node dist/src/server/cli/make-admin.js someone@example.com
import { loadConfig } from '../config.js';
import { Db } from '../lib/db.js';

const email = (process.argv[2] || '').toLowerCase();
if (!email) throw new Error('Pass the email address of an existing account');
const cfg = loadConfig();
const db = new Db(cfg.adminDb ?? cfg.db, 1);
const n = await db.asSystem(async (tx) => {
  const r = await tx.exec("update kyvo.users set role = 'admin' where lower(email) = $1", [email]);
  if (r) await tx.exec("insert into kyvo.audit_log (actor_id, action, target) values (null, 'grant_admin', $1)", [email]);
  return r;
});
console.log(n ? `${email} is now an admin.` : `No account found for ${email}.`);
await db.close();
