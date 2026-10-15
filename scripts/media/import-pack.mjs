#!/usr/bin/env node
// Imports a licensed exercise-animation pack (for example the exercisedb.io one-time licence) into KYVO.
//
//   node scripts/media/import-pack.mjs --manifest <pack.json|pack.csv> --dir <folder with the media files> \
//     --vendor "ExerciseDB" --license "Commercial licence, purchased 2026-10-15" [--map data/media-pack-map.json]
//
// Each manifest row needs an exercise name and a media file (GIF, WebP, MP4, WebM, or a PNG/JPEG still). Field names are detected
// (name/title/exercise and gifUrl/gif/videoUrl/video/mp4/file/media); a URL is reduced to its file name and looked
// up in --dir. Rows are matched to KYVO exercises by exact name or alias after normalising. Close-but-not-exact
// matches are NOT applied: they are written to storage/media-pack-review.json so a person can confirm them in the
// --map file ({ "kyvo-exercise-id": "Vendor exercise name" }), because a wrong demo is worse than none.
//
// Output: public/media/pack/<exercise-id>.<ext> and public/data/media-pack.json. Both are git-ignored: licensed
// media must not be published in the repository. Run this on each deploy from the purchased pack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA_EXT = new Set(['.gif', '.webp', '.mp4', '.webm', '.png', '.jpg', '.jpeg']);
const STILL_EXT = new Set(['.png', '.jpg', '.jpeg']);
const SYN = { db: 'dumbbell', dumbbells: 'dumbbell', bb: 'barbell', kb: 'kettlebell', ez: 'ezbar', pushup: 'push up', pullup: 'pull up', chinup: 'chin up', situp: 'sit up' };
const STOP = new Set(['the', 'a', 'with', 'on', 'of', 'and', 'exercise']);

export function normalise(s) {
  return String(s).toLowerCase().replace(/[’']/g, '').replace(/(\w)-(\w)/g, '$1$2').replace(/\bpull down\b/g, 'pulldown').replace(/\bpush down\b/g, 'pushdown').replace(/[()/,.-]+/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .map((w) => SYN[w] ?? w).join(' ').split(' ').filter((w) => !STOP.has(w)).sort().join(' ');
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((v) => v.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

const pick = (o, keys) => keys.map((k) => o[k]).find((v) => typeof v === 'string' && v.trim());

export function readManifest(file) {
  const text = fs.readFileSync(file, 'utf8');
  let rows = file.endsWith('.csv') ? parseCsv(text) : JSON.parse(text);
  if (!Array.isArray(rows)) rows = rows.exercises ?? rows.data ?? Object.values(rows);
  return rows.map((r) => ({ name: pick(r, ['name', 'title', 'exercise', 'exerciseName']), media: pick(r, ['videoUrl', 'video', 'mp4', 'gifUrl', 'gif', 'file', 'media', 'image']) }))
    .filter((r) => r.name && r.media);
}

/** Returns { matched: [{id, row}], review: [{id, name, candidates}], missing: [id] }. */
export function matchPack(exercises, rows, map = {}) {
  const byNorm = new Map();
  for (const r of rows) if (!byNorm.has(normalise(r.name))) byNorm.set(normalise(r.name), r);
  const byExactName = new Map(rows.map((r) => [r.name.toLowerCase().trim(), r]));
  const matched = [], review = [], missing = [];
  for (const e of exercises) {
    const pinned = map[e.id];
    if (pinned) {
      const r = byExactName.get(String(pinned).toLowerCase().trim());
      if (r) { matched.push({ id: e.id, row: r, via: 'map' }); continue; }
    }
    const r = [e.name, ...(e.aliases ?? [])].map((n) => byNorm.get(normalise(n))).find(Boolean);
    if (r) { matched.push({ id: e.id, row: r, via: 'name' }); continue; }
    // Same name once the exercise's own equipment words are ignored ("Cable lat pulldown" = "Lat pulldown" on a cable).
    const eq = new Set((e.equipment ?? []).flatMap((q) => normalise(q.replace(/_/g, ' ')).split(' ')));
    const core = (n) => normalise(n).split(' ').filter((w) => !eq.has(w)).join(' ');
    const mine = [e.name, ...(e.aliases ?? [])].map(core);
    const r2 = rows.find((row) => mine.includes(core(row.name)));
    if (r2) { matched.push({ id: e.id, row: r2, via: 'name+equipment' }); continue; }
    const want = new Set(normalise(e.name).split(' '));
    const candidates = rows.map((row) => {
      const have = new Set(normalise(row.name).split(' '));
      const inter = [...want].filter((w) => have.has(w)).length;
      return { name: row.name, score: inter / new Set([...want, ...have]).size };
    }).filter((c) => c.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 3);
    if (candidates.length) review.push({ id: e.id, name: e.name, candidates });
    else missing.push(e.id);
  }
  return { matched, review, missing };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i];
  return o;
}

function main() {
  const a = args(process.argv.slice(2));
  if (!a.manifest || !a.dir || !a.vendor || !a.license) {
    console.error('Usage: import-pack.mjs --manifest <file> --dir <media folder> --vendor <name> --license <text> [--map <file>] [--out <public dir>]');
    process.exit(2);
  }
  const pub = path.resolve(a.out ?? path.join(root, 'public'));
  const exercises = JSON.parse(fs.readFileSync(path.join(root, 'data', 'exercises.json'), 'utf8'));
  const rows = readManifest(path.resolve(a.manifest));
  const map = a.map && fs.existsSync(a.map) ? JSON.parse(fs.readFileSync(a.map, 'utf8')) : {};
  const { matched, review, missing } = matchPack(exercises, rows, map);
  const outDir = path.join(pub, 'media', 'pack');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const index = { vendor: a.vendor, license: a.license, exercises: {} };
  const noFile = [];
  for (const { id, row } of matched) {
    const base = decodeURIComponent(row.media.split(/[?#]/)[0].split('/').pop());
    const src = [path.join(a.dir, base), path.join(a.dir, row.media)].find((p) => fs.existsSync(p));
    const ext = path.extname(base).toLowerCase();
    if (!src || !MEDIA_EXT.has(ext)) { noFile.push(`${id} (${base})`); continue; }
    fs.copyFileSync(src, path.join(outDir, `${id}${ext}`));
    index.exercises[id] = { file: `media/pack/${id}${ext}`, kind: ext === '.mp4' || ext === '.webm' ? 'video' : 'image', still: STILL_EXT.has(ext), title: row.name };
  }
  fs.mkdirSync(path.join(pub, 'data'), { recursive: true });
  fs.writeFileSync(path.join(pub, 'data', 'media-pack.json'), JSON.stringify(index));
  fs.mkdirSync(path.join(root, 'storage'), { recursive: true });
  fs.writeFileSync(path.join(root, 'storage', 'media-pack-review.json'), JSON.stringify({ review, missing, noFile }, null, 2));
  console.log(`Imported ${Object.keys(index.exercises).length} of ${exercises.length} exercises from ${a.vendor}.`);
  console.log(`${review.length} need a person to confirm a close match, ${missing.length} have no match, ${noFile.length} matched but the file was missing.`);
  console.log('Details: storage/media-pack-review.json. Confirm matches in a --map file and re-run.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
