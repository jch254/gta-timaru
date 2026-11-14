/**
 * Offline DSP toolkit: everything here is pure maths on Float32Arrays so it runs (and is unit-tested) without WebAudio.
 * One-shot sound effects, drum hits, plucked strings and engine loops are rendered with these helpers once, cached
 * as AudioBuffers and then played back with a single source node per voice.
 */
import type { Rng } from '../core/rng';

/** Sample rate used for rendered one-shots. */
export const SR = 44100;
const TAU = Math.PI * 2;

export function buf(seconds: number, sr = SR): Float32Array {
  return new Float32Array(Math.max(1, Math.ceil(seconds * sr)));
}

/** Zero-delay-feedback state variable filter (stable under fast cutoff sweeps). */
export class Svf {
  low = 0;
  band = 0;
  high = 0;
  /** Band-pass with unity gain at the centre frequency. */
  bandN = 0;
  private s1 = 0;
  private s2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;

  constructor(private sr = SR) {}

  set(fc: number, q = 0.707): this {
    const f = fc < 10 ? 10 : fc > this.sr * 0.45 ? this.sr * 0.45 : fc;
    const g = Math.tan((Math.PI * f) / this.sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }

  tick(x: number): void {
    const v3 = x - this.s2;
    const v1 = this.a1 * this.s1 + this.a2 * v3;
    const v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1;
    this.s2 = 2 * v2 - this.s2;
    this.low = v2;
    this.band = v1;
    this.bandN = v1 * this.k;
    this.high = x - this.k * v1 - v2;
  }
}

export type Wave = 'sine' | 'tri' | 'saw' | 'square';

function polyBlep(p: number, dp: number): number {
  if (p < dp) {
    const t = p / dp;
    return t + t - t * t - 1;
  }
  if (p > 1 - dp) {
    const t = (p - 1) / dp;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Band-limited-ish oscillator sample for phase p (0..1) advancing dp per sample. */
export function waveAt(wave: Wave, p: number, dp: number): number {
  switch (wave) {
    case 'sine':
      return Math.sin(TAU * p);
    case 'tri':
      return 1 - 4 * Math.abs(p - 0.5);
    case 'saw':
      return 2 * p - 1 - polyBlep(p, dp);
    default: {
      const q = p + 0.5;
      return (p < 0.5 ? 1 : -1) + polyBlep(p, dp) - polyBlep(q >= 1 ? q - 1 : q, dp);
    }
  }
}

/** Attack ramp, optional hold, exponential decay with time constant `decay`. */
export function ahd(t: number, attack: number, hold: number, decay: number): number {
  if (t < attack) return t / attack;
  const u = t - attack - hold;
  return u <= 0 ? 1 : Math.exp(-u / decay);
}

export interface NoiseSpec {
  at?: number;
  dur: number;
  amp: number;
  type?: 'lp' | 'bp' | 'hp' | 'none';
  /** Filter frequency, swept exponentially from f0 to f1 over `dur`. */
  f0?: number;
  f1?: number;
  q?: number;
  attack?: number;
  hold?: number;
  decay: number;
  brown?: boolean;
}

/**
 * Adds an enveloped, filtered noise burst. The level is compensated for the filter's bandwidth so `amp` is
 * roughly the RMS-equivalent loudness whatever the filter (a narrow band-pass is not ten times quieter).
 */
export function addNoise(out: Float32Array, rng: Rng, s: NoiseSpec, sr = SR): void {
  const start = Math.floor((s.at ?? 0) * sr);
  const n = Math.min(out.length - start, Math.floor(s.dur * sr));
  if (n <= 0) return;
  const type = s.type ?? 'none';
  const f0 = s.f0 ?? 1000;
  const f1 = s.f1 ?? f0;
  const q = s.q ?? 0.707;
  const attack = Math.max(1, (s.attack ?? 0.0008) * sr);
  const release = attack + (s.hold ?? 0) * sr;
  const fall = Math.exp(-1 / (s.decay * sr));
  const nyq = sr / 2;
  const svf = new Svf(sr);
  // Filter frequency moves exponentially; coefficients are refreshed every 16 samples.
  const swept = f1 !== f0;
  const fStep = swept ? Math.pow(f1 / f0, 16 / n) : 1;
  let f = f0;
  let comp = 1;
  let brown = 0;
  let env = 1;
  const tune = (): void => {
    svf.set(f, q);
    const enbw = type === 'lp' ? 1.11 * f : type === 'hp' ? Math.max(500, nyq - f) : (1.57 * f) / q;
    comp = s.brown ? 1 : Math.min(6, 1 / Math.sqrt(Math.min(1, enbw / nyq)));
  };
  if (type !== 'none') tune();
  for (let i = 0; i < n; i++) {
    if (swept && i > 0 && (i & 15) === 0 && type !== 'none') {
      f *= fStep;
      tune();
    }
    let x = rng.next() * 2 - 1;
    if (s.brown) {
      brown = (brown + 0.02 * x) / 1.02;
      x = brown * 3.5;
    }
    let y = x;
    if (type !== 'none') {
      svf.tick(x);
      y = (type === 'lp' ? svf.low : type === 'hp' ? svf.high : svf.bandN) * comp;
    }
    let g: number;
    if (i < attack) g = i / attack;
    else if (i < release) g = 1;
    else {
      g = env;
      env *= fall;
      // Below -100 dB: nothing left to add.
      if (env < 1e-5) break;
    }
    out[start + i] += y * s.amp * g;
  }
}

export interface ToneSpec {
  at?: number;
  dur: number;
  amp: number;
  wave?: Wave;
  f0: number;
  /** Pitch glides exponentially from f0 towards f1 with time constant `sweep` seconds. */
  f1?: number;
  sweep?: number;
  attack?: number;
  hold?: number;
  decay: number;
  /** Vibrato rate (Hz) and depth (fraction of pitch). */
  vib?: number;
  vibDepth?: number;
  /** Two-operator FM: modulator ratio, peak index and index decay time constant. */
  fmRatio?: number;
  fmIndex?: number;
  fmDecay?: number;
}

export function addTone(out: Float32Array, s: ToneSpec, sr = SR): void {
  const start = Math.floor((s.at ?? 0) * sr);
  const n = Math.min(out.length - start, Math.floor(s.dur * sr));
  if (n <= 0) return;
  const wave = s.wave ?? 'sine';
  const attack = Math.max(1, (s.attack ?? 0.001) * sr);
  const release = attack + (s.hold ?? 0) * sr;
  const fall = Math.exp(-1 / (s.decay * sr));
  const f1 = s.f1 ?? s.f0;
  // Pitch offset from f1 shrinks geometrically: an exponential glide.
  let bend = s.f0 - f1;
  const bendFall = Math.exp(-1 / ((s.sweep ?? 0.05) * sr));
  const vib = s.vib ?? 0;
  const vibDepth = s.vibDepth ?? 0;
  const fmRatio = s.fmRatio ?? 1;
  let fmIndex = s.fmIndex ?? 0;
  const fm = fmIndex !== 0;
  const fmFall = Math.exp(-1 / ((s.fmDecay ?? 0.1) * sr));
  let p = 0;
  let mp = 0;
  let env = 1;
  for (let i = 0; i < n; i++) {
    let f = f1 + bend;
    bend *= bendFall;
    if (vib) f *= 1 + vibDepth * Math.sin((TAU * vib * i) / sr);
    const dp = f / sr;
    p += dp;
    if (p >= 1) p -= 1;
    let y: number;
    if (fm) {
      mp += dp * fmRatio;
      if (mp >= 1) mp -= Math.floor(mp);
      y = Math.sin(TAU * p + fmIndex * Math.sin(TAU * mp));
      fmIndex *= fmFall;
    } else {
      y = wave === 'sine' ? Math.sin(TAU * p) : waveAt(wave, p, dp);
    }
    let g: number;
    if (i < attack) g = i / attack;
    else if (i < release) g = 1;
    else {
      g = env;
      env *= fall;
      if (env < 1e-5) break;
    }
    out[start + i] += y * s.amp * g;
  }
}

/** Filtered-noise tick: the building block of clicks, latches and gravel grains. */
export function addClick(out: Float32Array, rng: Rng, at: number, freq: number, amp: number, decay = 0.006, q = 2.5): void {
  addNoise(out, rng, { at, dur: decay * 9, amp, type: 'bp', f0: freq, q, decay });
}

export function peak(b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < b.length; i++) {
    const a = Math.abs(b[i]);
    if (a > m) m = a;
  }
  return m;
}

export function rms(b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s += b[i] * b[i];
  return Math.sqrt(s / Math.max(1, b.length));
}

export function normalize(b: Float32Array, target = 0.92): Float32Array {
  const m = peak(b);
  if (m > 1e-6) {
    const g = target / m;
    for (let i = 0; i < b.length; i++) b[i] *= g;
  }
  return b;
}

/** Soft saturation: adds density and tames peaks. drive 1 ≈ gentle, 3 = crunchy. */
export function saturate(b: Float32Array, drive: number): Float32Array {
  const m = peak(b);
  if (m < 1e-6) return b;
  const k = drive / m;
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * k);
  return b;
}

export function fadeEdges(b: Float32Array, inSec = 0.0006, outSec = 0.012, sr = SR): Float32Array {
  const a = Math.min(b.length, Math.floor(inSec * sr));
  for (let i = 0; i < a; i++) b[i] *= i / a;
  const r = Math.min(b.length, Math.floor(outSec * sr));
  for (let i = 0; i < r; i++) b[b.length - 1 - i] *= i / r;
  return b;
}

/** In-place filter over a whole buffer. */
export function filterBuf(b: Float32Array, type: 'lp' | 'hp' | 'bp', fc: number, q = 0.707, sr = SR): Float32Array {
  const f = new Svf(sr).set(fc, q);
  for (let i = 0; i < b.length; i++) {
    f.tick(b[i]);
    b[i] = type === 'lp' ? f.low : type === 'hp' ? f.high : f.bandN;
  }
  return b;
}

/** Feedback echo with a darkening filter in the loop (slap-back off the hills, dub tails). */
export function echo(b: Float32Array, delay: number, feedback: number, mix: number, lpHz = 2000, sr = SR): Float32Array {
  const d = Math.max(1, Math.floor(delay * sr));
  const line = new Float32Array(d);
  const a = 1 - Math.exp((-TAU * lpHz) / sr);
  let lp = 0;
  let w = 0;
  for (let i = 0; i < b.length; i++) {
    const delayed = line[w];
    lp += a * (delayed - lp);
    line[w] = b[i] + lp * feedback;
    b[i] += lp * mix;
    if (++w >= d) w = 0;
  }
  return b;
}

export function mixInto(dst: Float32Array, src: Float32Array, at = 0, gain = 1, sr = SR): void {
  const start = Math.floor(at * sr);
  const n = Math.min(src.length, dst.length - start);
  for (let i = 0; i < n; i++) dst[start + i] += src[i] * gain;
}

/** Standard finishing chain for a one-shot: saturate, de-click the edges, normalise. */
export function finish(b: Float32Array, drive = 0, target = 0.92): Float32Array {
  if (drive > 0) saturate(b, drive);
  fadeEdges(b);
  return normalize(b, target);
}

/** Cross-fades the tail of a noise buffer into its head so it loops without a thump. Returns the loop (shorter). */
export function makeLoop(b: Float32Array, xfade: number): Float32Array {
  const n = b.length - xfade;
  const out = new Float32Array(n);
  out.set(b.subarray(0, n));
  for (let i = 0; i < xfade; i++) {
    const t = i / xfade;
    out[i] = b[i] * Math.sqrt(t) + b[n + i] * Math.sqrt(1 - t);
  }
  return out;
}

export type NoiseColor = 'white' | 'pink' | 'brown';

/** Loopable noise bed of the given colour, RMS ≈ 0.25. */
export function renderNoise(color: NoiseColor, seconds: number, rng: Rng, sr = SR): Float32Array {
  const xf = Math.floor(0.25 * sr);
  const b = new Float32Array(Math.ceil(seconds * sr) + xf);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let brown = 0;
  for (let i = 0; i < b.length; i++) {
    const w = rng.next() * 2 - 1;
    if (color === 'white') {
      b[i] = w;
    } else if (color === 'pink') {
      // Paul Kellet's economy pink filter.
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      b[i] = b0 + b1 + b2 + w * 0.1848;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      b[i] = brown;
    }
  }
  const loop = makeLoop(b, xf);
  const level = rms(loop);
  const g = level > 1e-9 ? 0.25 / level : 1;
  for (let i = 0; i < loop.length; i++) loop[i] *= g;
  return loop;
}

export interface PluckSpec {
  /** Seconds. */
  dur: number;
  /** 0 = dark felt, 1 = bright steel. */
  bright: number;
  /** Time for the string to die away by 60 dB at 110 Hz; higher strings decay faster. */
  sustain: number;
  /** Pick position along the string, 0.05..0.5. */
  pick: number;
  /** Adds a woody body resonance (acoustic instruments). */
  body?: number;
}

/**
 * Karplus-Strong plucked string: a delay line one period long, an all-pass for the fractional part of the
 * period (so high notes are in tune without the extra damping linear interpolation would add), a pick-position
 * comb on the excitation and a gentle loss filter. Tuned to within a few cents across the guitar range.
 */
export function renderPluck(freq: number, spec: PluckSpec, rng: Rng, sr = 22050): Float32Array {
  const n = Math.ceil(spec.dur * sr);
  const out = new Float32Array(n);
  // Loop filter y = (1-b)·x0 + b·x1 delays the loop by about b samples. The same filter damps a short
  // (high) string far more per second than a long one, so it is eased off as the pitch rises.
  const b = (0.5 - 0.42 * spec.bright) * Math.min(1, Math.pow(200 / freq, 0.8));
  const period = sr / freq - b;
  // Whole samples in the delay line; the remainder (0.1 .. 1.1 samples) comes from the all-pass.
  const len = Math.max(2, Math.floor(period - 0.1));
  const frac = period - len;
  const ap = (1 - frac) / (1 + frac);
  const line = new Float32Array(len);
  // Excitation: one period of low-passed noise, combed by the pick position.
  // A softer pick higher up the neck: more of the energy goes into the fundamental, which is what rings on.
  const hard = (0.25 + 0.7 * spec.bright) * Math.min(1, Math.sqrt(330 / freq));
  let lp = 0;
  const pickDelay = Math.max(1, Math.round(len * spec.pick));
  const exc = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    lp += hard * (rng.next() * 2 - 1 - lp);
    exc[i] = lp;
  }
  for (let i = 0; i < len; i++) line[i] = exc[i] - 0.6 * exc[(i + len - pickDelay) % len];
  // Higher strings die away sooner, but not so fast that a lead line cannot sing.
  const t60 = spec.sustain * Math.pow(110 / freq, 0.3);
  const loss = Math.pow(10, -3 / (freq * t60));
  let w = 0;
  let apIn = 0;
  let apOut = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    // line[w] is the sample written `len` steps ago.
    const delayed = line[w];
    const x = ap * delayed + apIn - ap * apOut;
    apIn = delayed;
    apOut = x;
    out[i] = x;
    line[w] = loss * ((1 - b) * x + b * prev);
    prev = x;
    w = w + 1 === len ? 0 : w + 1;
  }
  if (spec.body) {
    const body = new Svf(sr).set(190, 2.2);
    const air = new Svf(sr).set(105, 3);
    for (let i = 0; i < n; i++) {
      body.tick(out[i]);
      air.tick(out[i]);
      out[i] += spec.body * (body.bandN * 0.9 + air.bandN * 0.7);
    }
  }
  // Remove DC; fade the tail.
  filterBuf(out, 'hp', 55, 0.707, sr);
  fadeEdges(out, 0.0015, Math.min(0.12, spec.dur * 0.2), sr);
  // The raw pick transient towers over the ringing string. Level the note by its body (10–150 ms) and let a
  // soft clip round off the pick, so a strummed chord has some weight rather than just a click.
  const a = Math.floor(0.01 * sr);
  const b2 = Math.min(n, Math.floor(0.15 * sr));
  const body = rms(out.subarray(a, b2));
  if (body > 1e-6) {
    const g = 0.26 / body;
    for (let i = 0; i < n; i++) out[i] = 0.9 * Math.tanh((out[i] * g) / 0.9);
  }
  return out;
}

/**
 * Stereo impulse response for the convolution reverb: a few early reflections, then exponentially
 * decaying noise that darkens as it dies away. `bright` 0..1.
 */
export function renderImpulse(seconds: number, rng: Rng, bright = 0.5, preDelay = 0.012, sr = SR): [Float32Array, Float32Array] {
  const n = Math.ceil(seconds * sr);
  const pd = Math.floor(preDelay * sr);
  const make = (): Float32Array => {
    const b = new Float32Array(n);
    let lp = 0;
    // Level falls 60 dB over the length; the top end falls away faster.
    const span = n - pd;
    const levelFall = Math.exp(-6.9 / span);
    const toneFall = Math.exp(-3 / span);
    let level = 1;
    let tone = 0.2 + 0.65 * bright;
    for (let i = pd; i < n; i++) {
      lp += Math.min(1, 0.12 + tone) * (rng.next() * 2 - 1 - lp);
      b[i] = lp * level;
      level *= levelFall;
      tone *= toneFall;
    }
    for (let k = 0; k < 6; k++) {
      const at = pd + Math.floor(rng.range(0.004, 0.08) * sr);
      if (at < n) b[at] += rng.range(0.3, 0.8) * (rng.chance(0.5) ? 1 : -1) * (1 - k * 0.1);
    }
    return b;
  };
  return [make(), make()];
}

/**
 * Transfer curve for the master safety clipper. The input is pre-scaled by 0.5, so the table spans ±2 (≈ +6 dBFS):
 * linear below 0.7, then a tanh shoulder that never exceeds 0.98.
 */
export function softClipCurve(size = 4096): Float32Array<ArrayBuffer> {
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const u = ((i / (size - 1)) * 2 - 1) * 2;
    const a = Math.abs(u);
    c[i] = a <= 0.7 ? u : Math.sign(u) * (0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
  }
  return c;
}

/** Symmetric drive curve for guitar amps and lo-fi saturation. amount 1 = warm, 20 = fuzz. */
export function driveCurve(amount: number, size = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(size);
  const norm = Math.tanh(amount);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / norm;
  }
  return c;
}

/**
 * Converts samples rendered at `from` Hz to `to` Hz (cubic interpolation, with a low-pass first when going
 * down). AudioBuffers must be built at the AudioContext's own rate, which is only known once it exists and
 * differs between machines (44.1 kHz here, 48 kHz there). `loop` treats the data as circular so a looping
 * buffer still joins up seamlessly.
 */
export function resample(data: Float32Array, from: number, to: number, loop = false): Float32Array {
  if (from === to || data.length < 2) return data;
  const n = data.length;
  let src = data;
  if (to < from * 0.95) {
    // Going down: take out what the new rate cannot carry.
    src = data.slice();
    const f = new Svf(from).set(to * 0.45, 0.707);
    if (loop) for (let i = 0; i < n; i++) f.tick(src[i]);
    for (let i = 0; i < n; i++) {
      f.tick(src[i]);
      src[i] = f.low;
    }
  }
  const outLen = Math.max(2, Math.round((n * to) / from));
  const out = new Float32Array(outLen);
  const step = n / outLen;
  const at = (i: number): number => {
    if (loop) return src[((i % n) + n) % n];
    return src[i < 0 ? 0 : i >= n ? n - 1 : i];
  };
  for (let i = 0; i < outLen; i++) {
    const x = i * step;
    const k = Math.floor(x);
    const t = x - k;
    const p0 = at(k - 1);
    const p1 = at(k);
    const p2 = at(k + 1);
    const p3 = at(k + 2);
    // Catmull-Rom spline through the four neighbours.
    out[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}

/**
 * The value to give a BiquadFilterNode's Q so that `q` means what it does everywhere else in this code
 * (0.707 = maximally flat, higher = more resonant). WebAudio's low-pass and high-pass take their Q in
 * decibels of resonance instead; the other filter types use the ordinary quality factor.
 */
export function biquadQ(type: string, q: number): number {
  return type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(Math.max(0.05, q)) : q;
}
