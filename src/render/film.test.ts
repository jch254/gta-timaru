import { describe, expect, it } from 'vitest';
import { lookFor } from './film';

// warmth, grey, night, dusk, murk for each kind of weather at noon (see WEATHER in sky.ts).
const NOON = {
  clear: [0, 0, 0, 0, 0],
  norwester: [0.5, 0.12, 0, 0, 0],
  overcast: [-0.1, 0.6, 0, 0, 0],
  southerly: [-0.4, 0.9, 0, 0, 0],
  fog: [-0.1, 0.95, 0, 0, 1],
} as const;
const look = (k: keyof typeof NOON) => {
  const [warmth, grey, night, dusk, murk] = NOON[k];
  return lookFor(warmth, grey, night, dusk, murk);
};

describe('film look', () => {
  it('stays subtle in every weather, by day and by night', () => {
    for (const k of Object.keys(NOON) as (keyof typeof NOON)[]) {
      for (const night of [0, 0.5, 1]) {
        const [warmth, grey, , , murk] = NOON[k];
        const l = lookFor(warmth, grey, night, night === 0.5 ? 1 : 0, murk);
        expect(l.saturation).toBeGreaterThan(0.7);
        expect(l.saturation).toBeLessThan(1.1);
        expect(l.contrast).toBeGreaterThanOrEqual(0);
        expect(l.contrast).toBeLessThan(0.5);
        expect(l.lift).toBeGreaterThan(0);
        expect(l.lift).toBeLessThan(0.05);
        expect(l.grain).toBeLessThan(0.035);
        expect(l.vignette).toBeLessThan(0.15);
        expect(Math.abs(l.temperature)).toBeLessThan(0.7);
      }
    }
  });

  it('follows the weather', () => {
    expect(look('norwester').temperature).toBeGreaterThan(look('clear').temperature);
    expect(look('southerly').temperature).toBeLessThan(0);
    expect(look('overcast').contrast).toBeLessThan(look('clear').contrast);
    expect(look('fog').contrast).toBeLessThan(look('overcast').contrast);
    expect(look('fog').lift).toBeGreaterThan(look('clear').lift);
    expect(look('southerly').saturation).toBeLessThan(look('clear').saturation);
  });

  it('leans harder on the split tone and the grain after dark', () => {
    const day = lookFor(0, 0, 0, 0, 0);
    const night = lookFor(0, 0, 1, 0, 0);
    expect(night.night).toBe(1);
    expect(night.grain).toBeGreaterThan(day.grain);
    expect(night.temperature).toBeLessThan(day.temperature);
  });

  it('writes into the object it is given', () => {
    const out = lookFor(0, 0, 0, 0, 0);
    expect(lookFor(0.5, 0, 0, 0, 0, out)).toBe(out);
    expect(out.temperature).toBeGreaterThan(0.4);
  });
});
