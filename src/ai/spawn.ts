import { TAU, clamp, lerp, smooth } from '../core/math';

/**
 * Where and when the ambient population appears. Pure functions: ring selection around the player that
 * keeps new arrivals out of the camera's forward cone, and the time-of-day curves.
 */

export interface RingPoint {
  x: number;
  z: number;
  radius: number;
}

/**
 * A random point in the ring [minR, maxR] around (px, pz).
 * Normally it lies OUTSIDE the cone of half-angle `cone` around the camera heading, so things appear behind
 * or beside the player. With probability `aheadBias` it is placed inside the cone at the far edge of the
 * ring instead (for a fast-moving player, who would otherwise never meet oncoming traffic).
 * Heading convention: forward = (sin h, cos h).
 */
export function pickRingPoint(rng: { next(): number }, px: number, pz: number, cameraHeading: number, minR: number, maxR: number, cone: number, aheadBias: number, out: RingPoint): RingPoint {
  let angle: number;
  let radius: number;
  if (rng.next() < aheadBias) {
    angle = cameraHeading + (rng.next() * 2 - 1) * cone;
    radius = lerp(Math.max(minR, maxR * 0.82), maxR, rng.next());
  } else {
    angle = cameraHeading + cone + rng.next() * (TAU - 2 * cone);
    // Uniform over the ring's area.
    radius = Math.sqrt(lerp(minR * minR, maxR * maxR, rng.next()));
  }
  out.x = px + Math.sin(angle) * radius;
  out.z = pz + Math.cos(angle) * radius;
  out.radius = radius;
  return out;
}

/** Is (x, z) inside the cone of half-angle `cone` around `heading`, seen from (px, pz)? */
export function inCone(px: number, pz: number, heading: number, cone: number, x: number, z: number): boolean {
  const dx = x - px;
  const dz = z - pz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return true;
  return (dx * Math.sin(heading) + dz * Math.cos(heading)) / d > Math.cos(cone);
}

/**
 * Final check on a spawn position after snapping to a road or footpath: inside the ring (with `slack`
 * metres of tolerance for the snap) and not somewhere it would visibly pop in (inside the forward cone and
 * nearer than `coneFar`).
 */
export function spawnAllowed(px: number, pz: number, heading: number, x: number, z: number, minR: number, maxR: number, slack: number, cone: number, coneFar: number): boolean {
  const d = Math.hypot(x - px, z - pz);
  if (d < minR - slack || d > maxR + slack) return false;
  if (d < coneFar && inCone(px, pz, heading, cone, x, z)) return false;
  return true;
}

/** Moving traffic through the day: rush hours, a quiet evening, near-empty roads in the small hours. */
export function trafficTimeFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const morning = smooth(5, 7.5, h);
  const evening = 1 - smooth(18.5, 23, h);
  const day = Math.min(morning, evening);
  const rush = Math.max(0, 1 - Math.abs(h - 8.2) / 1.2, 1 - Math.abs(h - 17.2) / 1.4);
  return clamp(0.18 + 0.67 * day + 0.15 * rush, 0.18, 1);
}

/** Pedestrians through the day: busy from mid-morning to tea time, a few about in the evening, hardly any at night. */
export function pedTimeFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const morning = smooth(6, 9, h);
  const evening = 1 - smooth(17.5, 22.5, h);
  return clamp(0.12 + 0.88 * Math.min(morning, evening), 0.12, 1);
}

/** Share of parked cars: shop and office streets empty out at night, the suburbs fill up. */
export function parkedTimeFactor(hour: number, commercial: boolean): number {
  const h = ((hour % 24) + 24) % 24;
  const day = Math.min(smooth(6, 9, h), 1 - smooth(17.5, 21, h));
  return commercial ? 0.45 + 0.55 * day : 1 - 0.25 * day;
}

/**
 * Boy racers are out every night between 21:00 and 02:00, and for the whole of Friday and Saturday night
 * (19:00–04:00, the morning hours belonging to the night before).
 */
export function racersOut(hour: number, day: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 21 || h < 2) return true;
  const night = h >= 19 ? day : h < 4 ? day - 1 : -1;
  if (night < 0) return false;
  const weekday = ((night % 7) + 7) % 7;
  return weekday === 5 || weekday === 6;
}

/** 2–4 racers, the same number all night. */
export function racerCount(hour: number, day: number): number {
  const night = hour < 12 ? day - 1 : day;
  return 2 + ((Math.imul(night, 0x9e3779b1) >>> 0) % 3);
}
