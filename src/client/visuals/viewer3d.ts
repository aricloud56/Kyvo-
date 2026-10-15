// Real-time 3D exercise demonstration (Three.js). Loads the OpenGym3D anatomical body (CC0 MakeHuman mesh, MIT
// pack), builds one repetition from a KYVO motion file by aiming each bone at a target direction, bakes it into an
// animation clip, and plays it next to a simple machine model. Used by viewer.ts for exercises that have a 3D model.
// Three.js is loaded on demand from /vendor, so pages without a 3D demo never download it.
import { assetUrl } from './assets.js';

export interface Model3D { glb: string; motion: string; equipment: 'lat-pulldown'; credit: string }
export interface Controller { play(): void; pause(): void; replay(): void; setSpeed(s: number): void; setView(i: number): void; dispose(): void }

/** Camera views: rear three-quarter (shows the lats), side and front three-quarter. */
export const VIEWS = ['Rear', 'Side', 'Front'] as const;
const CAMERAS: [V3, V3][] = [[[-2.5, 2.0, -3.7], [0, 1.22, 0.3]], [[4.6, 1.5, 0.35], [0, 1.22, 0.35]], [[2.9, 1.9, 3.9], [0, 1.2, 0.2]]];

type V3 = [number, number, number];
interface Motion { duration: number; fps: number; grip?: { bones: string[]; axis: V3; deg: number }; segments: Record<string, [string, string]>; keyframes: { t: number; dirs: Record<string, V3> }[] }

// Highlight colours from the KYVO style brief (sRGB). The body model stores its muscle paint as vertex colours;
// they are decomposed into "primary" and "secondary" weights and re-coloured with these.
const SKIN = 0xd9dce0, PRIMARY = 0xe8552b, SECONDARY = 0xf2a65a, SHORTS = 0x4b4e54;
// Shorts: rest-pose heights from mid-thigh to the waist, on skin that follows the hips, thighs or lower spine
// (so the hands hanging beside the hips in the rest pose stay bare).
const SHORTS_BONES = new Set(['root', 'pelvisL', 'pelvisR', 'upperleg01L', 'upperleg01R', 'upperleg02L', 'upperleg02R', 'spine05', 'spine04']);
const SHORTS_Y: [number, number] = [0.6, 0.92];
// Linear vertex colours found in the OpenGym3D bent-over-row model: skin, primary (back) and secondary (arms).
const SRC_SKIN: V3 = [0.62, 0.64, 0.68], SRC_PRI: V3 = [0.8, 0.26, 0.02], SRC_SEC: V3 = [0.62, 0.02, 0.03];

const smooth = (x: number) => x * x * (3 - 2 * x);

export async function mount3D(host: HTMLElement, model: Model3D, opts: { paused: boolean; speed: number; view: number; onReady: () => void }): Promise<Controller> {
  const vendor = new URL(assetUrl('vendor/three/'), document.baseURI).href; // absolute, so import() never sees a bare specifier
  const THREE: any = await import(/* @vite-ignore */ `${vendor}three.module.min.js`);
  const { GLTFLoader }: any = await import(/* @vite-ignore */ `${vendor}GLTFLoader.js`);

  const canvas = document.createElement('canvas');
  canvas.className = 'vw-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Animated 3D lat pulldown. The back muscles are highlighted red-orange, and the biceps, rear shoulders and forearms soft orange.');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  if (!renderer.getContext()) throw new Error('WebGL unavailable');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps the highlight hues true to the brand colours
  renderer.toneMappingExposure = 1.05;
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9ccd1, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(-2.5, 4, -3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.9);
  fill.position.set(3, 2.5, 2);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const setView = (i: number) => {
    const [pos, at] = CAMERAS[Math.max(0, Math.min(CAMERAS.length - 1, i))];
    camera.position.set(...pos);
    camera.lookAt(...at);
  };
  setView(opts.view);

  const [gltf, motion] = await Promise.all([
    new GLTFLoader().loadAsync(assetUrl(model.glb)),
    fetch(assetUrl(model.motion)).then((r: Response) => { if (!r.ok) throw new Error('motion missing'); return r.json() as Promise<Motion>; }),
  ]);
  const body = gltf.scene;
  scene.add(body);

  // Re-colour the muscle paint.
  let mesh: any;
  body.traverse((o: any) => { if (o.isSkinnedMesh) mesh = o; if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  recolour(THREE, mesh);

  // Bones by their original names (GLTFLoader strips the dots: upperarm01.L -> upperarm01L).
  const bones: Record<string, any> = {};
  body.traverse((o: any) => { if (o.isBone) bones[o.name] = o; });
  const bone = (n: string) => bones[n.replace(/\./g, '')];
  const rest = new Map<any, any>();
  for (const b of Object.values(bones)) rest.set(b, b.quaternion.clone());

  // Expand mirrored segments: "upperarm01.*" -> .L with the given direction and .R with x negated.
  const segs: { from: any; to: any; key: string; mirror: boolean }[] = [];
  for (const [k, [a, b]] of Object.entries(motion.segments)) {
    if (a.endsWith('.*')) for (const side of ['L', 'R']) segs.push({ from: bone(a.replace('*', side)), to: bone(b.replace('*', side)), key: k, mirror: side === 'R' });
    else segs.push({ from: bone(a), to: bone(b), key: k, mirror: false });
  }
  const missing = segs.filter((s) => !s.from || !s.to);
  if (missing.length) throw new Error(`Skeleton is missing ${missing.map((s) => s.key).join(', ')}`);

  const grip = motion.grip?.bones.flatMap((n) => (n.endsWith('.*') ? ['L', 'R'].map((sd) => bone(n.replace('*', sd))) : [bone(n)])).filter(Boolean);
  const gripQ = motion.grip ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...motion.grip.axis).normalize(), (motion.grip.deg * Math.PI) / 180) : null;
  const dirAt = (key: string, t: number): any => {
    const ks = motion.keyframes;
    let i = 0;
    while (i < ks.length - 2 && t > ks[i + 1].t) i++;
    const a = ks[i], b = ks[i + 1];
    const u = smooth(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1))));
    const va = new THREE.Vector3(...a.dirs[key]).normalize(), vb = new THREE.Vector3(...b.dirs[key]).normalize();
    return va.lerp(vb, u).normalize();
  };

  // Pose the skeleton for time t (0..1) by aiming bones top-down.
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion(), bq = new THREE.Quaternion();
  const pose = (t: number) => {
    for (const [b, r] of rest) b.quaternion.copy(r);
    body.updateMatrixWorld(true);
    for (const s of segs) {
      const want = dirAt(s.key, t);
      if (s.mirror) want.x = -want.x;
      s.from.getWorldPosition(tmpA);
      s.to.getWorldPosition(tmpB);
      const have = tmpB.sub(tmpA).normalize();
      q.setFromUnitVectors(have, want);
      s.from.getWorldQuaternion(bq);
      s.from.parent.getWorldQuaternion(pq);
      s.from.quaternion.copy(pq.invert().multiply(q.multiply(bq)));
      s.from.updateMatrixWorld(true);
    }
    // Close the hands around the bar.
    if (grip) for (const b of grip) b.quaternion.multiply(gripQ);
  };

  // Bake one repetition into a clip so playback, speed and replay come from Three's AnimationMixer.
  const frames = Math.round(motion.duration * motion.fps);
  const times: number[] = [];
  const tracks = new Map<any, number[]>();
  const driven = [...new Set([...segs.map((s) => s.from), ...(grip ?? [])])];
  for (const b of driven) tracks.set(b, []);
  for (let f = 0; f <= frames; f++) {
    const t = f / frames;
    times.push(t * motion.duration);
    pose(t);
    for (const b of driven) tracks.get(b)!.push(...b.quaternion.toArray());
  }
  const clip = new THREE.AnimationClip('lat-pulldown', motion.duration, driven.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, tracks.get(b))));

  // Sit the athlete on the floor: after the seated pose, put the lowest foot point at y = 0.
  pose(0);
  const footY = Math.min(bone('foot.L').getWorldPosition(tmpA).y, bone('foot.R').getWorldPosition(tmpB).y);
  body.position.y = -(footY - 0.07);
  body.updateMatrixWorld(true);

  const hip = bone('upperleg01.L').getWorldPosition(new THREE.Vector3());
  const knee = bone('lowerleg01.L').getWorldPosition(new THREE.Vector3());
  // The pulley sits straight above the bar's top position so the cable hangs vertically at the start.
  const topBarZ = (bone('wrist.L').getWorldPosition(new THREE.Vector3()).z + bone('wrist.R').getWorldPosition(new THREE.Vector3()).z) / 2;
  const machine = buildMachine(THREE, { seatY: hip.y - 0.1, kneeZ: knee.z, kneeY: knee.y, pulleyZ: topBarZ });
  scene.add(machine.group);
  scene.add(floorShadow(THREE));

  const mixer = new THREE.AnimationMixer(body);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity).play();
  mixer.timeScale = opts.speed;
  let paused = opts.paused;

  const wristL = bone('wrist.L'), wristR = bone('wrist.R'), handL = bone('finger3-1.L'), handR = bone('finger3-1.R');
  const pL = new THREE.Vector3(), pR = new THREE.Vector3(), hL = new THREE.Vector3(), hR = new THREE.Vector3();
  const placeBar = () => {
    // The bar sits in the palms: halfway between the wrist and the base of the middle finger, on both sides.
    wristL.getWorldPosition(pL); wristR.getWorldPosition(pR);
    handL.getWorldPosition(hL); handR.getWorldPosition(hR);
    pL.lerp(hL, 0.6); pR.lerp(hR, 0.6);
    machine.setBar(pL.add(pR).multiplyScalar(0.5));
  };

  const resize = () => {
    const w = host.clientWidth || 320, h = host.clientHeight || 200;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole machine in frame on narrow screens by widening the vertical field of view.
    camera.fov = w / h < 1.5 ? 30 * (1.5 / (w / h)) ** 0.8 : 30;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const clock = new THREE.Clock();
  let first = true;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    ro.disconnect();
    renderer.dispose();
    scene.traverse((o: any) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m: any) => m.dispose?.()); });
    canvas.remove();
  };
  renderer.setAnimationLoop(() => {
    if (!host.isConnected) { dispose(); return; } // the page changed
    const dt = clock.getDelta();
    mixer.update(paused ? 0 : dt);
    placeBar();
    renderer.render(scene, camera);
    if (first) { first = false; opts.onReady(); }
  });

  return {
    play: () => { paused = false; },
    pause: () => { paused = true; },
    replay: () => { action.time = 0; paused = false; },
    setSpeed: (s: number) => { mixer.timeScale = s; },
    setView,
    dispose,
  };
}

function recolour(THREE: any, mesh: any) {
  const col = mesh?.geometry?.attributes?.color;
  if (!col) return;
  const lin = (hex: number) => new THREE.Color(hex); // three.js stores hex colours in linear space already
  const skin = lin(SKIN), pri = lin(PRIMARY), sec = lin(SECONDARY), shorts = lin(SHORTS);
  const { position, skinIndex: joints, skinWeight: weights } = mesh.geometry.attributes;
  const inShorts = (mesh.skeleton?.bones ?? []).map((b: any) => SHORTS_BONES.has(b.name));
  // Write each vertex as skin + p*(primary - skin) + q*(secondary - skin) and solve for p and q (least squares over
  // the three channels), then rebuild it from the brand colours. Blended border vertices keep their soft edge.
  const dp = SRC_PRI.map((v, i) => v - SRC_SKIN[i]), dq = SRC_SEC.map((v, i) => v - SRC_SKIN[i]);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pp = dot(dp, dp), qq = dot(dq, dq), pq = dot(dp, dq), det = pp * qq - pq * pq;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  for (let i = 0; i < col.count; i++) {
    const d = [col.getX(i) - SRC_SKIN[0], col.getY(i) - SRC_SKIN[1], col.getZ(i) - SRC_SKIN[2]];
    const dpd = dot(dp, d), dqd = dot(dq, d);
    const p = clamp((qq * dpd - pq * dqd) / det), q = clamp((pp * dqd - pq * dpd) / det);
    const out = skin.clone().lerp(sec, q / Math.max(1e-6, 1 - p) > 1 ? 1 : q).lerp(pri, p);
    if (joints && weights) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, best)) best = k;
      const y = position.getY(i);
      const band = Math.min(clamp((y - SHORTS_Y[0]) / 0.02), clamp((SHORTS_Y[1] - y) / 0.02));
      if (inShorts[joints.getComponent(i, best)]) out.lerp(shorts, band);
    }
    col.setXYZ(i, out.r, out.g, out.b);
  }
  col.needsUpdate = true;
  mesh.material.color.set(0xffffff);
  mesh.material.roughness = 0.62;
  mesh.material.metalness = 0;
  mesh.material.vertexColors = true;
  mesh.material.needsUpdate = true;
}

/** A simple lat pulldown station in neutral greys: seat, thigh pads, tower with weight stack, top beam, pulley,
 * cable and a wide bar with angled ends. The bar follows the athlete's hands every frame. */
function buildMachine(THREE: any, fit: { seatY: number; kneeZ: number; kneeY: number; pulleyZ: number }) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6, metalness: 0.1 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8 });
  const box = (w: number, h: number, d: number, m: any, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const cyl = (r: number, len: number, m: any) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20), m);

  const towerZ = fit.kneeZ + 0.55, topY = 2.45;
  // Base rail from the seat to the tower, seat post and seat.
  box(0.12, 0.06, towerZ + 0.45, steel, 0, 0.03, (towerZ - 0.45) / 2);
  box(0.08, fit.seatY - 0.06, 0.08, steel, 0, (fit.seatY - 0.06) / 2, -0.02);
  box(0.42, 0.08, 0.42, pad, 0, fit.seatY - 0.02, 0.02);
  // Thigh pads: two rollers just above the knees.
  const padY = fit.kneeY + 0.13, padZ = fit.kneeZ - 0.1;
  box(0.06, padY - 0.06, 0.06, steel, 0, (padY - 0.06) / 2 + 0.03, padZ + 0.06);
  for (const sx of [-1, 1]) {
    const r = cyl(0.06, 0.24, pad);
    r.rotation.z = Math.PI / 2;
    r.position.set(sx * 0.15, padY, padZ);
    g.add(r);
  }
  const axle = cyl(0.015, 0.1, steel);
  axle.rotation.z = Math.PI / 2;
  axle.position.set(0, padY, padZ);
  g.add(axle);
  // Tower with two guide rods and the weight stack.
  for (const sx of [-1, 1]) box(0.07, topY, 0.07, steel, sx * 0.24, topY / 2, towerZ);
  for (const sx of [-1, 1]) { const rod = cyl(0.008, 1.5, steel); rod.position.set(sx * 0.1, 0.85, towerZ + 0.02); g.add(rod); }
  for (let i = 0; i < 12; i++) box(0.3, 0.042, 0.16, dark, 0, 0.1 + i * 0.048, towerZ + 0.02);
  // Top beam reaching back over the seat, and the pulley the cable runs from.
  const pulleyZ = fit.pulleyZ;
  box(0.08, 0.08, towerZ - pulleyZ + 0.1, steel, 0, topY, (towerZ + pulleyZ) / 2);
  const pulley = cyl(0.06, 0.03, dark);
  pulley.rotation.z = Math.PI / 2;
  pulley.position.set(0, topY - 0.08, pulleyZ);
  g.add(pulley);

  // Bar: a straight centre with ends angled down, as on most lat bars.
  const bar = new THREE.Group();
  const centre = cyl(0.014, 0.62, steel);
  centre.rotation.z = Math.PI / 2;
  bar.add(centre);
  for (const sx of [-1, 1]) {
    const end = cyl(0.016, 0.34, dark);
    end.rotation.z = Math.PI / 2 + sx * 0.32;
    end.position.set(sx * 0.46, -0.05, 0);
    bar.add(end);
  }
  g.add(bar);
  const cableMat = new THREE.LineBasicMaterial({ color: 0x2b2d31 });
  const cableGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const cable = new THREE.Line(cableGeo, cableMat);
  g.add(cable);
  const top = new THREE.Vector3(0, topY - 0.14, pulleyZ);
  return {
    group: g,
    setBar(p: any) {
      // The ends dip below the hands, so lift the bar so the hands hold the straight-to-angled join.
      bar.position.set(0, p.y + 0.02, p.z);
      const pos = cable.geometry.attributes.position;
      pos.setXYZ(0, top.x, top.y, top.z);
      pos.setXYZ(1, 0, p.y + 0.03, p.z);
      pos.needsUpdate = true;
    },
  };
}

function floorShadow(THREE: any) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const grd = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.002, 0.45);
  return m;
}
