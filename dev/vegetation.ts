import * as THREE from 'three';
import { Materials } from '../src/render/materials';
import { loadPhotoSurfaces } from '../src/render/phototextures';
import { getProp } from '../src/world/props';
import '../src/world/props/extra';

/**
 * Every plant kind on a lawn under a plain sun, away from the game: for working on shapes in
 * src/world/props/vegetation.ts. Not the game's lighting (no cascades, sky or post), so judge colour in the game.
 *
 *   /dev/vegetation.html?kinds=tree-oak,tree-willow&gap=14&dist=30&height=6&yaw=0&sun=50,30&look=5
 *
 * kinds   comma-separated prop kinds (default: all vegetation)      gap    metres between them
 * dist    camera distance from the middle of the row                 height camera height
 * yaw     degrees the camera is swung round the row                  look   height the camera looks at
 * sun     elevation,azimuth in degrees                               turn   degrees every plant is rotated
 * rows    extra rows behind, each turned differently                 scale  instance scale
 * Drag to orbit, wheel to zoom.
 */
const q = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => (q.has(key) ? Number(q.get(key)) : fallback);
const ALL = ['tree-oak', 'tree-willow', 'tree-poplar', 'tree-pine', 'tree-macrocarpa', 'tree-norfolk-pine', 'tree-phoenix-palm', 'tree-cabbage', 'flax', 'bush', 'hedge', 'toetoe', 'grass-tuft', 'gorse', 'lupin'];
const kinds = (q.get('kinds') ?? ALL.join(',')).split(',');
const gap = num('gap', 13);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc0e6);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x55603a, 1.6));
const [sunEl, sunAz] = (q.get('sun') ?? '48,35').split(',').map((v) => (Number(v) * Math.PI) / 180);
const sun = new THREE.DirectionalLight(0xfff2dc, 4);
sun.position.set(Math.cos(sunEl) * Math.sin(sunAz), Math.sin(sunEl), Math.cos(sunEl) * Math.cos(sunAz)).multiplyScalar(120);
sun.castShadow = true;
const span = Math.max(30, (kinds.length * gap) / 2 + 20);
Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 320 });
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.25;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.2, 2000);
let yaw = (num('yaw', 0) * Math.PI) / 180;
let dist = num('dist', Math.max(26, kinds.length * gap * 0.62));
let height = num('height', 5);
const look = num('look', 5);
const aim = () => {
  camera.position.set(Math.sin(yaw) * dist, height, Math.cos(yaw) * dist);
  camera.lookAt(0, look, 0);
};
aim();
let drag = false;
canvas.addEventListener('pointerdown', () => (drag = true));
window.addEventListener('pointerup', () => (drag = false));
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw -= e.movementX * 0.006;
  height = Math.max(0.5, height + e.movementY * 0.08);
  aim();
});
window.addEventListener('wheel', (e) => {
  dist = Math.max(3, dist * (1 + e.deltaY * 0.001));
  aim();
});

const materials = new Materials(8);
await loadPhotoSurfaces(8);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), materials.get('grass', { color: 0x6c9446 }));
const guv = ground.geometry.getAttribute('uv');
for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * 600, guv.getY(i) * 600);
ground.receiveShadow = true;
scene.add(ground);

const dummy = new THREE.Object3D();
const lines: string[] = [];
const rows = num('rows', 1);
kinds.forEach((kind, i) => {
  const def = getProp(kind, materials);
  if (!def) {
    lines.push(`${kind}: not registered`);
    return;
  }
  let triangles = 0;
  for (let row = 0; row < rows; row++) {
    dummy.position.set((i - (kinds.length - 1) / 2) * gap, 0, -row * gap);
    dummy.rotation.set(0, (num('turn', 0) * Math.PI) / 180 + row * 2.1, 0);
    dummy.scale.setScalar(num('scale', 1));
    dummy.updateMatrix();
    for (const part of def.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, 1);
      mesh.setMatrixAt(0, dummy.matrix);
      mesh.castShadow = def.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      if (row === 0) triangles += (part.geometry.getIndex()?.count ?? part.geometry.getAttribute('position').count) / 3;
    }
  }
  lines.push(`${kind}: ${def.parts.length} part(s), ${triangles} triangles`);
});
if (!q.has('quiet')) document.getElementById('info')!.textContent = lines.join('\n');
(window as unknown as { vegetation: string[] }).vegetation = lines;

let frames = 0;
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  if (++frames === 5) (window as unknown as { ready: boolean }).ready = true;
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
