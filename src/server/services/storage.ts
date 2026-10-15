// Private file storage for progress photos. Files are never public: they are served only through an
// authenticated route that checks ownership. Local disk for development; Supabase Storage (private bucket) in production.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

export class LocalStorage implements Storage {
  constructor(private dir: string) {}
  private file(key: string) {
    if (!/^[a-z0-9/-]+\.(jpg|png|webp)$/.test(key)) throw new Error('Invalid storage key');
    return path.join(this.dir, key);
  }
  async put(key: string, data: Buffer): Promise<void> {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
    await fs.writeFile(f, data, { mode: 0o600 });
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.file(key));
    } catch {
      return null;
    }
  }
  async remove(key: string): Promise<void> {
    await fs.rm(this.file(key), { force: true });
  }
}

/** Supabase Storage over its REST API with the service-role key (server-side only). Not verified without credentials. */
export class SupabaseStorage implements Storage {
  constructor(private url: string, private key: string, private bucket: string) {}
  private obj(key: string) {
    return `${this.url.replace(/\/$/, '')}/storage/v1/object/${this.bucket}/${key}`;
  }
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const r = await fetch(this.obj(key), { method: 'POST', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': contentType, 'x-upsert': 'true' }, body: new Uint8Array(data) });
    if (!r.ok) throw new Error(`Storage upload failed (${r.status})`);
  }
  async get(key: string): Promise<Buffer | null> {
    const r = await fetch(this.obj(key), { headers: { Authorization: `Bearer ${this.key}` } });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error(`Storage download failed (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  async remove(key: string): Promise<void> {
    await fetch(`${this.url.replace(/\/$/, '')}/storage/v1/object/${this.bucket}`, { method: 'DELETE', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }) });
  }
}

export function createStorage(cfg: Config): Storage {
  if (cfg.storage.driver === 'supabase') {
    if (!cfg.storage.supabaseUrl || !cfg.storage.supabaseServiceKey) throw new Error('STORAGE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    return new SupabaseStorage(cfg.storage.supabaseUrl, cfg.storage.supabaseServiceKey, cfg.storage.bucket);
  }
  return new LocalStorage(path.resolve(cfg.storage.localDir));
}

/** Detect the image type from its first bytes; never trust the client-supplied type. */
export function sniffImage(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
