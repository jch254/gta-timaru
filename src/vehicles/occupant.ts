import * as THREE from 'three';
import type { MaterialLibrary } from '../core/types';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Stand-in occupants. Traffic and police drivers are not full figures (a skinned 17,000-triangle person in
 * every car would cost more than the cars), but the glass is clear now, so a car with somebody at the wheel
 * shows a simple seated figure: head, shoulders, arms to the wheel. It is about 130 triangles, one draw call,
 * casts no shadow, and reads as a person at any distance you see a moving car from. The player and anyone
 * else with a real figure are shown as themselves instead.
 *
 * Authored with the seat's reference point at the origin, facing +z, like the seated pose of the real figure
 * (crown of the head about 1.0 m above it).
 */

const SKIN = [0xc99878, 0xa8744f, 0xe0b596, 0x8a5a3c];
const HAIR = [0x2a1d14, 0x151515, 0x6b4a2a, 0x8d8a86, 0xb48a4a];
const TOPS = [0x38507a, 0x7a2f2a, 0x4d5a3a, 0xd9d2c0, 0x2f3338, 0x8a6a3c, 0x5a3f6a, 0xc7c9cc];
const UNIFORM = 0x1b2a4a;

const cache = new Map<string, THREE.BufferGeometry>();
let material: THREE.Material | null = null;

function paint(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geometry.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function build(driving: boolean, skin: number, hair: number, top: number): THREE.BufferGeometry {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, tiltX = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tiltX) g.rotateX(tiltX);
    return paint(g.translate(x, y, z), color);
  };
  const parts: THREE.BufferGeometry[] = [
    // Torso, leaning back a touch into the seat, and the shoulders.
    box(0.38, 0.5, 0.2, 0, 0.44, -0.05, top, -0.12),
    box(0.46, 0.1, 0.2, 0, 0.68, -0.08, top, -0.12),
    // Lap.
    box(0.34, 0.13, 0.4, 0, 0.1, 0.16, 0x2b2f38),
    // Neck and head, with hair over the top and back.
    paint(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 6).translate(0, 0.77, -0.09), skin),
    paint(new THREE.IcosahedronGeometry(0.1, 1).scale(0.92, 1.12, 1).translate(0, 0.9, -0.08), skin),
    paint(new THREE.SphereGeometry(0.108, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.1, 1.04).translate(0, 0.905, -0.095), hair),
  ];
  for (const side of [-1, 1]) {
    if (driving) {
      // Arms out to the wheel, hands at ten to two.
      const from = new THREE.Vector3(side * 0.21, 0.64, -0.05);
      const to = new THREE.Vector3(side * 0.13, 0.5, 0.34);
      const length = from.distanceTo(to);
      const arm = new THREE.BoxGeometry(0.075, 0.075, length);
      arm.lookAt(to.clone().sub(from));
      parts.push(paint(arm.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2), top));
      parts.push(paint(new THREE.BoxGeometry(0.07, 0.07, 0.08).translate(to.x, to.y, to.z + 0.03), skin));
    } else {
      // A passenger: arms down, hands in the lap.
      parts.push(box(0.08, 0.34, 0.09, side * 0.225, 0.47, -0.02, top, 0.25));
    }
  }
  // (Painted geometries carry a colour per vertex, which the shared prop merger would drop.)
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  merged.computeVertexNormals();
  return merged;
}

/** A stand-in seated figure for a vehicle. `seed` picks its look; `police` puts it in uniform. */
export function createOccupant(materials: MaterialLibrary, seed: number, driving: boolean, police: boolean): THREE.Mesh {
  const skin = SKIN[seed % SKIN.length];
  const hair = HAIR[(seed >>> 2) % HAIR.length];
  const top = police ? UNIFORM : TOPS[(seed >>> 4) % TOPS.length];
  const key = `${driving}|${skin}|${hair}|${top}`;
  let geometry = cache.get(key);
  if (!geometry) cache.set(key, (geometry = build(driving, skin, hair, top)));
  material ??= materials.get('plain', { vertexColors: true, roughness: 0.85 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
