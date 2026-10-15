// Production build: compiles the server (and tests) and the browser client with TypeScript.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
for (const project of ['tsconfig.server.json', 'tsconfig.client.json']) {
  console.log(`tsc -p ${project}`);
  execFileSync(process.execPath, [tsc, '-p', path.join(root, project)], { stdio: 'inherit', cwd: root });
}
console.log('Build complete: dist/src/server (server), dist/public/js (browser client).');
