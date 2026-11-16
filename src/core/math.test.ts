import { describe, expect, it } from 'vitest';
import { angleDiff, clamp01, damp, lerp, smooth } from './math';
import { hashString, Rng } from './rng';

// Several modules were consolidated onto these helpers from byte-identical local copies.
// Pinning exact outputs keeps every seeded sequence and every eased value bit-identical.
describe('core maths golden values', () => {
  it('lerp, clamp01 and smooth', () => {
    expect(lerp(2, 10, 0.25)).toBe(4);
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(smooth(0, 1, 0.5)).toBe(0.5);
    expect(smooth(2, 6, 3)).toBe(0.15625);
    expect(smooth(6, 2, 3)).toBe(0.84375); // reversed edges
  });

  it('damp approaches the target frame-rate independently', () => {
    expect(damp(0, 1, 7, 0.016)).toBe(0.10595574249964279);
    expect(damp(5, 5, 3, 0.1)).toBe(5);
  });

  it('angleDiff wraps to the shortest signed difference', () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(0.2, 15);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2, 12);
  });
});

describe('Rng (mulberry32) golden sequence', () => {
  it('produces the exact sequence for a fixed seed', () => {
    const r = new Rng(0x1995);
    expect(r.next()).toBe(0.29606311465613544);
    expect(r.next()).toBe(0.057439448544755578);
    expect(r.next()).toBe(0.30461124517023563);
  });

  it('range draws exactly one value from the stream', () => {
    const r = new Rng(7);
    expect(r.range(-1, 1)).toBe(-0.97659049369394779);
  });
});

describe('hashString (FNV-1a) golden values', () => {
  it('matches the values the street and landmark seeds were built with', () => {
    expect(hashString('Colombo Street')).toBe(2687867993);
    expect(hashString('')).toBe(2166136261);
  });
});
