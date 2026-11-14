import { clamp } from '../core/math';
import { DRIVE } from './tuning';

/**
 * Driving maths with no dependencies: pure-pursuit steering, speed planning and the forward obstacle
 * corridor. Conventions: heading h has forward = (sin h, cos h); "left" of that is (cos h, −sin h);
 * steering input and curvature are positive to the LEFT.
 */

/** A world point in a vehicle's frame: `f` metres ahead, `l` metres to the left. */
export interface Local {
  f: number;
  l: number;
}

export function toLocal(x: number, z: number, heading: number, px: number, pz: number, out: Local): Local {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const dx = px - x;
  const dz = pz - z;
  out.f = dx * sin + dz * cos;
  out.l = dx * cos - dz * sin;
  return out;
}

/** Look-ahead distance grows with speed. */
export function lookAhead(speed: number): number {
  return clamp(DRIVE.lookMin + DRIVE.lookGain * Math.abs(speed), DRIVE.lookMin, DRIVE.lookMax);
}

/** Curvature of the circle through the vehicle (tangent to its heading) and a target at local (f, l). */
export function pursuitCurvature(f: number, l: number): number {
  const d2 = f * f + l * l;
  return d2 < 1e-6 ? 0 : (2 * l) / d2;
}

/**
 * Steering input (−1..1, + = left) that follows `curvature`, for a vehicle with the given wheelbase and
 * low-speed steering lock. The lock shrinks with speed exactly as the vehicle model's does.
 */
export function steerForCurvature(curvature: number, wheelbase: number, steerLock: number, speed: number): number {
  const lock = steerLock / (1 + Math.abs(speed) * DRIVE.steerSpeedFalloff);
  return clamp(Math.atan(wheelbase * curvature) / lock, -1, 1);
}

/** Pure-pursuit steering towards a target at local (f, l). A target behind the vehicle asks for full lock. */
export function pursuitSteer(f: number, l: number, wheelbase: number, steerLock: number, speed: number): number {
  if (f < 0.5) return l >= 0 ? 1 : -1;
  return steerForCurvature(pursuitCurvature(f, l), wheelbase, steerLock, speed);
}

/** Highest speed now that still allows slowing to `target` within `distance` at `decel`. */
export function brakingSpeed(target: number, distance: number, decel: number): number {
  return Math.sqrt(target * target + 2 * decel * Math.max(0, distance));
}

/** Speed for a junction turn of `angle` radians whose entry and exit points are `chord` metres apart. */
export function turnSpeed(angle: number, chord: number, lateral: number): number {
  const a = Math.abs(angle);
  if (a < DRIVE.straightAngle) return Infinity;
  const radius = Math.max(DRIVE.minTurnRadius, chord / (2 * Math.sin(Math.min(a, Math.PI) / 2)));
  return Math.sqrt(lateral * radius);
}

export interface Pedals {
  throttle: number;
  brake: number;
  handbrake: boolean;
}

/**
 * Throttle / brake to reach `target` m/s from `speed` (signed forward speed).
 * The vehicle model treats the brake pedal as reverse below about 1.2 m/s, so a stop is finished and held on
 * the handbrake instead.
 */
export function speedControl(speed: number, target: number, out: Pedals): Pedals {
  out.throttle = 0;
  out.brake = 0;
  out.handbrake = false;
  if (target <= 0.05) {
    if (speed > 1.5) out.brake = clamp(0.35 + speed * 0.12, 0, 1);
    else if (speed < -1.5) out.throttle = 0.5;
    else out.handbrake = true;
    return out;
  }
  const error = target - speed;
  if (error > 0) out.throttle = clamp(0.1 + error * 0.4, 0, 1);
  else if (error < -0.5 && speed > 1.6) out.brake = clamp(-error * 0.55, 0, 1);
  return out;
}

/**
 * Forward corridor test. The corridor follows the arc the vehicle is steering along (`curvature`), so it
 * bends with the road. An obstacle at local (f, l) with lateral half-size `halfLat` intrudes when its
 * distance from the arc is under `halfWidth + halfLat`.
 * Returns the sideways distance from the arc (signed, + = left); callers compare it with the clearance.
 */
export function arcOffset(f: number, l: number, curvature: number): number {
  const bend = Math.min(0.5 * Math.abs(curvature) * f * f, Math.abs(f));
  return l - Math.sign(curvature) * bend;
}

/**
 * Speed allowed behind an obstacle `gap` metres ahead (bumper to bumper) moving at `along` m/s in our
 * direction of travel (negative = coming towards us).
 */
export function followSpeed(gap: number, along: number, decel: number, standoff = DRIVE.standoff): number {
  // Something approaching eats the gap for as long as it takes us to react and stop.
  const room = gap - standoff + Math.min(0, along) * 1.5;
  const lead = Math.max(0, along);
  // Too close already: hang back until the gap opens.
  if (room <= 0) return Math.max(0, lead - 1);
  // Safe if it brakes as hard as we can: our stopping distance ≤ the room plus its own stopping distance.
  return Math.sqrt(2 * decel * room + lead * lead);
}

/** Lateral and longitudinal half-extents of a box (width × length) seen at relative heading `delta`. */
export function boxHalfLat(width: number, length: number, delta: number): number {
  return (Math.abs(Math.cos(delta)) * width + Math.abs(Math.sin(delta)) * length) / 2;
}
export function boxHalfLon(width: number, length: number, delta: number): number {
  return (Math.abs(Math.cos(delta)) * length + Math.abs(Math.sin(delta)) * width) / 2;
}
