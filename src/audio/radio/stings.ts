/**
 * Everything between the songs: station idents, advertising jingles, the talkback station's wordless
 * "conversations" (two formant voices mumbling at each other) and its news stings. All original, all
 * wordless: no speech synthesis, nobody real.
 */
import { Rng } from '../../core/rng';
import { freshMotif, pitchAbove, realize, row, toBars, type Ev, type Plan, type Style } from './song';
import { degree, roman, stack, voiceNear, type Chord, type ScaleName } from './theory';
import { STEPS_PER_BAR } from './timing';

/** A plan whose bars are written out in full up front. */
function scripted(style: string, seed: number, bpm: number, key: number, scale: ScaleName, events: Ev[], bars: number, extra: Partial<Plan> = {}): Plan {
  return { style, seed, bpm, shuffle: 0, swing: 0, key, scale, bars, sections: [], humanize: 0, data: { bars: toBars(events, bars) }, ...extra };
}

const scriptedBar = (plan: Plan, bar: number): Ev[] => (plan.data as { bars: Ev[][] }).bars[bar] ?? [];

/** Shifts a bar's worth of events to an absolute bar. */
function at(bar: number, events: Ev[]): Ev[] {
  return events.map((e) => ({ ...e, step: e.step + bar * STEPS_PER_BAR }));
}

// ───────────────────────────── Talkback ─────────────────────────────

/**
 * One speaker's turn: a run of syllables with the pitch drifting down through the phrase (or up at the end,
 * for a question). Returns the step after the last syllable.
 */
function utterance(out: Ev[], r: Rng, who: 'host' | 'caller', start: number, limit: number, base: number, flat = 1): number {
  const syllables = r.int(5, 13);
  const question = r.chance(0.25);
  const sib = who === 'host' ? 'sib' : 'sibC';
  let t = start;
  for (let j = 0; j < syllables; j++) {
    const dur = r.pick([1.4, 1.8, 2, 2, 2.4, 3]);
    if (t + dur > limit) break;
    const u = j / syllables;
    let pitch = base + flat * (3 - 5 * u + (r.chance(0.25) ? r.range(1.5, 4) : 0)) + r.range(-0.6, 0.6);
    if (question && j >= syllables - 2) pitch += 3 + 2 * (j - (syllables - 2));
    const consonant = r.chance(0.3);
    if (consonant) out.push({ step: t, ch: sib, d: 0.5, v: 0.6 + 0.4 * r.next() });
    out.push({ step: t + (consonant ? 0.35 : 0), ch: who, n: pitch, d: dur * 0.85, v: 0.7 + 0.3 * r.next(), a: r.int(0, 4) });
    t += dur;
  }
  return t;
}

/** "You're on the air": the host and a caller down a phone line, talking over nothing in particular. */
export const babble: Style = {
  id: 'babble',
  plan(seed) {
    const r = new Rng(seed);
    const bars = r.int(7, 11);
    const limit = bars * STEPS_PER_BAR - 4;
    const hostBase = r.range(41, 46);
    const callerBase = r.range(50, 58);
    const events: Ev[] = [
      { step: 0, ch: 'beep', n: 81, d: 1.2, v: 0.6 },
      { step: 2, ch: 'beep', n: 86, d: 1.2, v: 0.6 },
    ];
    let t = 5;
    let host = true;
    while (t < limit - 4) {
      t = utterance(events, r, host ? 'host' : 'caller', t, limit, host ? hostBase : callerBase) + r.range(2.5, 6);
      host = !host;
    }
    // 150 bpm puts a sixteenth at 0.1 s: a comfortable syllable grid.
    return scripted('babble', seed, 150, 0, 'major', events, bars);
  },
  bar: scriptedBar,
};

/** News on the hour (or thereabouts): urgent pulse, brass, timpani, a newsreader, a button to finish. */
export const news: Style = {
  id: 'news',
  plan(seed) {
    const r = new Rng(seed);
    const key = r.pick([2, 4, 7, 9, 0]);
    const headline = r.int(3, 5);
    const bars = 2 + headline + 2;
    const root = pitchAbove(key, 60);
    const chord = (sym: string, center = 64): number[] => voiceNear(roman(key, sym), center, 3);
    const ev: Ev[] = [];
    // Opening fanfare over a ticking pedal.
    for (let s = 0; s < 24; s++) ev.push({ step: s, ch: 'tick', n: root + (s % 4 === 0 ? 12 : 0), d: 0.6, v: s % 4 === 0 ? 0.9 : 0.6 });
    ev.push({ step: 0, ch: 'timpani', d: 1, v: 0.9 });
    for (const [s, sym, d] of [[0, 'I', 5], [6, 'I', 3], [10, 'IV', 2], [12, 'V', 4]] as const) ev.push({ step: s, ch: 'brass', ns: chord(sym), d, v: 0.85 });
    [12, 13, 14, 15].forEach((s, q) => ev.push({ step: s, ch: 'timpani', d: 1, v: 0.45 + 0.15 * q }));
    for (const [s, sym, d] of [[16, 'bVI', 2.5], [19, 'bVII', 2.5], [22, 'I', 1.5]] as const) ev.push({ step: s, ch: 'brass', ns: chord(sym), d, v: 0.85 });
    ev.push({ step: 24, ch: 'brass', ns: chord('I', 70), d: 7, v: 1 }, { step: 24, ch: 'timpani', d: 1, v: 1 }, { step: 24, ch: 'crash', d: 1, v: 0.8 });
    // The bulletin: a flat, brisk voice with the pulse ticking away underneath.
    const from = 2 * STEPS_PER_BAR;
    const to = (2 + headline) * STEPS_PER_BAR;
    for (let s = from; s < to; s += 2) ev.push({ step: s, ch: 'tick', n: root, d: 0.5, v: s % 8 === 0 ? 0.45 : 0.3 });
    const base = r.range(43, 47);
    let t = from + 2;
    while (t < to - 6) t = utterance(ev, r, 'host', t, to - 1, base, 0.45) + r.range(2, 3.5);
    // Sign-off.
    ev.push({ step: to, ch: 'brass', ns: chord('V'), d: 3, v: 0.85 }, { step: to, ch: 'timpani', d: 1, v: 0.8 });
    ev.push({ step: to + 4, ch: 'brass', ns: chord('I', 67), d: 9, v: 1 }, { step: to + 4, ch: 'timpani', d: 1, v: 1 }, { step: to + 4, ch: 'crash', d: 1, v: 0.7 });
    return scripted('news', seed, 132, key, 'major', ev, bars);
  },
  bar: scriptedBar,
};

// ───────────────────────────── Advertising ─────────────────────────────

const JINGLE_CELLS = ['x.x.x...x.x.x...', 'x..x..x.x..x..x.', 'x.x...x.x.x...x.', 'x...x.x.x...x.x.'];

/** A four-bar jingle for a product that does not exist: glockenspiel, bouncing bass, handclaps, a "ta-da". */
export const jingle: Style = {
  id: 'jingle',
  plan(seed) {
    const r = new Rng(seed);
    const key = r.pick([0, 2, 5, 7, 9]);
    const root = pitchAbove(key, 72);
    const motif = freshMotif(r, { cells: JINGLE_CELLS, lo: 0, hi: 7, scaleLen: 5, stable: [0, 2, 3], maxLen: 2 }, root, 'majPent');
    const prog: Chord[] = r.pick([
      ['I', 'IV', 'V', 'I'],
      ['I', 'vi', 'IV', 'V'],
      ['I', 'ii', 'V', 'I'],
    ]).map((s) => roman(key, s));
    const organ = r.chance(0.5);
    const ev: Ev[] = [];
    for (let b = 0; b < 4; b++) {
      const ch = prog[b];
      const bar: Ev[] = [];
      const low = pitchAbove(ch.root, 36);
      row(bar, 'kick', 'x.......x.......', 0.8);
      row(bar, 'clap', '....x.......x...', 0.8);
      row(bar, 'shaker', 'o.g.o.g.o.g.o.g.', 0.7);
      bar.push({ step: 0, ch: 'bass', n: low, d: 3, v: 0.9 }, { step: 4, ch: 'bass', n: low + 7, d: 3, v: 0.8 }, { step: 8, ch: 'bass', n: low, d: 3, v: 0.9 }, { step: 12, ch: 'bass', n: low + 7, d: 3, v: 0.8 });
      for (const s of [2, 6, 10, 14]) bar.push({ step: s, ch: organ ? 'organ' : 'chord', ns: voiceNear(ch, 64, 3), d: 1.2, v: 0.6 });
      if (b < 3) bar.push(...realize(motif[b % 2], 'glock', root, 'majPent', ch, 0.85, b === 2 ? 1 : 0));
      else {
        // Home: three notes up to the tonic and a chord to finish.
        [2, 3, 5].forEach((deg, q) => bar.push({ step: q * 2, ch: 'glock', n: degree(root, 'majPent', deg), d: 2, v: 0.9 }));
        bar.push({ step: 8, ch: 'glock', ns: stack(ch, root), d: 8, v: 0.9 }, { step: 8, ch: 'brass', ns: voiceNear(ch, 62, 3), d: 6, v: 0.7 }, { step: 8, ch: 'crash', d: 1, v: 0.7 });
      }
      ev.push(...at(b, bar));
    }
    return scripted('jingle', seed, r.int(126, 150), key, 'majPent', ev, 5, { swing: r.chance(0.5) ? 0.3 : 0 });
  },
  bar: scriptedBar,
};

// ───────────────────────────── Station idents ─────────────────────────────

type IdentWriter = (key: number, r: Rng) => { bpm: number; bars: number; swing?: number; events: Ev[] };

/**
 * Each station's sonic logo: a short, fixed, hand-written motif (so it is recognisable) played by that
 * station's own band, in a key that changes from one airing to the next.
 */
const IDENTS: Record<string, IdentWriter> = {
  /** Three shoved power chords, a climbing lick and a held, bent note. */
  shingle(key) {
    const root = pitchAbove(key, 40);
    const lead = pitchAbove(key, 64);
    const power = (off: number): number[] => [root + off, root + off + 7, root + off + 12];
    const ev: Ev[] = [];
    row(ev, 'kick', 'x..x..x.x.......');
    row(ev, 'snare', '....x.......x.xx', 0.9);
    for (const [s, off, d] of [[0, 0, 2.5], [3, -2, 2.5], [6, 5, 2], [8, 12, 7]]) {
      ev.push({ step: s, ch: 'gtr', ns: power(off), d, v: 0.95 }, { step: s, ch: 'bass', n: root + off - 12 + (off === 12 ? -12 : 0), d, v: 0.9 });
    }
    ev.push({ step: 8, ch: 'crash', d: 1, v: 0.9 });
    [4, 3, 5, 4].forEach((deg, q) => ev.push({ step: 16 + q * 2, ch: 'lead', n: degree(lead, 'minPent', deg), d: 2, v: 0.85 }));
    ev.push({ step: 24, ch: 'lead', n: degree(lead, 'minPent', 7), d: 8, v: 1, a: 'bend' }, { step: 24, ch: 'gtr', ns: power(0), d: 8, v: 1 }, { step: 24, ch: 'bass', n: root - 12, d: 8, v: 1 });
    ev.push({ step: 24, ch: 'kick', d: 1, v: 1 }, { step: 24, ch: 'crash', d: 1, v: 1 }, { step: 16, ch: 'kick', d: 1, v: 0.9 }, { step: 20, ch: 'snare', d: 1, v: 0.9 });
    return { bpm: 124, bars: 3, events: ev };
  },
  /** A rising arpeggio and sweep into a four-note synth hook. */
  strobe(key) {
    const lead = pitchAbove(key, 69);
    const tonic: Chord = { root: key, q: 'min7' };
    const tones = stack(tonic, pitchAbove(key, 48));
    const ev: Ev[] = [{ step: 0, ch: 'riser', d: 16, v: 0.9 }];
    row(ev, 'kick', 'x...x...x...x...');
    row(ev, 'hat', '..x...x...x...x.', 0.8);
    for (let s = 0; s < 16; s++) ev.push({ step: s, ch: 'arp', n: tones[s % 4] + 12 * Math.floor(s / 6), d: 0.9, v: 0.5 + 0.03 * s });
    ev.push({ step: 16, ch: 'boom', d: 1, v: 1 }, { step: 16, ch: 'crash', d: 1, v: 0.9 }, { step: 16, ch: 'pad', ns: voiceNear(tonic, 60), d: 14, v: 0.7 });
    for (const [s, deg, d] of [[16, 4, 2.5], [19, 2, 2.5], [22, 3, 2], [24, 7, 7]]) ev.push({ step: s, ch: 'lead', n: degree(lead, 'minor', deg), d, v: 0.9 });
    for (const s of [16, 20, 24]) ev.push({ step: s, ch: 'kick', d: 1, v: 1 }, { step: s + 2, ch: 'ohat', d: 1, v: 0.7 });
    return { bpm: 128, bars: 3, events: ev };
  },
  /** A picked run up the scale, a strum, and the steel guitar swelling in. */
  drover(key) {
    const root = pitchAbove(key, 62);
    const tonic: Chord = { root: key, q: 'maj' };
    const low = pitchAbove(key, 31);
    const ev: Ev[] = [];
    [-2, -1, 0, 1, 2, 3, 2, 1].forEach((deg, q) => ev.push({ step: q * 2, ch: 'tele', n: degree(root, 'majPent', deg), d: 2, v: 0.8 + 0.02 * q }));
    ev.push({ step: 0, ch: 'bass', n: low, d: 6, v: 0.9 }, { step: 8, ch: 'bass', n: low + 7, d: 6, v: 0.85 });
    row(ev, 'brush', '....x.......x.gg', 0.9);
    const gv = [low + 12, low + 19, low + 24, low + 28, low + 31];
    const pair = voiceNear(tonic, 67, 3);
    ev.push({ step: 16, ch: 'strum', ns: gv, d: 14, v: 0.9 }, { step: 16, ch: 'bass', n: low, d: 10, v: 0.9 }, { step: 16, ch: 'kick', d: 1, v: 0.8 });
    ev.push({ step: 16, ch: 'steel', n: pair[1], d: 14, v: 0.8 }, { step: 16, ch: 'steel2', n: pair[2], d: 14, v: 0.7 }, { step: 24, ch: 'tele', n: root + 12, d: 6, v: 0.8 });
    return { bpm: 116, bars: 3, events: ev };
  },
  /** Two chops into the echo, then a three-note horn call. */
  lowtide(key) {
    const tonic: Chord = { root: key, q: 'min' };
    const low = pitchAbove(key, 33);
    const lead = pitchAbove(key, 60);
    const chop = voiceNear(tonic, 67, 3);
    const ev: Ev[] = [];
    row(ev, 'hat', 'o.x.o.x.o.x.o.x.', 0.8);
    row(ev, 'kick', '....x.......x...');
    row(ev, 'rim', '....x.......x...');
    ev.push({ step: 2, ch: 'skank', ns: chop, d: 0.9, v: 0.8 }, { step: 6, ch: 'skank', ns: chop, d: 0.9, v: 0.85 }, { step: 6, ch: 'throw', a: 'skank', d: 2, v: 1 });
    ev.push({ step: 0, ch: 'bass', n: low, d: 3, v: 1 }, { step: 8, ch: 'bass', n: low, d: 2.5, v: 0.9 }, { step: 11, ch: 'bass', n: low + 7, d: 1, v: 0.85 }, { step: 12, ch: 'bass', n: low + 12, d: 3, v: 0.9 });
    for (const [s, deg, d] of [[8, 0, 2.5], [11, 2, 1], [12, 4, 5]]) {
      ev.push({ step: s, ch: 'horn', n: degree(lead, 'minor', deg), d, v: 0.85 }, { step: s, ch: 'horn', n: degree(lead, 'minor', deg + 2), d, v: 0.55 });
    }
    ev.push({ step: 12, ch: 'throw', a: 'horn', d: 4, v: 1 }, { step: 20, ch: 'rim', d: 1, v: 0.8 }, { step: 20, ch: 'throw', a: 'snare', d: 2, v: 1 }, { step: 16, ch: 'bass', n: low, d: 6, v: 0.9 });
    return { bpm: 74, bars: 2, swing: 0.4, events: ev };
  },
  /** A wonky toy-keyboard tune over two strummed chords. */
  flatmate(key) {
    const root = pitchAbove(key, 74);
    const low = pitchAbove(key, 40);
    const chord = (off: number): number[] => [low + off + 7, low + off + 12, low + off + 16, low + off + 19];
    const ev: Ev[] = [];
    row(ev, 'kick', 'x.....x.x.......');
    row(ev, 'snare', '....x.......x...');
    row(ev, 'hat', 'x.o.x.o.x.o.x.o.', 0.8);
    for (const [s, deg, d] of [[0, 2, 2], [2, 4, 2], [4, 3, 3], [7, 5, 3], [10, 1, 5]]) ev.push({ step: s, ch: 'casio', n: degree(root, 'major', deg), d, v: 0.8 });
    ev.push({ step: 0, ch: 'strum', ns: chord(0), d: 7, v: 0.85 }, { step: 8, ch: 'strum', ns: chord(5), d: 7, v: 0.8 });
    const bass = pitchAbove(key, 33);
    ev.push({ step: 0, ch: 'bass', n: bass, d: 7, v: 0.9 }, { step: 8, ch: 'bass', n: bass + 5, d: 7, v: 0.85 });
    for (const [s, deg, d] of [[16, 4, 3.5], [20, 2, 3.5], [24, 0, 8]]) ev.push({ step: s, ch: 'casio', n: degree(root, 'major', deg), d, v: 0.8 });
    ev.push({ step: 16, ch: 'kick', d: 1, v: 0.9 }, { step: 20, ch: 'snare', d: 1, v: 0.9 }, { step: 22, ch: 'snare', d: 1, v: 0.7 }, { step: 23, ch: 'snare', d: 1, v: 0.8 });
    ev.push({ step: 24, ch: 'strum', ns: chord(0), d: 8, v: 0.9 }, { step: 24, ch: 'bass', n: bass, d: 8, v: 0.9 }, { step: 24, ch: 'crash', d: 1, v: 0.7 }, { step: 24, ch: 'kick', d: 1, v: 0.9 });
    return { bpm: 138, bars: 3, events: ev };
  },
  /** Four chimes over an electric-piano chord, and the pips. */
  partyline(key) {
    const root = pitchAbove(key, 72);
    const tonic: Chord = { root: key, q: 'maj7' };
    const ev: Ev[] = [];
    for (const [s, deg, d] of [[0, 0, 3], [3, 2, 3], [6, 1, 4], [10, 4, 6]]) ev.push({ step: s, ch: 'vibes', n: degree(root, 'major', deg), d, v: 0.85 });
    ev.push({ step: 0, ch: 'ep', ns: voiceNear(tonic, 62), d: 14, v: 0.7 }, { step: 0, ch: 'bass', n: pitchAbove(key, 33), d: 12, v: 0.8 });
    row(ev, 'shaker', 'o.g.o.g.o.g.o.g.', 0.6);
    ev.push({ step: 16, ch: 'brass', ns: voiceNear({ root: (key + 7) % 12, q: 'dom7' }, 62, 3), d: 3.5, v: 0.6 });
    ev.push({ step: 20, ch: 'brass', ns: voiceNear(tonic, 64, 3), d: 8, v: 0.7 }, { step: 20, ch: 'vibes', n: root + 12, d: 8, v: 0.8 });
    for (const s of [24, 26, 28]) ev.push({ step: s, ch: 'beep', n: root + 12, d: s === 28 ? 2.5 : 1, v: 0.6 });
    return { bpm: 104, bars: 3, events: ev };
  },
};

/** Builds the ident style for a station id. */
export function identStyle(stationId: string): Style {
  const write = IDENTS[stationId];
  return {
    id: `ident:${stationId}`,
    plan(seed) {
      const r = new Rng(seed);
      const key = r.int(0, 11);
      const { bpm, bars, events, swing } = write(key, r);
      return scripted(`ident:${stationId}`, seed, bpm, key, 'major', events, bars, { swing: swing ?? 0 });
    },
    bar: scriptedBar,
  };
}

export const IDENT_IDS = Object.keys(IDENTS);
