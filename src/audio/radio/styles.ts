/**
 * The song-writers. Each style turns a seed into a Plan (key, tempo, form, progressions, riffs, motifs) and
 * renders any bar of it into events. Progressions and grooves are stock genre idioms; every riff and melody is
 * generated from the seed, so no two tracks are the same and nothing is transcribed from an existing song.
 */
import { Rng } from '../../core/rng';
import {
  approach,
  barRng,
  buildSections,
  chordAt,
  clearFrom,
  fill,
  freshMotif,
  hits,
  nextChord,
  phrase,
  pitchAbove,
  realize,
  row,
  sectionAt,
  type Ev,
  type Form,
  type MotifNote,
  type Style,
} from './song';
import { degree, guitarVoicing, isFamiliar, nearestChordTone, rootAbove, stack, voiceNear, type Chord, type ScaleName } from './theory';
import { STEPS_PER_BAR } from './timing';

const isMinor = (c: Chord): boolean => c.q === 'min' || c.q === 'min7' || c.q === 'min9' || c.q === 'min6' || c.q === 'dim';

/** Adds a seventh (minor) or ninth (major) so stabs and pads have some colour without semitone clashes. */
const rich = (c: Chord): Chord => (c.q === 'min' ? { root: c.root, q: 'min7' } : c.q === 'maj' ? { root: c.root, q: 'add9' } : c);

interface RiffNote {
  step: number;
  d: number;
  semi: number;
}

/** An improvised-sounding run of scale notes between two steps of the bar. */
function lick(r: Rng, ch: string, root: number, scale: ScaleName, chord: Chord, from: number, to: number, hi = 11): Ev[] {
  const out: Ev[] = [];
  let deg = r.int(3, 8);
  let s = from;
  while (s < to) {
    const len = r.pick([1, 1, 2, 2, 2, 3, 4]);
    if (r.chance(0.12)) {
      s += len;
      continue;
    }
    let n = degree(root, scale, deg);
    const long = len >= 3;
    if (s % 8 === 0 || long) n = nearestChordTone(chord, n);
    while (n > 88) n -= 12;
    out.push({ step: s, ch, n, d: Math.min(len, to - s), v: 0.75 + 0.25 * r.next(), a: long && r.chance(0.5) ? 'bend' : undefined });
    deg = Math.min(hi, Math.max(0, deg + r.pick([-3, -2, -1, -1, 1, 1, 2, 3])));
    s += len;
  }
  return out;
}

// ───────────────────────────── Pub rock ─────────────────────────────

const ROCK_RIFFS = ['x.x.x..x.x..x.x.', 'x..x..x.x..x..x.', 'x.x...x.x.x...x.', 'x...x.x...x.x.x.', 'x.xx..x.x.xx..x.'];
const ROCK_KICKS = ['x.......x.x.....', 'x.....x.x.......', 'x..x....x.x.....', 'x.x.....x..x....', 'x.......x..x..x.'];
const ROCK_STRUMS = ['x.....x...x.x...', 'x...x...x...x...', 'x..x..x.x..x..x.', 'x.....x.x.....x.'];
const ROCK_LEAD = ['x...x...x.x.....', 'x..x..x...x.....', '..x.x...x...x...', 'x.......x.x.x...', 'x.x.x...x.......', 'x.....x.x...x...'];

interface RockData {
  shuffle: boolean;
  riff: RiffNote[];
  riffVerse: boolean;
  kick: string;
  kick2: string;
  strum: string;
  motif: MotifNote[][];
  organ: boolean;
}

function makeRiff(r: Rng): RiffNote[] {
  const pool = [0, 0, 3, 5, 7, 10, 12, -2];
  let notes: RiffNote[] = [];
  for (let tries = 0; tries < 10; tries++) {
    const on = hits(r.pick(ROCK_RIFFS));
    let semi = 0;
    notes = on.map((step, k) => {
      const until = k + 1 < on.length ? on[k + 1] : STEPS_PER_BAR;
      const note = { step, d: Math.min(3, until - step), semi };
      semi = r.chance(0.35) ? 0 : r.pick(pool);
      return note;
    });
    notes[notes.length - 1].semi = r.pick([10, 7, 3, -2]);
    if (!isFamiliar(notes.map((n) => n.semi))) break;
  }
  return notes;
}

export const rock: Style = {
  id: 'rock',
  plan(seed) {
    const r = new Rng(seed);
    const shuffle = r.chance(0.28);
    const minor = !shuffle && r.chance(0.3);
    const key = r.pick([4, 9, 2, 7, 11, 0]);
    const tonic = minor ? 'i' : 'I';
    const verse = r.pick(
      minor
        ? [
            ['i', 'i', 'bVII', 'i'],
            ['i', 'bVI', 'bVII', 'i'],
            ['i', 'iv', 'i', 'bVII'],
          ]
        : [
            ['I', 'I', 'IV', 'I'],
            ['I', 'bVII', 'IV', 'I'],
            ['I', 'IV', 'I', 'V'],
            ['I', 'I', 'bVII', 'IV'],
          ],
    );
    const chorus = r.pick(
      minor
        ? [
            ['bVI', 'bVII', 'i', 'i'],
            ['iv', 'bVII', 'i', 'i'],
            ['bIII', 'bVII', 'i', 'i'],
          ]
        : [
            ['IV', 'V', 'I', 'I'],
            ['IV', 'I', 'V', 'V'],
            ['bVII', 'IV', 'I', 'I'],
            ['I', 'V', 'IV', 'IV'],
            ['vi', 'IV', 'I', 'V'],
          ],
    );
    const form: Form = [
      ['intro', 4, 0.6],
      ['verse', 8, 0.55],
      ['chorus', 8, 0.9],
      ['verse', 8, 0.62],
      ['chorus', 8, 0.95],
      ['solo', 8, 0.85],
      ['chorus', 8, 1],
      ['outro', 4, 0.8],
    ];
    const { sections, bars } = buildSections(form, key, { intro: [tonic], verse, chorus, solo: verse, outro: [tonic], default: verse });
    const scale: ScaleName = minor || r.chance(0.5) ? 'minPent' : 'majPent';
    const data: RockData = {
      shuffle,
      riff: makeRiff(r),
      riffVerse: !shuffle && r.chance(0.4),
      kick: r.pick(ROCK_KICKS),
      kick2: r.pick(ROCK_KICKS),
      strum: r.pick(ROCK_STRUMS),
      motif: freshMotif(r, { cells: ROCK_LEAD, lo: 0, hi: 9, scaleLen: 5, stable: scale === 'majPent' ? [0, 2, 3] : [0, 1, 3] }, 64, scale),
      organ: r.chance(0.6),
    };
    return { style: 'rock', seed, bpm: shuffle ? r.int(104, 126) : r.int(114, 144), shuffle: shuffle ? 0.9 : 0, swing: 0, key, scale, bars, sections, humanize: 0.004, data };
  },
  bar(plan, bar) {
    const out: Ev[] = [];
    const d = plan.data as RockData;
    const { sec, i } = sectionAt(plan, bar);
    const r = barRng(plan, bar);
    const ch = chordAt(sec, i);
    const nxt = nextChord(plan, bar);
    const k = sec.kind;
    const lastBar = i === sec.bars - 1;
    const bassRoot = rootAbove(ch, 31);
    const gtrRoot = rootAbove(ch, 40);
    const power = [gtrRoot, gtrRoot + 7, gtrRoot + 12];
    const tonic = pitchAbove(plan.key, 40);
    const leadRoot = pitchAbove(plan.key, 64);

    if (bar === plan.bars - 1) {
      // Last chord: hit it and let it ring.
      out.push({ step: 0, ch: 'kick', d: 1, v: 1 }, { step: 0, ch: 'crash', d: 1, v: 1 });
      out.push({ step: 0, ch: 'gtr', ns: [...power, gtrRoot + 19], d: 16, v: 1 }, { step: 0, ch: 'bass', n: bassRoot, d: 14, v: 1 });
      return out;
    }

    const loud = k === 'chorus' || k === 'solo' || k === 'outro';
    const sparse = k === 'intro' && i < 2;
    if (sparse) {
      row(out, 'hat', 'x...x...x...x...', 0.8);
    } else {
      row(out, 'kick', loud ? d.kick2 : d.kick);
      row(out, 'snare', '....x.......x...');
      if (loud) row(out, 'ride', 'x.o.x.o.x.o.x.o.', 0.8);
      else row(out, 'hat', 'x.o.x.o.x.o.x.o.');
      if (!loud && r.chance(0.3)) out.push({ step: 14, ch: 'ohat', d: 2, v: 0.7 });
      if (r.chance(0.25)) out.push({ step: 7, ch: 'snare', d: 1, v: 0.3 });
      if (i === 0) out.push({ step: 0, ch: 'crash', d: 1, v: loud ? 1 : 0.7 });
      if (lastBar) {
        clearFrom(out, 8, ['kick', 'snare', 'hat', 'ride', 'ohat']);
        out.push({ step: 8, ch: 'kick', d: 1, v: 0.9 });
        fill(out, r, 8);
      } else if (i % 4 === 3) {
        clearFrom(out, 12, ['snare', 'hat', 'ride', 'ohat']);
        fill(out, r, 4);
      }
    }

    // Bass, and the riff it doubles.
    const useRiff = k === 'intro' || k === 'outro' || (k === 'verse' && d.riffVerse);
    if (useRiff) {
      const base = k === 'verse' ? gtrRoot : tonic;
      for (const n of d.riff) {
        out.push({ step: n.step, ch: 'riff', n: base + n.semi, d: n.d, v: 0.9 });
        if (!sparse) out.push({ step: n.step, ch: 'bass', n: base + n.semi - 12, d: n.d, v: 0.9 });
      }
    } else {
      const third = isMinor(ch) ? 3 : 4;
      const boogie = [0, third, 7, 9, 10, 9, 7, third];
      for (let s = 0; s < 8; s++) {
        let n = d.shuffle ? bassRoot + boogie[s] : bassRoot;
        if (!d.shuffle && s === 3 && r.chance(0.3)) n += 12;
        if (!d.shuffle && s === 6 && r.chance(0.4)) n += 7;
        if (s === 7 && nxt.root !== ch.root) n = approach(r, rootAbove(nxt, 31));
        out.push({ step: s * 2, ch: 'bass', n, d: 2, v: s % 2 === 0 ? 0.95 : 0.8 });
      }
    }

    // Rhythm guitar.
    if (k === 'verse' && !d.riffVerse) {
      for (let s = 0; s < 8; s++) {
        if (d.shuffle) {
          // The boogie chug: fifth and sixth over the root.
          out.push({ step: s * 2, ch: 'gtrm', ns: [gtrRoot, gtrRoot + (s % 4 >= 2 ? 9 : 7)], d: 2, v: s % 2 === 0 ? 0.9 : 0.7 });
        } else {
          const accent = s === 0 || s === 3 || (s === 6 && r.chance(0.5));
          out.push({ step: s * 2, ch: accent ? 'gtr' : 'gtrm', ns: power, d: accent ? 2 : 1.5, v: accent ? 0.9 : 0.7 });
        }
      }
    } else if (loud && k !== 'outro') {
      const on = hits(d.strum);
      on.forEach((step, q) => {
        const until = q + 1 < on.length ? on[q + 1] : STEPS_PER_BAR;
        out.push({ step, ch: 'gtr', ns: [...power, gtrRoot + 19], d: until - step, v: step === 0 ? 1 : 0.85 });
      });
      if (d.organ) out.push({ step: 0, ch: 'organ', ns: voiceNear(ch, 62, 3), d: 15.5, v: 0.6 });
    }

    // Lead guitar.
    if (k === 'chorus') {
      const ph = phrase(i);
      // The last chorus goes up the neck (as far as the fretboard allows).
      out.push(...realize(d.motif[ph.bar], 'lead', leadRoot, plan.scale, ch, 0.85, (ph.vary ? 1 : 0) + (sec.nth === 2 ? 5 : 0), 88));
    } else if (k === 'solo') {
      out.push(...lick(r, 'lead', leadRoot, plan.scale, ch, 0, lastBar ? 8 : 16));
    } else if (k === 'verse' && i % 4 === 3 && !lastBar && r.chance(0.6)) {
      out.push(...lick(r, 'lead', leadRoot, plan.scale, ch, 8, 16, 8));
    }
    return out;
  },
};

// ───────────────────────────── Synth-pop / dance ─────────────────────────────

const STABS = ['x..x..x...x.x...', '..x...x.x..x..x.', 'x..x....x..x....', '...x..x...x...x.', 'x.....x..x..x...'];
const SYNTH_LEAD = ['x...x..x..x.....', 'x.x...x...x.x...', '..x..x..x...x...', 'x.....x.x..x....', 'x..x..x.....x.x.'];
const ARPS = [
  [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1],
  [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 3, 1, 2, 0, 1],
  [0, 1, 2, 0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3],
  [4, 2, 0, 2, 4, 2, 0, 2, 5, 3, 1, 3, 5, 3, 1, 3],
];

interface DanceData {
  bass: number;
  bassRiff: RiffNote[];
  stab: string;
  arp: number[];
  motif: MotifNote[][];
}

export const dance: Style = {
  id: 'dance',
  plan(seed) {
    const r = new Rng(seed);
    const key = r.int(0, 11);
    const prog = r.pick([
      ['i', 'bVI', 'bIII', 'bVII'],
      ['i', 'iv', 'bVI', 'bVII'],
      ['i', 'bVII', 'bVI', 'bVII'],
      ['i', 'bIII', 'bVII', 'iv'],
      ['bVI', 'bVII', 'i', 'i'],
      ['i', 'i', 'bVI', 'bVII'],
    ]);
    const form: Form = [
      ['intro', 8, 0.4],
      ['a', 16, 0.8],
      ['break', 8, 0.35],
      ['b', 16, 1],
      ['a', 16, 0.9],
      ['outro', 8, 0.4],
    ];
    const { sections, bars } = buildSections(form, key, { default: prog });
    const on = hits(r.pick(['x..x..x.x..x..x.', 'x.x..x..x.x..x.x', 'x..x.x..x..x.x..']));
    const bassRiff = on.map((step) => ({ step, d: 1, semi: step === 0 ? 0 : r.pick([0, 0, 0, 12, 7, 10, 12]) }));
    const data: DanceData = {
      bass: r.int(0, 2),
      bassRiff,
      stab: r.pick(STABS),
      arp: r.pick(ARPS),
      motif: freshMotif(r, { cells: SYNTH_LEAD, lo: 0, hi: 9, scaleLen: 7 }, 72, 'minor'),
    };
    return { style: 'dance', seed, bpm: r.int(122, 134), shuffle: 0, swing: 0, key, scale: 'minor', bars, sections, humanize: 0, data };
  },
  bar(plan, bar) {
    const out: Ev[] = [];
    const d = plan.data as DanceData;
    const { sec, i } = sectionAt(plan, bar);
    const r = barRng(plan, bar);
    const ch = chordAt(sec, i);
    const k = sec.kind;
    const main = k === 'a' || k === 'b';
    const intro = k === 'intro';
    const brk = k === 'break';
    const outro = k === 'outro';
    const lastBar = i === sec.bars - 1;
    const bassRoot = rootAbove(ch, 33);
    const leadRoot = pitchAbove(plan.key, 64);

    if (bar === plan.bars - 1) {
      out.push({ step: 0, ch: 'boom', d: 1, v: 0.9 }, { step: 0, ch: 'pad', ns: voiceNear(rich(ch), 57), d: 12, v: 0.5 });
      return out;
    }

    // Drum machine: layers come in and out with the arrangement.
    if (!brk) row(out, 'kick', 'x...x...x...x...');
    if (main || (intro && i >= 2) || (outro && i < 6) || (brk && i >= 2)) row(out, 'hat', 'g-.-g-.-g-.-g-.-', brk ? 0.6 : 1);
    if (main || (intro && i >= 4) || (outro && i < 4)) row(out, 'ohat', '..x...x...x...x.');
    if (main || (intro && i >= 4) || (outro && i < 2)) {
      row(out, 'clap', '....x.......x...');
      if (r.chance(0.2)) out.push({ step: 15, ch: 'clap', d: 1, v: 0.5 });
    }
    if (k === 'b') row(out, 'shaker', 'g-g-g-g-g-g-g-g-', 0.9);
    if (main && i === 0) out.push({ step: 0, ch: 'crash', d: 1, v: 0.9 }, { step: 0, ch: 'boom', d: 1, v: k === 'b' ? 1 : 0.6 });
    if (main && lastBar) {
      clearFrom(out, 12, ['kick', 'clap']);
      out.push({ step: 12, ch: 'clap', d: 1, v: 0.7 }, { step: 14, ch: 'clap', d: 1, v: 0.85 }, { step: 15, ch: 'clap', d: 1, v: 1 });
    }
    if (brk && i >= sec.bars - 2) {
      // The build: a snare roll that doubles up, a rising sweep and a swell into the drop.
      const dense = lastBar;
      for (let s = 0; s < STEPS_PER_BAR; s += dense ? 1 : 2) {
        const u = (s + (dense ? 16 : 0)) / 32;
        out.push({ step: s, ch: 'snare', d: 1, v: 0.35 + 0.65 * u });
      }
      if (!dense) out.push({ step: 0, ch: 'riser', d: 32, v: 1 });
      else out.push({ step: 8, ch: 'swell', d: 8, v: 0.9 });
    }

    // Bass.
    if (main || (intro && i >= 4) || (outro && i < 4)) {
      if (d.bass === 0) {
        for (const s of [2, 6, 10, 14]) out.push({ step: s, ch: 'bass', n: bassRoot, d: 1.6, v: 0.9 });
      } else if (d.bass === 1) {
        for (const [s, up] of [[0, 0], [2, 12], [3, 0], [6, 12], [8, 0], [10, 12], [11, 0], [14, 12]]) out.push({ step: s, ch: 'bass', n: bassRoot + up, d: 1, v: up ? 0.75 : 0.95 });
      } else {
        for (const n of d.bassRiff) out.push({ step: n.step, ch: 'bass', n: bassRoot + n.semi, d: n.d, v: n.step % 4 === 0 ? 0.95 : 0.8 });
      }
    }

    // Chord stabs, pad, arpeggio.
    const colour = rich(ch);
    if (main || (outro && i < 2)) {
      for (const s of hits(d.stab)) out.push({ step: s, ch: 'stab', ns: voiceNear(colour, 64), d: 1.5, v: s === 0 ? 0.9 : 0.75 });
    }
    if (brk || k === 'b' || (k === 'a' && sec.nth === 1)) out.push({ step: 0, ch: 'pad', ns: voiceNear(colour, 57), d: 15.5, v: brk ? 0.7 : 0.5 });
    if (brk || k === 'b') {
      const tones = stack(colour, 57);
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        const idx = d.arp[s];
        out.push({ step: s, ch: 'arp', n: tones[idx % tones.length] + 12 * Math.floor(idx / tones.length), d: 0.9, v: s % 4 === 0 ? 0.8 : 0.55 });
      }
    }

    // The tune.
    if (k === 'b' || (k === 'a' && sec.nth === 1 && i >= 8)) {
      const ph = phrase(i);
      out.push(...realize(d.motif[ph.bar], 'lead', leadRoot, 'minor', ch, 0.8, (ph.vary ? 2 : 0) + (k === 'a' ? 2 : 0)));
    }
    return out;
  },
};

// ───────────────────────────── Country & western ─────────────────────────────

const COUNTRY_LEAD = ['x...x.x.x...x...', 'x.x.x...x.....x.', '..x.x.x.x...x...', 'x.....x.x.x.x...', 'x...x...x.x.x.x.'];

interface CountryData {
  feel: 'twostep' | 'shuffle' | 'ballad';
  lead: 'fiddle' | 'tele';
  motif: MotifNote[][];
  motifB: MotifNote[][];
}

export const country: Style = {
  id: 'country',
  plan(seed) {
    const r = new Rng(seed);
    const key = r.pick([7, 0, 2, 9, 4, 5]);
    const feel = r.pick(['twostep', 'twostep', 'shuffle', 'ballad'] as const);
    const verse = r.pick([
      ['I', 'I', 'IV', 'I', 'I', 'I', 'V7', 'V7'],
      ['I', 'IV', 'I', 'V7', 'I', 'IV', 'V7', 'I'],
      ['I', 'I', 'IV', 'IV', 'V7', 'V7', 'I', 'I'],
      ['I', 'vi', 'IV', 'V7', 'I', 'vi', 'IV', 'V7'],
    ]);
    const chorus = r.pick([
      ['IV', 'IV', 'I', 'I', 'V7', 'V7', 'I', 'I'],
      ['IV', 'I', 'V7', 'I', 'IV', 'I', 'V7', 'I'],
      ['IV', 'V7', 'I', 'vi', 'IV', 'V7', 'I', 'I'],
    ]);
    const form: Form = [
      ['intro', 4, 0.5],
      ['verse', 8, 0.55],
      ['chorus', 8, 0.8],
      ['verse', 8, 0.62],
      ['chorus', 8, 0.85],
      ['solo', 8, 0.8],
      ['chorus', 8, 0.95],
      ['outro', 4, 0.6],
    ];
    const { sections, bars } = buildSections(form, key, { intro: ['I', 'IV', 'I', 'V7'], verse, chorus, solo: verse, outro: ['IV', 'V7', 'I', 'I'], default: verse });
    const opts = { cells: COUNTRY_LEAD, lo: -2, hi: 8, scaleLen: 5, stable: [0, 2, 3], maxLen: 5 };
    const data: CountryData = {
      feel,
      lead: r.pick(['fiddle', 'tele'] as const),
      motif: freshMotif(r, opts, 67, 'majPent'),
      motifB: freshMotif(r, opts, 67, 'majPent'),
    };
    const bpm = feel === 'ballad' ? r.int(72, 86) : feel === 'shuffle' ? r.int(96, 116) : r.int(104, 128);
    return { style: 'country', seed, bpm, shuffle: feel === 'shuffle' ? 0.85 : 0, swing: feel === 'ballad' ? 0.1 : 0, key, scale: 'majPent', bars, sections, humanize: 0.005, data };
  },
  bar(plan, bar) {
    const out: Ev[] = [];
    const d = plan.data as CountryData;
    const { sec, i } = sectionAt(plan, bar);
    const r = barRng(plan, bar);
    const ch = chordAt(sec, i);
    const nxt = nextChord(plan, bar);
    const k = sec.kind;
    const lastBar = i === sec.bars - 1;
    const ballad = d.feel === 'ballad';
    const bassRoot = rootAbove(ch, 31);
    const fifth = bassRoot + 7 > 45 ? bassRoot - 5 : bassRoot + 7;
    const gv = guitarVoicing(ch, 40);
    const leadRoot = pitchAbove(plan.key, 62);
    const double = voiceNear(ch, 67, 3);

    if (bar === plan.bars - 1) {
      out.push({ step: 0, ch: 'kick', d: 1, v: 0.8 }, { step: 0, ch: 'crash', d: 1, v: 0.6 }, { step: 0, ch: 'bass', n: bassRoot, d: 12, v: 0.9 });
      out.push({ step: 0, ch: 'strum', ns: gv, d: 16, v: 0.9 }, { step: 0, ch: 'steel', n: double[1], d: 14, v: 0.8 }, { step: 0, ch: 'steel2', n: double[2], d: 14, v: 0.7 });
      return out;
    }

    // Drums: brushes, and a train beat when things pick up.
    if (!(k === 'intro' && i < 2)) {
      row(out, 'kick', ballad ? 'x.........o.....' : 'x.......x.......', 0.8);
      if (ballad) {
        row(out, 'rim', '....x.......x...');
        row(out, 'shaker', 'o.g.o.g.o.g.o.g.', 0.6);
      } else if (sec.energy > 0.7) {
        row(out, 'brush', 'g-g-x-g-g-g-x-g-', 0.75);
      } else {
        row(out, 'brush', '....x.......x...');
        row(out, 'hat', '..o...o...o...o.', 0.6);
      }
      if (lastBar) for (let s = 12; s < 16; s++) out.push({ step: s, ch: 'brush', d: 1, v: 0.5 + 0.12 * (s - 12) });
    }

    // Bass: root and fifth, walking up to the next chord.
    out.push({ step: 0, ch: 'bass', n: bassRoot, d: 3.5, v: 0.95 });
    if (nxt.root !== ch.root && !ballad) {
      const target = rootAbove(nxt, 31);
      out.push({ step: 8, ch: 'bass', n: bassRoot, d: 3, v: 0.85 }, { step: 12, ch: 'bass', n: target - 2, d: 2, v: 0.8 }, { step: 14, ch: 'bass', n: target - 1, d: 2, v: 0.85 });
    } else {
      out.push({ step: 8, ch: 'bass', n: fifth, d: 3.5, v: 0.85 });
    }

    // Acoustic guitar: boom-chick, or picked arpeggios in a ballad.
    if (ballad) {
      const order = [0, 2, 3, 4, 3, 2, 3, 4];
      for (let s = 0; s < 8; s++) out.push({ step: s * 2, ch: 'pick', n: gv[order[s] % gv.length], d: 3, v: s % 4 === 0 ? 0.8 : 0.6 });
    } else {
      out.push({ step: 0, ch: 'pick', n: gv[0], d: 3, v: 0.8 }, { step: 8, ch: 'pick', n: gv[1], d: 3, v: 0.7 });
      out.push({ step: 4, ch: 'strum', ns: gv.slice(2), d: 2.5, v: 0.8 }, { step: 12, ch: 'strum', ns: gv.slice(2), d: 2.5, v: 0.8 });
      if (sec.energy > 0.6) out.push({ step: 6, ch: 'strum', ns: gv.slice(3), d: 1.5, v: 0.5, a: 'up' }, { step: 14, ch: 'strum', ns: gv.slice(3), d: 1.5, v: 0.5, a: 'up' });
    }

    // Pedal steel: slow double-stops sliding from chord to chord.
    const steelOn = k === 'chorus' || k === 'outro' || (k === 'verse' && i % 2 === 1) || (k === 'intro' && i >= 2);
    if (steelOn) {
      out.push({ step: 0, ch: 'steel', n: double[1], d: 14, v: 0.7 });
      if (k !== 'verse') out.push({ step: 0, ch: 'steel2', n: double[2], d: 14, v: 0.6 });
    }

    // The tune: fiddle or picked guitar, harmonised in the chorus; the other one takes the solo.
    const ph = phrase(i);
    if (k === 'verse') {
      out.push(...realize(d.motif[ph.bar], d.lead, leadRoot, 'majPent', ch, 0.8, ph.vary ? 1 : 0));
    } else if (k === 'chorus') {
      const shift = ph.vary ? 1 : 0;
      out.push(...realize(d.motifB[ph.bar], d.lead, leadRoot, 'majPent', ch, 0.85, shift));
      if (d.lead === 'fiddle') out.push(...realize(d.motifB[ph.bar], 'fiddle2', leadRoot, 'majPent', ch, 0.6, shift - 2));
    } else if (k === 'solo') {
      out.push(...lick(r, d.lead === 'fiddle' ? 'tele' : 'fiddle', leadRoot, 'majPent', ch, 0, lastBar ? 10 : 16, 9));
    } else if (k === 'intro' && i === 3) {
      // A run up into the first verse.
      [-2, -1, 0, 1].forEach((deg, q) => out.push({ step: 8 + q * 2, ch: 'tele', n: degree(leadRoot, 'majPent', deg), d: 2, v: 0.8 }));
    }
    return out;
  },
};

// ───────────────────────────── Dub / roots ─────────────────────────────

const DUB_BASS = ['x..x..x.x.......', 'x.....x.x..x....', 'x..x....x.x...x.', 'x.x...x...x.x...', 'x...x..x..x.....', '..x.x...x..x..x.'];
const DUB_HORN = ['x.......x...x...', 'x...x.......x.x.', '....x...x.......', 'x.x.....x.......', 'x.......x.x.....'];

interface DubData {
  feel: number;
  /** Two bars of bass: steps, lengths and rungs of the chord ladder (root, third, fifth, seventh, octave). */
  riff: { step: number; d: number; rung: number }[][];
  horn: MotifNote[][];
  bubble: boolean;
  melodica: boolean;
}

export const dub: Style = {
  id: 'dub',
  plan(seed) {
    const r = new Rng(seed);
    const key = r.pick([9, 2, 7, 4, 0, 11]);
    const vamp = r.pick([
      ['i', 'iv'],
      ['i', 'bVII'],
      ['i', 'v'],
      ['i', 'i', 'iv', 'iv'],
      ['i', 'bVII', 'bVI', 'bVII'],
      ['i', 'i', 'bVII', 'iv'],
    ]);
    const form: Form = [
      ['intro', 4, 0.4],
      ['a', 8, 0.7],
      ['a', 8, 0.8],
      ['dub', 8, 0.5],
      ['a', 8, 0.85],
      ['dub', 8, 0.45],
      ['a', 8, 0.9],
      ['outro', 4, 0.4],
    ];
    const { sections, bars } = buildSections(form, key, { default: vamp });
    const riff = [0, 1].map(() => {
      const on = hits(r.pick(DUB_BASS));
      return on.map((step, q) => {
        const until = q + 1 < on.length ? on[q + 1] : STEPS_PER_BAR;
        return { step, d: Math.min(4, until - step), rung: q === 0 ? 0 : r.pick([0, 0, 0, 2, 2, 4, 1, 3]) };
      });
    });
    const data: DubData = {
      feel: r.int(0, 2),
      riff,
      horn: freshMotif(r, { cells: DUB_HORN, lo: 0, hi: 7, scaleLen: 7, maxLen: 6 }, 60, 'minor'),
      bubble: r.chance(0.7),
      melodica: r.chance(0.5),
    };
    return { style: 'dub', seed, bpm: r.int(66, 80), shuffle: 0, swing: r.range(0.3, 0.55), key, scale: 'minor', bars, sections, humanize: 0.006, data };
  },
  bar(plan, bar) {
    const out: Ev[] = [];
    const d = plan.data as DubData;
    const { sec, i } = sectionAt(plan, bar);
    const r = barRng(plan, bar);
    const ch = chordAt(sec, i);
    const k = sec.kind;
    const dubbed = k === 'dub';
    const intro = k === 'intro';
    const outro = k === 'outro';
    const bassRoot = rootAbove(ch, 33);
    const ladder = [0, isMinor(ch) ? 3 : 4, 7, 10, 12];
    const skank = voiceNear(ch, 67, 3);
    const leadRoot = pitchAbove(plan.key, 60);

    if (bar === plan.bars - 1) {
      // The bass comes home, and one last chop is thrown into the echo.
      out.push({ step: 0, ch: 'bass', n: bassRoot, d: 10, v: 1 });
      out.push({ step: 2, ch: 'skank', ns: skank, d: 1, v: 0.9 }, { step: 2, ch: 'throw', a: 'skank', d: 3, v: 1 }, { step: 4, ch: 'rim', d: 1, v: 0.8 }, { step: 4, ch: 'throw', a: 'snare', d: 2, v: 1 });
      return out;
    }

    // Drums.
    if (!(intro && i < 3) && !(outro && i >= 2)) {
      if (d.feel === 0) row(out, 'kick', '....x.......x...');
      else if (d.feel === 1) row(out, 'kick', 'x...x...x...x...', 0.9);
      else row(out, 'kick', 'x.....o.x.......');
      row(out, 'rim', '....x.......x...');
      if (dubbed && r.chance(0.5)) out.push({ step: 12, ch: 'throw', a: 'snare', d: 2, v: 1 });
    }
    if (!(outro && i >= 3)) {
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        if (s % 2 === 0) out.push({ step: s, ch: s === 14 && r.chance(0.15) ? 'ohat' : 'hat', d: 1, v: s % 4 === 2 ? 0.7 : 0.4 });
        else if (r.chance(0.25)) out.push({ step: s, ch: 'hat', d: 1, v: 0.25 });
      }
    }
    if (i % 4 === 3 || (intro && i === 3)) {
      // A little roll to turn the phrase around.
      if (r.chance(0.5)) [13, 14, 15].forEach((s, q) => out.push({ step: s, ch: q === 2 ? 'tomMid' : 'tomHi', d: 1, v: 0.6 + 0.15 * q }));
      else out.push({ step: 14, ch: 'rim', d: 1, v: 0.6 }, { step: 15, ch: 'rim', d: 1, v: 0.8 });
    }

    // Bass: the tune of the thing. It drops out for a couple of bars in the second dub.
    const bassOut = (intro && i < 2) || (outro && i >= 3) || (dubbed && sec.nth === 1 && (i === 2 || i === 3));
    if (!bassOut) for (const n of d.riff[i % 2]) out.push({ step: n.step, ch: 'bass', n: bassRoot + ladder[n.rung], d: n.d, v: n.step === 0 ? 1 : 0.88 });

    // Skank on the off-beats; in the dub sections just the odd chop sent spinning through the delay.
    if (dubbed) {
      if (i % 2 === 1) out.push({ step: 6, ch: 'skank', ns: skank, d: 1, v: 0.85 }, { step: 6, ch: 'throw', a: 'skank', d: 2, v: 1 });
    } else {
      for (const s of [2, 6, 10, 14]) out.push({ step: s, ch: 'skank', ns: skank, d: 0.9, v: 0.75 });
      if (r.chance(0.2)) out.push({ step: r.pick([3, 11]), ch: 'skank', ns: skank, d: 0.7, v: 0.45 });
      if (d.bubble && !(intro && i < 1)) {
        const low = voiceNear(ch, 55, 3);
        for (const s of [0, 3, 4, 7, 8, 11, 12, 15]) out.push({ step: s, ch: 'bubble', ns: low, d: 0.7, v: s % 4 === 0 ? 0.4 : 0.3 });
      }
    }

    // Horns answer every other two bars; a melodica may take the last verse.
    if (k === 'a' && sec.nth >= 1 && i % 4 < 2) {
      const voice = d.melodica && sec.nth === 3 ? 'melodica' : 'horn';
      out.push(...realize(d.horn[i % 2], voice, leadRoot, 'minor', ch, 0.8));
      if (voice === 'horn') out.push(...realize(d.horn[i % 2], 'horn', leadRoot, 'minor', ch, 0.5, 2));
      if (i % 4 === 1 && r.chance(0.5)) out.push({ step: 12, ch: 'throw', a: 'horn', d: 3, v: 1 });
    }
    return out;
  },
};

// ───────────────────────────── Student radio indie ─────────────────────────────

const STRUMS_VERSE = ['d...d.u...u.d.u.', 'd.....u.d.u...u.', 'd...d...d.u.d.u.', 'd.u...u.d...d.u.'];
const STRUMS_CHORUS = ['d.d.d.u.d.d.d.u.', 'd.dud.u.d.dud.u.', 'd...d.udd...d.ud'];
const INDIE_LEAD = ['x.......x...x...', 'x...x.......x...', 'x.....x...x.....', '..x...x...x...x.', 'x...........x.x.'];
const INDIE_KICKS = ['x.....x.x.......', 'x...x.x.x...x.x.', 'x.......x.x.....', 'x..x..x.x..x....'];
const COLOURS: Record<string, string[]> = {
  I: ['I', 'Iadd9', 'Imaj7', 'Isus2'],
  IV: ['IV', 'IVmaj7', 'IVadd9'],
  V: ['V', 'Vsus4'],
  vi: ['vi', 'vi7'],
  ii: ['ii', 'ii7'],
  iii: ['iii', 'iii7'],
};

interface IndieData {
  strumV: string;
  strumC: string;
  bass: number;
  kick: string;
  motif: MotifNote[][];
  keys: MotifNote[][];
}

export const indie: Style = {
  id: 'indie',
  plan(seed) {
    const r = new Rng(seed);
    const key = r.pick([2, 7, 9, 4, 0]);
    const slack = r.chance(0.3);
    const colour = (syms: string[]) => syms.map((s) => (COLOURS[s] ? r.pick(COLOURS[s]) : s));
    const verse = colour(
      r.pick([
        ['I', 'iii', 'IV', 'IV'],
        ['I', 'IV', 'I', 'IV'],
        ['vi', 'IV', 'I', 'V'],
        ['I', 'ii', 'IV', 'I'],
        ['I', 'bVII', 'IV', 'I'],
        ['I', 'V', 'ii', 'IV'],
      ]),
    );
    const chorus = colour(
      r.pick([
        ['IV', 'V', 'I', 'vi'],
        ['IV', 'I', 'V', 'V'],
        ['ii', 'IV', 'I', 'I'],
        ['vi', 'V', 'IV', 'IV'],
        ['IV', 'IV', 'I', 'V'],
      ]),
    );
    const bridge = r.pick([
      ['vi', 'IV', 'vi', 'V'],
      ['ii', 'ii', 'IV', 'V'],
    ]);
    const form: Form = [
      ['intro', 4, 0.4],
      ['verse', 8, 0.55],
      ['chorus', 8, 0.9],
      ['verse', 8, 0.65],
      ['chorus', 8, 0.95],
      ['bridge', r.pick([6, 8]), 0.4],
      ['chorus', 8, 1],
      ['outro', 4, 0.5],
    ];
    const { sections, bars } = buildSections(form, key, { intro: verse, verse, chorus, bridge, outro: verse, default: verse });
    const data: IndieData = {
      strumV: r.pick(STRUMS_VERSE),
      strumC: r.pick(STRUMS_CHORUS),
      bass: r.int(0, 1),
      kick: r.pick(INDIE_KICKS),
      motif: freshMotif(r, { cells: INDIE_LEAD, lo: 0, hi: 8, scaleLen: 7, maxLen: 8 }, 64, 'major'),
      keys: freshMotif(r, { cells: INDIE_LEAD, lo: 0, hi: 9, scaleLen: 7, maxLen: 4 }, 76, 'major'),
    };
    return { style: 'indie', seed, bpm: slack ? r.int(84, 102) : r.int(118, 150), shuffle: 0, swing: slack ? 0.15 : 0, key, scale: 'major', bars, sections, humanize: 0.012, data };
  },
  bar(plan, bar) {
    const out: Ev[] = [];
    const d = plan.data as IndieData;
    const { sec, i } = sectionAt(plan, bar);
    const r = barRng(plan, bar);
    const ch = chordAt(sec, i);
    const nxt = nextChord(plan, bar);
    const k = sec.kind;
    const lastBar = i === sec.bars - 1;
    const bassRoot = rootAbove(ch, 31);
    const gv = guitarVoicing(ch, 40);
    const top = gv.slice(1);
    const leadRoot = pitchAbove(plan.key, 62);

    if (bar === plan.bars - 1) {
      out.push({ step: 0, ch: 'kick', d: 1, v: 0.9 }, { step: 0, ch: 'crash', d: 1, v: 0.8 }, { step: 0, ch: 'strum', ns: gv, d: 16, v: 0.9 }, { step: 0, ch: 'bass', n: bassRoot, d: 12, v: 0.9 });
      return out;
    }

    const quiet = k === 'intro' || k === 'bridge';
    // Drums.
    if (k === 'bridge') {
      row(out, 'tomLo', 'x...o...x...o...', 0.8);
      out.push({ step: 12, ch: 'rim', d: 1, v: 0.7 });
    } else if (!(k === 'intro' && i < 2)) {
      row(out, 'kick', d.kick);
      row(out, 'snare', '....x.......x...');
      row(out, 'hat', 'x.o.x.o.x.o.x.o.', 0.9);
      if (k === 'chorus') {
        row(out, 'tamb', 'o.-.o.-.o.-.o.-.');
        if (i === 0) out.push({ step: 0, ch: 'crash', d: 1, v: 0.9 });
        if (r.chance(0.4)) out.push({ step: 14, ch: 'ohat', d: 2, v: 0.6 });
      }
    }
    if (lastBar && k !== 'intro') {
      clearFrom(out, 12, ['hat', 'tamb', 'snare', 'tomLo']);
      for (const s of r.chance(0.5) ? [12, 14, 15] : [12, 13, 14, 15]) out.push({ step: s, ch: k === 'bridge' ? 'tomMid' : 'snare', d: 1, v: 0.6 + 0.1 * (s - 12) });
    }

    // Bass.
    if (!(k === 'intro' && i < 2)) {
      const target = nxt.root !== ch.root ? approach(r, rootAbove(nxt, 31)) : bassRoot;
      if (k === 'bridge') {
        out.push({ step: 0, ch: 'bass', n: bassRoot, d: 14, v: 0.85 });
      } else if (d.bass === 0) {
        for (let s = 0; s < 8; s++) out.push({ step: s * 2, ch: 'bass', n: s === 7 ? target : bassRoot, d: 2, v: s % 2 === 0 ? 0.9 : 0.75 });
      } else {
        const third = bassRoot + (isMinor(ch) ? 3 : 4);
        out.push({ step: 0, ch: 'bass', n: bassRoot, d: 5, v: 0.95 }, { step: 6, ch: 'bass', n: bassRoot + 7, d: 2, v: 0.8 });
        out.push({ step: 8, ch: 'bass', n: bassRoot + 12, d: 3, v: 0.85 }, { step: 12, ch: 'bass', n: third, d: 2, v: 0.8 }, { step: 14, ch: 'bass', n: target, d: 2, v: 0.8 });
      }
    }

    // Guitars: picked arpeggios when quiet, strummed otherwise, fuzz on top in the chorus.
    if (quiet) {
      const order = [0, 2, 1, 3, 2, 4, 3, 2];
      for (let s = 0; s < 8; s++) out.push({ step: s * 2, ch: 'pick', n: top[order[s] % top.length], d: 4, v: s % 4 === 0 ? 0.8 : 0.6 });
    } else {
      const pat = k === 'chorus' ? d.strumC : d.strumV;
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        const c = pat[s];
        if (c !== 'd' && c !== 'u') continue;
        let until = s + 1;
        while (until < STEPS_PER_BAR && pat[until] === '.') until++;
        if (c === 'd') out.push({ step: s, ch: 'strum', ns: top, d: until - s, v: s % 8 === 0 ? 0.9 : 0.75 });
        else out.push({ step: s, ch: 'strum', ns: top.slice(1), d: until - s, v: 0.55, a: 'up' });
      }
      if (k === 'chorus') {
        const root = gv[0];
        out.push({ step: 0, ch: 'fuzzgtr', ns: [root, root + 7, root + 12], d: 8, v: 0.9 }, { step: 8, ch: 'fuzzgtr', ns: [root, root + 7, root + 12], d: 8, v: 0.8 });
      }
    }

    // Hooks: a fuzz lead in the chorus, a cheap keyboard in the second verse and on the way out.
    const ph = phrase(i);
    if (k === 'chorus') out.push(...realize(d.motif[ph.bar], 'fuzz', leadRoot, 'major', ch, 0.8, ph.vary ? 2 : 0));
    else if ((k === 'verse' && sec.nth === 1) || k === 'outro') out.push(...realize(d.keys[ph.bar], 'casio', leadRoot + 12, 'major', ch, 0.7, ph.vary ? 1 : 0));
    return out;
  },
};

// ───────────────────────────── Hold music ─────────────────────────────

const LOUNGE_LEAD = ['x.....x...x.....', '..x...x.....x...', 'x...x.....x.x...', '....x...x...x...', 'x.........x...x.'];

interface LoungeData {
  lead: 'vibes' | 'flute';
  motifA: MotifNote[][];
  motifB: MotifNote[][];
}

export const lounge: Style = {
  id: 'lounge',
  plan(seed) {
    const r = new Rng(seed);
    const key = r.pick([5, 10, 3, 0, 7]);
    const a = r.pick([
      ['Imaj7', 'vi7', 'ii7', 'V7'],
      ['Imaj7', 'IVmaj7', 'ii7', 'V7'],
      ['Imaj7', 'iii7', 'IVmaj7', 'V7'],
    ]);
    const b = r.pick([
      ['IVmaj7', 'iii7', 'ii7', 'V7'],
      ['ii7', 'V7', 'Imaj7', 'vi7'],
      ['vi7', 'ii7', 'V7', 'Imaj7'],
    ]);
    const form: Form = r.chance(0.5)
      ? [
          ['a', 8, 0.5],
          ['a', 8, 0.6],
          ['b', 8, 0.7],
          ['a', 8, 0.65],
        ]
      : [
          ['a', 8, 0.5],
          ['b', 8, 0.65],
          ['a', 8, 0.6],
        ];
    const { sections, bars } = buildSections(form, key, { a, b, default: a });
    const opts = { cells: LOUNGE_LEAD, lo: 0, hi: 9, scaleLen: 7, maxLen: 6 };
    const data: LoungeData = { lead: r.pick(['vibes', 'flute'] as const), motifA: freshMotif(r, opts, 72, 'major'), motifB: freshMotif(r, opts, 72, 'major') };
    return { style: 'lounge', seed, bpm: r.int(96, 116), shuffle: 0, swing: 0.12, key, scale: 'major', bars, sections, humanize: 0.004, data };
  },
  bar(plan, bar) {
    const out: Ev[] = [];
    const d = plan.data as LoungeData;
    const { sec, i } = sectionAt(plan, bar);
    const r = barRng(plan, bar);
    const ch = chordAt(sec, i);
    const nxt = nextChord(plan, bar);
    const bassRoot = rootAbove(ch, 33);
    const fifth = bassRoot + 7 > 47 ? bassRoot - 5 : bassRoot + 7;
    const leadRoot = pitchAbove(plan.key, 67);
    const odd = bar % 2 === 1;

    // A polite bossa: soft kick, clave, shaker.
    row(out, 'kick', 'x.....o.x.....o.', 0.7);
    row(out, 'clave', odd ? '..x.x...x..x....' : 'x..x..x...x.x...', 0.8);
    row(out, 'shaker', 'o.g.o.g.o.g.o.g.', 0.7);
    out.push({ step: 0, ch: 'bass', n: bassRoot, d: 5, v: 0.9 }, { step: 6, ch: 'bass', n: fifth, d: 2, v: 0.75 }, { step: 8, ch: 'bass', n: bassRoot, d: 5, v: 0.85 });
    out.push({ step: 14, ch: 'bass', n: nxt.root !== ch.root ? rootAbove(nxt, 33) - 1 : fifth, d: 2, v: 0.75 });
    const voicing = voiceNear(ch, 62);
    for (const s of odd ? [3, 8, 14] : [0, 6, 11]) out.push({ step: s, ch: 'ep', ns: voicing, d: 3.5, v: 0.55 + 0.15 * r.next() });
    if (sec.kind === 'b') {
      const tones = stack(ch, 55);
      for (let s = 0; s < 8; s++) out.push({ step: s * 2, ch: 'nylon', n: tones[[0, 1, 2, 3, 2, 1, 2, 3][s] % tones.length], d: 3, v: 0.5 });
    }
    if (sec.kind === 'b' || sec.nth >= 1) {
      const ph = phrase(i);
      out.push(...realize(sec.kind === 'b' ? d.motifB[ph.bar] : d.motifA[ph.bar], d.lead, leadRoot, 'major', ch, 0.7, ph.vary ? 1 : 0));
    }
    // "Your call is important to us."
    if (i % 8 === 7) {
      const pip = pitchAbove(plan.key, 84);
      out.push({ step: 12, ch: 'beep', n: pip, d: 1, v: 0.6 }, { step: 14, ch: 'beep', n: pip, d: 1, v: 0.6 });
    }
    return out;
  },
};
