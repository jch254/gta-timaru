/** Just enough music theory for the generative stations: scales, chords, voicings. Pure functions. */

export const midiHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  majPent: [0, 2, 4, 7, 9],
  minPent: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
} as const;

export type ScaleName = keyof typeof SCALES;

/** Pitch of scale degree `deg` (0 = tonic; negatives and large values wrap by octave) above `root`. */
export function degree(root: number, scale: ScaleName, deg: number): number {
  const s = SCALES[scale];
  const n = s.length;
  const oct = Math.floor(deg / n);
  return root + oct * 12 + s[deg - oct * n];
}

export type Quality = 'maj' | 'min' | 'dom7' | 'maj7' | 'min7' | 'sus4' | 'sus2' | 'five' | 'dim' | 'add9' | 'six' | 'min6' | 'min9' | 'maj9';

export const CHORDS: Record<Quality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  five: [0, 7],
  dim: [0, 3, 6],
  add9: [0, 4, 7, 14],
  six: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  min9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
};

export interface Chord {
  /** Root pitch class, 0 = C. */
  root: number;
  q: Quality;
}

const NUMERALS: Record<string, number> = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };

/**
 * Chord from a roman numeral relative to `key` (pitch class): 'I', 'vi', 'bVII', 'V7', 'IVmaj7', 'ii7',
 * 'Isus4', 'I5', 'Iadd9', 'iv6', 'vi9'. Upper case = major, lower = minor; 'b' / '#' shift the root.
 */
export function roman(key: number, sym: string): Chord {
  const m = /^([b#]?)([ivIV]+)(.*)$/.exec(sym);
  if (!m) throw new Error(`bad chord symbol: ${sym}`);
  const [, acc, num, ext] = m;
  const base = NUMERALS[num.toLowerCase()];
  if (base === undefined) throw new Error(`bad numeral: ${sym}`);
  const minor = num === num.toLowerCase();
  const root = (((key + base + (acc === 'b' ? -1 : acc === '#' ? 1 : 0)) % 12) + 12) % 12;
  let q: Quality;
  switch (ext) {
    case '':
      q = minor ? 'min' : 'maj';
      break;
    case '7':
      q = minor ? 'min7' : 'dom7';
      break;
    case 'maj7':
      q = 'maj7';
      break;
    case '9':
      q = minor ? 'min9' : 'maj9';
      break;
    case '6':
      q = minor ? 'min6' : 'six';
      break;
    case 'sus4':
    case 'sus2':
    case 'add9':
    case 'dim':
      q = ext;
      break;
    case '5':
      q = 'five';
      break;
    default:
      throw new Error(`bad chord extension: ${sym}`);
  }
  return { root, q };
}

export function chordPcs(c: Chord): number[] {
  return CHORDS[c.q].map((i) => (c.root + i) % 12);
}

/** The chord's root at or above `low` (within an octave). */
export function rootAbove(c: Chord, low: number): number {
  return low + ((((c.root - low) % 12) + 12) % 12);
}

/** Chord tones stacked upwards from the root at or above `low`. */
export function stack(c: Chord, low: number): number[] {
  const r = rootAbove(c, low);
  return CHORDS[c.q].map((i) => r + i);
}

/**
 * Close voicing centred on `center`: each chord tone in the octave nearest the centre, ascending.
 * Successive chords voiced around the same centre move by small steps (cheap voice leading).
 */
export function voiceNear(c: Chord, center: number, max = 4): number[] {
  const out: number[] = [];
  for (const iv of CHORDS[c.q].slice(0, max)) {
    const pc = (c.root + iv) % 12;
    let n = center - 6 + ((((pc - (center - 6)) % 12) + 12) % 12);
    if (n - center > 6) n -= 12;
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/** Nearest pitch to `midi` that belongs to the chord. */
export function nearestChordTone(c: Chord, midi: number): number {
  const pcs = chordPcs(c);
  for (let d = 0; d <= 6; d++) {
    if (pcs.includes((((midi - d) % 12) + 12) % 12)) return midi - d;
    if (pcs.includes((((midi + d) % 12) + 12) % 12)) return midi + d;
  }
  return midi;
}

/** Nearest pitch to `midi` in the scale on `key`. Ties resolve downwards. */
export function snapToScale(key: number, scale: ScaleName, midi: number): number {
  const s: readonly number[] = SCALES[scale];
  for (let d = 0; d <= 6; d++) {
    if (s.includes((((midi - d - key) % 12) + 12) % 12)) return midi - d;
    if (s.includes((((midi + d - key) % 12) + 12) % 12)) return midi + d;
  }
  return midi;
}

/** Index of the scale degree at or below `midi` (inverse of `degree`). */
export function degreeOf(root: number, scale: ScaleName, midi: number): number {
  const s = SCALES[scale];
  const rel = midi - root;
  const oct = Math.floor(rel / 12);
  const within = rel - oct * 12;
  let idx = 0;
  for (let i = 0; i < s.length; i++) if (s[i] <= within) idx = i;
  return oct * s.length + idx;
}

/**
 * Guitar-style voicing: a six-string barre shape built up from the lowest root at or above `lowest`
 * (default low E), so strums sound like a guitar rather than a piano.
 */
export function guitarVoicing(c: Chord, lowest = 40): number[] {
  const r = rootAbove(c, lowest);
  const third = c.q === 'min' || c.q === 'min7' || c.q === 'min9' || c.q === 'min6' || c.q === 'dim' ? 3 : 4;
  switch (c.q) {
    case 'five':
      return [r, r + 7, r + 12];
    case 'sus4':
      return [r, r + 7, r + 12, r + 17, r + 19, r + 24];
    case 'sus2':
      return [r, r + 7, r + 12, r + 14, r + 19, r + 24];
    case 'dom7':
    case 'min7':
      return [r, r + 7, r + 10, r + 12 + third, r + 19, r + 24];
    case 'maj7':
      return [r, r + 7, r + 11, r + 16, r + 19];
    case 'add9':
    case 'maj9':
    case 'min9':
      return [r, r + 7, r + 12, r + 14, r + 12 + third, r + 19];
    case 'six':
    case 'min6':
      return [r, r + 7, r + 9, r + 12 + third, r + 19];
    default:
      return [r, r + 7, r + 12, r + 12 + third, r + 19, r + 24];
  }
}

/** Well-known riffs and idents (as semitone contours) that generated motifs must not reproduce. */
const FAMILIAR: readonly (readonly number[])[] = [
  [0, 3, 5, 0, 3, 6, 5],
  [0, 0, 3, 0, -2, -4, -5],
  [0, 3, 3, 5, 5, 8, 7],
  [0, 9, 5],
  [0, 0, 5, 0, 7],
  [0, 2, -2, -14, -7],
  [0, 0, 0, 4, 0],
];

/** True if the opening of a melody (midi notes) matches the contour of something everyone knows. */
export function isFamiliar(notes: readonly number[]): boolean {
  if (!notes.length) return false;
  for (const f of FAMILIAR) {
    if (notes.length < f.length) continue;
    let same = true;
    for (let i = 0; i < f.length && same; i++) same = notes[i] - notes[0] === f[i];
    if (same) return true;
  }
  return false;
}
