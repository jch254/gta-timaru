/** Instrument and mixer descriptions for the radio bands: plain data, turned into WebAudio nodes by band.ts. */
import type { PluckSpec } from '../dsp';
import type { DrumId } from './drums';

/** Names of the custom oscillator shapes band.ts builds as PeriodicWaves. */
export type WaveName = OscillatorType | 'organ' | 'soft' | 'reed' | 'bright' | 'pulse';

/** A subtractive / two-operator FM synth voice. Times in seconds. */
export interface Patch {
  wave: WaveName;
  /** Extra detuned copies of each note, in cents. */
  unison?: number[];
  /** Second oscillator: shape, semitone offset, level. */
  sub?: [OscillatorType, number, number];
  /**
   * Low-pass (or `ftype`) cutoff = cutoff + track × note frequency, plus envAmt at the start of the note.
   * `q` is an ordinary quality factor (0.707 flat, 3 = squelchy); band.ts converts it for WebAudio.
   */
  cutoff?: number;
  track?: number;
  q?: number;
  envAmt?: number;
  envDecay?: number;
  ftype?: BiquadFilterType;
  /** Amplitude envelope: attack, decay time-constant, sustain level, release time-constant. */
  a: number;
  d: number;
  s: number;
  r: number;
  /** Vibrato: rate (Hz), depth (cents), onset delay. */
  vib?: [number, number, number];
  /** Portamento from the previous note on this instrument. */
  glide?: number;
  /** FM: modulator ratio, index, index decay, index sustain (fraction). */
  fm?: [number, number, number, number];
}

/** A channel strip on the station's desk. */
export interface StripSpec {
  gain: number;
  pan?: number;
  /** Sends. */
  rev?: number;
  del?: number;
  /** Overdrive amount (1 = warm … 20 = fuzz) followed by a speaker-ish filter. */
  drive?: number;
  lp?: number;
  hp?: number;
  /** Depth of the side-chain "pump" triggered by the kick, 0..1. */
  pump?: number;
}

export type Inst =
  | { type: 'drum'; bus: string; drum: DrumId; gain: number; rate?: number; choke?: string; pump?: boolean }
  | { type: 'synth'; bus: string; patch: Patch; gain: number; oct?: number }
  | { type: 'pluck'; bus: string; string: PluckSpec; id: string; gain: number; strum?: number; mute?: number; oct?: number }
  | { type: 'voice'; bus: string; gain: number; phone: boolean }
  | { type: 'riser'; bus: string; gain: number };

export interface Kit {
  strips: Record<string, StripSpec>;
  insts: Record<string, Inst>;
  /** Tempo-synced feedback delay: length in sixteenths, feedback, loop low-pass (Hz). */
  delay: { steps: number; feedback: number; lp: number };
  /** Reverb return level. */
  reverb: number;
  /** Broadcast chain: 'fm' clean, 'am' narrow with a little hiss, 'tape' lo-fi with wobble. */
  tone: 'fm' | 'am' | 'tape';
  /** Output trim. */
  level: number;
}

export const STEEL: PluckSpec = { dur: 1.2, bright: 0.78, sustain: 3.6, pick: 0.17 };
export const ACOUSTIC: PluckSpec = { dur: 1.2, bright: 0.66, sustain: 3, pick: 0.22, body: 0.5 };
export const NYLON: PluckSpec = { dur: 1, bright: 0.32, sustain: 2.2, pick: 0.3, body: 0.35 };

export const PATCH = {
  pickBass: { wave: 'sawtooth', cutoff: 180, track: 4, q: 1, envAmt: 1200, envDecay: 0.1, a: 0.005, d: 0.25, s: 0.65, r: 0.05 },
  subBass: { wave: 'soft', cutoff: 420, q: 0.7, a: 0.012, d: 0.4, s: 0.85, r: 0.07 },
  synthBass: { wave: 'sawtooth', unison: [9], sub: ['square', -12, 0.5], cutoff: 140, track: 2, q: 3, envAmt: 2400, envDecay: 0.09, a: 0.003, d: 0.15, s: 0.6, r: 0.05 },
  upright: { wave: 'soft', cutoff: 900, q: 0.7, envAmt: 700, envDecay: 0.05, a: 0.006, d: 0.32, s: 0.25, r: 0.08 },
  lofiBass: { wave: 'triangle', cutoff: 700, q: 0.8, a: 0.006, d: 0.25, s: 0.6, r: 0.06 },
  organ: { wave: 'organ', a: 0.012, d: 0.3, s: 0.85, r: 0.1, vib: [6.3, 7, 0] },
  skank: { wave: 'organ', cutoff: 2600, q: 0.7, a: 0.004, d: 0.05, s: 0.5, r: 0.035 },
  pad: { wave: 'sawtooth', unison: [11], cutoff: 700, track: 1, q: 0.8, envAmt: 900, envDecay: 0.8, a: 0.25, d: 0.6, s: 0.8, r: 0.45 },
  stab: { wave: 'bright', cutoff: 900, track: 2, q: 1, envAmt: 3200, envDecay: 0.12, a: 0.003, d: 0.16, s: 0.25, r: 0.09 },
  arp: { wave: 'sawtooth', cutoff: 500, track: 1, q: 3, envAmt: 2600, envDecay: 0.07, a: 0.003, d: 0.1, s: 0.2, r: 0.08 },
  sawLead: { wave: 'sawtooth', unison: [7], sub: ['square', 0, 0.4], cutoff: 1400, track: 2, q: 1.5, envAmt: 1800, envDecay: 0.2, a: 0.01, d: 0.2, s: 0.75, r: 0.12, vib: [5.5, 14, 0.18], glide: 0.04 },
  steel: { wave: 'soft', unison: [4], cutoff: 2400, q: 0.6, a: 0.09, d: 0.5, s: 0.8, r: 0.35, vib: [5.2, 12, 0.25], glide: 0.16 },
  fiddle: { wave: 'sawtooth', cutoff: 2300, q: 1.4, a: 0.05, d: 0.2, s: 0.85, r: 0.1, vib: [5.8, 20, 0.12], glide: 0.03 },
  horns: { wave: 'sawtooth', unison: [6], cutoff: 500, track: 1.5, q: 1, envAmt: 2400, envDecay: 0.18, a: 0.03, d: 0.2, s: 0.8, r: 0.1 },
  brass: { wave: 'sawtooth', unison: [5], cutoff: 700, track: 2, q: 1, envAmt: 3200, envDecay: 0.16, a: 0.02, d: 0.2, s: 0.8, r: 0.12 },
  melodica: { wave: 'reed', cutoff: 2800, q: 0.8, a: 0.03, d: 0.2, s: 0.85, r: 0.09, vib: [5.5, 10, 0.2] },
  casio: { wave: 'square', cutoff: 2500, q: 0.7, a: 0.006, d: 0.2, s: 0.7, r: 0.08, vib: [6.5, 16, 0.1] },
  ep: { wave: 'sine', fm: [1, 2.2, 0.35, 0.25], a: 0.004, d: 0.9, s: 0.25, r: 0.25 },
  vibes: { wave: 'sine', fm: [4, 1.6, 0.12, 0.05], a: 0.003, d: 0.6, s: 0, r: 0.4 },
  glock: { wave: 'sine', fm: [3.5, 2, 0.08, 0.02], a: 0.002, d: 0.3, s: 0, r: 0.3 },
  flute: { wave: 'soft', cutoff: 3000, q: 0.5, a: 0.04, d: 0.2, s: 0.8, r: 0.12, vib: [5, 9, 0.25] },
  tick: { wave: 'square', cutoff: 1800, q: 2, envAmt: 1500, envDecay: 0.03, a: 0.002, d: 0.05, s: 0, r: 0.03 },
  beep: { wave: 'sine', a: 0.005, d: 0.1, s: 1, r: 0.015 },
} satisfies Record<string, Patch>;

/** Formant pairs (Hz) for the abstract "voices": ah, eh, ee, oh, oo. */
export const VOWELS: readonly [number, number][] = [
  [760, 1200],
  [520, 1800],
  [320, 2300],
  [480, 900],
  [350, 800],
];
