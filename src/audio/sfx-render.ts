/**
 * Synthesised sound effects, rendered offline to Float32Arrays (see dsp.ts). Every sound is built from
 * oscillators, filtered noise and envelopes: no samples. Renderers take a seeded Rng so each id gets a few
 * distinct variants, and playback adds a little pitch jitter on top.
 */
import type { Rng } from '../core/rng';
import { SR, Svf, addClick, addNoise, addTone, ahd, buf, echo, fadeEdges, filterBuf, finish, mixInto, normalize, waveAt } from './dsp';

const TAU = Math.PI * 2;

export type Renderer = (r: Rng) => Float32Array;

// ───────────────────────────── helpers ─────────────────────────────

/** A voiced, formant-filtered source: the basis of the sheep, the yelp and the gull. */
function voiced(
  r: Rng,
  dur: number,
  pitch: (u: number, t: number) => number,
  formants: [number, number, number][],
  o: { breath?: number; attack?: number; release?: number; tremRate?: number; tremDepth?: number; wave?: 'saw' | 'square' } = {},
): Float32Array {
  const n = Math.ceil(dur * SR);
  const out = new Float32Array(n);
  const filters = formants.map(([f, q]) => new Svf().set(f, q));
  const attack = o.attack ?? 0.03;
  const release = o.release ?? 0.08;
  const breath = o.breath ?? 0.15;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = t / dur;
    const dp = pitch(u, t) / SR;
    p += dp;
    if (p >= 1) p -= 1;
    const src = waveAt(o.wave ?? 'saw', p, dp) + breath * (r.next() * 2 - 1);
    let y = 0;
    for (let k = 0; k < filters.length; k++) {
      filters[k].tick(src);
      y += filters[k].bandN * formants[k][2];
    }
    let env = Math.min(1, t / attack) * Math.min(1, (dur - t) / release);
    if (o.tremRate) env *= 1 - (o.tremDepth ?? 0.3) * (0.5 + 0.5 * Math.sin(TAU * o.tremRate * t));
    out[i] = y * env;
  }
  return out;
}

/** A slow random wander (±amount) in a voice's pitch: `rate` fresh targets a second, smoothly joined. */
function wander(r: Rng, dur: number, rate: number, amount: number): (t: number) => number {
  const n = Math.ceil(dur * rate) + 2;
  const points = new Float32Array(n);
  for (let i = 0; i < n; i++) points[i] = (r.next() * 2 - 1) * amount;
  return (t) => {
    const x = t * rate;
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    return points[i] + (points[i + 1] - points[i]) * f * f * (3 - 2 * f);
  };
}

/** One flute-like syllable with a pitch glide and optional amplitude roll (birdsong). */
function warble(b: Float32Array, at: number, dur: number, fa: number, fb: number, amp: number, roll = 0): void {
  const start = Math.floor(at * SR);
  const n = Math.min(b.length - start, Math.floor(dur * SR));
  let p = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const s = u * u * (3 - 2 * u);
    const f = fa + (fb - fa) * s;
    p += f / SR;
    if (p >= 1) p -= 1;
    const y = Math.sin(TAU * p) + 0.26 * Math.sin(2 * TAU * p) + 0.09 * Math.sin(3 * TAU * p);
    let env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.55);
    if (roll) env *= 1 - 0.6 * (0.5 + 0.5 * Math.sin(TAU * roll * (i / SR)));
    b[start + i] += y * amp * env;
  }
}

/** Inharmonic struck bell. */
function bell(b: Float32Array, at: number, f: number, amp: number, decay: number, partials: [number, number, number][]): void {
  for (const [ratio, a, d] of partials) addTone(b, { at, dur: decay * d * 7, amp: amp * a, f0: f * ratio, decay: decay * d });
}

/** Rich brass-like note rendered into a scratch buffer then low-passed. */
function brass(b: Float32Array, at: number, dur: number, freq: number, amp: number, cutoff: number): void {
  const tmp = buf(dur + 0.3);
  for (const det of [-0.004, 0.004]) {
    addTone(tmp, { dur: dur + 0.25, amp: 0.5, wave: 'saw', f0: freq * (1 + det) * 0.985, f1: freq * (1 + det), sweep: 0.03, attack: 0.025, hold: dur - 0.025, decay: 0.07 });
  }
  filterBuf(tmp, 'lp', cutoff, 0.9);
  mixInto(b, tmp, at, amp);
}

function gunTail(b: Float32Array, r: Rng, at: number, amp: number, f: number, decay: number): void {
  addNoise(b, r, { at, dur: Math.min(b.length / SR - at, decay * 6), amp, type: 'lp', f0: f, f1: f * 0.35, decay });
}

// ───────────────────────────── weapons ─────────────────────────────

const pistol: Renderer = (r) => {
  const b = buf(0.62);
  const v = r.range(0.93, 1.07);
  addNoise(b, r, { dur: 0.02, amp: 0.9, type: 'hp', f0: 3600, decay: 0.003 });
  addNoise(b, r, { dur: 0.2, amp: 1, type: 'bp', f0: 1900 * v, f1: 800, q: 0.7, decay: 0.03 });
  addTone(b, { dur: 0.16, amp: 1, f0: 250 * v, f1: 60, sweep: 0.02, decay: 0.04 });
  gunTail(b, r, 0.012, 0.2, 1500, 0.1);
  return finish(b, 1.8);
};

const smg: Renderer = (r) => {
  const b = buf(0.32);
  const v = r.range(0.94, 1.06);
  addNoise(b, r, { dur: 0.015, amp: 0.8, type: 'hp', f0: 4200, decay: 0.002 });
  addNoise(b, r, { dur: 0.12, amp: 1, type: 'bp', f0: 2500 * v, f1: 1200, q: 0.8, decay: 0.02 });
  addTone(b, { dur: 0.1, amp: 0.75, f0: 310 * v, f1: 95, sweep: 0.014, decay: 0.026 });
  gunTail(b, r, 0.01, 0.14, 1900, 0.05);
  return finish(b, 1.6);
};

const shotgun: Renderer = (r) => {
  const b = buf(1.35);
  const v = r.range(0.94, 1.06);
  addNoise(b, r, { dur: 0.03, amp: 0.8, type: 'hp', f0: 2600, decay: 0.004 });
  addNoise(b, r, { dur: 0.55, amp: 1, type: 'lp', f0: 4400 * v, f1: 480, decay: 0.1 });
  addTone(b, { dur: 0.5, amp: 1.2, f0: 150 * v, f1: 40, sweep: 0.05, decay: 0.13 });
  gunTail(b, r, 0.03, 0.3, 950, 0.3);
  return finish(b, 2.3);
};

const rifle: Renderer = (r) => {
  const b = buf(1.6);
  const v = r.range(0.95, 1.05);
  addNoise(b, r, { dur: 0.09, amp: 1, type: 'hp', f0: 1300 * v, decay: 0.014 });
  addNoise(b, r, { dur: 0.25, amp: 0.8, type: 'bp', f0: 1350 * v, f1: 600, q: 0.7, decay: 0.045 });
  addTone(b, { dur: 0.2, amp: 0.9, f0: 330 * v, f1: 70, sweep: 0.03, decay: 0.055 });
  gunTail(b, r, 0.015, 0.24, 1100, 0.22);
  // The crack comes back off the hills.
  echo(b, r.range(0.19, 0.24), 0.34, 0.42, 1500);
  return finish(b, 1.9);
};

const punch: Renderer = (r) => {
  const b = buf(0.26);
  const v = r.range(0.9, 1.1);
  addTone(b, { dur: 0.2, amp: 1, f0: 155 * v, f1: 50, sweep: 0.03, decay: 0.05 });
  addNoise(b, r, { dur: 0.12, amp: 0.6, type: 'lp', f0: 950, f1: 260, decay: 0.028 });
  addNoise(b, r, { dur: 0.05, amp: 0.3, type: 'bp', f0: 2000 * v, q: 1, decay: 0.01 });
  return finish(b, 1.4);
};

/** A blade landing: the swish of the edge coming round, the bright tick as it bites, and the short wet tear under it. */
const slash: Renderer = (r) => {
  const b = buf(0.3);
  const v = r.range(0.9, 1.12);
  addNoise(b, r, { dur: 0.1, amp: 0.5, type: 'bp', f0: 1800 * v, f1: 5400 * v, q: 1.4, attack: 0.03, hold: 0.015, decay: 0.02 });
  addNoise(b, r, { at: 0.05, dur: 0.05, amp: 0.9, type: 'hp', f0: 3800, decay: 0.008 });
  addNoise(b, r, { at: 0.055, dur: 0.16, amp: 0.7, type: 'bp', f0: 950 * v, f1: 380, q: 0.9, decay: 0.035 });
  addTone(b, { at: 0.055, dur: 0.1, amp: 0.3, f0: 210 * v, f1: 90, sweep: 0.03, decay: 0.03 });
  return finish(b, 1.3);
};

const bodyHit: Renderer = (r) => {
  const b = buf(0.32);
  const v = r.range(0.9, 1.1);
  addTone(b, { dur: 0.28, amp: 1, f0: 105 * v, f1: 42, sweep: 0.04, decay: 0.07 });
  addNoise(b, r, { dur: 0.2, amp: 0.7, type: 'bp', f0: 430 * v, q: 1.2, decay: 0.045 });
  addNoise(b, r, { dur: 0.05, amp: 0.22, type: 'lp', f0: 1600, decay: 0.012 });
  return finish(b, 1.3);
};

const reload: Renderer = (r) => {
  const b = buf(0.92);
  addClick(b, r, 0, 2400, 0.7);
  addClick(b, r, 0.07, 1500, 0.4, 0.01);
  addNoise(b, r, { at: 0.08, dur: 0.1, amp: 0.1, type: 'bp', f0: 1800, q: 1, attack: 0.03, decay: 0.03 });
  addClick(b, r, 0.36, 1300, 0.85, 0.008);
  addTone(b, { at: 0.36, dur: 0.12, amp: 0.5, f0: 190, f1: 150, decay: 0.025 });
  addClick(b, r, 0.63, 3000, 0.9, 0.005);
  addNoise(b, r, { at: 0.64, dur: 0.07, amp: 0.2, type: 'hp', f0: 2600, attack: 0.01, decay: 0.03 });
  addClick(b, r, 0.71, 2200, 1, 0.007);
  addTone(b, { at: 0.71, dur: 0.08, amp: 0.3, f0: 260, f1: 200, decay: 0.018 });
  return finish(b, 1.2);
};

const empty: Renderer = (r) => {
  const b = buf(0.12);
  addClick(b, r, 0, 3200, 1, 0.005, 3);
  addTone(b, { dur: 0.05, amp: 0.4, wave: 'tri', f0: 1500, decay: 0.007 });
  addClick(b, r, 0.032, 2000, 0.3, 0.006);
  return finish(b);
};

const ricochet: Renderer = (r) => {
  const b = buf(0.55);
  const f = r.range(2600, 4200);
  const end = f * r.range(0.25, 0.4);
  addNoise(b, r, { dur: 0.02, amp: 0.8, type: 'hp', f0: 3000, decay: 0.003 });
  addTone(b, { dur: 0.5, amp: 0.7, f0: f, f1: end, sweep: r.range(0.1, 0.2), decay: 0.12, vib: 28, vibDepth: 0.012 });
  addTone(b, { dur: 0.4, amp: 0.25, f0: f * 1.5, f1: end * 1.5, sweep: 0.12, decay: 0.07 });
  addNoise(b, r, { dur: 0.4, amp: 0.3, type: 'bp', f0: f, f1: end, q: 7, decay: 0.1 });
  return finish(b);
};

const impactWorld: Renderer = (r) => {
  const b = buf(0.22);
  addNoise(b, r, { dur: 0.03, amp: 1, type: 'bp', f0: r.range(1400, 2600), q: 1, decay: 0.006 });
  addNoise(b, r, { dur: 0.18, amp: 0.5, type: 'lp', f0: 900, f1: 300, decay: 0.035 });
  addTone(b, { dur: 0.08, amp: 0.4, f0: 190, f1: 90, sweep: 0.02, decay: 0.02 });
  for (let i = 0; i < 3; i++) addClick(b, r, r.range(0.04, 0.16), r.range(2500, 5000), 0.12, 0.004);
  return finish(b, 1.2);
};

const impactMetal: Renderer = (r) => {
  const b = buf(0.3);
  const f = r.range(700, 1100);
  addNoise(b, r, { dur: 0.02, amp: 1, type: 'hp', f0: 2500, decay: 0.003 });
  bell(b, 0, f, 0.6, 0.045, [
    [1, 1, 1],
    [1.59, 0.7, 0.8],
    [2.83, 0.5, 0.5],
    [4.1, 0.3, 0.3],
  ]);
  addTone(b, { dur: 0.08, amp: 0.5, f0: 160, f1: 90, sweep: 0.02, decay: 0.02 });
  return finish(b, 1.3);
};

// ───────────────────────────── vehicles ─────────────────────────────

const crashSmall: Renderer = (r) => {
  const b = buf(0.5);
  const v = r.range(0.85, 1.15);
  addTone(b, { dur: 0.3, amp: 1, f0: 115 * v, f1: 48, sweep: 0.03, decay: 0.06 });
  for (let i = 0; i < 4; i++) {
    addNoise(b, r, { at: r.range(0, 0.08), dur: 0.2, amp: r.range(0.6, 0.9), type: 'bp', f0: r.range(700, 1900), q: 0.9, decay: r.range(0.018, 0.04) });
  }
  for (const f of [523, 811, 1319]) addTone(b, { dur: 0.4, amp: 0.16, wave: 'tri', f0: f * v, decay: r.range(0.04, 0.09) });
  addNoise(b, r, { at: 0.04, dur: 0.25, amp: 0.2, type: 'hp', f0: 2600, decay: 0.05 });
  return finish(b, 1.6);
};

const crashBig: Renderer = (r) => {
  const b = buf(1.4);
  const v = r.range(0.88, 1.12);
  addTone(b, { dur: 0.8, amp: 1.2, f0: 88 * v, f1: 32, sweep: 0.06, decay: 0.16 });
  addNoise(b, r, { dur: 0.9, amp: 0.75, type: 'lp', f0: 3200, f1: 380, decay: 0.2 });
  for (let i = 0; i < 9; i++) {
    const at = Math.pow(r.next(), 1.6) * 0.36;
    addNoise(b, r, { at, dur: 0.3, amp: r.range(0.5, 0.95) * (1 - at), type: 'bp', f0: r.range(500, 2300), q: 0.9, decay: r.range(0.03, 0.08) });
  }
  addTone(b, { at: 0.03, dur: 0.6, amp: 0.22, wave: 'saw', f0: 190 * v, f1: 85, sweep: 0.2, decay: 0.16, vib: 17, vibDepth: 0.05 });
  for (let i = 0; i < 11; i++) {
    const at = r.range(0.22, 1.1);
    addClick(b, r, at, r.range(1800, 4600), 0.28 * (1.25 - at), r.range(0.006, 0.014), 3);
  }
  for (let i = 0; i < 5; i++) {
    addTone(b, { at: r.range(0.08, 0.7), dur: 0.2, amp: 0.1, f0: r.range(3000, 6500), decay: r.range(0.015, 0.04), fmRatio: 1.41, fmIndex: 1.2, fmDecay: 0.03 });
  }
  return finish(b, 2.1);
};

const glass: Renderer = (r) => {
  const b = buf(0.95);
  addNoise(b, r, { dur: 0.2, amp: 1, type: 'hp', f0: 3600, decay: 0.03 });
  addNoise(b, r, { dur: 0.35, amp: 0.6, type: 'bp', f0: 5600, q: 1.5, decay: 0.07 });
  addNoise(b, r, { dur: 0.1, amp: 0.4, type: 'lp', f0: 900, decay: 0.02 });
  for (let i = 0; i < 26; i++) {
    const at = 0.015 + Math.pow(r.next(), 1.5) * 0.72;
    const f = r.range(2200, 8600);
    const d = r.range(0.012, 0.05);
    addTone(b, { at, dur: d * 6, amp: 0.38 * (1 - at / 0.9), f0: f * 1.03, f1: f, sweep: 0.004, decay: d });
    if (i % 3 === 0) addClick(b, r, at, f * 0.8, 0.12, 0.003, 2);
  }
  return finish(b, 1.1);
};

const explosion: Renderer = (r) => {
  const b = buf(2.7);
  addNoise(b, r, { dur: 0.05, amp: 0.9, type: 'hp', f0: 1500, decay: 0.008 });
  addTone(b, { dur: 2.2, amp: 1.3, f0: 98, f1: 27, sweep: 0.18, decay: 0.48 });
  addNoise(b, r, { dur: 1.7, amp: 1, type: 'lp', f0: 6200, f1: 190, decay: 0.3 });
  addNoise(b, r, { at: 0.04, dur: 2.5, amp: 0.8, type: 'lp', f0: 170, decay: 0.85, brown: true });
  addNoise(b, r, { at: 0.2, dur: 1.4, amp: 0.25, type: 'bp', f0: 720, f1: 280, q: 0.7, attack: 0.15, decay: 0.45 });
  for (let i = 0; i < 44; i++) {
    const at = 0.12 + Math.pow(r.next(), 1.3) * 2.2;
    addClick(b, r, at, r.range(1400, 5200), 0.3 * (1 - at / 2.6), r.range(0.003, 0.011), 2);
  }
  return finish(b, 2.6);
};

function hornTone(b: Float32Array, freq: number, dur: number, attack: number, droop: number): void {
  const n = Math.floor(dur * SR);
  const tmp = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freq * (1 - droop * Math.exp(-t / 0.05));
    const dp = f / SR;
    p += dp;
    if (p >= 1) p -= 1;
    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / 0.05);
    tmp[i] = (0.65 * waveAt('saw', p, dp) + 0.35 * waveAt('square', p, dp)) * env;
  }
  mixInto(b, tmp);
}

const horn: Renderer = () => {
  const b = buf(0.5);
  hornTone(b, 418, 0.47, 0.012, 0.015);
  hornTone(b, 523, 0.47, 0.014, 0.015);
  const body = b.slice();
  filterBuf(b, 'bp', 1700, 0.8);
  mixInto(b, filterBuf(body, 'lp', 3800), 0, 0.5);
  return finish(b, 1.5);
};

const hornTruck: Renderer = () => {
  const b = buf(0.95);
  hornTone(b, 186, 0.9, 0.05, 0.07);
  hornTone(b, 234.5, 0.9, 0.06, 0.07);
  hornTone(b, 279, 0.9, 0.07, 0.07);
  const body = b.slice();
  filterBuf(b, 'bp', 900, 0.7);
  mixInto(b, filterBuf(body, 'lp', 2400), 0, 0.7);
  return finish(b, 1.8);
};

const doorOpen: Renderer = (r) => {
  const b = buf(0.36);
  addClick(b, r, 0, 1800, 0.8, 0.007, 3);
  addTone(b, { dur: 0.12, amp: 0.5, f0: 230, f1: 140, sweep: 0.02, decay: 0.028 });
  addNoise(b, r, { at: 0.03, dur: 0.2, amp: 0.3, type: 'lp', f0: 320, attack: 0.02, decay: 0.05 });
  addNoise(b, r, { at: 0.08, dur: 0.22, amp: 0.1, type: 'bp', f0: r.range(520, 760), q: 5, attack: 0.05, decay: 0.06 });
  return finish(b, 1.1);
};

const doorClose: Renderer = (r) => {
  const b = buf(0.42);
  addTone(b, { dur: 0.3, amp: 1, f0: 125, f1: 58, sweep: 0.03, decay: 0.058 });
  addNoise(b, r, { dur: 0.25, amp: 0.8, type: 'lp', f0: 1300, f1: 300, decay: 0.038 });
  addClick(b, r, 0.014, 2200, 0.5, 0.006, 3);
  addNoise(b, r, { at: 0.05, dur: 0.15, amp: 0.12, type: 'bp', f0: 3200, q: 1.5, decay: 0.022 });
  return finish(b, 1.5);
};

const engineStart: Renderer = (r) => {
  const b = buf(1.1);
  const n = Math.floor(0.56 * SR);
  const crank = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const dp = (92 + 10 * Math.sin(TAU * 7.6 * t)) / SR;
    p += dp;
    if (p >= 1) p -= 1;
    const chug = Math.pow(Math.abs(Math.sin(Math.PI * 7.6 * t)), 1.6);
    crank[i] = (waveAt('saw', p, dp) * 0.7 + (r.next() * 2 - 1) * 0.5) * (0.25 + 0.75 * chug) * Math.min(1, t / 0.03);
  }
  filterBuf(crank, 'lp', 1100, 1.2);
  mixInto(b, crank, 0, 0.7);
  addTone(b, { at: 0.55, dur: 0.5, amp: 0.8, f0: 84, f1: 56, sweep: 0.08, decay: 0.11 });
  addNoise(b, r, { at: 0.55, dur: 0.5, amp: 0.5, type: 'lp', f0: 800, f1: 300, decay: 0.13 });
  return finish(b, 1.4);
};

const skid: Renderer = (r) => {
  const n = Math.floor(0.62 * SR);
  const b = new Float32Array(n);
  const fa = new Svf();
  const fb = new Svf();
  const base = r.range(1250, 1550);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 31) === 0) {
      const wob = 1 + 0.06 * Math.sin(TAU * 5.3 * t) + 0.03 * Math.sin(TAU * 13 * t);
      fa.set(base * wob, 9);
      fb.set(base * 1.37 * wob, 8);
    }
    const x = r.next() * 2 - 1;
    fa.tick(x);
    fb.tick(x);
    b[i] = (fa.band + 0.6 * fb.band) * ahd(t, 0.03, 0.32, 0.09);
  }
  return finish(b, 1.3);
};

const siren: Renderer = () => {
  const dur = 1.8;
  const n = Math.floor(dur * SR);
  const b = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const cyc = (t / 0.9) % 1;
    const up = cyc < 0.6 ? cyc / 0.6 : 1 - (cyc - 0.6) / 0.4;
    const f = 650 + 800 * up * up * (3 - 2 * up);
    const dp = f / SR;
    p += dp;
    if (p >= 1) p -= 1;
    b[i] = (0.6 * waveAt('saw', p, dp) + 0.4 * waveAt('square', p, dp)) * Math.min(1, t / 0.04) * Math.min(1, (dur - t) / 0.12);
  }
  filterBuf(b, 'bp', 1500, 0.8);
  return finish(b, 1.4);
};

const backfire: Renderer = (r) => {
  const b = buf(0.3);
  addNoise(b, r, { dur: 0.2, amp: 1, type: 'lp', f0: 2200, f1: 400, decay: 0.03 });
  addTone(b, { dur: 0.2, amp: 0.9, f0: 170, f1: 70, sweep: 0.02, decay: 0.04 });
  if (r.chance(0.5)) addNoise(b, r, { at: r.range(0.07, 0.11), dur: 0.15, amp: 0.5, type: 'lp', f0: 1600, f1: 400, decay: 0.025 });
  return finish(b, 1.8);
};

/** A distant car going past: a noise swell with a falling band. */
const carPass: Renderer = (r) => {
  const dur = r.range(2.4, 3.4);
  const n = Math.floor(dur * SR);
  const b = new Float32Array(n);
  const f = new Svf();
  const low = new Svf().set(160, 0.8);
  const top = r.range(700, 1100);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 63) === 0) f.set(top * (1.25 - 0.55 * u), 0.6);
    const x = r.next() * 2 - 1;
    f.tick(x);
    low.tick(x);
    const env = Math.pow(Math.sin(Math.PI * u), 2.2);
    b[i] = (f.bandN * 1.6 + low.low * 2.2) * env;
  }
  return finish(b);
};

// ───────────────────────────── interface & stingers ─────────────────────────────

const pickup: Renderer = () => {
  const b = buf(0.4);
  addTone(b, { dur: 0.3, amp: 0.8, f0: 1318.5, decay: 0.06, fmRatio: 2, fmIndex: 0.8, fmDecay: 0.05 });
  addTone(b, { at: 0.075, dur: 0.32, amp: 1, f0: 1975.5, decay: 0.1, fmRatio: 2, fmIndex: 0.8, fmDecay: 0.06 });
  return finish(b);
};

const cash: Renderer = (r) => {
  const b = buf(0.6);
  addClick(b, r, 0, 2500, 0.6, 0.008);
  addTone(b, { dur: 0.06, amp: 0.3, f0: 320, f1: 220, decay: 0.015 });
  bell(b, 0.06, 2150, 0.9, 0.16, [
    [1, 1, 1],
    [1.5, 0.45, 0.7],
    [2.76, 0.3, 0.4],
  ]);
  for (let i = 0; i < 6; i++) {
    const at = r.range(0.1, 0.36);
    addTone(b, { at, dur: 0.12, amp: 0.2, f0: r.range(4200, 7200), decay: r.range(0.012, 0.03), fmRatio: 1.41, fmIndex: 1, fmDecay: 0.02 });
  }
  return finish(b);
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const missionPass: Renderer = (r) => {
  const b = buf(2.4);
  addTone(b, { dur: 0.6, amp: 0.7, f0: 147, f1: 73.4, sweep: 0.03, decay: 0.2 });
  // Rising broken chord, a lift to the subdominant, home again.
  [62, 66, 69, 74].forEach((m, i) => brass(b, i * 0.1, 0.13, hz(m), 0.55, 2600));
  for (const m of [67, 71, 74, 79]) brass(b, 0.52, 0.34, hz(m), 0.3, 2400);
  for (const m of [62, 69, 74, 78, 81]) brass(b, 0.94, 0.9, hz(m), 0.3, 3000);
  addTone(b, { at: 0.94, dur: 1.4, amp: 0.35, f0: hz(86), decay: 0.35, fmRatio: 3.5, fmIndex: 1.2, fmDecay: 0.2 });
  addTone(b, { at: 1.06, dur: 1.3, amp: 0.3, f0: hz(93), decay: 0.4, fmRatio: 3.5, fmIndex: 1, fmDecay: 0.2 });
  addNoise(b, r, { at: 0.94, dur: 1.2, amp: 0.18, type: 'hp', f0: 6000, decay: 0.3 });
  return finish(b, 1.2);
};

const missionFail: Renderer = (r) => {
  const b = buf(2);
  addTone(b, { dur: 0.7, amp: 0.9, f0: 110, f1: 52, sweep: 0.06, decay: 0.22 });
  addNoise(b, r, { dur: 0.4, amp: 0.4, type: 'lp', f0: 500, decay: 0.08 });
  const tmp = buf(1.9);
  const notes: [number, number, number][] = [
    [0.08, 0.42, 64],
    [0.5, 1.2, 58],
  ];
  for (const [at, dur, m] of notes) {
    for (const det of [0.994, 1.006]) {
      addTone(tmp, { at, dur: dur + 0.2, amp: 0.5, wave: 'saw', f0: hz(m) * det, f1: hz(m) * det * 0.972, sweep: dur * 0.9, attack: 0.03, hold: dur * 0.5, decay: dur * 0.3 });
      addTone(tmp, { at, dur: dur + 0.2, amp: 0.35, wave: 'saw', f0: hz(m - 12) * det, f1: hz(m - 12) * det * 0.972, sweep: dur * 0.9, attack: 0.03, hold: dur * 0.5, decay: dur * 0.3 });
    }
  }
  filterBuf(tmp, 'lp', 950, 1);
  mixInto(b, tmp, 0, 1);
  return finish(b, 1.2);
};

const uiMove: Renderer = (r) => {
  const b = buf(0.07);
  addTone(b, { dur: 0.06, amp: 0.7, f0: 900, f1: 680, sweep: 0.01, decay: 0.012 });
  addNoise(b, r, { dur: 0.01, amp: 0.2, type: 'hp', f0: 4000, decay: 0.002 });
  return finish(b);
};

const uiSelect: Renderer = () => {
  const b = buf(0.2);
  addTone(b, { dur: 0.08, amp: 0.7, wave: 'tri', f0: 660, decay: 0.03 });
  addTone(b, { at: 0.055, dur: 0.14, amp: 0.8, wave: 'tri', f0: 990, decay: 0.04 });
  addTone(b, { at: 0.055, dur: 0.14, amp: 0.25, f0: 1980, decay: 0.03 });
  return finish(b);
};

/** Police-band squelch and two rising tones. */
const wantedUp: Renderer = (r) => {
  const b = buf(0.7);
  addNoise(b, r, { dur: 0.09, amp: 0.5, type: 'bp', f0: 2200, q: 1, attack: 0.005, hold: 0.05, decay: 0.01 });
  addTone(b, { at: 0.1, dur: 0.16, amp: 0.6, wave: 'square', f0: 740, attack: 0.005, hold: 0.1, decay: 0.012 });
  addTone(b, { at: 0.27, dur: 0.3, amp: 0.6, wave: 'square', f0: 988, attack: 0.005, hold: 0.16, decay: 0.03 });
  addNoise(b, r, { at: 0.5, dur: 0.12, amp: 0.3, type: 'bp', f0: 2600, q: 1, attack: 0.004, hold: 0.04, decay: 0.02 });
  filterBuf(b, 'bp', 1500, 0.6);
  return finish(b, 1.3);
};

const wantedClear: Renderer = () => {
  const b = buf(0.9);
  addTone(b, { dur: 0.3, amp: 0.6, wave: 'tri', f0: 784, decay: 0.09 });
  addTone(b, { at: 0.14, dur: 0.4, amp: 0.6, wave: 'tri', f0: 659.3, decay: 0.12 });
  addTone(b, { at: 0.28, dur: 0.6, amp: 0.7, wave: 'tri', f0: 523.3, decay: 0.2 });
  return finish(b);
};

/** Tuning between stations: band-passed hash, crackle and a heterodyne whistle. */
const staticBurst: Renderer = (r) => {
  const dur = 0.5;
  const b = buf(dur);
  addNoise(b, r, { dur, amp: 0.8, type: 'bp', f0: r.range(700, 1200), f1: r.range(2600, 4200), q: 1.1, attack: 0.02, hold: 0.3, decay: 0.05 });
  for (let i = 0; i < 14; i++) addClick(b, r, r.range(0, 0.42), r.range(1500, 5000), r.range(0.2, 0.6), 0.002, 1.5);
  const f = r.range(1800, 3200);
  addTone(b, { dur, amp: 0.14, f0: f, f1: f * r.range(0.2, 0.5), sweep: 0.15, attack: 0.02, hold: 0.2, decay: 0.08 });
  addTone(b, { at: 0.15, dur: 0.3, amp: 0.1, f0: r.range(500, 900), f1: r.range(1500, 2500), sweep: 0.1, attack: 0.02, hold: 0.1, decay: 0.06 });
  return finish(b, 1.4);
};

const radioOff: Renderer = (r) => {
  const b = buf(0.1);
  addClick(b, r, 0, 1400, 0.8, 0.006, 2);
  addTone(b, { dur: 0.08, amp: 0.6, f0: 140, f1: 70, sweep: 0.015, decay: 0.02 });
  return finish(b);
};

// ───────────────────────────── foley ─────────────────────────────

export type FootSurface = 'hard' | 'gravel' | 'grass' | 'sand' | 'wet';

const footstep: Record<FootSurface, Renderer> = {
  hard(r) {
    const b = buf(0.14);
    const v = r.range(0.85, 1.15);
    addNoise(b, r, { dur: 0.06, amp: 1, type: 'lp', f0: 750 * v, f1: 250, decay: 0.011 });
    addTone(b, { dur: 0.06, amp: 0.5, f0: 165 * v, f1: 90, sweep: 0.012, decay: 0.014 });
    addNoise(b, r, { at: 0.034, dur: 0.07, amp: 0.3, type: 'bp', f0: 2300 * v, q: 0.8, attack: 0.004, decay: 0.012 });
    return finish(b, 1.1);
  },
  gravel(r) {
    const b = buf(0.24);
    addNoise(b, r, { dur: 0.1, amp: 0.45, type: 'lp', f0: 320, decay: 0.02 });
    const grains = r.int(6, 9);
    for (let i = 0; i < grains; i++) addClick(b, r, r.range(0, 0.13), r.range(1500, 4600), r.range(0.4, 0.95), r.range(0.004, 0.012), 1.3);
    addNoise(b, r, { dur: 0.2, amp: 0.25, type: 'bp', f0: 2800, q: 0.6, attack: 0.01, decay: 0.045 });
    return finish(b, 1.2);
  },
  grass(r) {
    const b = buf(0.22);
    addNoise(b, r, { dur: 0.2, amp: 0.7, type: 'bp', f0: r.range(750, 1050), q: 0.6, attack: 0.012, decay: 0.035 });
    addNoise(b, r, { dur: 0.2, amp: 0.25, type: 'hp', f0: 3000, attack: 0.018, decay: 0.03 });
    addTone(b, { dur: 0.08, amp: 0.3, f0: 115, f1: 70, sweep: 0.015, decay: 0.018 });
    return finish(b);
  },
  sand(r) {
    const b = buf(0.27);
    addNoise(b, r, { dur: 0.26, amp: 0.8, type: 'lp', f0: r.range(1600, 2100), f1: 600, attack: 0.02, decay: 0.055 });
    addNoise(b, r, { dur: 0.2, amp: 0.2, type: 'hp', f0: 4000, attack: 0.03, decay: 0.03 });
    return finish(b);
  },
  wet(r) {
    const b = buf(0.34);
    addNoise(b, r, { dur: 0.3, amp: 0.8, type: 'bp', f0: 1300, f1: 500, q: 1, attack: 0.008, decay: 0.065 });
    for (let i = 0; i < 3; i++) {
      const f = r.range(380, 620);
      addTone(b, { at: r.range(0.03, 0.2), dur: 0.035, amp: 0.25, f0: f, f1: f * 2.2, sweep: 0.03, decay: 0.012 });
    }
    return finish(b);
  },
};

const splash: Renderer = (r) => {
  const b = buf(1.25);
  addNoise(b, r, { dur: 0.7, amp: 1, type: 'lp', f0: 3600, f1: 600, attack: 0.004, decay: 0.12 });
  addTone(b, { dur: 0.3, amp: 0.6, f0: 92, f1: 45, sweep: 0.04, decay: 0.08 });
  addNoise(b, r, { at: 0.05, dur: 1.1, amp: 0.4, type: 'bp', f0: 3400, f1: 1700, q: 0.5, attack: 0.08, decay: 0.3 });
  for (let i = 0; i < 16; i++) {
    const f = r.range(550, 1100);
    addTone(b, { at: r.range(0.22, 1.05), dur: 0.04, amp: 0.16, f0: f, f1: f * 2.1, sweep: 0.03, decay: 0.014 });
  }
  return finish(b, 1.2);
};

const tramBell: Renderer = () => {
  const b = buf(1.3);
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.76, 0.5, 0.6],
    [5.4, 0.25, 0.3],
    [8.93, 0.1, 0.16],
  ];
  for (const at of [0, 0.29]) {
    bell(b, at, 1175, 0.8, 0.16, partials);
    addTone(b, { at, dur: 0.03, amp: 0.3, f0: 3400, decay: 0.004 });
  }
  return finish(b);
};

// ───────────────────────────── creatures ─────────────────────────────

const sheep: Renderer = (r) => {
  const lamb = r.chance(0.25);
  const f = (lamb ? 1.7 : 1) * r.range(175, 290);
  const dur = r.range(0.55, 0.85) * (lamb ? 0.7 : 1);
  const trem = r.range(8, 12);
  const out = voiced(
    r,
    dur,
    (u, t) => f * (1 + 0.07 * Math.sin(Math.PI * u) - 0.06 * u) * (1 + 0.035 * Math.sin(TAU * trem * t)),
    [
      [820, 5, 1],
      [1500, 6, 0.7],
      [2700, 7, 0.35],
      [330, 2, 0.25],
    ],
    { breath: 0.3, attack: 0.05, release: 0.16, tremRate: trem, tremDepth: 0.4 },
  );
  return finish(out, 1.2);
};

const scream: Renderer = (r) => {
  // A sharp rise into a strained, wavering "aah" that sags as the breath goes. Rendered mid-range: playback
  // pitches it up for women and down for men.
  const f = r.range(430, 620);
  const dur = r.range(0.6, 1.05);
  const vib = r.range(5.5, 7.5);
  const depth = r.range(0.018, 0.035);
  const peakAt = r.range(0.08, 0.16);
  const flutter = wander(r, dur, 18, 0.03);
  const out = voiced(
    r,
    dur,
    (u, t) => {
      const rise = Math.min(1, u / peakAt);
      const contour = 0.72 + 0.28 * rise * rise * (3 - 2 * rise) + 0.06 * Math.sin(Math.PI * u) - (0.22 * Math.max(0, u - 0.7)) / 0.3;
      return f * contour * (1 + depth * Math.min(1, t / 0.2) * Math.sin(TAU * vib * t)) * (1 + flutter(t));
    },
    [
      [r.range(880, 1050), 4, 1],
      [r.range(1350, 1650), 5, 0.75],
      [r.range(2700, 3100), 7, 0.35],
      [r.range(3600, 4100), 9, 0.15],
    ],
    { breath: 0.35, attack: 0.02, release: 0.22, tremRate: vib, tremDepth: 0.12 },
  );
  return finish(out, 1.6);
};

/** Hurt: a sharp "agh!" that drops away, sometimes with a ragged breath in after it. */
const pain: Renderer = (r) => {
  const f = r.range(230, 320);
  const dur = r.range(0.2, 0.4);
  const b = buf(dur + 0.3);
  const cry = voiced(
    r,
    dur,
    (u) => f * (1.18 - 0.38 * u) * (1 + 0.05 * Math.sin(Math.PI * Math.min(1, u * 3))),
    [
      [r.range(650, 800), 4, 1],
      [r.range(1050, 1300), 5, 0.6],
      [r.range(2400, 2800), 6, 0.25],
    ],
    { breath: 0.45, attack: 0.008, release: 0.09 },
  );
  // The catch of breath it starts on.
  addNoise(b, r, { dur: 0.05, amp: 0.25, type: 'bp', f0: 1800, q: 1.2, decay: 0.015 });
  mixInto(b, cry, 0.01);
  if (r.chance(0.4)) addNoise(b, r, { at: dur + 0.06, dur: 0.18, amp: 0.12, type: 'bp', f0: 1400, q: 0.9, attack: 0.05, decay: 0.05 });
  return finish(b, 1.4);
};

/** The last sound someone makes: a gasp, then a groan that sags in pitch and breaks up. */
const deathCry: Renderer = (r) => {
  const f = r.range(190, 260);
  const dur = r.range(0.55, 0.9);
  const gurgle = r.range(9, 15);
  const b = buf(dur + 0.12);
  addNoise(b, r, { dur: 0.08, amp: 0.3, type: 'bp', f0: 1500, f1: 900, q: 1, attack: 0.01, decay: 0.03 });
  const groan = voiced(
    r,
    dur,
    (u, t) => f * (1.1 - 0.42 * u) * (1 + 0.04 * Math.sin(TAU * gurgle * 0.5 * t)),
    [
      [r.range(600, 760), 4, 1],
      [r.range(1000, 1250), 5, 0.55],
      [r.range(2300, 2700), 6, 0.2],
    ],
    { breath: 0.55, attack: 0.04, release: 0.3, tremRate: gurgle, tremDepth: 0.45 },
  );
  mixInto(b, groan, 0.06);
  return finish(b, 1.5);
};

/** Wheels going over a body: a heavy thud up through the car, a wet give, and bone cracking. */
const crunch: Renderer = (r) => {
  const b = buf(0.45);
  const v = r.range(0.9, 1.1);
  addTone(b, { dur: 0.32, amp: 1, f0: 82 * v, f1: 36, sweep: 0.05, decay: 0.08 });
  addNoise(b, r, { dur: 0.22, amp: 0.7, type: 'bp', f0: 340 * v, q: 1.1, decay: 0.05 });
  addNoise(b, r, { at: 0.01, dur: 0.16, amp: 0.4, type: 'bp', f0: 1100 * v, f1: 420, q: 2.2, decay: 0.04 });
  const cracks = r.int(3, 6);
  let at = r.range(0.004, 0.02);
  for (let i = 0; i < cracks; i++) {
    addClick(b, r, at, r.range(1800, 3400), r.range(0.35, 0.7), r.range(0.002, 0.004), 2);
    at += r.range(0.008, 0.03);
  }
  return finish(b, 1.6);
};

const gull: Renderer = (r) => {
  const b = buf(1.9);
  const calls = r.int(3, 6);
  let at = 0.02;
  const f = r.range(1150, 1500);
  for (let i = 0; i < calls && at < 1.5; i++) {
    const dur = r.range(0.17, 0.3) * (i === 0 ? 1.4 : 1);
    const cry = voiced(
      r,
      dur,
      (u) => f * (0.82 + 0.4 * Math.sin(Math.PI * Math.pow(u, 0.5)) - 0.2 * u),
      [
        [2100, 4, 1],
        [3200, 5, 0.6],
        [1200, 3, 0.3],
      ],
      { breath: 0.2, attack: 0.02, release: 0.07 },
    );
    mixInto(b, cry, at, 1 - i * 0.08);
    at += dur + r.range(0.03, 0.09);
  }
  return finish(b);
};

/** The warbling carol of the paddock magpie: gurgling, flute-like syllables leaping between two registers. */
const magpie: Renderer = (r) => {
  const b = buf(2.7);
  const n = r.int(9, 13);
  let t = 0.02;
  let hi = r.chance(0.5);
  for (let i = 0; i < n && t < 2.35; i++) {
    const dur = hi ? r.range(0.07, 0.14) : r.range(0.12, 0.24);
    const base = hi ? r.range(1250, 1900) : r.range(560, 900);
    const fa = base * r.range(0.8, 1);
    const fb = base * r.range(1.05, 1.45);
    const up = r.chance(hi ? 0.7 : 0.45);
    const from = up ? fa : fb;
    const to = up ? fb : fa;
    warble(b, t, dur, from, to, hi ? 0.55 : 0.9, r.chance(0.45) ? r.range(24, 38) : 0);
    if (r.chance(0.35)) warble(b, t + 0.01, dur * 0.8, from * 1.5, to * 1.34, 0.22);
    t += dur + (r.chance(0.2) ? r.range(0.08, 0.2) : r.range(0, 0.03));
    if (r.chance(0.75)) hi = !hi;
  }
  filterBuf(b, 'lp', 5200);
  return finish(b);
};

/** Bellbird-ish chimes: a handful of pure, liquid notes. */
const bellbird: Renderer = (r) => {
  const b = buf(1.5);
  const pitches = [1480, 1760, 1975, 2350, 2640];
  const n = r.int(3, 6);
  let t = 0.01;
  let idx = r.int(0, pitches.length - 1);
  for (let i = 0; i < n && t < 1.25; i++) {
    const f = pitches[idx] * r.range(0.99, 1.01);
    const d = r.range(0.07, 0.16);
    addTone(b, { at: t, dur: d * 3.5, amp: 0.9, f0: f * 0.97, f1: f, sweep: 0.008, attack: 0.006, decay: d * 0.55 });
    addTone(b, { at: t, dur: d * 2, amp: 0.16, f0: f * 2, attack: 0.006, decay: d * 0.3 });
    if (r.chance(0.25)) addTone(b, { at: t + d * 0.9, dur: 0.05, amp: 0.4, f0: 920, f1: 780, sweep: 0.02, decay: 0.012 });
    t += d + r.range(0.03, 0.2);
    idx = Math.max(0, Math.min(pitches.length - 1, idx + r.pick([-2, -1, -1, 1, 1, 2, 3])));
  }
  return finish(b);
};

const chirp: Renderer = (r) => {
  const b = buf(0.9);
  const n = r.int(2, 6);
  let t = 0.01;
  for (let i = 0; i < n && t < 0.8; i++) {
    const f = r.range(3300, 4600);
    warble(b, t, r.range(0.035, 0.06), f, f * r.range(1.15, 1.4), 0.8);
    t += r.range(0.09, 0.16);
  }
  return finish(b);
};

/** Ruru: two soft hoots after dark. */
const morepork: Renderer = (r) => {
  const b = buf(0.85);
  const f = r.range(820, 930);
  warble(b, 0.02, 0.2, f * 0.96, f, 0.9);
  warble(b, 0.32, 0.27, f * 0.86, f * 0.8, 1);
  addNoise(b, r, { at: 0.02, dur: 0.6, amp: 0.04, type: 'bp', f0: f, q: 2, attack: 0.05, hold: 0.4, decay: 0.05 });
  filterBuf(b, 'lp', 2400);
  return finish(b);
};

// ───────────────────────────── loops for continuous layers ─────────────────────────────

/** Adds `fn` over n samples starting at `start`, wrapping around the end so the loop is seamless. */
function addWrapped(out: Float32Array, start: number, n: number, fn: (i: number) => number): void {
  const len = out.length;
  for (let i = 0; i < n; i++) {
    let j = (start + i) % len;
    if (j < 0) j += len;
    out[j] += fn(i);
  }
}

/** Night crickets: three insects with commensurate periods so the bed loops cleanly. */
export function renderCrickets(): Float32Array {
  const dur = 2.4;
  const b = buf(dur);
  const insects: [number, number, number, number][] = [
    [4600, 0.6, 0.0, 1],
    [4150, 0.4, 0.13, 0.55],
    [5100, 0.8, 0.31, 0.4],
  ];
  for (const [f, period, phase, amp] of insects) {
    for (let t = phase; t < dur - 0.08; t += period) {
      for (let k = 0; k < 3; k++) addTone(b, { at: t + k * 0.019, dur: 0.016, amp, f0: f, attack: 0.003, hold: 0.006, decay: 0.002 });
    }
  }
  return normalize(b, 0.8);
}

/** Tyres on loose metal: a dense bed of little stones. */
export function renderGravelLoop(r: Rng): Float32Array {
  const b = buf(1.6);
  const len = b.length;
  for (let g = 0; g < 190; g++) {
    const start = Math.floor(r.next() * len);
    const n = Math.floor(r.range(0.004, 0.02) * SR);
    const f = new Svf().set(r.range(1200, 5200), r.range(1, 2.5));
    const amp = Math.pow(r.next(), 2) * 0.9 + 0.1;
    addWrapped(b, start, n, (i) => {
      f.tick(r.next() * 2 - 1);
      return f.bandN * amp * Math.exp((-5 * i) / n) * 3;
    });
  }
  // Low rumble: filter a periodic noise lap twice so the filter state matches at the seam.
  const low = new Svf().set(240, 0.7);
  const lap = new Float32Array(len);
  for (let i = 0; i < len; i++) lap[i] = r.next() * 2 - 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < len; i++) {
      low.tick(lap[i]);
      if (pass === 1) b[i] += low.low * 1.6;
    }
  }
  return normalize(b, 0.85);
}

/** Rain patter: thousands of tiny drops plus a few fat ones. */
export function renderRainLoop(r: Rng): Float32Array {
  const b = buf(2.2);
  const len = b.length;
  for (let g = 0; g < 900; g++) {
    const start = Math.floor(r.next() * len);
    const fat = r.chance(0.04);
    const n = Math.floor((fat ? 0.012 : 0.003) * SR);
    const f = new Svf().set(fat ? r.range(700, 1500) : r.range(2500, 7000), fat ? 2 : 1.2);
    const amp = (fat ? 0.9 : 0.35) * (0.3 + r.next());
    addWrapped(b, start, n, (i) => {
      f.tick(i < 6 ? r.next() * 2 - 1 : 0);
      return f.bandN * amp * 4;
    });
  }
  return normalize(b, 0.8);
}

export type EngineKind = 'four' | 'six' | 'v6' | 'v8' | 'boxer' | 'turbo' | 'diesel' | 'bike' | 'single';

interface EngineVoice {
  cylinders: number;
  /** Exhaust resonance (Hz) and pulse decay (s) for the [low, high] rpm loops. */
  res: [number, number];
  tau: [number, number];
  noise: [number, number];
  /** Per-cylinder loudness and timing offsets (fraction of the firing interval): uneven = lumpy. */
  amps: number[];
  offsets: number[];
  knock: number;
}

const ENGINES: Record<EngineKind, EngineVoice> = {
  four: { cylinders: 4, res: [150, 270], tau: [0.009, 0.004], noise: [0.22, 0.4], amps: [1, 0.92, 0.97, 0.9], offsets: [0, 0.01, 0, -0.01], knock: 0 },
  six: { cylinders: 6, res: [125, 235], tau: [0.01, 0.0045], noise: [0.18, 0.34], amps: [1, 0.95, 0.98, 0.94, 1, 0.96], offsets: [0, 0, 0, 0, 0, 0], knock: 0 },
  v8: { cylinders: 8, res: [88, 172], tau: [0.014, 0.006], noise: [0.24, 0.4], amps: [1, 0.58, 0.95, 0.52, 1, 0.62, 0.88, 0.5], offsets: [0, 0.08, 0, -0.06, 0, 0.07, 0, -0.05], knock: 0 },
  diesel: { cylinders: 4, res: [96, 165], tau: [0.012, 0.007], noise: [0.3, 0.45], amps: [1, 0.85, 0.95, 0.8], offsets: [0, 0.02, 0, -0.02], knock: 0.55 },
  bike: { cylinders: 2, res: [185, 345], tau: [0.007, 0.003], noise: [0.34, 0.5], amps: [1, 0.8], offsets: [0, -0.14], knock: 0 },
  // Between the six and the v8: a 60-degree V6 fires evenly but breathes through shared manifolds, so
  // adjacent pulses lean on each other a little.
  v6: { cylinders: 6, res: [105, 200], tau: [0.011, 0.005], noise: [0.2, 0.36], amps: [1, 0.88, 0.97, 0.86, 0.99, 0.9], offsets: [0, 0.03, 0, -0.03, 0, 0.03], knock: 0 },
  // Flat four with unequal exhaust header lengths: the classic offbeat thrum.
  boxer: { cylinders: 4, res: [118, 225], tau: [0.011, 0.005], noise: [0.24, 0.4], amps: [1, 0.68, 0.96, 0.66], offsets: [0, 0.11, 0, 0.1], knock: 0 },
  // Turbocharged four: the turbine soaks the pulse energy, so the note is softer and hissier; the live
  // graph adds the spool whine on top.
  turbo: { cylinders: 4, res: [135, 240], tau: [0.007, 0.0035], noise: [0.34, 0.52], amps: [1, 0.93, 0.97, 0.91], offsets: [0, 0.01, 0, -0.01], knock: 0 },
  // One big cylinder: a fat thump every second revolution and silence in between.
  single: { cylinders: 1, res: [150, 290], tau: [0.02, 0.009], noise: [0.3, 0.45], amps: [1], offsets: [0], knock: 0 },
};

/** RPM each loop is rendered at; playbackRate = rpm / base. */
export const ENGINE_BASE_RPM: [number, number] = [1000, 4000];

/**
 * A few engine cycles of exhaust pulses as a seamless loop. band 0 = low-rpm loop, 1 = high-rpm loop;
 * the live engine cross-fades between them and bends both with playbackRate.
 */
export function renderEngineLoop(kind: EngineKind, band: 0 | 1, r: Rng): Float32Array {
  const e = ENGINES[kind];
  const rpm = ENGINE_BASE_RPM[band];
  const cycle = (2 * 60) / rpm; // four-stroke: two revolutions
  const cycles = band === 0 ? 4 : 12;
  const len = Math.round(cycles * cycle * SR);
  const b = new Float32Array(len);
  const interval = (cycle * SR) / e.cylinders;
  const res = e.res[band];
  const tau = e.tau[band] * SR;
  const pulseLen = Math.floor(tau * 7);
  const noiseAmt = e.noise[band];
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < e.cylinders; k++) {
      const start = Math.round((c * e.cylinders + k + e.offsets[k] + r.range(-0.012, 0.012)) * interval);
      const amp = e.amps[k] * r.range(0.94, 1.06);
      const w = (TAU * res * r.range(0.97, 1.03)) / SR;
      const w2 = w * 2.13;
      const nf = new Svf().set(res * 4.5, 0.8);
      addWrapped(b, start, pulseLen, (i) => {
        const env = Math.exp(-i / tau);
        nf.tick(r.next() * 2 - 1);
        return amp * env * (Math.sin(w * i) + 0.35 * Math.sin(w2 * i) + noiseAmt * nf.bandN * 2);
      });
      if (e.knock) {
        const kf = new Svf().set(r.range(2100, 2900), 2);
        const kn = Math.floor(0.004 * SR);
        addWrapped(b, start, kn, (i) => {
          kf.tick(r.next() * 2 - 1);
          return e.knock * amp * kf.bandN * 3 * Math.exp((-4 * i) / kn);
        });
      }
    }
  }
  return normalize(b, 0.85);
}

// ───────────────────────────── registry ─────────────────────────────

export const RENDERERS = {
  pistol,
  shotgun,
  smg,
  rifle,
  punch,
  reload,
  empty,
  ricochet,
  bodyHit,
  crashSmall,
  crashBig,
  glass,
  explosion,
  horn,
  hornTruck,
  doorOpen,
  doorClose,
  engineStart,
  skid,
  siren,
  pickup,
  cash,
  missionPass,
  missionFail,
  uiMove,
  uiSelect,
  footstep: footstep.hard,
  splash,
  tramBell,
  sheep,
  magpie,
  scream,
  // Internal extras (not part of the public SfxId list).
  slash,
  pain,
  deathCry,
  crunch,
  footGravel: footstep.gravel,
  footGrass: footstep.grass,
  footSand: footstep.sand,
  footWet: footstep.wet,
  impactWorld,
  impactMetal,
  backfire,
  carPass,
  wantedUp,
  wantedClear,
  static: staticBurst,
  radioOff,
  gull,
  bellbird,
  chirp,
  morepork,
} satisfies Record<string, Renderer>;

export type SoundId = keyof typeof RENDERERS;

/** Shared with the test-suite: trims trailing silence from the tail of a one-shot. */
export function trimTail(b: Float32Array, floor = 0.0008): Float32Array {
  let end = b.length;
  while (end > 1 && Math.abs(b[end - 1]) < floor) end--;
  const out = b.slice(0, Math.min(b.length, end + 64));
  return fadeEdges(out, 0, 0.004);
}
