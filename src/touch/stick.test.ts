import { describe, expect, it } from 'vitest';
import { STICK_DEAD, STICK_RADIUS, STICK_SPRINT, clampBase, emptyStick, followBase, steerCurve, stickVector } from './stick';

describe('stickVector', () => {
  it('is zero at rest and inside the dead zone', () => {
    expect(stickVector(0, 0)).toMatchObject({ x: 0, y: 0, reach: 0, sprint: false });
    const s = stickVector(STICK_RADIUS * STICK_DEAD * 0.9, 0);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    // The knob still follows the thumb, so the stick does not look dead.
    expect(s.knobX).toBeGreaterThan(0);
  });

  it('points up for a thumb pushed up the screen (screen y runs down)', () => {
    const s = stickVector(0, -STICK_RADIUS);
    expect(s.x).toBeCloseTo(0);
    expect(s.y).toBeCloseTo(1);
    const right = stickVector(STICK_RADIUS, 0);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
  });

  it('starts from zero at the edge of the dead zone and reaches one at the rim', () => {
    const justOut = stickVector(STICK_RADIUS * (STICK_DEAD + 0.01), 0);
    expect(justOut.x).toBeGreaterThan(0);
    expect(justOut.x).toBeLessThan(0.05);
    const half = stickVector(STICK_RADIUS * 0.5, 0);
    expect(half.x).toBeCloseTo((0.5 - STICK_DEAD) / (1 - STICK_DEAD));
    expect(stickVector(STICK_RADIUS, 0).x).toBeCloseTo(1);
  });

  it('never exceeds one, however far the thumb pulls, and keeps the knob on the rim', () => {
    const s = stickVector(300, -400);
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(1);
    expect(Math.hypot(s.knobX, s.knobY)).toBeCloseTo(STICK_RADIUS);
    expect(s.x).toBeCloseTo(0.6);
    expect(s.y).toBeCloseTo(0.8);
  });

  it('sprints only at the rim', () => {
    expect(stickVector(0, -STICK_RADIUS * (STICK_SPRINT - 0.05)).sprint).toBe(false);
    expect(stickVector(0, -STICK_RADIUS * (STICK_SPRINT + 0.01)).sprint).toBe(true);
    expect(stickVector(STICK_RADIUS * 2, 0).sprint).toBe(true);
  });

  it('writes into the object it is given (no garbage per move) and clears it again', () => {
    const out = emptyStick();
    expect(stickVector(20, 20, out)).toBe(out);
    expect(out.reach).toBeGreaterThan(0);
    stickVector(0, 0, out);
    expect(out).toEqual(emptyStick());
  });

  it('copes with a zero radius', () => {
    expect(stickVector(10, 10, emptyStick(), 0)).toEqual(emptyStick());
  });
});

describe('followBase', () => {
  it('leaves the base alone while the thumb is inside the rim', () => {
    const base = { x: 100, y: 200 };
    followBase(base, 100 + STICK_RADIUS - 1, 200);
    expect(base).toEqual({ x: 100, y: 200 });
  });

  it('drags the base along so the thumb stays on the rim', () => {
    const base = { x: 100, y: 200 };
    followBase(base, 100 + STICK_RADIUS + 30, 200);
    expect(base.x).toBeCloseTo(130);
    expect(base.y).toBeCloseTo(200);
    // A reversal now needs only one diameter of travel, not the whole way back.
    const s = stickVector(100 + STICK_RADIUS + 30 - 2 * STICK_RADIUS - base.x, 0);
    expect(s.x).toBeCloseTo(-1);
  });
});

describe('steerCurve', () => {
  it('is odd, gentle near the centre and full at the rim', () => {
    expect(steerCurve(0)).toBe(0);
    expect(steerCurve(1)).toBeCloseTo(1);
    expect(steerCurve(-1)).toBeCloseTo(-1);
    expect(steerCurve(0.3)).toBeLessThan(0.3);
    expect(steerCurve(-0.3)).toBeCloseTo(-steerCurve(0.3));
    expect(steerCurve(5)).toBeCloseTo(1);
  });

  it('never goes backwards as the stick moves out', () => {
    let last = -Infinity;
    for (let x = -1; x <= 1.0001; x += 0.05) {
      const v = steerCurve(x);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe('clampBase', () => {
  it('keeps the whole ring on a phone screen', () => {
    const margin = STICK_RADIUS + 8;
    expect(clampBase(2, 388, 844, 390)).toEqual({ x: margin, y: 390 - margin });
    expect(clampBase(200, 200, 844, 390)).toEqual({ x: 200, y: 200 });
  });

  it('does not invert on a screen smaller than the ring', () => {
    const at = clampBase(50, 50, 40, 40);
    expect(at.x).toBe(STICK_RADIUS + 8);
    expect(at.y).toBe(STICK_RADIUS + 8);
  });
});
