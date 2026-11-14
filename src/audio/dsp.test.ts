import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { SR, Svf, addNoise, addTone, buf, driveCurve, peak, renderImpulse, renderNoise, renderPluck, resample, rms, softClipCurve } from './dsp';
import { pitchOf } from './test-helpers';

describe('dsp', () => {
  it('state variable filter separates lows from highs', () => {
    const lowTone = buf(0.2);
    const highTone = buf(0.2);
    addTone(lowTone, { dur: 0.2, amp: 1, f0: 100, decay: 10 });
    addTone(highTone, { dur: 0.2, amp: 1, f0: 8000, decay: 10 });
    const run = (x: Float32Array, pick: (f: Svf) => number): number => {
      const f = new Svf().set(1000, 0.707);
      const y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) {
        f.tick(x[i]);
        y[i] = pick(f);
      }
      return rms(y.subarray(2000));
    };
    expect(run(lowTone, (f) => f.low)).toBeGreaterThan(0.6);
    expect(run(highTone, (f) => f.low)).toBeLessThan(0.03);
    expect(run(highTone, (f) => f.high)).toBeGreaterThan(0.6);
    expect(run(lowTone, (f) => f.high)).toBeLessThan(0.03);
  });

  it('band-pass has unity gain at its centre', () => {
    const x = buf(0.3);
    addTone(x, { dur: 0.3, amp: 1, f0: 1500, decay: 10 });
    const f = new Svf().set(1500, 6);
    let m = 0;
    for (let i = 0; i < x.length; i++) {
      f.tick(x[i]);
      if (i > 4000) m = Math.max(m, Math.abs(f.bandN));
    }
    expect(m).toBeGreaterThan(0.9);
    expect(m).toBeLessThan(1.1);
  });

  it('noise bursts keep a similar loudness whatever the filter', () => {
    const level = (spec: Parameters<typeof addNoise>[2]): number => {
      const b = buf(0.5);
      addNoise(b, new Rng(3), spec);
      return rms(b);
    };
    const wide = level({ dur: 0.5, amp: 1, type: 'none', decay: 10 });
    const lp = level({ dur: 0.5, amp: 1, type: 'lp', f0: 800, decay: 10 });
    const bp = level({ dur: 0.5, amp: 1, type: 'bp', f0: 2000, q: 2, decay: 10 });
    for (const x of [lp, bp]) {
      expect(x / wide).toBeGreaterThan(0.5);
      expect(x / wide).toBeLessThan(2);
    }
  });

  it('plucked strings are in tune across the guitar range', () => {
    for (const midi of [40, 45, 52, 57, 64, 69, 76, 81]) {
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const b = renderPluck(f, { dur: 0.6, bright: 0.7, sustain: 3, pick: 0.2 }, new Rng(midi), 22050);
      const got = pitchOf(b, 22050, f * 0.8, f * 1.25, 2000, 6000);
      const cents = 1200 * Math.log2(got / f);
      expect(Math.abs(cents), `midi ${midi}: ${got.toFixed(2)} Hz vs ${f.toFixed(2)}`).toBeLessThan(6);
      expect(peak(b)).toBeLessThanOrEqual(0.91);
      expect(Math.abs(b[b.length - 1])).toBeLessThan(0.01);
    }
  });

  it('a plucked string dies away', () => {
    const b = renderPluck(196, { dur: 1.5, bright: 0.7, sustain: 3, pick: 0.2 }, new Rng(1), 22050);
    const early = rms(b.subarray(1000, 5000));
    const late = rms(b.subarray(24000, 28000));
    expect(late).toBeLessThan(early * 0.6);
    expect(late).toBeGreaterThan(0.001);
  });

  it('noise beds loop without a jump and sit at a known level', () => {
    for (const color of ['white', 'pink', 'brown'] as const) {
      const b = renderNoise(color, 2, new Rng(9));
      expect(rms(b)).toBeCloseTo(0.25, 1);
      expect(b.every(Number.isFinite)).toBe(true);
      // The seam is no rougher than the roughest neighbouring pair elsewhere.
      let worst = 0;
      for (let i = 1; i < b.length; i++) worst = Math.max(worst, Math.abs(b[i] - b[i - 1]));
      expect(Math.abs(b[0] - b[b.length - 1])).toBeLessThanOrEqual(worst * 1.5);
    }
  });

  it('impulse response decays to nothing', () => {
    const [l, r] = renderImpulse(1.5, new Rng(4), 0.5);
    expect(l.length).toBe(Math.ceil(1.5 * SR));
    const head = rms(l.subarray(1000, 9000));
    const tail = rms(l.subarray(l.length - 8000));
    expect(tail).toBeLessThan(head * 0.02);
    expect(l).not.toEqual(r);
  });

  it('the master clipper is transparent below 0.7 and can never reach full scale', () => {
    const c = softClipCurve();
    const at = (u: number): number => c[Math.round(((u / 2 + 1) / 2) * (c.length - 1))];
    expect(at(0)).toBeCloseTo(0, 3);
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(-0.6)).toBeCloseTo(-0.6, 3);
    expect(at(2)).toBeLessThan(0.985);
    expect(at(-2)).toBeGreaterThan(-0.985);
    expect(Math.max(...c)).toBeLessThan(1);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });

  it('converts between sample rates without changing pitch, length or level', () => {
    const tone = buf(0.5);
    addTone(tone, { dur: 0.5, amp: 0.8, f0: 440, decay: 10 });
    for (const to of [48000, 44100, 96000, 22050]) {
      const out = resample(tone, SR, to);
      if (to === SR) expect(out).toBe(tone);
      expect(Math.abs(out.length - (tone.length * to) / SR)).toBeLessThanOrEqual(1);
      expect(out.every(Number.isFinite)).toBe(true);
      expect(pitchOf(out, to, 300, 600, Math.floor(to * 0.1), Math.floor(to * 0.1))).toBeCloseTo(440, 0);
      expect(rms(out.subarray(Math.floor(to * 0.1), Math.floor(to * 0.4)))).toBeCloseTo(rms(tone.subarray(4410, 17640)), 2);
      expect(peak(out)).toBeLessThan(0.85);
    }
  });

  it('keeps loops seamless when converting them', () => {
    const loop = renderNoise('brown', 1, new Rng(2));
    for (const to of [48000, 32000]) {
      const out = resample(loop, SR, to, true);
      let worst = 0;
      for (let i = 1; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - out[i - 1]));
      expect(Math.abs(out[0] - out[out.length - 1])).toBeLessThanOrEqual(worst * 1.5);
      expect(rms(out)).toBeCloseTo(rms(loop), 1);
    }
  });

  it('builds impulse responses at whatever rate it is asked for', () => {
    for (const rate of [44100, 48000]) {
      const [l] = renderImpulse(1, new Rng(1), 0.5, 0.012, rate);
      expect(l.length).toBe(rate);
      // Silent pre-delay, then sound.
      expect(peak(l.subarray(0, Math.floor(0.011 * rate)))).toBe(0);
      expect(peak(l.subarray(Math.floor(0.012 * rate), Math.floor(0.1 * rate)))).toBeGreaterThan(0.1);
    }
  });

  it('drive curves are odd and normalised', () => {
    const c = driveCurve(8);
    expect(c[0]).toBeCloseTo(-1, 5);
    expect(c[c.length - 1]).toBeCloseTo(1, 5);
    expect(c[0] + c[c.length - 1]).toBeCloseTo(0, 5);
  });
});
