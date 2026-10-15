// Locates the project root (the folder holding package.json) from the compiled file location.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('Could not find the project root');
    dir = up;
  }
  return dir;
}

export const ROOT = findRoot();
export const DATA_DIR = path.join(ROOT, 'data');
export const MIGRATIONS_DIR = path.join(ROOT, 'db/migrations');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const CLIENT_JS_DIR = path.join(ROOT, 'dist/public/js');
export const LEGAL_DIR = path.join(ROOT, 'legal');
