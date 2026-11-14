import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { damageAtRange, explosionFalloff, explosionShake, spreadDirection } from './ballistics';
import { WEAPONS } from './weapons';

describe('spreadDirection', () => {
  const axes = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0.2, -0.4).normalize(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.01, -0.9999, 0.005).normalize()];

  it('returns unit vectors inside the cone, for any axis', () => {
    const rng = new Rng(7);
    const out = new THREE.Vector3();
    for (const axis of axes) {
      for (const half of [0.003, 0.02, 0.085, 0.6]) {
        for (let i = 0; i < 400; i++) {
          spreadDirection(axis, half, rng.next(), rng.next(), out);
          expect(out.length()).toBeCloseTo(1, 5);
          expect(out.angleTo(axis)).toBeLessThanOrEqual(half + 1e-6);
        }
      }
    }
  });

  it('covers the cone evenly: centred on the axis, a quarter of shots inside half the angle', () => {
    const rng = new Rng(1995);
    const axis = axes[1];
    const half = 0.085;
    const out = new THREE.Vector3();
    const mean = new THREE.Vector3();
    const n = 20000;
    let inner = 0;
    let reachesEdge = false;
    const quadrants = [0, 0, 0, 0];
    const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    const lift = new THREE.Vector3().crossVectors(side, axis);
    for (let i = 0; i < n; i++) {
      spreadDirection(axis, half, rng.next(), rng.next(), out);
      mean.add(out);
      const angle = out.angleTo(axis);
      if (angle < half / 2) inner++;
      if (angle > half * 0.97) reachesEdge = true;
      quadrants[(out.dot(side) > 0 ? 1 : 0) + (out.dot(lift) > 0 ? 2 : 0)]++;
    }
    expect(mean.normalize().angleTo(axis)).toBeLessThan(half * 0.03);
    // Area of a small cap grows with the square of its angle.
    const expected = (1 - Math.cos(half / 2)) / (1 - Math.cos(half));
    expect(expected).toBeCloseTo(0.25, 2);
    expect(inner / n).toBeGreaterThan(expected - 0.02);
    expect(inner / n).toBeLessThan(expected + 0.02);
    expect(reachesEdge).toBe(true);
    for (const q of quadrants) expect(q / n).toBeGreaterThan(0.23);
  });

  it('extremes of the random inputs map to the axis and the rim', () => {
    const axis = axes[0];
    const out = new THREE.Vector3();
    expect(spreadDirection(axis, 0.1, 0, 0.3, out).angleTo(axis)).toBeLessThan(1e-6);
    expect(spreadDirection(axis, 0.1, 1, 0.3, out).angleTo(axis)).toBeCloseTo(0.1, 6);
  });

  it('no spread means no deviation, and the output may be the axis itself', () => {
    const axis = axes[1].clone();
    const out = new THREE.Vector3();
    expect(spreadDirection(axis, 0, 0.5, 0.5, out).equals(axis)).toBe(true);
    const before = axis.clone();
    spreadDirection(axis, 0.05, 0.7, 0.2, axis);
    expect(axis.length()).toBeCloseTo(1, 6);
    expect(axis.angleTo(before)).toBeLessThanOrEqual(0.05 + 1e-6);
    expect(axis.angleTo(before)).toBeGreaterThan(0);
  });

  it('a shotgun pattern is wider than a rifle group', () => {
    const shotgun = WEAPONS.find((w) => w.id === 'shotgun')!;
    const rifle = WEAPONS.find((w) => w.id === 'rifle')!;
    const rng = new Rng(3);
    const out = new THREE.Vector3();
    const widest = (half: number) => {
      let max = 0;
      for (let i = 0; i < 500; i++) max = Math.max(max, spreadDirection(axes[0], half, rng.next(), rng.next(), out).angleTo(axes[0]));
      return max;
    };
    expect(widest(shotgun.spread)).toBeGreaterThan(widest(rifle.spread) * 10);
  });
});

describe('damageAtRange', () => {
  it('is full up close, floors at maximum range, and is linear between', () => {
    expect(damageAtRange(20, 0, 30, 0.3, 0.25)).toBe(20);
    expect(damageAtRange(20, 9, 30, 0.3, 0.25)).toBe(20);
    expect(damageAtRange(20, 30, 30, 0.3, 0.25)).toBe(5);
    expect(damageAtRange(20, 500, 30, 0.3, 0.25)).toBe(5);
    expect(damageAtRange(20, 19.5, 30, 0.3, 0.25)).toBeCloseTo(12.5, 6);
  });

  it('never rises with distance', () => {
    let last = Infinity;
    for (let d = 0; d <= 80; d += 0.5) {
      const v = damageAtRange(26, d, 70, 0.5, 0.6);
      expect(v).toBeLessThanOrEqual(last + 1e-9);
      last = v;
    }
    expect(last).toBeCloseTo(26 * 0.6, 6);
  });

  it('with no falloff configured stays constant', () => {
    expect(damageAtRange(14, 1.2, 1.5, 1, 1)).toBe(14);
    expect(damageAtRange(14, 9, 1.5, 1, 1)).toBe(14);
  });
});

describe('explosionFalloff', () => {
  it('is 1 through the core, 0 at the radius and beyond, linear between', () => {
    expect(explosionFalloff(0, 9)).toBe(1);
    expect(explosionFalloff(2.25, 9)).toBe(1);
    expect(explosionFalloff(9, 9)).toBe(0);
    expect(explosionFalloff(40, 9)).toBe(0);
    expect(explosionFalloff(5.625, 9)).toBeCloseTo(0.5, 6);
    expect(explosionFalloff(5, 10, 0)).toBeCloseTo(0.5, 6);
  });

  it('never rises with distance and stays within 0..1', () => {
    let last = 1;
    for (let d = 0; d <= 12; d += 0.1) {
      const f = explosionFalloff(d, 9, 0.25);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(last + 1e-9);
      last = f;
    }
  });

  it('a zero radius hurts nothing', () => {
    expect(explosionFalloff(0, 0)).toBe(0);
  });
});

describe('explosionShake', () => {
  it('is strongest at the blast and gone by about five radii', () => {
    expect(explosionShake(0, 9)).toBe(1);
    expect(explosionShake(9, 9)).toBe(1);
    expect(explosionShake(27, 9)).toBeCloseTo(0.55, 6);
    expect(explosionShake(47, 9)).toBe(0);
    expect(explosionShake(5, 0)).toBe(0);
  });
});
