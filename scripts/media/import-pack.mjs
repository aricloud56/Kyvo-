#!/usr/bin/env node
// KYVO licensed-media importer. Node 22, no runtime dependencies.
// Default is audit-only. To publish, pass --apply after reviewing the report.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA_EXT = new Set(['.gif', '.webp', '.mp4', '.webm', '.png', '.jpg', '.jpeg']);
const STILL_EXT = new Set(['.png', '.jpg', '.jpeg']);
const SYN = { db: 'dumbbell', dumbbells: 'dumbbell', bb: 'barbell', kb: 'kettlebell', ez: 'ezbar', pushup: 'push up', pullup: 'pull up', chinup: 'chin up', situp: 'sit up' };
const STOP = new Set(['the', 'a', 'with', 'on', 'of', 'and', 'exercise']);

// Keep exported legacy matcher compatible with build-everkinetic.mjs.
export function normalise(s) {
  return String(s).toLowerCase().replace(/[’']/g, '').replace(/(\w)-(\w)/g, '$1$2').replace(/\bpull down\b/g, 'pulldown').replace(/\bpush down\b/g, 'pushdown').replace(/[()/,.-]+/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .map((w) => SYN[w] ?? w).join(' ').split(' ').filter((w) => !STOP.has(w)).sort().join(' ');
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (q) throw new Error('Unclosed quoted CSV field');
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const nonempty = rows.filter((r) => r.some((v) => v.trim()));
  if (!nonempty.length) return [];
  const [head, ...body] = nonempty;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim().replace(/^\uFEFF/, ''), r[i] ?? ''])));
}
const pick = (o, keys) => keys.map((k) => o[k]).find((v) => typeof v === 'string' && v.trim());
export function readManifest(file) {
  const contents = fs.readFileSync(file, 'utf8');
  let rows = /\.csv$/i.test(file) ? parseCsv(contents) : JSON.parse(contents);
  if (!Array.isArray(rows)) rows = rows?.exercises ?? rows?.data ?? Object.values(rows ?? {});
  if (!Array.isArray(rows)) throw new Error('Manifest must contain a list of exercises');
  return rows.map((r) => ({ name: pick(r ?? {}, ['name', 'title', 'exercise', 'exerciseName']), media: pick(r ?? {}, ['videoUrl', 'video', 'mp4', 'gifUrl', 'gif', 'file', 'media', 'image']) })).filter((r) => r.name && r.media);
}
// Legacy matching behaviour retained for the existing Everkinetic build script.
export function matchPack(exercises, rows, map = {}) {
  const byNorm = new Map();
  for (const r of rows) if (!byNorm.has(normalise(r.name))) byNorm.set(normalise(r.name), r);
  const byExactName = new Map(rows.map((r) => [r.name.toLowerCase().trim(), r]));
  const matched = [], review = [], missing = [];
  for (const e of exercises) {
    const pinned = map[e.id];
    if (pinned) { const r = byExactName.get(String(pinned).toLowerCase().trim()); if (r) { matched.push({ id: e.id, row: r, via: 'map' }); continue; } }
    const r = [e.name, ...(e.aliases ?? [])].map((n) => byNorm.get(normalise(n))).find(Boolean);
    if (r) { matched.push({ id: e.id, row: r, via: 'name' }); continue; }
    const eq = new Set((e.equipment ?? []).flatMap((q) => normalise(q.replace(/_/g, ' ')).split(' ')));
    const core = (n) => normalise(n).split(' ').filter((w) => !eq.has(w)).join(' ');
    const mine = [e.name, ...(e.aliases ?? [])].map(core);
    const r2 = rows.find((row) => mine.includes(core(row.name)));
    if (r2) { matched.push({ id: e.id, row: r2, via: 'name+equipment' }); continue; }
    const want = new Set(normalise(e.name).split(' '));
    const candidates = rows.map((row) => { const have = new Set(normalise(row.name).split(' ')); const inter = [...want].filter((w) => have.has(w)).length; return { name: row.name, score: inter / new Set([...want, ...have]).size }; }).filter((c) => c.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 3);
    if (candidates.length) review.push({ id: e.id, name: e.name, candidates }); else missing.push(e.id);
  }
  return { matched, review, missing };
}

function safelyResolveMedia(dir, media) {
  if (typeof media !== 'string' || !media.trim() || media.includes('\0')) throw new Error('Invalid media path');
  const value = media.trim();
  let relative = value;
  if (/^https?:\/\//i.test(value)) {
    const u = new URL(value);
    relative = decodeURIComponent(u.pathname.split('/').pop() ?? '');
  } else {
    relative = decodeURIComponent(value.split(/[?#]/)[0].replace(/\\/g, '/'));
  }
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) throw new Error('Absolute/empty media path is not allowed');
  const base = path.resolve(dir);
  const selected = path.resolve(base, relative);
  if (selected !== base && !selected.startsWith(base + path.sep)) throw new Error('Media path escapes source folder');
  if (selected === base) throw new Error('Media must be a file');
  const ext = path.extname(selected).toLowerCase();
  if (!MEDIA_EXT.has(ext)) throw new Error(`Unsupported extension: ${ext || '(none)'}`);
  if (!fs.existsSync(selected)) throw new Error('Media file does not exist');
  const realBase = fs.realpathSync(base);
  const realSelected = fs.realpathSync(selected);
  if (!realSelected.startsWith(realBase + path.sep)) throw new Error('Media symlink escapes source folder');
  const stat = fs.statSync(realSelected);
  if (!stat.isFile() || !stat.size || stat.size > 100 * 1024 * 1024) throw new Error('Media file must be non-empty and at most 100 MB');
  const header = Buffer.alloc(Math.min(stat.size, 64));
  const fd = fs.openSync(realSelected, 'r');
  try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  const signatureOk = ext === '.png' ? header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : ['.jpg', '.jpeg'].includes(ext) ? header.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
    : ext === '.gif' ? /^GIF8[79]a/.test(header.toString('ascii', 0, 6))
    : ext === '.webp' ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
    : ext === '.webm' ? header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))
    : ext === '.mp4' ? header.toString('ascii', 4, 8) === 'ftyp' : false;
  if (!signatureOk) throw new Error('File signature does not match media extension');
  return { src: realSelected, ext, bytes: stat.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(realSelected)).digest('hex') };
}

// This importer intentionally requires unambiguous exact name/alias matches or explicit manual mapping.
// Legacy matchPack() remains unchanged for the Everkinetic builder.
export function auditPack(exercises, rows, mapping = {}, dir) {
  const matched = [], review = [], missing = [], noFile = [];
  const byName = new Map();
  for (const row of rows) {
    const key = normalise(row.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }
  const assigned = new Map();
  for (const e of exercises) {
    const pin = mapping[e.id];
    let candidates = [];
    let via = 'name';
    if (pin !== undefined) {
      via = 'map';
      candidates = rows.filter((r) => r.name.toLowerCase().trim() === String(pin).toLowerCase().trim());
    } else {
      const names = new Set([e.name, ...(e.aliases ?? [])].map(normalise));
      candidates = [...new Set([...names].flatMap((n) => byName.get(n) ?? []))];
    }
    if (candidates.length !== 1) {
      const suggestions = rows.map((r) => { const a = new Set(normalise(e.name).split(' ')); const b = new Set(normalise(r.name).split(' ')); const score = [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size; return { name: r.name, score }; }).filter((r) => r.score >= 0.5).sort((a,b) => b.score - a.score).slice(0, 3);
      if (candidates.length || suggestions.length || pin !== undefined) review.push({ id: e.id, name: e.name, reason: candidates.length > 1 ? 'Ambiguous matching rows' : pin !== undefined ? 'Manual mapping target not found' : 'Manual review required', candidates: candidates.length ? candidates.map((r) => ({ name: r.name, media: r.media })) : suggestions });
      else missing.push(e.id);
      continue;
    }
    const row = candidates[0];
    if (assigned.has(row)) { review.push({ id: e.id, name: e.name, reason: `Vendor row already assigned to ${assigned.get(row)}`, candidates: [{ name: row.name, media: row.media }] }); continue; }
    try { const file = safelyResolveMedia(dir, row.media); assigned.set(row, e.id); matched.push({ id: e.id, row, via, file }); }
    catch (err) { noFile.push({ id: e.id, name: e.name, media: row.media, reason: err.message }); }
  }
  return { matched, review, missing, noFile };
}

function parseArgs(argv) {
  const out = {};
  const keys = new Set(['manifest', 'dir', 'vendor', 'license', 'map', 'out', 'report', 'apply']);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    if (!keys.has(key) || key in out) throw new Error(`Unknown/duplicate option: --${key}`);
    if (key === 'apply') out.apply = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for --${key}`); out[key] = argv[++i]; }
  }
  return out;
}

function writeJson(dest, value) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(value, null, 2) + '\n'); }
export function runImport(options) {
  const { manifest, dir, vendor, license, map, out, report, apply = false, exercisesFile = path.join(root, 'data', 'exercises.json') } = options;
  if (![manifest, dir, vendor, license].every((x) => typeof x === 'string' && x.trim())) throw new Error('manifest, dir, vendor and license are required');
  if (!fs.statSync(dir).isDirectory()) throw new Error('Media source is not a directory');
  const exercises = JSON.parse(fs.readFileSync(exercisesFile, 'utf8'));
  if (!Array.isArray(exercises)) throw new Error('Exercise catalogue must be an array');
  const rows = readManifest(manifest);
  const mapping = map ? JSON.parse(fs.readFileSync(map, 'utf8')) : {};
  if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw new Error('Mapping must be an object');
  const ids = new Set(exercises.map((e) => e.id));
  for (const id of Object.keys(mapping)) if (!ids.has(id)) throw new Error(`Unknown exercise ID in map: ${id}`);
  const audit = auditPack(exercises, rows, mapping, dir);
  const output = path.resolve(out ?? path.join(root, 'public'));
  const reportPath = path.resolve(report ?? path.join(root, 'storage', 'media-pack-review.json'));
  const summary = { generatedAt: new Date().toISOString(), vendor, license, mode: apply ? 'apply' : 'audit', totalExercises: exercises.length, manifestRows: rows.length, importable: audit.matched.length, review: audit.review, missing: audit.missing, noFile: audit.noFile,
    matches: audit.matched.map(({id,row,via,file}) => ({ id, vendorName: row.name, media: row.media, via, bytes: file.bytes, sha256: file.sha256 })) };
  writeJson(reportPath, summary);
  if (!apply) return summary;
  if (!audit.matched.length) throw new Error('No validated matches; refusing to replace an existing pack');
  // Preflight passed: build a complete replacement in a staging directory on the destination filesystem.
  const mediaBase = path.join(output, 'media');
  const target = path.join(mediaBase, 'pack');
  const dataDir = path.join(output, 'data');
  fs.mkdirSync(mediaBase, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const staging = fs.mkdtempSync(path.join(mediaBase, '.pack-staging-'));
  const index = { vendor, license, exercises: {} };
  try {
    for (const { id, row, file } of audit.matched) {
      const name = `${id}${file.ext}`;
      fs.copyFileSync(file.src, path.join(staging, name));
      index.exercises[id] = { file: `media/pack/${name}`, kind: ['.mp4', '.webm'].includes(file.ext) ? 'video' : 'image', still: STILL_EXT.has(file.ext), title: row.name };
    }
    // Publish with rollback on a file write/rename error. No existing pack is deleted before staging succeeds.
    const backup = path.join(mediaBase, `.pack-backup-${crypto.randomUUID()}`);
    const indexPath = path.join(dataDir, 'media-pack.json');
    const oldIndex = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null;
    let backedUp = false;
    try {
      if (fs.existsSync(target)) { fs.renameSync(target, backup); backedUp = true; }
      fs.renameSync(staging, target);
      writeJson(indexPath, index);
      if (backedUp) fs.rmSync(backup, { recursive: true, force: true });
    } catch (err) {
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      if (backedUp) fs.renameSync(backup, target);
      if (oldIndex) fs.writeFileSync(indexPath, oldIndex); else fs.rmSync(indexPath, { force: true });
      throw err;
    }
  } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true }); }
  return summary;
}

function main() {
  try {
    const a = parseArgs(process.argv.slice(2));
    const result = runImport(a);
    console.log(`${a.apply ? 'Imported' : 'Audited'} ${result.importable} of ${result.totalExercises} exercises from ${result.vendor}.`);
    console.log(`${result.review.length} review, ${result.missing.length} unmatched, ${result.noFile.length} invalid/missing files.`);
    console.log(`Report: ${path.resolve(a.report ?? path.join(root, 'storage', 'media-pack-review.json'))}`);
    if (!a.apply) console.log('No media was changed. Review matches and re-run with --apply to publish.');
  } catch (err) { console.error(`Import failed: ${err.message}`); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();