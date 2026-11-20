import type { LandmarkPlacement } from '../core/types';

/**
 * Whether a point is inside a landmark's ground, grown by `pad` metres: its `footprint` rectangle when it has
 * one, else its clear circle. Lots, street furniture and the rural scatter all ask this, so a shop in a street
 * frontage keeps its own plot clear and leaves the neighbours (and the footpath outside) alone.
 */
export function inLandmark(l: LandmarkPlacement, x: number, z: number, pad = 0): boolean {
  const dx = x - l.x;
  const dz = z - l.z;
  const f = l.footprint;
  if (!f) return dx * dx + dz * dz < (l.clearRadius + pad) ** 2;
  const c = Math.cos(l.heading);
  const s = Math.sin(l.heading);
  // World → local: the inverse of local (lx, lz) → (x + lx·cos + lz·sin, z − lx·sin + lz·cos).
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) < f.w / 2 + pad && Math.abs(lz) < f.d / 2 + pad;
}

/** A landmark's footprint as an oriented rectangle: centre, unit axis along local x, half sizes. */
export function footprintRect(l: LandmarkPlacement): { x: number; z: number; ax: number; az: number; hw: number; hd: number } | null {
  if (!l.footprint) return null;
  return { x: l.x, z: l.z, ax: Math.cos(l.heading), az: -Math.sin(l.heading), hw: l.footprint.w / 2, hd: l.footprint.d / 2 };
}

/** Distance from a point to a landmark's ground (0 inside): to its footprint when it has one, else to its circle. */
export function distanceToLandmark(l: LandmarkPlacement, x: number, z: number): number {
  const dx = x - l.x;
  const dz = z - l.z;
  const f = l.footprint;
  if (!f) return Math.max(0, Math.hypot(dx, dz) - l.clearRadius);
  const c = Math.cos(l.heading);
  const s = Math.sin(l.heading);
  const ox = Math.max(0, Math.abs(dx * c - dz * s) - f.w / 2);
  const oz = Math.max(0, Math.abs(dx * s + dz * c) - f.d / 2);
  return Math.hypot(ox, oz);
}

/** Whether two landmarks' grounds overlap (footprint or circle each). */
export function landmarksOverlap(a: LandmarkPlacement, b: LandmarkPlacement): boolean {
  if (!a.footprint && !b.footprint) return Math.hypot(a.x - b.x, a.z - b.z) < a.clearRadius + b.clearRadius;
  if (!a.footprint) return distanceToLandmark(b, a.x, a.z) < a.clearRadius;
  if (!b.footprint) return distanceToLandmark(a, b.x, b.z) < b.clearRadius;
  // Two rectangles: separating axes.
  const ra = footprintRect(a)!;
  const rb = footprintRect(b)!;
  const dx = rb.x - ra.x;
  const dz = rb.z - ra.z;
  for (const [ux, uz] of [[ra.ax, ra.az], [-ra.az, ra.ax], [rb.ax, rb.az], [-rb.az, rb.ax]]) {
    const pa = ra.hw * Math.abs(ra.ax * ux + ra.az * uz) + ra.hd * Math.abs(-ra.az * ux + ra.ax * uz);
    const pb = rb.hw * Math.abs(rb.ax * ux + rb.az * uz) + rb.hd * Math.abs(-rb.az * ux + rb.ax * uz);
    if (Math.abs(dx * ux + dz * uz) >= pa + pb - 0.01) return false;
  }
  return true;
}
