/**
 * Shared vocabulary for the generative stations. A station's style turns a seed into a Plan (key, tempo,
 * sections, motifs) and then renders any bar of that plan into note events. Everything here is pure data and
 * deterministic for a given seed, so a station can be "joined in progress" at any bar.
 */
import { Rng, hashInts } from '../../core/rng';
import { degree, isFamiliar, nearestChordTone, roman, type Chord, type ScaleName } from './theory';
import { STEPS_PER_BAR } from './timing';

/** One thing to play. `ch` names an instrument in the station's kit. */
export interface Ev {
  /** Position in the bar in sixteenths (fractions allowed). */
  step: number;
  ch: string;
  /** MIDI note (melodic instruments) … */
  n?: number;
  /** … or several (chords, strums). */
  ns?: number[];
  /** Length in sixteenths. */
  d: number;
  /** Velocity 0..1. */
  v: number;
  /** Articulation / variant understood by the instrument ('mute', 'up', 'bend', a vowel index…). */
  a?: string | number;
}

export interface Section {
  kind: string;
  bars: number;
  /** First bar of the section within the track. */
  start: number;
  /** One chord per bar, cycled. */
  chords: Chord[];
  /** 0 (sparse) .. 1 (everything). */
  energy: number;
  /** Which occurrence of this kind of section this is (0 = first verse, 1 = second…). */
  nth: number;
}

export interface Plan {
  style: string;
  seed: number;
  bpm: number;
  shuffle: number;
  swing: number;
  /** Tonic pitch class. */
  key: number;
  scale: ScaleName;
  bars: number;
  sections: Section[];
  /** Random timing looseness in seconds (sloppy student bands). */
  humanize: number;
  /** Style-specific material: riffs, motifs, pattern choices. */
  data: object;
}

export interface Style {
  id: string;
  plan(seed: number): Plan;
  bar(plan: Plan, bar: number): Ev[];
}

export type Form = [kind: string, bars: number, energy: number][];

/** Lays sections end to end and resolves their chord symbols in `key`. */
export function buildSections(form: Form, key: number, chords: Record<string, string[]>): { sections: Section[]; bars: number } {
  const sections: Section[] = [];
  const seen: Record<string, number> = {};
  let start = 0;
  for (const [kind, bars, energy] of form) {
    const syms = chords[kind] ?? chords.default;
    const nth = seen[kind] ?? 0;
    seen[kind] = nth + 1;
    sections.push({ kind, bars, start, energy, nth, chords: syms.map((s) => roman(key, s)) });
    start += bars;
  }
  return { sections, bars: start };
}

export function sectionAt(plan: Plan, bar: number): { sec: Section; i: number; index: number } {
  const secs = plan.sections;
  for (let k = secs.length - 1; k >= 0; k--) {
    if (bar >= secs[k].start) return { sec: secs[k], i: bar - secs[k].start, index: k };
  }
  return { sec: secs[0], i: 0, index: 0 };
}

export const chordAt = (sec: Section, i: number): Chord => sec.chords[i % sec.chords.length];

/** Chord of the bar after `bar` (for approach notes and walk-ups); wraps to the tonic at the very end. */
export function nextChord(plan: Plan, bar: number): Chord {
  if (bar + 1 >= plan.bars) return { root: plan.key, q: 'maj' };
  const { sec, i } = sectionAt(plan, bar + 1);
  return chordAt(sec, i);
}

/** Per-bar random source: the same bar of the same track always gets the same numbers. */
export const barRng = (plan: Plan, bar: number, salt = 0): Rng => new Rng(hashInts(plan.seed, bar, salt));

const VEL: Record<string, number> = { x: 1, o: 0.72, '-': 0.5, g: 0.28 };

/**
 * Drum row notation, sixteen characters to the bar: x accent, o normal, - soft, g ghost, anything else rest.
 * Pushes one event per hit onto `out`.
 */
export function row(out: Ev[], ch: string, pattern: string, vel = 1, d = 1): void {
  for (let s = 0; s < pattern.length && s < STEPS_PER_BAR; s++) {
    const v = VEL[pattern[s]];
    if (v !== undefined) out.push({ step: s, ch, d, v: v * vel });
  }
}

/** Steps where a pattern string has a hit. */
export function hits(pattern: string): number[] {
  const out: number[] = [];
  for (let s = 0; s < pattern.length; s++) if (VEL[pattern[s]] !== undefined) out.push(s);
  return out;
}

/** Removes drum hits at or after `from` on the given channels (to make room for a fill). */
export function clearFrom(out: Ev[], from: number, chans: readonly string[]): void {
  for (let k = out.length - 1; k >= 0; k--) if (out[k].step >= from && chans.includes(out[k].ch)) out.splice(k, 1);
}

/** A drum fill over the last `len` steps of the bar: snare into toms, building. */
export function fill(out: Ev[], r: Rng, len: number, snare = 'snare', toms: readonly string[] = ['tomHi', 'tomMid', 'tomLo']): void {
  const from = STEPS_PER_BAR - len;
  const busy = r.chance(0.5);
  for (let s = from; s < STEPS_PER_BAR; s++) {
    const u = (s - from) / len;
    if (!busy && s % 2 === 1 && u < 0.6) continue;
    const ch = u < 0.34 ? snare : toms[Math.min(toms.length - 1, Math.floor(((u - 0.34) / 0.66) * toms.length))];
    out.push({ step: s, ch, d: 1, v: 0.55 + 0.45 * u });
  }
}

/** A note of a motif: scale-degree relative to the tonic, so it can be re-harmonised bar by bar. */
export interface MotifNote {
  step: number;
  d: number;
  deg: number;
}

export interface MotifOptions {
  /** Rhythm cells: 16-char strings, x = onset. */
  cells: readonly string[];
  /** Lowest / highest scale degree. */
  lo: number;
  hi: number;
  /** Longest a note may ring, in steps. */
  maxLen?: number;
  /** Chance the second bar reuses the first bar's rhythm. */
  echo?: number;
  scaleLen: number;
  /** Degrees (within one octave) a phrase may start and end on. Default: root, third, fifth of a 7-note scale. */
  stable?: readonly number[];
}

/**
 * A two-bar melodic idea: a rhythm cell per bar and a stepwise-with-leaps walk through the scale that starts
 * and ends on stable degrees.
 */
export function makeMotif(r: Rng, o: MotifOptions): MotifNote[][] {
  const stable = o.stable ?? [0, 2, 4];
  const cellA = r.pick(o.cells);
  const cellB = r.chance(o.echo ?? 0.6) ? cellA : r.pick(o.cells);
  const maxLen = o.maxLen ?? 6;
  let deg = r.pick(stable) + (r.chance(0.3) ? o.scaleLen : 0);
  deg = Math.min(o.hi, Math.max(o.lo, deg));
  const bars: MotifNote[][] = [];
  for (const cell of [cellA, cellB]) {
    const on = hits(cell);
    const notes: MotifNote[] = [];
    for (let k = 0; k < on.length; k++) {
      const step = on[k];
      const until = k + 1 < on.length ? on[k + 1] : STEPS_PER_BAR;
      notes.push({ step, d: Math.min(maxLen, until - step), deg });
      const roll = r.next();
      // Mostly steps, some thirds, the odd leap (kept smaller in five-note scales, whose steps are already wide).
      const leap = o.scaleLen <= 5 ? r.pick([-3, 3]) : r.pick([-4, -3, 3, 4]);
      const move = roll < 0.32 ? 1 : roll < 0.64 ? -1 : roll < 0.74 ? 2 : roll < 0.84 ? -2 : roll < 0.92 ? 0 : leap;
      deg += move;
      if (deg > o.hi) deg -= 2 * Math.abs(move) || 2;
      if (deg < o.lo) deg += 2 * Math.abs(move) || 2;
      deg = Math.min(o.hi, Math.max(o.lo, deg));
    }
    bars.push(notes);
  }
  // Land the phrase on the nearest stable degree that is still in range.
  const lastBar = bars[1];
  if (lastBar.length) {
    const end = lastBar[lastBar.length - 1];
    let best = end.deg;
    let bestDist = Infinity;
    for (let d = o.lo; d <= o.hi; d++) {
      const within = ((d % o.scaleLen) + o.scaleLen) % o.scaleLen;
      if (stable.includes(within) && Math.abs(d - end.deg) < bestDist) {
        best = d;
        bestDist = Math.abs(d - end.deg);
      }
    }
    end.deg = best;
    end.d = Math.max(end.d, Math.min(8, STEPS_PER_BAR - end.step));
  }
  return bars;
}

/**
 * Turns a motif bar into notes over a chord. Notes on strong beats (or long ones) are nudged onto chord tones
 * so the tune always agrees with the harmony. `shift` transposes by scale degrees for variation; anything
 * above `ceiling` drops an octave.
 */
export function realize(notes: readonly MotifNote[], ch: string, root: number, scale: ScaleName, chord: Chord, vel: number, shift = 0, ceiling = 93): Ev[] {
  const out: Ev[] = [];
  for (const m of notes) {
    let n = degree(root, scale, m.deg + shift);
    if (m.step % 8 === 0 || m.d >= 4) n = nearestChordTone(chord, n);
    // Keep the tune where the instrument still sounds like itself.
    while (n > ceiling) n -= 12;
    out.push({ step: m.step, ch, n, d: m.d, v: vel * (m.step % 4 === 0 ? 1 : 0.85) });
  }
  return out;
}

/** Rolls motifs until one does not open like a tune everybody already knows. */
export function freshMotif(r: Rng, o: MotifOptions, root: number, scale: ScaleName): MotifNote[][] {
  for (let tries = 0; tries < 8; tries++) {
    const m = makeMotif(r, o);
    const line = [...m[0], ...m[1]].map((x) => degree(root, scale, x.deg));
    if (!isFamiliar(line)) return m;
  }
  return makeMotif(r, o);
}

/** The usual A A′ A B phrase shape: which motif bar to use and how far to shift it, for bar i of a section. */
export function phrase(i: number): { bar: 0 | 1; vary: boolean } {
  const p = i % 4;
  return { bar: p % 2 === 0 ? 0 : 1, vary: p === 3 };
}

/** Bass approach: the note to play just before `target` (a semitone or a tone below, or a tone above). */
export function approach(r: Rng, target: number): number {
  const roll = r.next();
  const n = roll < 0.5 ? target - 1 : roll < 0.8 ? target - 2 : target + 2;
  // Do not growl about below the bottom of a bass guitar.
  return n < 28 ? n + 12 : n;
}

/** Root of `pc` in the octave starting at `low`. */
export const pitchAbove = (pc: number, low: number): number => low + ((((pc - low) % 12) + 12) % 12);

/** Buckets a flat list of events with absolute steps into bars. */
export function toBars(events: readonly Ev[], bars: number): Ev[][] {
  const out: Ev[][] = [];
  for (let b = 0; b < bars; b++) out.push([]);
  for (const e of events) {
    const b = Math.floor(e.step / STEPS_PER_BAR);
    if (b >= 0 && b < bars) out[b].push({ ...e, step: e.step - b * STEPS_PER_BAR });
  }
  return out;
}
