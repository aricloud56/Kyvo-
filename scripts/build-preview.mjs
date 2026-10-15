// Builds a self-contained, server-free preview of the app (sample data, in-browser DemoApi) into dist/preview.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'preview');
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'tsconfig.client.json')], { stdio: 'inherit' });
fs.rmSync(out, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
copy('dist/public/js', 'js');
copy('public/css/kyvo.css', 'css/kyvo.css');
copy('public/media', 'media');
copy('public/icon.svg', 'icon.svg');
copy('public/data', 'data');
copy('public/vendor', 'vendor');
copy('public/models', 'models');
for (const f of ['exercises.json', 'exercise_media.json', 'foods.json', 'foods_extra.json', 'recipes.json']) copy(`data/${f}`, `data/${f}`);
// The Artifact host wraps this in its own document skeleton; a standalone copy is written too.
const body = `<title>KYVO Preview</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#111111">
<link rel="stylesheet" href="css/kyvo.css">
<style>:root{color-scheme:dark}html,body{background:#111111;color:#ffffff}</style>
<a class="skip" href="#view">Skip to content</a>
<div id="app" aria-live="polite"><p class="boot">Loading KYVO preview…</p></div>
<script type="module" src="js/client/demo/main.js"></script>
`;
fs.writeFileSync(path.join(out, 'index.html'), body);
fs.writeFileSync(path.join(out, 'standalone.html'), `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body class="app">${body}</body></html>`);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(out, p));
  }
})(out);
console.log(`Preview built in ${path.relative(root, out)} (${files.length} files).`);
