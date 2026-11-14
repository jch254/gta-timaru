import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { inCone, parkedTimeFactor, pedTimeFactor, pickRingPoint, racerCount, racersOut, spawnAllowed, trafficTimeFactor, type RingPoint } from './spawn';

const out: RingPoint = { x: 0, z: 0, radius: 0 };

describe('spawn ring', () => {
  it('always lands inside the ring', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 2000; i++) {
      pickRingPoint(rng, 100, -50, rng.range(-4, 4), 140, 260, 0.66, i % 2 ? 0.6 : 0, out);
      const d = Math.hypot(out.x - 100, out.z + 50);
      expect(d).toBeGreaterThanOrEqual(140 - 1e-6);
      expect(d).toBeLessThanOrEqual(260 + 1e-6);
      expect(d).toBeCloseTo(out.radius, 6);
    }
  });

  it('stays out of the camera cone unless asked to spawn ahead', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 2000; i++) {
      const heading = rng.range(-Math.PI, Math.PI);
      pickRingPoint(rng, 0, 0, heading, 140, 260, 0.66, 0, out);
      expect(inCone(0, 0, heading, 0.66 - 1e-6, out.x, out.z)).toBe(false);
    }
  });

  it('spawns far ahead for a fast-moving player', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 500; i++) {
      const heading = rng.range(-Math.PI, Math.PI);
      pickRingPoint(rng, 0, 0, heading, 140, 260, 0.66, 1, out);
      expect(inCone(0, 0, heading, 0.66 + 1e-6, out.x, out.z)).toBe(true);
      expect(out.radius).toBeGreaterThanOrEqual(260 * 0.82 - 1e-6);
    }
  });

  it('covers the whole ring area, not just its inner edge', () => {
    const rng = new Rng(4);
    let outer = 0;
    for (let i = 0; i < 4000; i++) {
      pickRingPoint(rng, 0, 0, 0, 100, 200, 0.5, 0, out);
      if (out.radius > 158.1) outer++;
    }
    // Half the ring's area lies beyond r = sqrt((100² + 200²) / 2) ≈ 158.1.
    expect(outer / 4000).toBeGreaterThan(0.45);
    expect(outer / 4000).toBeLessThan(0.55);
  });

  it('uses the heading convention forward = (sin h, cos h)', () => {
    expect(inCone(0, 0, 0, 0.5, 0, 100)).toBe(true);
    expect(inCone(0, 0, 0, 0.5, 0, -100)).toBe(false);
    expect(inCone(0, 0, Math.PI / 2, 0.5, 100, 0)).toBe(true);
    expect(inCone(0, 0, Math.PI / 2, 0.5, 0, 100)).toBe(false);
  });

  it('rejects positions that would pop into view or fall outside the ring', () => {
    // Behind the camera at a good distance.
    expect(spawnAllowed(0, 0, 0, 0, -180, 140, 260, 20, 0.66, 215)).toBe(true);
    // In front and close enough to see appear.
    expect(spawnAllowed(0, 0, 0, 0, 180, 140, 260, 20, 0.66, 215)).toBe(false);
    // In front but far away.
    expect(spawnAllowed(0, 0, 0, 0, 240, 140, 260, 20, 0.66, 215)).toBe(true);
    // Snapped too close / too far.
    expect(spawnAllowed(0, 0, 0, 0, -100, 140, 260, 20, 0.66, 215)).toBe(false);
    expect(spawnAllowed(0, 0, 0, 0, -300, 140, 260, 20, 0.66, 215)).toBe(false);
    expect(spawnAllowed(0, 0, 0, 0, -125, 140, 260, 20, 0.66, 215)).toBe(true);
  });
});

describe('time of day', () => {
  it('traffic is quiet at night and busiest at rush hour', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const f = trafficTimeFactor(h);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(trafficTimeFactor(3)).toBeLessThan(0.3);
    expect(trafficTimeFactor(8.2)).toBeGreaterThan(trafficTimeFactor(12));
    expect(trafficTimeFactor(12)).toBeGreaterThan(trafficTimeFactor(22));
    expect(trafficTimeFactor(22)).toBeGreaterThan(trafficTimeFactor(3));
    expect(trafficTimeFactor(27)).toBeCloseTo(trafficTimeFactor(3));
  });

  it('pedestrians thin out in the evening and all but vanish at night', () => {
    expect(pedTimeFactor(13)).toBe(1);
    expect(pedTimeFactor(20)).toBeLessThan(pedTimeFactor(13));
    expect(pedTimeFactor(20)).toBeGreaterThan(pedTimeFactor(2));
    expect(pedTimeFactor(2)).toBeLessThan(0.2);
    expect(pedTimeFactor(2)).toBeGreaterThan(0);
  });

  it('parked cars move from town to the suburbs overnight', () => {
    expect(parkedTimeFactor(13, true)).toBeGreaterThan(parkedTimeFactor(2, true));
    expect(parkedTimeFactor(2, false)).toBeGreaterThan(parkedTimeFactor(13, false));
  });
});

describe('boy racers', () => {
  it('are out every night between nine and two', () => {
    for (let day = 1; day <= 14; day++) {
      expect(racersOut(21.5, day)).toBe(true);
      expect(racersOut(23.9, day)).toBe(true);
      expect(racersOut(0.5, day)).toBe(true);
      expect(racersOut(1.9, day)).toBe(true);
      expect(racersOut(12, day)).toBe(false);
      expect(racersOut(17, day)).toBe(false);
    }
  });

  it('stay out longer on Friday and Saturday nights (clock.day % 7 of 5 and 6)', () => {
    // Friday evening before nine, and the small hours of Saturday morning.
    expect(racersOut(19.5, 5)).toBe(true);
    expect(racersOut(3, 6)).toBe(true);
    // Saturday evening, and the small hours of Sunday.
    expect(racersOut(20, 6)).toBe(true);
    expect(racersOut(3.5, 7)).toBe(true);
    // An ordinary Tuesday: not before nine, not after two.
    expect(racersOut(19.5, 2)).toBe(false);
    expect(racersOut(3, 3)).toBe(false);
    // The early hours of Friday belong to Thursday night.
    expect(racersOut(3, 5)).toBe(false);
    expect(racersOut(5, 6)).toBe(false);
  });

  it('come in packs of two to four, the same all night', () => {
    const counts = new Set<number>();
    for (let day = 1; day <= 40; day++) {
      const n = racerCount(22, day);
      counts.add(n);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
      // Past midnight it is still the same night out.
      expect(racerCount(1, day + 1)).toBe(n);
    }
    expect(counts.size).toBe(3);
  });
});
