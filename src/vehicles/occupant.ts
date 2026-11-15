import * as THREE from 'three';
import type { MaterialLibrary } from '../core/types';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Stand-in occupants. Traffic and police drivers are not full figures (a skinned 17,000-triangle person in
 * every car would cost more than the cars), but the glass is clear, so a car with somebody at the wheel
 * shows a simple seated figure: a rounded torso and shoulders, a head with one of a few haircuts (or a cap,
 * or none), arms out to the wheel with the hands on it, thighs along the seat. Long or short sleeves, a few
 * builds. It is about 280 triangles, one draw call, casts no shadow, and reads as a person through the
 * glass at any distance you see a moving car from. The player and anyone else with a real figure are shown
 * as themselves instead.
 *
 * Authored with the seat's reference point at the origin, facing +z, like the seated pose of the real figure
 * (crown of the head about 1.0 m above it). It has no shins: nothing of it reaches below the cushion.
 */

const SKIN = [0xc99878, 0xa8744f, 0xe0b596, 0x8a5a3c];
const HAIR = [0x2a1d14, 0x151515, 0x6b4a2a, 0x8d8a86, 0xb48a4a];
const TOPS = [0x38507a, 0x7a2f2a, 0x4d5a3a, 0xd9d2c0, 0x2f3338, 0x8a6a3c, 0x5a3f6a, 0xc7c9cc, 0x1f5a4a, 0xb9a23a];
const LEGS = [0x2b2f38, 0x3a3a34, 0x4a3f2e, 0x20242e];
const CAPS = [0x1f3a5c, 0x7a1f1f, 0x2f2f2f, 0xd8d2c0];
const UNIFORM = 0x1b2a4a;
/** Haircuts: short, long, balding, cap. */
const STYLES = ['short', 'short', 'long', 'bald', 'cap', 'short', 'long'] as const;

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

interface Look {
  driving: boolean;
  skin: number;
  hair: number;
  top: number;
  legs: number;
  cap: number;
  style: (typeof STYLES)[number];
  /** Bare forearms. */
  short: boolean;
  /** Shoulder width and height, about 1. */
  build: number;
}

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

/** A limb: a tapered tube from a to b. */
function limb(a: [number, number, number], b: [number, number, number], ra: number, rb: number, color: number): THREE.BufferGeometry {
  _from.set(...a);
  _to.set(...b);
  const g = new THREE.CylinderGeometry(rb, ra, _from.distanceTo(_to), 5, 1, true);
  g.applyQuaternion(_q.setFromUnitVectors(_up, _to.clone().sub(_from).normalize()));
  return paint(g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), color);
}

function build(o: Look): THREE.BufferGeometry {
  const w = o.build;
  const ball = (r: number, x: number, y: number, z: number, color: number, sx = 1, sy = 1, sz = 1) => paint(new THREE.IcosahedronGeometry(r, 1).scale(sx, sy, sz).translate(x, y, z), color);
  const parts: THREE.BufferGeometry[] = [
    // Torso: wider at the shoulders than the waist, flattened front to back, leaning into the seat.
    paint(new THREE.CylinderGeometry(0.2 * w, 0.165 * w, 0.46, 8, 1, false).scale(1, 1, 0.58).rotateX(-0.13).translate(0, 0.43, -0.05), o.top),
    ball(0.2 * w, 0, 0.64, -0.085, o.top, 1.08, 0.42, 0.56),
    // Neck and head.
    paint(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 6, 1, true).translate(0, 0.74, -0.09), o.skin),
    ball(0.1, 0, 0.885, -0.08, o.skin, 0.9, 1.14, 1),
    // Thighs along the cushion.
    limb([-0.09, 0.14, -0.04], [-0.13, 0.19, 0.36], 0.085, 0.068, o.legs),
    limb([0.09, 0.14, -0.04], [0.13, 0.19, 0.36], 0.085, 0.068, o.legs),
  ];
  // Hair, or a cap with its peak, or a bare crown with a fringe round the back.
  // (Tipped back, so the hairline sits above the brow and the hair comes down to the nape.)
  const crown = (color: number, cover: number) => paint(new THREE.SphereGeometry(0.108, 8, 5, 0, Math.PI * 2, 0, Math.PI * cover).scale(0.95, 1.1, 1.05).rotateX(-0.5).translate(0, 0.89, -0.088), color);
  if (o.style === 'cap') {
    parts.push(crown(o.cap, 0.5));
    parts.push(paint(new THREE.BoxGeometry(0.15, 0.012, 0.1).rotateX(0.12).translate(0, 0.925, 0.055), o.cap));
  } else if (o.style === 'bald') {
    parts.push(paint(new THREE.SphereGeometry(0.106, 8, 3, Math.PI * 0.95, Math.PI * 1.1, Math.PI * 0.3, Math.PI * 0.32).scale(0.97, 1.1, 1.05).translate(0, 0.885, -0.092), o.hair));
  } else {
    parts.push(crown(o.hair, o.style === 'long' ? 0.56 : 0.5));
    if (o.style === 'long') parts.push(paint(new THREE.BoxGeometry(0.2, 0.2, 0.07).translate(0, 0.76, -0.16), o.hair));
  }
  const sleeve = o.short ? o.skin : o.top;
  for (const side of [-1, 1]) {
    const shoulder: [number, number, number] = [side * 0.21 * w, 0.63, -0.07];
    if (o.driving) {
      // Arms out to the wheel, elbows dropped, hands at ten to two.
      const elbow: [number, number, number] = [side * 0.27 * w, 0.43, 0.13];
      const hand: [number, number, number] = [side * 0.14, 0.5, 0.35];
      parts.push(limb(shoulder, elbow, 0.058, 0.047, o.top), limb(elbow, hand, 0.047, 0.036, sleeve));
      parts.push(ball(0.042, hand[0], hand[1] + 0.01, hand[2] + 0.02, o.skin, 0.9, 1.1, 1));
    } else {
      // A passenger: arms down, hands resting on the thighs.
      const elbow: [number, number, number] = [side * 0.25 * w, 0.38, 0.0];
      const hand: [number, number, number] = [side * 0.13, 0.27, 0.24];
      parts.push(limb(shoulder, elbow, 0.058, 0.047, o.top), limb(elbow, hand, 0.047, 0.036, sleeve));
      parts.push(ball(0.04, hand[0], hand[1], hand[2] + 0.02, o.skin));
    }
  }
  // (Painted geometries carry a colour per vertex, which the shared prop merger would drop.) The parts keep
  // the smooth normals they were made with.
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** A stand-in seated figure for a vehicle. `seed` picks its look; `police` puts it in uniform. */
export function createOccupant(materials: MaterialLibrary, seed: number, driving: boolean, police: boolean): THREE.Mesh {
  const style = police ? 'short' : STYLES[(seed >>> 1) % STYLES.length];
  const look: Look = {
    driving,
    skin: SKIN[seed % SKIN.length],
    hair: HAIR[(seed >>> 2) % HAIR.length],
    top: police ? UNIFORM : TOPS[(seed >>> 4) % TOPS.length],
    legs: police ? UNIFORM : LEGS[(seed >>> 3) % LEGS.length],
    cap: CAPS[(seed >>> 5) % CAPS.length],
    style,
    short: !police && (seed >>> 6) % 3 === 0,
    build: 0.92 + ((seed >>> 3) % 4) * 0.045,
  };
  const key = Object.values(look).join('|');
  let geometry = cache.get(key);
  if (!geometry) cache.set(key, (geometry = build(look)));
  material ??= materials.get('plain', { vertexColors: true, roughness: 0.85 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
