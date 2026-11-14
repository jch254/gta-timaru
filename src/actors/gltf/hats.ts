import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HumanoidLook } from '../../core/types';
import type { HeadMetrics } from './assets';

/**
 * Hats: small procedural meshes fitted to the head's measurements (bind space), coloured per vertex so
 * every hat shares one material. Geometry is cached by kind, colour and head.
 */

export type HatKind = Exclude<NonNullable<HumanoidLook['hat']>, 'none'>;

const cache = new Map<string, THREE.BufferGeometry>();

function tinted(geometry: THREE.BufferGeometry, color: THREE.Color, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.applyMatrix4(matrix);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rx), new THREE.Vector3(sx, sy, sz));

export function hatGeometry(kind: HatKind, hex: number, head: HeadMetrics, key: string): THREE.BufferGeometry {
  const id = `${key}|${kind}|${hex}`;
  const cached = cache.get(id);
  if (cached) return cached;
  const main = new THREE.Color(hex);
  const dark = main.clone().multiplyScalar(0.55);
  const pale = new THREE.Color(0xd8d8d0);
  const cz = (head.skullZ0 + head.skullZ1) / 2;
  const rz = (head.skullZ1 - head.skullZ0) / 2;
  const rx = head.rx;
  const line = head.hatLine;
  const crown = head.top - line;
  const front = head.z1;
  const dome = (pad: number, y: number, tall: number) => tinted(new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), main, place(0, y, cz, rx + pad, tall, rz + pad));
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'cap' || kind === 'police') {
    const police = kind === 'police';
    parts.push(dome(0.014, line - 0.004, crown + (police ? 0.012 : 0.026)));
    // Peak: half a disc, tipped down a little.
    parts.push(tinted(new THREE.CylinderGeometry(1, 1, 1, 14, 1, false, -Math.PI / 2, Math.PI), police ? dark : main, place(0, line + 0.002, front - 0.012, rx * 0.9, 0.006, police ? 0.07 : 0.11, 0.12)));
    if (police) {
      // Flat-topped crown, band and badge.
      parts.push(tinted(new THREE.CylinderGeometry(1.16, 1, 1, 18), main, place(0, line + crown * 0.62, cz, rx + 0.014, crown * 0.75, rz + 0.014)));
      parts.push(tinted(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), dark, place(0, line + 0.014, cz, rx + 0.017, 0.026, rz + 0.017)));
      parts.push(tinted(new THREE.BoxGeometry(1, 1, 1), pale, place(0, line + crown * 0.5, front + 0.012, 0.036, 0.034, 0.012)));
    } else {
      parts.push(tinted(new THREE.SphereGeometry(1, 8, 4), dark, place(0, line + crown + 0.02, cz, 0.011, 0.006, 0.011)));
    }
  } else if (kind === 'beanie') {
    parts.push(dome(0.016, line - 0.03, crown + 0.05));
    parts.push(tinted(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), dark, place(0, line - 0.014, cz, rx + 0.02, 0.036, rz + 0.02)));
  } else if (kind === 'brim') {
    parts.push(dome(0.014, line - 0.004, crown + 0.03));
    parts.push(tinted(new THREE.CylinderGeometry(1, 1, 1, 22), main, place(0, line + 0.002, cz, rx + 0.09, 0.008, rz + 0.1)));
    parts.push(tinted(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), dark, place(0, line + 0.018, cz, rx + 0.017, 0.022, rz + 0.017)));
  } else {
    // Helmet: a hard shell well clear of the skull, down over the ears and the back of the head, open at
    // the face, with a rolled rim so it reads as a helmet and not as hair.
    const y = head.eyeY + 0.02;
    const tall = head.top - y + 0.045;
    const sx = rx + 0.05;
    const sz = rz + 0.055;
    const gap = 1.7;
    parts.push(tinted(new THREE.SphereGeometry(1, 20, 7, 0, Math.PI * 2, 0, Math.PI * 0.46), main, place(0, y, cz, sx, tall, sz)));
    parts.push(tinted(new THREE.SphereGeometry(1, 18, 5, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, Math.PI * 0.46, Math.PI * 0.2), main, place(0, y, cz, sx, tall, sz)));
    const rim = new THREE.TorusGeometry(1, 0.055, 6, 22);
    rim.rotateX(Math.PI / 2);
    parts.push(tinted(rim, dark, place(0, y + tall * 0.13, cz, sx * 0.99, tall * 0.5, sz * 0.99)));
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  cache.set(id, merged);
  return merged;
}
