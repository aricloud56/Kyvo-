// Minimal PostgreSQL client (wire protocol v3) with SCRAM-SHA-256/MD5 auth, TLS, parameterised queries and a pool.
// Written in-house so KYVO runs with zero runtime dependencies. Supports exactly what the app uses.
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: false | 'require' | 'verify';
}

export function parseDatabaseUrl(url: string, sslMode?: string): PgConfig {
  const u = new URL(url);
  const qsMode = u.searchParams.get('sslmode');
  const mode = (sslMode || qsMode || '').toLowerCase();
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    ssl: mode === 'disable' || mode === '' ? false : mode === 'verify-full' || mode === 'verify' ? 'verify' : 'require',
  };
}

export class PgError extends Error {
  code: string;
  detail?: string;
  constructor(fields: Record<string, string>) {
    super(fields.M || 'PostgreSQL error');
    this.code = fields.C || '';
    this.detail = fields.D;
  }
}

type Row = Record<string, unknown>;
export interface QueryResult<T = Row> {
  rows: T[];
  rowCount: number;
}

interface Field {
  name: string;
  oid: number;
}

const ARRAY_ELEMENT: Record<number, number> = { 1000: 16, 1005: 21, 1007: 23, 1016: 20, 1009: 25, 1015: 25, 1231: 1700, 1021: 700, 1022: 701, 2951: 2950, 1182: 1082 };

function parseScalar(oid: number, v: string): unknown {
  switch (oid) {
    case 16: return v === 't';
    case 20: case 21: case 23: case 26: case 700: case 701: case 1700: return Number(v);
    case 114: case 3802: return JSON.parse(v);
    case 1184: case 1114: {
      let iso = v.replace(' ', 'T');
      if (oid === 1114) iso += 'Z';
      else iso = iso.replace(/([+-]\d{2})$/, '$1:00');
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? v : d.toISOString();
    }
    default: return v;
  }
}

/** Parse a one-dimensional PostgreSQL array literal like {a,"b c",NULL}. */
function parseArray(text: string, elemOid: number): unknown[] {
  const out: unknown[] = [];
  if (text === '{}') return out;
  let i = 1;
  while (i < text.length - 1) {
    let val = '';
    let quoted = false;
    if (text[i] === '"') {
      quoted = true;
      i++;
      while (text[i] !== '"') {
        if (text[i] === '\\') i++;
        val += text[i++];
      }
      i++;
    } else {
      while (text[i] !== ',' && text[i] !== '}') val += text[i++];
    }
    out.push(!quoted && val === 'NULL' ? null : parseScalar(elemOid, val));
    i++; // skip comma
  }
  return out;
}

function parseValue(oid: number, v: string): unknown {
  const elem = ARRAY_ELEMENT[oid];
  return elem ? parseArray(v, elem) : parseScalar(oid, v);
}

function arrayLiteral(a: unknown[]): string {
  return '{' + a.map((x) => (x == null ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';
}

/** Serialise a JS value to PostgreSQL text format. Arrays become array literals; plain objects become JSON. */
export function serialize(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return arrayLiteral(v);
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 't' : 'f';
  return String(v);
}

/** Wrap a value that must be sent as JSON even if it is an array. */
export const json = (v: unknown): { toPg: string } => ({ toPg: JSON.stringify(v) });

class Writer {
  private parts: Buffer[] = [];
  str(s: string) {
    this.parts.push(Buffer.from(s + '\0', 'utf8'));
    return this;
  }
  i16(n: number) {
    const b = Buffer.alloc(2);
    b.writeInt16BE(n);
    this.parts.push(b);
    return this;
  }
  i32(n: number) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    this.parts.push(b);
    return this;
  }
  bytes(b: Buffer) {
    this.parts.push(b);
    return this;
  }
  msg(type: string): Buffer {
    const body = Buffer.concat(this.parts);
    const head = Buffer.alloc(5);
    head.write(type, 0, 'ascii');
    head.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([head, body]);
  }
}

interface Pending {
  resolve: (r: QueryResult) => void;
  reject: (e: Error) => void;
  fields: Field[];
  rows: Row[];
  rowCount: number;
  error: PgError | null;
}

export class PgConnection {
  private socket!: net.Socket | tls.TLSSocket;
  private buf: Buffer = Buffer.alloc(0);
  private queue: Pending[] = [];
  private onMessage: ((type: string, body: Buffer) => void) | null = null;
  broken = false;

  static async connect(cfg: PgConfig): Promise<PgConnection> {
    const c = new PgConnection();
    await c.open(cfg);
    return c;
  }

  private async open(cfg: PgConfig): Promise<void> {
    let sock: net.Socket | tls.TLSSocket = await new Promise((res, rej) => {
      const s = net.connect(cfg.port, cfg.host, () => res(s));
      s.once('error', rej);
    });
    if (cfg.ssl) {
      sock.write(new Writer().i32(8).i32(80877103).msg('').subarray(5)); // SSLRequest: length + code, no type byte
      const answer: Buffer = await new Promise((res) => sock.once('data', res));
      if (answer.toString('ascii', 0, 1) !== 'S') throw new Error('Server does not accept SSL connections');
      sock = await new Promise((res, rej) => {
        const t = tls.connect({ socket: sock as net.Socket, servername: cfg.host, rejectUnauthorized: cfg.ssl === 'verify' }, () => res(t));
        t.once('error', rej);
      });
    }
    this.socket = sock;
    sock.on('data', (d: Buffer) => this.onData(d));
    sock.on('error', () => this.fail(new Error('Database connection error')));
    sock.on('close', () => this.fail(new Error('Database connection closed')));

    const startup = new Writer().i32(196608).str('user').str(cfg.user).str('database').str(cfg.database).str('client_encoding').str('UTF8').str('TimeZone').str('UTC').str('').msg('');
    sock.write(startup.subarray(1));
    await this.authenticate(cfg);
  }

  private authenticate(cfg: PgConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      let scram: { nonce: string; clientFirstBare: string; serverSignature?: Buffer } | null = null;
      this.onMessage = (type, body) => {
        if (type === 'E') return reject(new PgError(parseFields(body)));
        if (type === 'Z') {
          this.onMessage = null;
          return resolve();
        }
        if (type !== 'R') return;
        const code = body.readInt32BE(0);
        if (code === 0) return;
        if (code === 3) return this.socket.write(new Writer().str(cfg.password).msg('p'));
        if (code === 5) {
          const salt = body.subarray(4, 8);
          const inner = crypto.createHash('md5').update(cfg.password + cfg.user).digest('hex');
          const outer = 'md5' + crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
          return this.socket.write(new Writer().str(outer).msg('p'));
        }
        if (code === 10) {
          const nonce = crypto.randomBytes(18).toString('base64');
          const clientFirstBare = `n=*,r=${nonce}`;
          scram = { nonce, clientFirstBare };
          const first = Buffer.from('n,,' + clientFirstBare);
          return this.socket.write(new Writer().str('SCRAM-SHA-256').i32(first.length).bytes(first).msg('p'));
        }
        if (code === 11 && scram) {
          const serverFirst = body.subarray(4).toString('utf8');
          const attrs = Object.fromEntries(serverFirst.split(',').map((kv) => [kv[0], kv.slice(2)]));
          if (!attrs.r?.startsWith(scram.nonce)) return reject(new Error('SCRAM nonce mismatch'));
          const salted = crypto.pbkdf2Sync(cfg.password.normalize('NFKC'), Buffer.from(attrs.s, 'base64'), Number(attrs.i), 32, 'sha256');
          const clientKey = crypto.createHmac('sha256', salted).update('Client Key').digest();
          const storedKey = crypto.createHash('sha256').update(clientKey).digest();
          const finalNoProof = `c=biws,r=${attrs.r}`;
          const authMessage = `${scram.clientFirstBare},${serverFirst},${finalNoProof}`;
          const clientSig = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
          const proof = Buffer.from(clientKey.map((b, i) => b ^ clientSig[i]));
          const serverKey = crypto.createHmac('sha256', salted).update('Server Key').digest();
          scram.serverSignature = crypto.createHmac('sha256', serverKey).update(authMessage).digest();
          return this.socket.write(new Writer().bytes(Buffer.from(`${finalNoProof},p=${proof.toString('base64')}`)).msg('p'));
        }
        if (code === 12 && scram?.serverSignature) {
          const v = body.subarray(4).toString('utf8').replace(/^v=/, '');
          if (!crypto.timingSafeEqual(Buffer.from(v, 'base64'), scram.serverSignature)) return reject(new Error('SCRAM server signature mismatch'));
          return;
        }
        reject(new Error(`Unsupported authentication method ${code}`));
      };
    });
  }

  private fail(err: Error) {
    this.broken = true;
    const q = this.queue.splice(0);
    q.forEach((p) => p.reject(err));
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      try {
        if (this.onMessage) this.onMessage(type, body);
        else this.handle(type, body);
      } catch (e) {
        const p = this.queue[0];
        if (p && !p.error) p.error = new PgError({ M: `Could not read database response: ${(e as Error).message}` });
      }
    }
  }

  private handle(type: string, body: Buffer) {
    const p = this.queue[0];
    if (!p) return;
    switch (type) {
      case 'T': {
        const n = body.readInt16BE(0);
        let o = 2;
        p.fields = [];
        for (let i = 0; i < n; i++) {
          const end = body.indexOf(0, o);
          const name = body.toString('utf8', o, end);
          o = end + 1;
          const oid = body.readInt32BE(o + 6);
          o += 18;
          p.fields.push({ name, oid });
        }
        break;
      }
      case 'D': {
        const n = body.readInt16BE(0);
        let o = 2;
        const row: Row = {};
        for (let i = 0; i < n; i++) {
          const len = body.readInt32BE(o);
          o += 4;
          const f = p.fields[i];
          if (len === -1) row[f.name] = null;
          else {
            row[f.name] = parseValue(f.oid, body.toString('utf8', o, o + len));
            o += len;
          }
        }
        p.rows.push(row);
        break;
      }
      case 'C': {
        const tag = body.toString('utf8', 0, body.length - 1);
        const m = tag.match(/(\d+)$/);
        p.rowCount += m ? Number(m[1]) : 0;
        break;
      }
      case 'E':
        p.error = new PgError(parseFields(body));
        break;
      case 'Z':
        this.queue.shift();
        if (p.error) p.reject(p.error);
        else p.resolve({ rows: p.rows, rowCount: p.rowCount });
        break;
      default:
        break; // 1, 2, n, s, N, S, I: nothing to do
    }
  }

  private send(buf: Buffer): Promise<QueryResult> {
    if (this.broken) return Promise.reject(new Error('Database connection is closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, fields: [], rows: [], rowCount: 0, error: null });
      this.socket.write(buf);
    });
  }

  /** Run one parameterised statement with the extended query protocol. */
  query<T = Row>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const bind = new Writer().str('').str('').i16(0).i16(params.length);
    for (const p of params) {
      const v = p && typeof p === 'object' && 'toPg' in (p as object) ? (p as { toPg: string }).toPg : serialize(p);
      if (v === null) bind.i32(-1);
      else {
        const b = Buffer.from(v, 'utf8');
        bind.i32(b.length).bytes(b);
      }
    }
    bind.i16(1).i16(0);
    const buf = Buffer.concat([
      new Writer().str('').str(text).i16(0).msg('P'),
      bind.msg('B'),
      new Writer().bytes(Buffer.from('P\0')).msg('D'),
      new Writer().str('').i32(0).msg('E'),
      new Writer().msg('S'),
    ]);
    return this.send(buf) as Promise<QueryResult<T>>;
  }

  /** Run a multi-statement SQL script (no parameters), e.g. a migration. */
  simple(text: string): Promise<QueryResult> {
    return this.send(new Writer().str(text).msg('Q'));
  }

  end(): void {
    try {
      this.socket.write(new Writer().msg('X'));
      this.socket.end();
    } catch {
      /* already closed */
    }
    this.broken = true;
  }
}

function parseFields(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let o = 0;
  while (o < body.length && body[o] !== 0) {
    const code = String.fromCharCode(body[o]);
    const end = body.indexOf(0, o + 1);
    out[code] = body.toString('utf8', o + 1, end);
    o = end + 1;
  }
  return out;
}

export class PgPool {
  private idle: PgConnection[] = [];
  private total = 0;
  private waiters: ((c: PgConnection) => void)[] = [];
  constructor(private cfg: PgConfig, private max = 10) {}

  async acquire(): Promise<PgConnection> {
    while (this.idle.length) {
      const c = this.idle.pop()!;
      if (!c.broken) return c;
      this.total--;
    }
    if (this.total < this.max) {
      this.total++;
      try {
        return await PgConnection.connect(this.cfg);
      } catch (e) {
        this.total--;
        throw e;
      }
    }
    return new Promise((res) => this.waiters.push(res));
  }

  release(c: PgConnection): void {
    if (c.broken) {
      this.total--;
      if (this.waiters.length) this.acquire().then(this.waiters.shift()!);
      return;
    }
    const w = this.waiters.shift();
    if (w) w(c);
    else this.idle.push(c);
  }

  async end(): Promise<void> {
    this.idle.forEach((c) => c.end());
    this.idle = [];
    this.total = 0;
  }
}
