import { describe, expect, it } from 'vitest';
import { GEARBOXES, newGearbox, revFraction, shiftPoints, sirenHz, stepGearbox } from './gearbox';

const DT = 1 / 60;

describe('virtual gearbox', () => {
  it('idles at rest', () => {
    for (const spec of Object.values(GEARBOXES)) {
      const s = newGearbox(spec);
      for (let i = 0; i < 300; i++) stepGearbox(s, spec, 0, 0, true, DT);
      expect(s.gear).toBe(0);
      expect(s.rpm).toBeCloseTo(spec.idle, 0);
    }
  });

  it('climbs through the gears under full throttle and never leaves the rev range', () => {
    for (const [name, spec] of Object.entries(GEARBOXES)) {
      const s = newGearbox(spec);
      let ups = 0;
      let lastGear = 0;
      for (let i = 0; i <= 1200; i++) {
        const speedFrac = Math.min(1, i / 1000); // 0 → top speed over ~17 s
        const changed = stepGearbox(s, spec, speedFrac, 1, true, DT);
        if (changed > 0) ups++;
        expect(changed).toBeGreaterThanOrEqual(0);
        expect(s.gear).toBeGreaterThanOrEqual(lastGear);
        lastGear = s.gear;
        expect(s.rpm, name).toBeGreaterThanOrEqual(spec.idle - 1);
        expect(s.rpm, name).toBeLessThanOrEqual(spec.redline + 1);
      }
      expect(s.gear, name).toBe(spec.ratios.length - 1);
      expect(ups, name).toBe(spec.ratios.length - 1);
      // Flat out in top gear the engine is working hard.
      if (spec.ratios.length > 1) expect((s.rpm - spec.idle) / (spec.redline - spec.idle), name).toBeGreaterThan(0.8);
    }
  });

  it('revs drop on every up-shift (the sawtooth you can hear)', () => {
    const spec = GEARBOXES.v8;
    const s = newGearbox(spec);
    const drops: number[] = [];
    let before = 0;
    let watching = 0;
    for (let i = 0; i <= 1100; i++) {
      const rpm = s.rpm;
      if (stepGearbox(s, spec, Math.min(1, i / 1000), 1, true, DT) > 0) {
        before = rpm;
        watching = 30;
      }
      if (watching > 0 && --watching === 0) drops.push(before - s.rpm);
    }
    expect(drops.length).toBe(spec.ratios.length - 1);
    for (const d of drops) expect(d).toBeGreaterThan(900);
  });

  it('holds a gear at a steady cruise: no hunting', () => {
    for (const spec of [GEARBOXES.four, GEARBOXES.six, GEARBOXES.diesel, GEARBOXES.bike]) {
      for (const throttle of [0.15, 0.5, 1]) {
        for (let speed = 0.05; speed <= 1; speed += 0.05) {
          const s = newGearbox(spec);
          for (let i = 0; i < 600; i++) stepGearbox(s, spec, speed, throttle, true, DT);
          let changes = 0;
          for (let i = 0; i < 600; i++) if (stepGearbox(s, spec, speed, throttle, true, DT) !== 0) changes++;
          expect(changes, `speed ${speed.toFixed(2)} throttle ${throttle}`).toBe(0);
        }
      }
    }
  });

  it('shifts up early on a light throttle and hangs on when flat out', () => {
    const spec = GEARBOXES.four;
    const gearAt = (throttle: number): number => {
      const s = newGearbox(spec);
      for (let i = 0; i < 900; i++) stepGearbox(s, spec, 0.4, throttle, true, DT);
      return s.gear;
    };
    expect(gearAt(0.1)).toBeGreaterThan(gearAt(1));
    expect(shiftPoints(1).up).toBeGreaterThan(shiftPoints(0).up);
    expect(shiftPoints(1).down).toBeLessThan(shiftPoints(1).up * 0.55);
  });

  it('drops straight to first when braked to a stop', () => {
    const spec = GEARBOXES.six;
    const s = newGearbox(spec);
    for (let i = 0; i < 1200; i++) stepGearbox(s, spec, Math.min(1, i / 600), 1, true, DT);
    expect(s.gear).toBe(spec.ratios.length - 1);
    for (let i = 0; i < 90; i++) stepGearbox(s, spec, 0, 0, true, DT);
    expect(s.gear).toBe(0);
  });

  it('revs lead the road speed when pulling away, and flare with the wheels in the air', () => {
    const spec = GEARBOXES.six;
    const s = newGearbox(spec);
    for (let i = 0; i < 60; i++) stepGearbox(s, spec, 0.01, 1, true, DT);
    const launch = s.rpm;
    expect(launch).toBeGreaterThan(spec.idle + 800);
    expect(launch).toBeGreaterThan(spec.idle + (spec.redline - spec.idle) * revFraction(spec, 0, 0.01) + 500);
    for (let i = 0; i < 60; i++) stepGearbox(s, spec, 0.01, 1, false, DT);
    expect(s.rpm).toBeGreaterThan(launch + 1000);
  });

  it('the electric drive has one gear', () => {
    const spec = GEARBOXES.electric;
    const s = newGearbox(spec);
    for (let i = 0; i < 600; i++) expect(stepGearbox(s, spec, i / 600, 1, true, DT)).toBe(0);
    expect(s.gear).toBe(0);
  });
});

describe('siren', () => {
  it('stays in the band a siren horn can reproduce', () => {
    for (let t = 0; t < 60; t += 0.01) {
      const f = sirenHz(t, 3);
      expect(f).toBeGreaterThanOrEqual(600);
      expect(f).toBeLessThanOrEqual(1520);
    }
  });

  it('wails smoothly, then yelps, then goes two-tone', () => {
    // Wail: no jumps.
    for (let t = 0.01; t < 7.9; t += 0.01) expect(Math.abs(sirenHz(t) - sirenHz(t - 0.01))).toBeLessThan(25);
    // Yelp sweeps much faster than the wail.
    const rate = (from: number, to: number): number => {
      let total = 0;
      for (let t = from; t < to; t += 0.01) total += Math.abs(sirenHz(t + 0.01) - sirenHz(t));
      return total / (to - from);
    };
    expect(rate(8.1, 11.4)).toBeGreaterThan(rate(0.1, 7.9) * 4);
    // Two-tone: exactly two pitches.
    const tones = new Set<number>();
    for (let t = 11.6; t < 14.9; t += 0.05) tones.add(sirenHz(t));
    expect([...tones].sort()).toEqual([660, 880]);
  });

  it('different cars are out of step', () => {
    let differs = 0;
    for (let t = 0; t < 15; t += 0.25) if (Math.abs(sirenHz(t, 1) - sirenHz(t, 2)) > 20) differs++;
    expect(differs).toBeGreaterThan(30);
  });
});
