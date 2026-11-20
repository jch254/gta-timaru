import type * as THREE from 'three';

/**
 * A direction inside the cone of half-angle `halfAngle` around the unit vector `axis`, uniformly
 * distributed over the cone's solid angle. `u1`, `u2` are independent uniform randoms in 0..1.
 * Writes to and returns `out` (which may be `axis` itself).
 */
export function spreadDirection(axis: THREE.Vector3, halfAngle: number, u1: number, u2: number, out: THREE.Vector3): THREE.Vector3 {
  const ax = axis.x;
  const ay = axis.y;
  const az = axis.z;
  if (halfAngle <= 0) return out.set(ax, ay, az);
  const cosT = 1 - u1 * (1 - Math.cos(halfAngle));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = u2 * Math.PI * 2;
  // Orthonormal basis (b, c) perpendicular to the axis.
  let bx: number;
  let by: number;
  let bz: number;
  if (Math.abs(ay) < 0.99) {
    const inv = 1 / Math.hypot(ax, az);
    bx = az * inv;
    by = 0;
    bz = -ax * inv;
  } else {
    const inv = 1 / Math.hypot(ay, az);
    bx = 0;
    by = -az * inv;
    bz = ay * inv;
  }
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  const p = Math.cos(phi) * sinT;
  const q = Math.sin(phi) * sinT;
  return out.set(ax * cosT + bx * p + cx * q, ay * cosT + by * p + cy * q, az * cosT + bz * p + cz * q);
}

/**
 * Damage after range falloff: full out to `falloffStart × range`, then linear down to
 * `falloffMin × damage` at `range`.
 */
export function damageAtRange(damage: number, distance: number, range: number, falloffStart: number, falloffMin: number): number {
  const start = range * falloffStart;
  if (distance <= start) return damage;
  if (distance >= range) return damage * falloffMin;
  const t = (distance - start) / (range - start);
  return damage * (1 + (falloffMin - 1) * t);
}

/**
 * Blast strength 0..1 at `distance` from an explosion of `radius`: 1 inside the core
 * (`core × radius`), falling linearly to 0 at the radius.
 */
export function explosionFalloff(distance: number, radius: number, core = 0.25): number {
  if (radius <= 0 || distance >= radius) return 0;
  const inner = radius * core;
  if (distance <= inner) return 1;
  return 1 - (distance - inner) / (radius - inner);
}

/**
 * Closest approach of the line through `origin` along the unit vector `dir` to the segment `a`–`b`. Writes the
 * distance along the line (`t`, may be negative) and the squared gap between the two (`gap2`) into `out`.
 */
export function rayToSegment(origin: THREE.Vector3, dir: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: { t: number; gap2: number }): { t: number; gap2: number } {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const sz = b.z - a.z;
  const wx = origin.x - a.x;
  const wy = origin.y - a.y;
  const wz = origin.z - a.z;
  const ds = dir.x * sx + dir.y * sy + dir.z * sz;
  const ss = sx * sx + sy * sy + sz * sz;
  const dw = dir.x * wx + dir.y * wy + dir.z * wz;
  const sw = sx * wx + sy * wy + sz * wz;
  const denom = ss - ds * ds;
  let s = denom > 1e-9 ? (sw - dw * ds) / denom : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const t = s * ds - dw;
  const gx = wx + dir.x * t - sx * s;
  const gy = wy + dir.y * t - sy * s;
  const gz = wz + dir.z * t - sz * s;
  out.t = t;
  out.gap2 = gx * gx + gy * gy + gz * gz;
  return out;
}

/** Camera shake 0..1 for an explosion `distance` away: felt out to about five radii. */
export function explosionShake(distance: number, radius: number): number {
  if (radius <= 0) return 0;
  const s = 1.3 - distance / (radius * 4);
  return s < 0 ? 0 : s > 1 ? 1 : s;
}
