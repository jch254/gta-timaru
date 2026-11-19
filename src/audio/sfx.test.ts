import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { SfxId } from '../core/types';
import { SR, peak, rms } from './dsp';
import { lowShare as lowEnergy, pitchOf } from './test-helpers';
import { SOUNDS, renderSound, warmList } from './sfx';
import { ENGINE_BASE_RPM, renderCrickets, renderEngineLoop, renderGravelLoop, renderRainLoop, type EngineKind, type SoundId } from './sfx-render';

/** Every id in the contract (src/core/types.ts → SfxId). The Record type makes the compiler check the list is complete. */
const PUBLIC: Record<SfxId, true> = {
  pistol: true,
  shotgun: true,
  smg: true,
  rifle: true,
  punch: true,
  reload: true,
  empty: true,
  ricochet: true,
  bodyHit: true,
  crashSmall: true,
  crashBig: true,
  glass: true,
  explosion: true,
  horn: true,
  hornTruck: true,
  doorOpen: true,
  doorClose: true,
  engineStart: true,
  skid: true,
  siren: true,
  pickup: true,
  cash: true,
  missionPass: true,
  missionFail: true,
  uiMove: true,
  uiSelect: true,
  footstep: true,
  splash: true,
  tramBell: true,
  sheep: true,
  magpie: true,
  scream: true,
};

const ids = Object.keys(SOUNDS) as SoundId[];

describe('sound effect library', () => {
  it('covers every SfxId in the contract', () => {
    for (const id of Object.keys(PUBLIC)) expect(SOUNDS[id as SoundId], id).toBeDefined();
  });

  it('keeps every voice at or below 0.5 before the bus', () => {
    for (const id of ids) {
      expect(SOUNDS[id].gain, id).toBeLessThanOrEqual(0.5);
      expect(SOUNDS[id].gain, id).toBeGreaterThan(0.05);
    }
  });

  it.each(ids)('%s renders clean, audible, bounded audio', (id) => {
    const def = SOUNDS[id];
    for (let v = 0; v < def.variants; v++) {
      const b = renderSound(id, v);
      const seconds = b.length / SR;
      expect(b.every(Number.isFinite), `${id}#${v} finite`).toBe(true);
      expect(seconds, `${id}#${v} length`).toBeGreaterThan(0.03);
      expect(seconds, `${id}#${v} length`).toBeLessThan(3.6);
      const p = peak(b);
      expect(p, `${id}#${v} peak`).toBeGreaterThan(0.85);
      expect(p, `${id}#${v} peak`).toBeLessThanOrEqual(0.93);
      // Not a click and not silence: a sensible amount of energy.
      expect(rms(b), `${id}#${v} rms`).toBeGreaterThan(0.02);
      // Starts and ends at (near) zero so it can never click.
      expect(Math.abs(b[0]), `${id}#${v} start`).toBeLessThan(0.02);
      expect(Math.abs(b[b.length - 1]), `${id}#${v} end`).toBeLessThan(0.02);
      // No DC offset to speak of.
      let sum = 0;
      for (let i = 0; i < b.length; i++) sum += b[i];
      expect(Math.abs(sum / b.length), `${id}#${v} dc`).toBeLessThan(0.03);
    }
  });

  it('is deterministic, and variants differ', () => {
    expect(renderSound('pistol', 0)).toEqual(renderSound('pistol', 0));
    expect(renderSound('pistol', 0)).not.toEqual(renderSound('pistol', 1));
    expect(renderSound('magpie', 0).length).not.toBe(renderSound('magpie', 2).length);
  });

  it('gives each weapon its own character', () => {
    const len = (id: SoundId): number => renderSound(id, 0).length / SR;
    // Low-frequency share of the energy: boom vs crack.
    const lowShare = (id: SoundId): number => lowEnergy(renderSound(id, 0), SR, 210);
    expect(len('smg')).toBeLessThan(len('pistol'));
    expect(len('pistol')).toBeLessThan(len('shotgun'));
    expect(len('shotgun')).toBeLessThan(len('rifle'));
    expect(lowShare('shotgun')).toBeGreaterThan(lowShare('pistol'));
    expect(lowShare('explosion')).toBeGreaterThan(lowShare('glass') * 5);
  });

  it('the rifle has an audible echo after the crack', () => {
    const b = renderSound('rifle', 0);
    const win = (from: number, to: number): number => rms(b.subarray(Math.floor(from * SR), Math.floor(to * SR)));
    // Energy bumps back up around the slap-back delay compared with just before it.
    expect(win(0.2, 0.3)).toBeGreaterThan(win(0.13, 0.18));
  });

  it('cries sound like people: a scream is high and long, a hurt yelp short, a dying groan low', () => {
    const len = (id: SoundId): number => renderSound(id, 0).length / SR;
    // Voice pitch, measured a little way in (past the attack).
    const pitch = (id: SoundId): number => pitchOf(renderSound(id, 0), SR, 120, 900, Math.floor(0.12 * SR), 2048);
    expect(pitch('scream')).toBeGreaterThan(380);
    expect(pitch('pain')).toBeGreaterThan(160);
    expect(pitch('pain')).toBeLessThan(pitch('scream'));
    expect(pitch('deathCry')).toBeLessThan(pitch('scream'));
    for (let v = 0; v < SOUNDS.scream.variants; v++) expect(renderSound('scream', v).length / SR, `scream#${v}`).toBeGreaterThan(0.55);
    expect(len('pain')).toBeLessThan(len('scream'));
    // Run over: mostly a low thud.
    expect(lowEnergy(renderSound('crunch', 0), SR, 210)).toBeGreaterThan(lowEnergy(renderSound('pain', 0), SR, 210));
  });

  it('horns are pitched where car horns live', () => {
    const horn = renderSound('horn', 0);
    const f = pitchOf(horn, SR, 80, 700, 6000, 8000);
    // Two tones a major third apart share a low common period; either is fine.
    expect(f).toBeGreaterThan(90);
    expect(f).toBeLessThan(560);
    const truck = renderSound('hornTruck', 0);
    expect(truck.length).toBeGreaterThan(horn.length);
  });

  it('queues every variant for warming, most important first', () => {
    const list = warmList();
    const total = ids.reduce((n, id) => n + SOUNDS[id].variants, 0);
    expect(list.length).toBe(total);
    expect(list[0][0]).toBe('explosion');
    expect(new Set(list.map(([id, v]) => `${id}:${v}`)).size).toBe(total);
  });
});

describe('loops for continuous layers', () => {
  const seamOk = (b: Float32Array): void => {
    let worst = 0;
    for (let i = 1; i < b.length; i++) worst = Math.max(worst, Math.abs(b[i] - b[i - 1]));
    expect(Math.abs(b[0] - b[b.length - 1])).toBeLessThanOrEqual(worst);
  };

  it.each(['four', 'six', 'v6', 'v8', 'boxer', 'turbo', 'diesel', 'bike', 'single'] as EngineKind[])('%s engine loops are seamless and the right length', (kind) => {
    for (const band of [0, 1] as const) {
      const b = renderEngineLoop(kind, band, new Rng(5));
      expect(b.every(Number.isFinite)).toBe(true);
      expect(peak(b)).toBeLessThanOrEqual(0.86);
      expect(rms(b)).toBeGreaterThan(0.08);
      seamOk(b);
      // A whole number of engine cycles (two revolutions each) at the base rpm.
      const cycle = (120 / ENGINE_BASE_RPM[band]) * SR;
      const cycles = b.length / cycle;
      expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(0.01);
    }
  });

  it('a V8 is lumpier than a straight six', () => {
    // Variation between successive firing pulses: uneven for the V8, near-even for the six.
    const lump = (kind: EngineKind, cylinders: number): number => {
      const b = renderEngineLoop(kind, 0, new Rng(5));
      const interval = Math.round((120 / ENGINE_BASE_RPM[0] / cylinders) * SR);
      const peaks: number[] = [];
      for (let i = 0; i + interval <= b.length; i += interval) peaks.push(peak(b.subarray(i, i + interval)));
      const mean = peaks.reduce((a, c) => a + c, 0) / peaks.length;
      return Math.sqrt(peaks.reduce((a, c) => a + (c - mean) ** 2, 0) / peaks.length) / mean;
    };
    expect(lump('v8', 8)).toBeGreaterThan(lump('six', 6) * 2);
  });

  it('crickets, gravel and rain loop cleanly', () => {
    for (const b of [renderCrickets(), renderGravelLoop(new Rng(1)), renderRainLoop(new Rng(2))]) {
      expect(b.every(Number.isFinite)).toBe(true);
      expect(peak(b)).toBeLessThanOrEqual(0.86);
      expect(rms(b)).toBeGreaterThan(0.01);
      seamOk(b);
    }
  });
});
