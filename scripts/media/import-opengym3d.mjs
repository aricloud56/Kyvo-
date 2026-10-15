#!/usr/bin/env node
// Imports the OpenGym3D exercise pack (MIT, https://github.com/AssiamahS/opengym3d, dist/opengym3d-exercise-pack-v1.zip)
// as live 3D demos. Every model in the pack uses the same rigged MakeHuman body (CC0); only the animation and the
// muscle paint differ. So KYVO keeps one shared body (public/models/body.glb) and, per pack exercise, a small
// "kyvo-clip/1" file with the animation tracks and the muscle paint.
//
//   unzip opengym3d-exercise-pack-v1.zip -d /tmp/og3d
//   node scripts/media/import-opengym3d.mjs --pack /tmp/og3d/pack
//
// Every pack exercise is converted (public/models/og3d/<pack-id>.json). Only the KYVO exercises listed in
// scripts/media/opengym3d-map.json get a 3D demo in public/data/demos.json: the map was checked by hand and only
// pairs exercises whose body movement and stance are the same. The pack draws no equipment.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CREDIT = '3D body and motion: OpenGym3D exercise pack (MIT) using the MakeHuman anatomical male (CC0). Equipment is not shown. Rendered live with three.js (MIT).';
// Linear vertex colours the pack paints with: skin, main muscles (red) and assisting muscles (orange).
const SRC_SKIN = [0.62, 0.64, 0.68], SRC_PRI = [0.62, 0.02, 0.03], SRC_SEC = [0.8, 0.26, 0.02];

export function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file} is not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen + 8;
  const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen));
  const floats = (ai) => {
    const a = json.accessors[ai], v = json.bufferViews[a.bufferView];
    if (a.componentType !== 5126 || v.byteStride) throw new Error('only tightly packed float accessors are supported');
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return new Float32Array(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * width * 4));
  };
  return { json, floats };
}

// Main/assisting weights per vertex, found by writing each colour as skin + p*(main - skin) + q*(assist - skin).
function paint(colours) {
  const dp = SRC_PRI.map((v, i) => v - SRC_SKIN[i]), dq = SRC_SEC.map((v, i) => v - SRC_SKIN[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pp = dot(dp, dp), qq = dot(dq, dq), pq = dot(dp, dq), det = pp * qq - pq * pq;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const out = new Uint8Array((colours.length / 3) * 2);
  for (let i = 0; i < colours.length / 3; i++) {
    const d = [0, 1, 2].map((k) => colours[i * 3 + k] - SRC_SKIN[k]);
    const a = dot(dp, d), c = dot(dq, d);
    out[i * 2] = Math.round(clamp((qq * a - pq * c) / det) * 255);
    out[i * 2 + 1] = Math.round(clamp((pp * c - pq * a) / det) * 255);
  }
  return out;
}

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
const same = (a, b, eps = 1e-5) => a.every((v, i) => Math.abs(v - b[i]) < eps);

export function convert(file, meta) {
  const { json, floats } = readGlb(file);
  const anim = json.animations.find((a) => a.channels.length > 1) ?? json.animations[0];
  const prim = json.meshes[0].primitives[0];
  const tracks = [];
  let duration = 0;
  for (const ch of anim.channels) {
    const node = json.nodes[ch.target.node];
    const path_ = ch.target.path;
    const s = anim.samplers[ch.sampler];
    const times = floats(s.input), values = floats(s.output);
    const w = path_ === 'rotation' ? 4 : 3;
    duration = Math.max(duration, times[times.length - 1]);
    const restRaw = path_ === 'rotation' ? node.rotation ?? [0, 0, 0, 1] : path_ === 'scale' ? node.scale ?? [1, 1, 1] : node.translation ?? [0, 0, 0];
    const constant = [...Array(times.length).keys()].every((k) => same(values.subarray(k * w, k * w + w), values.subarray(0, w)));
    // Skip tracks that never move away from the bone's rest value; they add nothing.
    if (constant && same(values.subarray(0, w), restRaw, 1e-4)) continue;
    if (path_ === 'scale' && constant) continue;
    tracks.push({
      bone: node.name,
      path: { rotation: 'quaternion', translation: 'position', scale: 'scale' }[path_],
      times: b64(constant ? times.subarray(0, 1) : times),
      values: b64(constant ? values.subarray(0, w) : values),
    });
  }
  return {
    format: 'kyvo-clip/1',
    id: meta.id,
    name: meta.name,
    source: 'OpenGym3D exercise pack v1 (MIT)',
    duration: Math.round(duration * 1000) / 1000,
    vertices: json.accessors[prim.attributes.POSITION].count,
    primary: meta.primary,
    secondary: meta.secondary,
    tracks,
    paint: b64(paint(floats(prim.attributes.COLOR_0))),
  };
}

function main() {
  const pack = process.argv[process.argv.indexOf('--pack') + 1];
  if (!pack || !fs.existsSync(path.join(pack, 'exercises.json')) || !fs.existsSync(path.join(pack, 'models'))) {
    console.error('Usage: import-opengym3d.mjs --pack <unzipped pack folder with exercises.json and models/>');
    process.exit(2);
  }
  const meta = JSON.parse(fs.readFileSync(path.join(pack, 'exercises.json'), 'utf8'));
  const map = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'media', 'opengym3d-map.json'), 'utf8'));
  const kyvo = new Set(JSON.parse(fs.readFileSync(path.join(root, 'data', 'exercises.json'), 'utf8')).map((e) => e.id));
  const models = path.join(root, 'public', 'models');
  const outDir = path.join(models, 'og3d');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  // The shared body: any pack model carries it; its own muscle paint is replaced per exercise at load time.
  fs.copyFileSync(path.join(pack, 'models', 'bent_over_row.glb'), path.join(models, 'body.glb'));
  fs.copyFileSync(path.join(pack, 'LICENSE'), path.join(models, 'LICENSE-opengym3d.txt'));
  let n = 0;
  for (const m of meta) {
    const file = path.join(pack, 'models', `${m.id}.glb`);
    if (!fs.existsSync(file)) continue;
    fs.writeFileSync(path.join(outDir, `${m.id}.json`), JSON.stringify(convert(file, m)));
    n++;
  }
  const demosPath = path.join(root, 'public', 'data', 'demos.json');
  const demos = JSON.parse(fs.readFileSync(demosPath, 'utf8'));
  for (const d of Object.values(demos.exercises)) if (d.model3d?.clip) delete d.model3d;
  for (const [id, { pack: packId, views }] of Object.entries(map)) {
    if (id.startsWith('_')) continue;
    if (!kyvo.has(id)) throw new Error(`opengym3d-map.json: unknown KYVO exercise ${id}`);
    if (!fs.existsSync(path.join(outDir, `${packId}.json`))) throw new Error(`opengym3d-map.json: pack has no ${packId}`);
    const entry = (demos.exercises[id] ??= {});
    entry.model3d = { glb: 'models/body.glb', clip: `models/og3d/${packId}.json`, views, credit: `${CREDIT} Pack exercise: ${meta.find((x) => x.id === packId).name}.` };
  }
  for (const [id, d] of Object.entries(demos.exercises)) if (!d.angles && !d.model3d) delete demos.exercises[id];
  fs.writeFileSync(demosPath, `${JSON.stringify(demos, null, 2)}\n`);
  console.log(`Converted ${n} OpenGym3D exercises into public/models/og3d/; ${Object.keys(map).filter((k) => !k.startsWith('_')).length} KYVO exercises now have a 3D demo.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
