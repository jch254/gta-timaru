/**
 * Stand-alone viewer for the rigged characters: a row of looks cycling through every pose, with the
 * code-built figure at the end for scale. Not part of the game and independent of its loop.
 *
 *   /dev/characters.html?pose=walk&speed=1.4&pitch=0&view=front&focus=2&gun=pistol&move=1&only=3
 *
 * pose   any HumanoidPose, or "cycle" (default) to step through them all
 * speed  metres per second passed to setPose        pitch  aim pitch in radians (positive aims down)
 * view   front | back | side | quarter | face | feet | top      focus  index of the figure to frame
 * gun    pistol | rifle | none                      move   1 = slide the figures at `speed` (foot-skate check)
 * only   show just this many figures                 time   freeze animation after this many seconds
 * warp   simulate this many seconds in 1/60 s steps before the first frame (hidden tabs do not animate)
 * dist   camera distance multiplier                 old    0 = leave out the code-built figure
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HumanoidRig } from '../src/actors/humanoid';
import { createGltfHumanoid, preloadCharacters } from '../src/actors/gltf';
import type { Humanoid, HumanoidLook, HumanoidPose, MaterialLibrary } from '../src/core/types';

const POSES: HumanoidPose[] = ['idle', 'walk', 'run', 'jump', 'fall', 'aim', 'aimRifle', 'punch', 'cower', 'handsUp', 'drive', 'ride', 'sit', 'dead'];
const q = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => (q.has(key) ? Number(q.get(key)) : fallback);

const LOOKS: { name: string; look: HumanoidLook }[] = [
  { name: 'player', look: { skin: 0xd8a888, hair: 0x3a2a1c, top: 0xb3261e, topStyle: 'bushShirt', legs: 0x2c3a5c, shorts: true, shoes: 0x1a1a1c, bulk: 1.02 } },
  { name: 'tee + cap', look: { skin: 0xe8b99a, hair: 0x5a4028, top: 0x2f5a8a, topStyle: 'tee', legs: 0x2c3a5c, shoes: 0xe8e8e4, hat: 'cap', hatColor: 0xb3261e } },
  { name: 'woman, long hair', look: { skin: 0xdcab8a, hair: 0x8a6a3a, top: 0xd9d4c4, topStyle: 'tee', legs: 0x3a4a6a, shoes: 0xd0d0cc, female: true, hairStyle: 'long' } },
  { name: 'hi-vis + beanie', look: { skin: 0xb98058, hair: 0x16110d, top: 0xe6ee2c, topStyle: 'hiVis', legs: 0x27324a, shoes: 0x4a3626, hat: 'beanie', hatColor: 0x202024, bulk: 1.12 } },
  { name: 'constable', look: { skin: 0xd9ab8c, hair: 0x4a3524, top: 0x2a3d6b, topStyle: 'uniform', legs: 0x1c2333, shoes: 0x0c0c0e, hat: 'police', hatColor: 0x1c2333 } },
  { name: 'jersey, mullet', look: { skin: 0xf0c8ae, hair: 0xc8a860, top: 0x1c6b3a, topStyle: 'jersey', legs: 0x27324a, shorts: true, shoes: 0x2a2a2e, hairStyle: 'mullet', height: 1.04 } },
  { name: 'woman, bob + brim', look: { skin: 0x9a6a44, hair: 0x120e0a, top: 0x6b2fa0, topStyle: 'jacket', legs: 0x4a4a52, shoes: 0x121214, female: true, hairStyle: 'bob', hat: 'brim', hatColor: 0xc8b890, height: 0.97 } },
  { name: 'singlet, bald', look: { skin: 0x8a5c3a, hair: 0x120e0a, top: 0xf0f0ea, topStyle: 'singlet', legs: 0x8a6a44, shorts: true, shoes: 0x1a2a5a, hairStyle: 'bald', bulk: 1.2 } },
  { name: 'armed response', look: { skin: 0xd0a080, hair: 0x2a2018, topStyle: 'uniform', top: 0x1a2130, legs: 0x1a2130, shoes: 0x0c0c0e, hat: 'helmet', hatColor: 0x141a26, bulk: 1.1 } },
  { name: 'woman, short hair', look: { skin: 0xe2b090, hair: 0x8a3a1c, top: 0x12a39a, topStyle: 'jacket', legs: 0x12a39a, shoes: 0xe8e8e4, female: true, hairStyle: 'short', bulk: 0.92 } },
];

// ── A material library that does nothing clever ──
const plain = () => new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.8 });
const materials = {
  get: (_surface: unknown, options?: { color?: number }) => new THREE.MeshStandardMaterial({ color: options?.color ?? 0x8a8a8a, roughness: 0.8 }),
  windows: plain,
  emitter: plain,
  sign: plain,
  register: <T extends THREE.Material>(material: T) => material,
  release: () => undefined,
} as unknown as MaterialLibrary;

// ── Scene ──
const canvas = document.getElementById('c') as HTMLCanvasElement;
const info = document.getElementById('info')!;
const bar = document.getElementById('bar')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa3b4);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x5a5346, 1.25));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
sun.position.set(4, 7, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -9;
sun.shadow.camera.right = 9;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
sun.shadow.bias = -0.0004;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x6f7a72, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(40, 80, 0xd0d8e0, 0x4f5a55);
grid.position.y = 0.002;
scene.add(grid);
// A 1.78 m staff for scale.
const staff = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.78, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd040 }));

function standIn(kind: string): THREE.Object3D {
  // Weapon space: origin at the grip, +z the muzzle, +y the top.
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.45, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4424, roughness: 0.7 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    root.add(mesh);
  };
  if (kind === 'rifle') {
    box(0.035, 0.05, 0.75, 0, 0.045, 0.25, metal);
    box(0.04, 0.09, 0.3, 0, 0.0, -0.22, wood);
    box(0.03, 0.09, 0.035, 0, -0.03, 0, wood);
    box(0.012, 0.02, 0.012, 0, 0.08, 0.6, metal);
  } else {
    box(0.03, 0.035, 0.19, 0, 0.05, 0.06, metal);
    box(0.028, 0.11, 0.04, 0, -0.01, 0, metal);
    box(0.008, 0.012, 0.008, 0, 0.074, 0.14, metal);
  }
  return root;
}

interface Figure {
  name: string;
  humanoid: Humanoid;
  home: number;
}
const figures: Figure[] = [];
let pose: HumanoidPose | 'cycle' = (q.get('pose') as HumanoidPose | null) ?? 'cycle';
let current: HumanoidPose = 'idle';
let speed = num('speed', -1);
let pitch = num('pitch', 0);
const move = q.get('move') === '1';
const freeze = num('time', -1);
let elapsed = 0;
let cycleAt = 0;

function defaultSpeed(p: HumanoidPose): number {
  return p === 'walk' ? 1.4 : p === 'run' ? 6 : 0;
}

function setPoseButtons() {
  for (const b of bar.querySelectorAll('button')) b.classList.toggle('on', b.dataset.pose === (pose === 'cycle' ? 'cycle' : pose));
}

async function main() {
  const loaded = await preloadCharacters('/');
  const count = Math.min(LOOKS.length, num('only', LOOKS.length));
  const spacing = 1.15;
  const x0 = (-(count + 1 - 1) * spacing) / 2;
  LOOKS.slice(0, count).forEach(({ name, look }, i) => {
    const humanoid = createGltfHumanoid(look, materials) ?? new HumanoidRig(look, materials);
    humanoid.group.position.x = x0 + i * spacing;
    scene.add(humanoid.group);
    figures.push({ name, humanoid, home: 0 });
  });
  if (q.get('old') !== '0') {
    const old = new HumanoidRig(LOOKS[1].look, materials);
    old.group.position.x = x0 + count * spacing;
    scene.add(old.group);
    figures.push({ name: 'code-built', humanoid: old, home: 0 });
    staff.position.set(x0 + count * spacing + 0.45, 0.89, 0);
    scene.add(staff);
  }

  const gun = q.get('gun') ?? 'auto';
  const arm = () => {
    for (const f of figures) {
      const kind = gun === 'auto' ? (current === 'aimRifle' ? 'rifle' : current === 'aim' ? 'pistol' : 'none') : gun;
      f.humanoid.setHeld(kind === 'none' ? null : standIn(kind));
    }
  };

  for (const p of ['cycle', ...POSES]) {
    const b = document.createElement('button');
    b.textContent = p;
    b.dataset.pose = p;
    b.onclick = () => {
      pose = p as HumanoidPose | 'cycle';
      setPoseButtons();
    };
    bar.append(b);
  }
  const slider = (label: string, min: number, max: number, step: number, value: number, set: (v: number) => void) => {
    const l = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = document.createElement('span');
    out.textContent = value.toFixed(2);
    input.oninput = () => {
      set(Number(input.value));
      out.textContent = Number(input.value).toFixed(2);
    };
    l.append(label, input, out);
    bar.append(l);
  };
  slider('speed', -1, 9, 0.1, speed, (v) => (speed = v));
  slider('pitch', -0.9, 0.9, 0.05, pitch, (v) => (pitch = v));
  setPoseButtons();

  // Camera.
  const focus = q.has('focus') ? figures[Math.min(figures.length - 1, num('focus', 0))].humanoid.group.position.x : 0;
  const wide = (q.has('focus') ? 1 : Math.max(1, figures.length / 4.2)) * num('dist', 1);
  const views: Record<string, [THREE.Vector3, THREE.Vector3]> = {
    front: [new THREE.Vector3(focus, 1.25, 4.4 * wide), new THREE.Vector3(focus, 0.95, 0)],
    back: [new THREE.Vector3(focus, 1.25, -4.4 * wide), new THREE.Vector3(focus, 0.95, 0)],
    side: [new THREE.Vector3(focus + 4.4 * wide, 1.25, 0.2), new THREE.Vector3(focus, 0.95, 0.2)],
    quarter: [new THREE.Vector3(focus + 2.4 * wide, 1.7, 3.6 * wide), new THREE.Vector3(focus, 0.95, 0)],
    face: [new THREE.Vector3(focus + 0.25, 1.68, 1.25), new THREE.Vector3(focus, 1.6, 0)],
    feet: [new THREE.Vector3(focus + 0.7, 0.45, 1.4), new THREE.Vector3(focus, 0.12, 0.05)],
    top: [new THREE.Vector3(focus, 7 * wide, 0.5), new THREE.Vector3(focus, 0.9, 0)],
    low: [new THREE.Vector3(focus + 1.6, 0.6, 3.2), new THREE.Vector3(focus, 0.5, -0.4)],
  };
  const [eye, at] = views[q.get('view') ?? 'front'] ?? views.front;
  camera.position.copy(eye);
  controls.target.copy(at);

  let last = performance.now();
  let shownPose: HumanoidPose | null = null;
  let v = 0;
  const advance = (step: number) => {
    let dt = step;
    if (freeze >= 0 && elapsed + dt > freeze) dt = Math.max(0, freeze - elapsed);
    elapsed += dt;
    if (pose === 'cycle') {
      cycleAt += dt;
      current = POSES[Math.floor(cycleAt / 2.5) % POSES.length];
    } else current = pose;
    if (current !== shownPose) {
      shownPose = current;
      arm();
    }
    v = speed >= 0 ? speed : defaultSpeed(current);
    for (const f of figures) {
      f.humanoid.setPose(current, { speed: v, aimPitch: pitch });
      f.humanoid.update(dt);
      if (move && v > 0) {
        f.home = (f.home + v * dt) % 4;
        f.humanoid.group.position.z = f.home - 2;
      } else f.humanoid.group.position.z = 0;
    }
  };
  for (let i = 0, n = Math.round(num('warp', 0) * 60); i < n; i++) advance(1 / 60);
  const frame = () => {
    requestAnimationFrame(frame);
    const w = innerWidth;
    const h = innerHeight;
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const now = performance.now();
    advance(Math.min(0.1, (now - last) / 1000));
    last = now;
    controls.update();
    renderer.render(scene, camera);
    const r = renderer.info.render;
    info.textContent = `${loaded ? 'glTF characters' : 'FALLBACK: code-built figures only'} · pose ${current} · speed ${v.toFixed(1)} · pitch ${pitch.toFixed(2)}\n${r.calls} draw calls · ${r.triangles} triangles · t=${elapsed.toFixed(2)}\n${figures.map((f, i) => `${i}:${f.name}`).join('  ')}`;
  };
  frame();
  Object.assign(window, { figures, scene, camera, renderer });
}

main().catch((e) => {
  info.textContent = String(e?.stack ?? e);
  console.error(e);
});
