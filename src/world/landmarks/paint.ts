import * as THREE from 'three';

/**
 * Merge geometries (already positioned) into one with a per-vertex colour, for props that need several
 * colours but should cost a single draw call: use with `materials.get('plain', { vertexColors: true })`.
 */
export function painted(parts: readonly (readonly [geometry: THREE.BufferGeometry, color: number])[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color();
  for (const [source, color] of parts) {
    const g = source.index ? source.toNonIndexed() : source;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    c.set(color);
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      colors.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return out;
}

/** Box by centre. */
export const bx = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** Upright cylinder / cone by centre. */
export const cy = (rTop: number, rBottom: number, h: number, x = 0, y = 0, z = 0, segments = 8) => new THREE.CylinderGeometry(rTop, rBottom, h, segments).translate(x, y, z);
/** Cylinder lying along x (a wheel, a drum on its side). */
export const cyX = (r: number, len: number, x = 0, y = 0, z = 0, segments = 10) => new THREE.CylinderGeometry(r, r, len, segments).rotateZ(Math.PI / 2).translate(x, y, z);
/** Lumpy blob: an icosahedron scaled and moved. */
export const blob = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, detail = 0) => new THREE.IcosahedronGeometry(r, detail).scale(sx, sy, sz).translate(x, y, z);
