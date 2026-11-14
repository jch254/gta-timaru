/** Synthesised drum and percussion hits for the radio bands, rendered offline (see ../dsp.ts). */
import { Rng } from '../../core/rng';
import { SR, addClick, addNoise, addTone, buf, filterBuf, finish, mixInto, waveAt } from '../dsp';

type Drum = (r: Rng) => Float32Array;

/** Six detuned square partials: the metallic core of cymbals and hi-hats. */
function metal(dur: number, base: number, decay: number): Float32Array {
  const n = Math.floor(dur * SR);
  const b = new Float32Array(n);
  const ratios = [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523];
  const phases = [0, 0, 0, 0, 0, 0];
  const steps = ratios.map((ratio) => (base * ratio) / SR);
  const fall = Math.exp(-1 / (SR * decay));
  let env = 1 / 6;
  for (let i = 0; i < n; i++) {
    let y = 0;
    for (let k = 0; k < 6; k++) {
      phases[k] += steps[k];
      if (phases[k] >= 1) phases[k] -= 1;
      y += waveAt('square', phases[k], steps[k]);
    }
    b[i] = y * env;
    env *= fall;
  }
  return b;
}

function hat(r: Rng, decay: number, bright: number, base = 540): Float32Array {
  const dur = Math.max(0.06, decay * 6);
  const b = metal(dur, base * 8, decay);
  addNoise(b, r, { dur, amp: 0.7, type: 'hp', f0: bright, decay });
  filterBuf(b, 'hp', bright * 0.85, 0.9);
  return finish(b);
}

function kick(r: Rng, f0: number, f1: number, sweep: number, decay: number, click: number, drive: number): Float32Array {
  const b = buf(decay * 5 + 0.05);
  addTone(b, { dur: decay * 5, amp: 1, f0, f1, sweep, decay });
  if (click > 0) addNoise(b, r, { dur: 0.02, amp: click, type: 'lp', f0: 3200, decay: 0.003 });
  return finish(b, drive);
}

function tom(r: Rng, f: number): Float32Array {
  const b = buf(0.5);
  addTone(b, { dur: 0.45, amp: 1, f0: f * 1.5, f1: f, sweep: 0.03, decay: 0.12 });
  addNoise(b, r, { dur: 0.08, amp: 0.35, type: 'lp', f0: 1800, decay: 0.012 });
  return finish(b, 1.2);
}

export const DRUMS = {
  kickRock: (r) => kick(r, 135, 52, 0.028, 0.11, 0.55, 1.5),
  kickElectro: (r) => kick(r, 190, 47, 0.045, 0.2, 0.35, 2),
  kickDub: (r) => kick(r, 105, 42, 0.05, 0.22, 0.2, 1.3),
  kickSoft: (r) => kick(r, 100, 55, 0.03, 0.08, 0.15, 0),
  snareRock(r) {
    const b = buf(0.4);
    addTone(b, { dur: 0.2, amp: 0.6, f0: 215, f1: 178, sweep: 0.02, decay: 0.055 });
    addTone(b, { dur: 0.1, amp: 0.3, f0: 335, decay: 0.03 });
    addNoise(b, r, { dur: 0.38, amp: 0.9, type: 'bp', f0: 2300, f1: 1700, q: 0.6, decay: 0.085 });
    addNoise(b, r, { dur: 0.2, amp: 0.3, type: 'hp', f0: 5200, decay: 0.05 });
    return finish(b, 1.5);
  },
  snareLofi(r) {
    const b = buf(0.3);
    addTone(b, { dur: 0.15, amp: 0.7, f0: 240, f1: 190, sweep: 0.02, decay: 0.045 });
    addNoise(b, r, { dur: 0.28, amp: 0.9, type: 'bp', f0: 1900, q: 0.7, decay: 0.06 });
    filterBuf(b, 'lp', 5200);
    return finish(b, 2.4);
  },
  clap(r) {
    const b = buf(0.35);
    for (const at of [0, 0.011, 0.023]) addNoise(b, r, { at, dur: 0.02, amp: 0.8, type: 'bp', f0: 1250, q: 1.2, decay: 0.006 });
    addNoise(b, r, { at: 0.03, dur: 0.3, amp: 0.9, type: 'bp', f0: 1150, q: 1, decay: 0.07 });
    addNoise(b, r, { at: 0.03, dur: 0.2, amp: 0.25, type: 'hp', f0: 4000, decay: 0.05 });
    return finish(b, 1.3);
  },
  rim(r) {
    const b = buf(0.14);
    addTone(b, { dur: 0.06, amp: 0.8, wave: 'tri', f0: 490, decay: 0.012 });
    addTone(b, { dur: 0.08, amp: 0.6, f0: 1260, decay: 0.018 });
    addClick(b, r, 0, 2600, 0.8, 0.005, 3);
    return finish(b, 1.2);
  },
  brush(r) {
    const b = buf(0.22);
    addNoise(b, r, { dur: 0.2, amp: 0.8, type: 'bp', f0: 3200, q: 0.5, attack: 0.004, decay: 0.045 });
    addTone(b, { dur: 0.08, amp: 0.2, f0: 205, decay: 0.025 });
    return finish(b);
  },
  hatC: (r) => hat(r, 0.02, 7000),
  hatO: (r) => hat(r, 0.16, 6500),
  hatEC: (r) => hat(r, 0.014, 8500, 610),
  hatEO: (r) => hat(r, 0.11, 8000, 610),
  crash(r) {
    const b = metal(1.6, 3100, 0.38);
    addNoise(b, r, { dur: 1.6, amp: 0.9, type: 'hp', f0: 3600, decay: 0.42 });
    addNoise(b, r, { dur: 0.1, amp: 0.5, type: 'bp', f0: 900, q: 0.7, decay: 0.02 });
    return finish(b);
  },
  ride(r) {
    const b = metal(0.7, 3900, 0.2);
    addTone(b, { dur: 0.5, amp: 0.25, f0: 5120, decay: 0.12, fmRatio: 1.48, fmIndex: 1.5, fmDecay: 0.2 });
    addNoise(b, r, { dur: 0.05, amp: 0.3, type: 'hp', f0: 6000, decay: 0.008 });
    filterBuf(b, 'hp', 2500);
    return finish(b);
  },
  tomHi: (r) => tom(r, 190),
  tomMid: (r) => tom(r, 140),
  tomLo: (r) => tom(r, 98),
  shaker(r) {
    const b = buf(0.1);
    addNoise(b, r, { dur: 0.09, amp: 1, type: 'hp', f0: 5600, attack: 0.012, decay: 0.018 });
    return finish(b);
  },
  tamb(r) {
    const b = metal(0.25, 4600, 0.05);
    addNoise(b, r, { dur: 0.22, amp: 0.8, type: 'hp', f0: 6200, attack: 0.003, decay: 0.045 });
    filterBuf(b, 'hp', 4500);
    return finish(b);
  },
  clave(r) {
    const b = buf(0.12);
    addTone(b, { dur: 0.1, amp: 1, f0: 2450, decay: 0.016 });
    addClick(b, r, 0, 3500, 0.3, 0.003);
    return finish(b);
  },
  timpani(r) {
    const b = buf(1.1);
    for (const [ratio, amp, dec] of [
      [1, 1, 0.3],
      [1.5, 0.5, 0.22],
      [1.98, 0.3, 0.16],
    ]) addTone(b, { dur: 1, amp, f0: 98 * ratio * 1.04, f1: 98 * ratio, sweep: 0.05, decay: dec });
    addNoise(b, r, { dur: 0.06, amp: 0.4, type: 'lp', f0: 900, decay: 0.012 });
    return finish(b, 1.2);
  },
  /** Low impact for drops and stings. */
  boom(r) {
    const b = buf(1.4);
    addTone(b, { dur: 1.3, amp: 1, f0: 110, f1: 36, sweep: 0.12, decay: 0.35 });
    addNoise(b, r, { dur: 0.6, amp: 0.4, type: 'lp', f0: 1200, f1: 200, decay: 0.12 });
    return finish(b, 1.6);
  },
  /** A consonant for the formant voices. */
  sib(r) {
    const b = buf(0.07);
    addNoise(b, r, { dur: 0.06, amp: 1, type: 'hp', f0: r.range(3500, 5500), attack: 0.008, hold: 0.015, decay: 0.012 });
    return finish(b);
  },
  /** Reverse-ish swell into a downbeat. */
  swell(r) {
    const n = Math.floor(0.9 * SR);
    const b = new Float32Array(n);
    const src = metal(0.9, 3300, 0.5);
    const noise = buf(0.9);
    addNoise(noise, r, { dur: 0.9, amp: 1, type: 'hp', f0: 3000, decay: 5 });
    mixInto(src, noise, 0, 0.6);
    for (let i = 0; i < n; i++) b[i] = src[i] * Math.pow(i / n, 2.5);
    return finish(b);
  },
} satisfies Record<string, Drum>;

export type DrumId = keyof typeof DRUMS;

export const DRUM_IDS = Object.keys(DRUMS) as DrumId[];

/** One drum hit, always the same for a given id (so it can be pre-rendered). */
export function renderDrum(id: DrumId): Float32Array {
  const render: Drum = DRUMS[id];
  return render(new Rng(0xd2a3 + id.length * 977 + id.charCodeAt(0)));
}
