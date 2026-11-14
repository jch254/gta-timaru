import { describe, expect, it } from 'vitest';
import { arcOffset, boxHalfLat, boxHalfLon, brakingSpeed, followSpeed, lookAhead, pursuitCurvature, pursuitSteer, speedControl, steerForCurvature, toLocal, turnSpeed, type Pedals } from './steer';
import { DRIVE } from './tuning';

const local = { f: 0, l: 0 };
const pedals: Pedals = { throttle: 0, brake: 0, handbrake: false };

describe('vehicle frame', () => {
  it('heading 0 faces +z and left is +x', () => {
    toLocal(0, 0, 0, 0, 10, local);
    expect(local.f).toBeCloseTo(10);
    expect(local.l).toBeCloseTo(0);
    toLocal(0, 0, 0, 4, 0, local);
    expect(local.f).toBeCloseTo(0);
    expect(local.l).toBeCloseTo(4);
  });

  it('follows the heading as it turns left (towards +x)', () => {
    // Facing +x: ahead is +x, left is −z.
    toLocal(5, 5, Math.PI / 2, 15, 5, local);
    expect(local.f).toBeCloseTo(10);
    expect(local.l).toBeCloseTo(0);
    toLocal(5, 5, Math.PI / 2, 5, 2, local);
    expect(local.l).toBeCloseTo(3);
  });
});

describe('pure pursuit', () => {
  it('finds the circle through the target', () => {
    // A quarter turn of radius 10 ends at (f, l) = (10, 10).
    expect(pursuitCurvature(10, 10)).toBeCloseTo(0.1);
    expect(pursuitCurvature(10, -10)).toBeCloseTo(-0.1);
    expect(pursuitCurvature(20, 0)).toBe(0);
  });

  it('steers towards the target: + is left', () => {
    expect(pursuitSteer(10, 2, 2.8, 0.58, 10)).toBeGreaterThan(0);
    expect(pursuitSteer(10, -2, 2.8, 0.58, 10)).toBeLessThan(0);
    expect(pursuitSteer(10, 0, 2.8, 0.58, 10)).toBe(0);
  });

  it('steers harder for a target further to the side, up to full lock', () => {
    const gentle = pursuitSteer(10, 1, 2.8, 0.58, 5);
    const sharp = pursuitSteer(10, 4, 2.8, 0.58, 5);
    expect(sharp).toBeGreaterThan(gentle);
    expect(pursuitSteer(2, 6, 2.8, 0.58, 5)).toBe(1);
    expect(pursuitSteer(2, -6, 2.8, 0.58, 5)).toBe(-1);
  });

  it('asks for full lock when the target is behind', () => {
    expect(pursuitSteer(-5, 1, 2.8, 0.58, 3)).toBe(1);
    expect(pursuitSteer(-5, -1, 2.8, 0.58, 3)).toBe(-1);
  });

  it('needs more steering input at speed, because the lock shrinks', () => {
    expect(steerForCurvature(0.02, 2.8, 0.58, 30)).toBeGreaterThan(steerForCurvature(0.02, 2.8, 0.58, 5));
  });

  it('looks further ahead the faster it goes', () => {
    expect(lookAhead(0)).toBe(DRIVE.lookMin);
    expect(lookAhead(20)).toBeGreaterThan(lookAhead(8));
    expect(lookAhead(200)).toBe(DRIVE.lookMax);
  });

  it('converges on a lane in closed loop (bicycle model)', () => {
    // Lane runs along +z at x = 0; the car starts 3 m to its right (−x), pointing slightly away.
    let x = -3;
    let z = 0;
    let h = -0.15;
    const speed = 12;
    const wheelbase = 2.8;
    const lock = 0.58;
    const dt = 1 / 60;
    let steer = 0;
    for (let i = 0; i < 60 * 8; i++) {
      const look = lookAhead(speed);
      toLocal(x, z, h, 0, z + look, local);
      const want = pursuitSteer(local.f, local.l, wheelbase, lock, speed);
      steer += Math.max(-2 * dt, Math.min(2 * dt, want - steer));
      const angle = (steer * lock) / (1 + speed * DRIVE.steerSpeedFalloff);
      h += ((speed * Math.tan(angle)) / wheelbase) * dt;
      x += Math.sin(h) * speed * dt;
      z += Math.cos(h) * speed * dt;
    }
    expect(Math.abs(x)).toBeLessThan(0.15);
    expect(Math.abs(h)).toBeLessThan(0.03);
  });
});

describe('speed planning', () => {
  it('braking profile obeys v² = v₀² + 2ad', () => {
    expect(brakingSpeed(0, 50, 4)).toBeCloseTo(20);
    expect(brakingSpeed(5, 0, 4)).toBeCloseTo(5);
    expect(brakingSpeed(5, -3, 4)).toBeCloseTo(5);
  });

  it('takes sharper junction turns more slowly and does not slow for straight on', () => {
    expect(turnSpeed(0.1, 12, 3)).toBe(Infinity);
    const wide = turnSpeed(Math.PI / 2, 10.6, 3);
    const tight = turnSpeed(Math.PI / 2, 3.9, 3);
    expect(wide).toBeGreaterThan(tight);
    expect(tight).toBeGreaterThan(2);
    expect(wide).toBeLessThan(8);
    expect(turnSpeed(-Math.PI / 2, 10.6, 3)).toBeCloseTo(wide);
  });

  it('accelerates below the target and brakes well above it', () => {
    speedControl(5, 14, pedals);
    expect(pedals.throttle).toBeGreaterThan(0);
    expect(pedals.brake).toBe(0);
    speedControl(20, 10, pedals);
    expect(pedals.throttle).toBe(0);
    expect(pedals.brake).toBeGreaterThan(0);
    speedControl(10.3, 10, pedals);
    expect(pedals.throttle + pedals.brake).toBe(0);
  });

  it('never uses the brake pedal near a standstill (it would select reverse)', () => {
    speedControl(0.4, 0, pedals);
    expect(pedals.brake).toBe(0);
    expect(pedals.handbrake).toBe(true);
    speedControl(1.0, 6, pedals);
    expect(pedals.brake).toBe(0);
    speedControl(8, 0, pedals);
    expect(pedals.brake).toBeGreaterThan(0);
    expect(pedals.handbrake).toBe(false);
  });
});

describe('obstacle corridor', () => {
  it('measures sideways distance from the arc being driven', () => {
    expect(arcOffset(20, 0, 0)).toBe(0);
    expect(arcOffset(20, 3, 0)).toBe(3);
    // Turning left on a 50 m radius: a point on that arc 20 m ahead sits about 4 m to the left.
    expect(arcOffset(20, 4, 1 / 50)).toBeCloseTo(0);
    expect(arcOffset(20, 0, 1 / 50)).toBeCloseTo(-4);
    expect(arcOffset(20, -4, -1 / 50)).toBeCloseTo(0);
  });

  it('keeps a gap that grows with speed and matches a leader', () => {
    expect(followSpeed(DRIVE.standoff, 0, 4)).toBe(0);
    expect(followSpeed(1, 0, 4)).toBe(0);
    const near = followSpeed(8, 0, 4);
    const far = followSpeed(40, 0, 4);
    expect(far).toBeGreaterThan(near);
    // Behind a moving leader: fast enough to keep up, slow enough to stop if it does.
    expect(followSpeed(8, 10, 4)).toBeGreaterThan(10);
    expect(followSpeed(8, 10, 4)).toBeLessThan(near + 10);
    expect(followSpeed(8, 10, 4) ** 2 / 8).toBeLessThanOrEqual(8 - DRIVE.standoff + 10 ** 2 / 8 + 1e-9);
    // Too close to a moving leader: drop back rather than stop dead.
    expect(followSpeed(1, 10, 4)).toBeCloseTo(9);
    // Something coming the other way leaves less room.
    expect(followSpeed(20, -8, 4)).toBeLessThan(followSpeed(20, 0, 4));
    expect(followSpeed(8, 0, 4, 6)).toBeLessThan(near);
  });

  it('sizes a box by how it is turned', () => {
    expect(boxHalfLat(1.8, 4.8, 0)).toBeCloseTo(0.9);
    expect(boxHalfLon(1.8, 4.8, 0)).toBeCloseTo(2.4);
    expect(boxHalfLat(1.8, 4.8, Math.PI / 2)).toBeCloseTo(2.4);
    expect(boxHalfLon(1.8, 4.8, Math.PI / 2)).toBeCloseTo(0.9);
    expect(boxHalfLat(1.8, 4.8, Math.PI)).toBeCloseTo(0.9);
  });
});
