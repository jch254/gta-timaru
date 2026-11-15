/**
 * Thumb-stick maths, free of the DOM. Screen coordinates throughout: +x right, +y down, in CSS pixels.
 * The stick floats: its base is wherever the thumb landed, and follows if the thumb pulls past the rim.
 */

/** Thumb travel for full deflection. */
export const STICK_RADIUS = 52;
/** Fraction of the radius that does nothing, so a resting thumb does not creep. */
export const STICK_DEAD = 0.14;
/** Deflection (0..1, before the dead zone is taken off) at which walking becomes sprinting. */
export const STICK_SPRINT = 0.9;

export interface StickState {
  /** Deflection in -1..1 with the dead zone removed: x +1 = right, y +1 = up (away from the player). */
  x: number;
  y: number;
  /** Raw deflection 0..1 (dead zone included), for the rim test. */
  reach: number;
  /** The thumb is at the rim. */
  sprint: boolean;
  /** Where to draw the knob, relative to the base, clamped to the rim. */
  knobX: number;
  knobY: number;
}

export function emptyStick(): StickState {
  return { x: 0, y: 0, reach: 0, sprint: false, knobX: 0, knobY: 0 };
}

/** Deflection for a thumb `dx, dy` pixels from the base. Writes into `out` and returns it. */
export function stickVector(dx: number, dy: number, out: StickState = emptyStick(), radius = STICK_RADIUS): StickState {
  const distance = Math.hypot(dx, dy);
  if (!(distance > 0) || !(radius > 0)) {
    out.x = out.y = out.reach = out.knobX = out.knobY = 0;
    out.sprint = false;
    return out;
  }
  const reach = Math.min(1, distance / radius);
  // Rescaled so the output starts from 0 at the edge of the dead zone and still reaches 1 at the rim.
  const live = reach <= STICK_DEAD ? 0 : (reach - STICK_DEAD) / (1 - STICK_DEAD);
  const ux = dx / distance;
  const uy = dy / distance;
  // (Adding to and taking from zero keeps a dead stick at +0 rather than -0.)
  out.x = ux * live + 0;
  out.y = 0 - uy * live;
  out.reach = reach;
  out.sprint = reach >= STICK_SPRINT;
  out.knobX = ux * reach * radius;
  out.knobY = uy * reach * radius;
  return out;
}

/**
 * The base follows a thumb that has pulled past the rim, so a change of direction never needs the thumb to
 * travel back across the whole stick. Returns the new base in `base` (mutated).
 */
export function followBase(base: { x: number; y: number }, thumbX: number, thumbY: number, radius = STICK_RADIUS): { x: number; y: number } {
  const dx = thumbX - base.x;
  const dy = thumbY - base.y;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) {
    const pull = (distance - radius) / distance;
    base.x += dx * pull;
    base.y += dy * pull;
  }
  return base;
}

/**
 * Steering response for the car: gentle near the centre, where a thumb is least precise, and full at the rim.
 */
export function steerCurve(x: number): number {
  const a = Math.min(1, Math.abs(x));
  return Math.sign(x) * (0.45 * a + 0.55 * a * a);
}

/** Keeps the stick's base on screen and clear of the edges, so the whole ring can be drawn. */
export function clampBase(x: number, y: number, width: number, height: number, margin = STICK_RADIUS + 8): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, margin), Math.max(margin, width - margin)),
    y: Math.min(Math.max(y, margin), Math.max(margin, height - margin)),
  };
}
