/**
 * A pretend gearbox for the engine note. The physics has no gears (drive force just tapers to top speed), so the
 * audio invents them: revs climb through each gear, drop on the up-shift, and the shift points move with load.
 * Pure maths, unit-tested.
 */
import { damp } from '../core/math';
import type { VehicleSpec } from '../core/types';

export interface GearboxSpec {
  /** Road speed at the red line in each gear, as a fraction of the vehicle's top speed. */
  ratios: number[];
  idle: number;
  redline: number;
  /** Seconds the throttle is cut during a change. */
  shiftTime: number;
  /** How quickly the revs follow their target (1/s): flywheel weight. */
  inertia: number;
}

export interface GearboxState {
  gear: number;
  rpm: number;
  /** Seconds left in the current gear change. */
  shift: number;
  /** Seconds until another change is allowed. */
  cooldown: number;
}

export const GEARBOXES: Record<VehicleSpec['engineSound'], GearboxSpec> = {
  four: { ratios: [0.26, 0.45, 0.66, 0.88, 1.12], idle: 850, redline: 6400, shiftTime: 0.22, inertia: 9 },
  six: { ratios: [0.3, 0.52, 0.78, 1.1], idle: 700, redline: 5400, shiftTime: 0.28, inertia: 8 },
  v8: { ratios: [0.3, 0.5, 0.74, 1.08], idle: 650, redline: 5800, shiftTime: 0.25, inertia: 8 },
  diesel: { ratios: [0.2, 0.36, 0.56, 0.8, 1.1], idle: 600, redline: 3800, shiftTime: 0.4, inertia: 5 },
  bike: { ratios: [0.24, 0.4, 0.56, 0.74, 0.92, 1.1], idle: 1200, redline: 9500, shiftTime: 0.14, inertia: 14 },
  v6: { ratios: [0.29, 0.5, 0.75, 1.08], idle: 750, redline: 5600, shiftTime: 0.26, inertia: 8 },
  boxer: { ratios: [0.25, 0.44, 0.65, 0.87, 1.1], idle: 800, redline: 6000, shiftTime: 0.24, inertia: 9 },
  turbo: { ratios: [0.27, 0.46, 0.67, 0.89, 1.1], idle: 900, redline: 7200, shiftTime: 0.18, inertia: 11 },
  single: { ratios: [0.22, 0.4, 0.6, 0.82, 1.08], idle: 1100, redline: 8000, shiftTime: 0.16, inertia: 12 },
  electric: { ratios: [1.05], idle: 0, redline: 6000, shiftTime: 0, inertia: 10 },
};

export function newGearbox(spec: GearboxSpec): GearboxState {
  return { gear: 0, rpm: spec.idle, shift: 0, cooldown: 0 };
}

/** Fraction of the rev range used at `speedFrac` (speed / top speed) in a gear. */
export function revFraction(spec: GearboxSpec, gear: number, speedFrac: number): number {
  return speedFrac / spec.ratios[gear];
}

/** Up-shift and down-shift thresholds (fractions of the rev range) for a throttle position. */
export function shiftPoints(throttle: number): { up: number; down: number } {
  return { up: 0.5 + 0.38 * throttle, down: 0.24 + 0.18 * throttle };
}

/**
 * Advances the gearbox. `speedFrac` = |speed| / topSpeed, `throttle` 0..1, `grounded` false when the driven
 * wheels are in the air (the engine free-revs). Returns +1 / -1 on an up / down change, else 0.
 */
export function stepGearbox(s: GearboxState, spec: GearboxSpec, speedFrac: number, throttle: number, grounded: boolean, dt: number): number {
  const range = spec.redline - spec.idle;
  const last = spec.ratios.length - 1;
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.shift = Math.max(0, s.shift - dt);
  let changed = 0;
  if (s.cooldown <= 0 && last > 0) {
    const { up, down } = shiftPoints(throttle);
    if (s.gear < last && revFraction(spec, s.gear, speedFrac) > up && revFraction(spec, s.gear + 1, speedFrac) > down + 0.04) {
      s.gear++;
      changed = 1;
    } else if (s.gear > 0 && revFraction(spec, s.gear, speedFrac) < down) {
      // Drop as many gears as it takes (braking to a stop from top gear).
      while (s.gear > 0 && revFraction(spec, s.gear, speedFrac) < down) s.gear--;
      changed = -1;
    }
    if (changed) {
      s.cooldown = spec.shiftTime + 0.35;
      s.shift = spec.shiftTime;
    }
  }
  const frac = revFraction(spec, s.gear, speedFrac);
  let target = spec.idle + range * Math.min(1.04, frac);
  // Pulling away: the clutch slips, so revs lead the road speed.
  if (s.gear === 0) target = Math.max(target, spec.idle + range * 0.32 * throttle * Math.max(0, 1 - frac / 0.5));
  // Wheels in the air: nothing to push against.
  if (!grounded) target = Math.max(target, spec.idle + range * (0.25 + 0.7 * throttle));
  // Throttle cut during the change.
  if (s.shift > 0) target -= range * 0.07;
  target = Math.min(spec.redline, Math.max(spec.idle, target));
  const rate = spec.inertia * (target > s.rpm ? 1 : 1.5);
  s.rpm = damp(s.rpm, target, rate, dt);
  return changed;
}

/** Siren pitch (Hz) at time t. Cycles wail → yelp → two-tone so a chase never drones. `seed` offsets each car. */
export function sirenHz(t: number, seed = 0): number {
  const u = (t + seed * 2.3) % 15;
  if (u < 8) {
    // Wail: 1.4 s up, 2.6 s down.
    const c = (u % 4) / 4;
    const x = c < 0.35 ? c / 0.35 : 1 - (c - 0.35) / 0.65;
    return 640 + 760 * x * x * (3 - 2 * x);
  }
  if (u < 11.5) {
    // Yelp: quick rise, quicker fall.
    const c = ((u - 8) % 0.35) / 0.35;
    const x = c < 0.75 ? c / 0.75 : 1 - (c - 0.75) / 0.25;
    return 700 + 800 * x;
  }
  // Two-tone.
  return (u - 11.5) % 1.1 < 0.55 ? 660 : 880;
}
