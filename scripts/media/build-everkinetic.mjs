#!/usr/bin/env node
// Builds looping demo clips from the free Everkinetic drawings (CC BY-SA 4.0, https://github.com/everkinetic/data).
// Each Everkinetic exercise has a "relaxation" (start) and a "tension" (end) drawing; this cross-fades between
// them so the clip shows the movement. Needs ffmpeg and python3 with Pillow.
//
//   git clone --depth 1 https://github.com/everkinetic/data.git /tmp/everkinetic
//   node scripts/media/build-everkinetic.mjs --src /tmp/everkinetic
//
// Exact name matches are used automatically; anything else must be listed in scripts/media/everkinetic-map.json,
// which was checked by hand. SKIP lists automatic matches that turned out to be a different variation.
// Output: public/media/demos/ek/<id>.{mp4,webm,jpg} and entries in public/data/demos.json.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchPack } from './import-pack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['seated-dumbbell-shoulder-press', 'low-to-high-cable-fly']);
const CREDIT = 'Drawing: Everkinetic (Greg Priday and contributors), CC BY-SA 4.0, animated by KYVO.';

const src = process.argv[process.argv.indexOf('--src') + 1];
if (!src || !fs.existsSync(path.join(src, 'dist', 'exercises.json'))) {
  console.error('Usage: build-everkinetic.mjs --src <clone of github.com/everkinetic/data>');
  process.exit(2);
}
const ek = JSON.parse(fs.readFileSync(path.join(src, 'dist', 'exercises.json'), 'utf8'));
const exercises = JSON.parse(fs.readFileSync(path.join(root, 'data', 'exercises.json'), 'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'media', 'everkinetic-map.json'), 'utf8'));
const rows = ek.map((x) => ({ name: x.title.trim(), media: x.id }));
const { matched } = matchPack(exercises, rows, map);
const use = matched.filter((m) => !SKIP.has(m.id));

const outDir = path.join(root, 'public', 'media', 'demos', 'ek');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-'));
const demosPath = path.join(root, 'public', 'data', 'demos.json');
const demos = JSON.parse(fs.readFileSync(demosPath, 'utf8'));
for (const [id, d] of Object.entries(demos.exercises)) if (d.source === 'everkinetic') delete demos.exercises[id];

// Put both drawings on the same white 960x600 canvas at the same scale, bottom-aligned, so the cross-fade lines up.
const PREP = `
import sys
from PIL import Image
W, H, PAD = 960, 600, 36
ims = [Image.open(p).convert('L') for p in sys.argv[1:3]]
s = min(min((W - 2 * PAD) / im.width, (H - 2 * PAD) / im.height) for im in ims)
for im, out in zip(ims, sys.argv[3:5]):
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    c = Image.new('RGB', (W, H), (255, 255, 255))
    c.paste(im.convert('RGB'), ((W - im.width) // 2, H - PAD - im.height))  # feet on the same floor line
    c.save(out)
`;
fs.writeFileSync(path.join(tmp, 'prep.py'), PREP);

let n = 0;
for (const { id, row } of use) {
  const a = path.join(src, 'dist', 'png', `${row.media}-relaxation.png`);
  const b = path.join(src, 'dist', 'png', `${row.media}-tension.png`);
  if (!fs.existsSync(a) || !fs.existsSync(b)) continue;
  const fa = path.join(tmp, 'a.png'), fb = path.join(tmp, 'b.png');
  execFileSync('python3', ['-I', path.join(tmp, 'prep.py'), a, b, fa, fb]);
  // start 0.8 s, quick fade 0.35 s, end 0.8 s, fade back 0.35 s: a 2.3 s loop.
  const graph = '[0:v]fps=24,format=yuv420p[a];[1:v]fps=24,format=yuv420p[b];[2:v]fps=24,format=yuv420p[c];' +
    '[a][b]xfade=transition=fade:duration=0.35:offset=0.8[ab];[ab][c]xfade=transition=fade:duration=0.35:offset=1.95[v]';
  const inputs = ['-loop', '1', '-t', '1.2', '-i', fa, '-loop', '1', '-t', '1.6', '-i', fb, '-loop', '1', '-t', '0.6', '-i', fa];
  const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
  ff([...inputs, '-filter_complex', graph, '-map', '[v]', '-t', '2.3', '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', path.join(outDir, `${id}.mp4`)]);
  ff([...inputs, '-filter_complex', graph, '-map', '[v]', '-t', '2.3', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '42', path.join(outDir, `${id}.webm`)]);
  ff(['-i', fb, '-q:v', '5', path.join(outDir, `${id}.jpg`)]);
  demos.exercises[id] = {
    source: 'everkinetic',
    angles: [{
      label: 'Side',
      video: [{ src: `media/demos/ek/${id}.webm`, type: 'video/webm' }, { src: `media/demos/ek/${id}.mp4`, type: 'video/mp4' }],
      poster: `media/demos/ek/${id}.jpg`,
      credit: `${CREDIT} Everkinetic exercise: ${row.name}.`,
    }],
  };
  n++;
}
fs.writeFileSync(demosPath, `${JSON.stringify(demos, null, 2)}\n`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Built ${n} Everkinetic demo clips into public/media/demos/ek/.`);
