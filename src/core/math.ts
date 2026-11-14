export const TAU = Math.PI * 2;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (v - a) / (b - a);
/** Smoothstep that also accepts reversed edges (a > b). */
export function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
/** Frame-rate independent exponential approach. `rate` ≈ 1/time-constant. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
/** Shortest signed difference between two angles (radians). */
export function angleDiff(to: number, from: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const dampAngle = (current: number, target: number, rate: number, dt: number) =>
  current + angleDiff(target, current) * (1 - Math.exp(-rate * dt));
export const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
/** Heading convention used everywhere: 0 faces +z, increasing turns towards +x (left). forward = (sin h, cos h). */
export const headingOf = (dx: number, dz: number) => Math.atan2(dx, dz);
export const moveToward = (current: number, target: number, maxDelta: number) =>
  Math.abs(target - current) <= maxDelta ? target : current + Math.sign(target - current) * maxDelta;
