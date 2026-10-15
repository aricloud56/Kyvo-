// Accounts and sessions: scrypt password hashes, random session tokens stored only as SHA-256 hashes.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from '../lib/db.js';
import { HttpError, type AuthUser } from '../lib/http.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, LEN = 64;

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(got, expected);
}

// Used to make failed logins for unknown emails take as long as real ones.
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export const tokenHash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Use a password with at least 10 characters.', 'weak_password');
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.', 'weak_password');
  if (/^(.)\1+$/.test(pw) || ['password12', 'password123', '1234567890', 'qwertyuiop'].includes(pw.toLowerCase())) throw new HttpError(400, 'That password is too easy to guess.', 'weak_password');
  return pw;
}

export interface Attribution {
  utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string; landing_path?: string; referrer_host?: string; first_seen_at?: string;
}

export class AuthService {
  // Admin is never granted from an email address (emails are unverified); use the make-admin CLI.
  constructor(private db: Db, private sessionDays: number) {}

  async register(email: string, password: string, attribution: Attribution | null, analyticsConsent: boolean): Promise<{ userId: string; token: string }> {
    const hash = await hashPassword(password);
    return this.db.asSystem(async (tx) => {
      const exists = await tx.maybeOne('select 1 from kyvo.users where lower(email) = lower($1)', [email]);
      if (exists) throw new HttpError(409, 'An account with this email already exists. Try signing in.', 'email_taken');
      const u = await tx.one<{ id: string }>("insert into kyvo.users (email, password_hash, role, analytics_consent) values ($1,$2,'user',$3) returning id", [email, hash, analyticsConsent]);
      await tx.exec("insert into kyvo.profiles (user_id) values ($1)", [u.id]);
      if (attribution) {
        await tx.exec(
          'insert into kyvo.attribution (user_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, referrer_host, first_seen_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [u.id, attribution.utm_source ?? null, attribution.utm_medium ?? null, attribution.utm_campaign ?? null, attribution.utm_content ?? null, attribution.utm_term ?? null, attribution.landing_path ?? null, attribution.referrer_host ?? null, attribution.first_seen_at ?? null],
        );
      }
      await tx.exec("insert into kyvo.product_events (user_id, name, campaign) values ($1, 'signup', $2)", [u.id, attribution?.utm_campaign ?? null]);
      const token = await this.createSession(tx, u.id);
      return { userId: u.id, token };
    });
  }

  async login(email: string, password: string): Promise<{ userId: string; token: string }> {
    return this.db.asSystem(async (tx) => {
      const u = await tx.maybeOne<{ id: string; password_hash: string; email: string }>('select id, password_hash, email from kyvo.users where lower(email) = lower($1)', [email]);
      const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
      if (!u || !ok) throw new HttpError(401, 'That email and password do not match.', 'bad_credentials');
      await tx.exec('update kyvo.users set last_login_at = now() where id = $1', [u.id]);
      await tx.exec('delete from kyvo.sessions where user_id = $1 and expires_at < now()', [u.id]);
      return { userId: u.id, token: await this.createSession(tx, u.id) };
    });
  }

  private async createSession(tx: { exec: (s: string, p: unknown[]) => Promise<number> }, userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await tx.exec(`insert into kyvo.sessions (user_id, token_hash, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`, [userId, tokenHash(token), String(this.sessionDays)]);
    return token;
  }

  async resolve(token: string | undefined): Promise<AuthUser | null> {
    if (!token || token.length > 100) return null;
    return this.db.asSystem(async (tx) => {
      const r = await tx.maybeOne<{ sid: string; id: string; email: string; role: 'user' | 'admin'; expires_at: string }>(
        'select s.id as sid, u.id, u.email, u.role, s.expires_at from kyvo.sessions s join kyvo.users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()',
        [tokenHash(token)],
      );
      if (!r) return null;
      // Sliding expiry, refreshed at most once a day.
      if (new Date(r.expires_at).getTime() - Date.now() < (this.sessionDays - 1) * 86400000) {
        await tx.exec(`update kyvo.sessions set expires_at = now() + ($2 || ' days')::interval where id = $1`, [r.sid, String(this.sessionDays)]);
      }
      return { id: r.id, email: r.email, role: r.role, sessionId: r.sid };
    });
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.asSystem((tx) => tx.exec('delete from kyvo.sessions where id = $1', [sessionId]));
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    await this.db.asUser(userId, async (tx) => {
      const u = await tx.one<{ password_hash: string }>('select password_hash from kyvo.users where id = $1', [userId]);
      if (!(await verifyPassword(current, u.password_hash))) throw new HttpError(400, 'Your current password is not correct.', 'bad_credentials');
      await tx.exec('update kyvo.users set password_hash = $2 where id = $1', [userId, await hashPassword(next)]);
    });
    await this.db.asSystem((tx) => tx.exec('delete from kyvo.sessions where user_id = $1', [userId]));
  }

  async checkPassword(userId: string, pw: string): Promise<boolean> {
    const u = await this.db.asUser(userId, (tx) => tx.one<{ password_hash: string }>('select password_hash from kyvo.users where id = $1', [userId]));
    return verifyPassword(pw, u.password_hash);
  }
}
