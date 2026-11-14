/** The band behind each station: instruments, channel strips and broadcast tone. Data only. */
import { ACOUSTIC, NYLON, PATCH, STEEL, type Inst, type Kit } from './kit';

const drum = (bus: string, d: Extract<Inst, { type: 'drum' }>['drum'], gain: number, extra: Partial<Extract<Inst, { type: 'drum' }>> = {}): Inst => ({ type: 'drum', bus, drum: d, gain, ...extra });
const synth = (bus: string, patch: Extract<Inst, { type: 'synth' }>['patch'], gain: number, oct = 0): Inst => ({ type: 'synth', bus, patch, gain, oct });

/** Pub rock: loud guitars, real-ish drums, a bit of organ. */
export const ROCK_KIT: Kit = {
  strips: {
    drums: { gain: 0.8, rev: 0.06 },
    snare: { gain: 0.8, rev: 0.2 },
    bass: { gain: 0.55 },
    gtr: { gain: 0.2, drive: 7, lp: 4200, hp: 90, rev: 0.08, pan: -0.3 },
    lead: { gain: 0.2, drive: 10, lp: 3600, hp: 160, rev: 0.22, del: 0.18, pan: 0.25 },
    organ: { gain: 0.3, rev: 0.2, pan: 0.35 },
  },
  insts: {
    kick: drum('drums', 'kickRock', 0.75),
    snare: drum('snare', 'snareRock', 0.62),
    hat: drum('drums', 'hatC', 0.26, { choke: 'hat' }),
    ohat: drum('drums', 'hatO', 0.26, { choke: 'hat' }),
    ride: drum('drums', 'ride', 0.24),
    crash: drum('drums', 'crash', 0.36),
    tomHi: drum('snare', 'tomHi', 0.6),
    tomMid: drum('snare', 'tomMid', 0.62),
    tomLo: drum('snare', 'tomLo', 0.66),
    bass: synth('bass', PATCH.pickBass, 0.8),
    gtr: { type: 'pluck', bus: 'gtr', string: STEEL, id: 'steel', gain: 0.55, strum: 0.011 },
    gtrm: { type: 'pluck', bus: 'gtr', string: STEEL, id: 'steel', gain: 0.6, strum: 0.004, mute: 0.05 },
    riff: { type: 'pluck', bus: 'gtr', string: STEEL, id: 'steel', gain: 0.7 },
    lead: { type: 'pluck', bus: 'lead', string: STEEL, id: 'steel', gain: 0.7 },
    organ: synth('organ', PATCH.organ, 0.5),
  },
  delay: { steps: 3, feedback: 0.3, lp: 2600 },
  reverb: 0.7,
  tone: 'fm',
  level: 0.8,
};

/** Synth-pop / dance: drum machine, pumping pads, arpeggios. */
export const DANCE_KIT: Kit = {
  strips: {
    drums: { gain: 0.8, rev: 0.04 },
    clap: { gain: 0.7, rev: 0.25 },
    bass: { gain: 0.5, pump: 0.55 },
    stab: { gain: 0.34, rev: 0.25, del: 0.2, pan: -0.2, pump: 0.3 },
    pad: { gain: 0.3, rev: 0.35, pump: 0.6 },
    arp: { gain: 0.24, rev: 0.2, del: 0.45, pan: 0.3 },
    lead: { gain: 0.3, rev: 0.25, del: 0.3 },
    fx: { gain: 0.3, rev: 0.4 },
  },
  insts: {
    kick: drum('drums', 'kickElectro', 0.8, { pump: true }),
    clap: drum('clap', 'clap', 0.6),
    snare: drum('clap', 'snareRock', 0.45),
    hat: drum('drums', 'hatEC', 0.2, { choke: 'hat' }),
    ohat: drum('drums', 'hatEO', 0.24, { choke: 'hat' }),
    shaker: drum('drums', 'shaker', 0.14),
    crash: drum('fx', 'crash', 0.6),
    boom: drum('fx', 'boom', 0.8),
    swell: drum('fx', 'swell', 0.6),
    riser: { type: 'riser', bus: 'fx', gain: 0.5 },
    bass: synth('bass', PATCH.synthBass, 0.8),
    stab: synth('stab', PATCH.stab, 0.9),
    pad: synth('pad', PATCH.pad, 0.8),
    arp: synth('arp', PATCH.arp, 0.8),
    lead: synth('lead', PATCH.sawLead, 0.7),
  },
  delay: { steps: 3, feedback: 0.42, lp: 3200 },
  reverb: 0.8,
  tone: 'fm',
  level: 0.8,
};

/** Country & western: brushes, upright bass, acoustic guitar, pedal steel, fiddle. Broadcast on AM. */
export const COUNTRY_KIT: Kit = {
  strips: {
    drums: { gain: 0.6, rev: 0.12 },
    bass: { gain: 0.6 },
    gtr: { gain: 0.5, rev: 0.12, pan: -0.25 },
    tele: { gain: 0.4, drive: 1.6, lp: 5000, hp: 140, rev: 0.2, del: 0.12, pan: 0.2 },
    steel: { gain: 0.3, rev: 0.5, del: 0.15, pan: 0.3 },
    fiddle: { gain: 0.26, rev: 0.3, pan: -0.1 },
  },
  insts: {
    kick: drum('drums', 'kickSoft', 0.7),
    brush: drum('drums', 'brush', 0.5),
    rim: drum('drums', 'rim', 0.4),
    hat: drum('drums', 'hatC', 0.16),
    shaker: drum('drums', 'shaker', 0.2),
    crash: drum('drums', 'crash', 0.25),
    bass: synth('bass', PATCH.upright, 0.9),
    pick: { type: 'pluck', bus: 'gtr', string: ACOUSTIC, id: 'acoustic', gain: 0.6 },
    strum: { type: 'pluck', bus: 'gtr', string: ACOUSTIC, id: 'acoustic', gain: 0.45, strum: 0.014 },
    tele: { type: 'pluck', bus: 'tele', string: STEEL, id: 'steel', gain: 0.7 },
    steel: synth('steel', PATCH.steel, 0.7),
    steel2: synth('steel', PATCH.steel, 0.55),
    fiddle: synth('fiddle', PATCH.fiddle, 0.7),
    fiddle2: synth('fiddle', PATCH.fiddle, 0.45),
  },
  delay: { steps: 2, feedback: 0.22, lp: 2400 },
  reverb: 0.8,
  tone: 'am',
  level: 0.85,
};

/** Dub / roots: deep bass, one-drop drums, organ skank, horns and a lot of echo. */
export const DUB_KIT: Kit = {
  strips: {
    drums: { gain: 0.75, rev: 0.05, del: 0 },
    snare: { gain: 0.7, rev: 0.4, del: 0.06 },
    bass: { gain: 0.6 },
    skank: { gain: 0.3, rev: 0.2, del: 0.12, pan: -0.25, hp: 220 },
    bubble: { gain: 0.2, rev: 0.15, pan: 0.3, lp: 1800 },
    horn: { gain: 0.28, rev: 0.35, del: 0.25, pan: 0.15 },
  },
  insts: {
    kick: drum('drums', 'kickDub', 0.85),
    rim: drum('snare', 'rim', 0.6),
    snare: drum('snare', 'snareRock', 0.4),
    hat: drum('drums', 'hatC', 0.2, { choke: 'hat' }),
    ohat: drum('drums', 'hatO', 0.2, { choke: 'hat' }),
    tomHi: drum('snare', 'tomHi', 0.5),
    tomMid: drum('snare', 'tomMid', 0.5),
    bass: synth('bass', PATCH.subBass, 0.95),
    skank: synth('skank', PATCH.skank, 0.9),
    bubble: synth('bubble', PATCH.organ, 0.7),
    horn: synth('horn', PATCH.horns, 0.8),
    melodica: synth('horn', PATCH.melodica, 0.7),
  },
  delay: { steps: 3, feedback: 0.6, lp: 1900 },
  reverb: 0.9,
  tone: 'fm',
  level: 0.85,
};

/** Student radio: jangly guitars, fuzz, a cheap keyboard, all a bit worn. */
export const INDIE_KIT: Kit = {
  strips: {
    drums: { gain: 0.7, rev: 0.12 },
    bass: { gain: 0.55 },
    gtr: { gain: 0.42, rev: 0.2, pan: -0.3, hp: 130 },
    fuzz: { gain: 0.16, drive: 16, lp: 3200, hp: 180, rev: 0.2, pan: 0.3 },
    keys: { gain: 0.22, rev: 0.25, del: 0.15, pan: 0.15 },
  },
  insts: {
    kick: drum('drums', 'kickRock', 0.7),
    snare: drum('drums', 'snareLofi', 0.6),
    hat: drum('drums', 'hatC', 0.22, { choke: 'hat' }),
    ohat: drum('drums', 'hatO', 0.22, { choke: 'hat' }),
    tamb: drum('drums', 'tamb', 0.2),
    crash: drum('drums', 'crash', 0.32),
    tomLo: drum('drums', 'tomLo', 0.6),
    tomMid: drum('drums', 'tomMid', 0.55),
    rim: drum('drums', 'rim', 0.4),
    bass: synth('bass', PATCH.lofiBass, 0.9),
    strum: { type: 'pluck', bus: 'gtr', string: STEEL, id: 'steel', gain: 0.42, strum: 0.013 },
    pick: { type: 'pluck', bus: 'gtr', string: STEEL, id: 'steel', gain: 0.6 },
    fuzz: { type: 'pluck', bus: 'fuzz', string: STEEL, id: 'steel', gain: 0.7 },
    fuzzgtr: { type: 'pluck', bus: 'fuzz', string: STEEL, id: 'steel', gain: 0.4, strum: 0.008 },
    casio: synth('keys', PATCH.casio, 0.7),
  },
  delay: { steps: 3, feedback: 0.25, lp: 2200 },
  reverb: 0.75,
  tone: 'tape',
  level: 0.85,
};

/** Talkback: lounge hold music, two mumbling formant voices and a news desk. Broadcast on AM. */
export const TALK_KIT: Kit = {
  strips: {
    perc: { gain: 0.5, rev: 0.1 },
    bass: { gain: 0.55 },
    keys: { gain: 0.34, rev: 0.25, pan: -0.15 },
    gtr: { gain: 0.3, rev: 0.2, pan: 0.3 },
    lead: { gain: 0.3, rev: 0.35, del: 0.1 },
    host: { gain: 0.5, rev: 0.05 },
    caller: { gain: 0.42, drive: 2.5, lp: 3000, hp: 420 },
    news: { gain: 0.3, rev: 0.25 },
  },
  insts: {
    kick: drum('perc', 'kickSoft', 0.6),
    clave: drum('perc', 'clave', 0.3),
    rim: drum('perc', 'rim', 0.35),
    shaker: drum('perc', 'shaker', 0.25),
    timpani: drum('news', 'timpani', 0.9),
    crash: drum('news', 'crash', 0.5),
    sib: drum('host', 'sib', 0.12),
    sibC: drum('caller', 'sib', 0.16),
    bass: synth('bass', PATCH.upright, 0.9),
    ep: synth('keys', PATCH.ep, 0.9),
    nylon: { type: 'pluck', bus: 'gtr', string: NYLON, id: 'nylon', gain: 0.6 },
    vibes: synth('lead', PATCH.vibes, 0.9),
    flute: synth('lead', PATCH.flute, 0.7),
    beep: synth('host', PATCH.beep, 0.25),
    host: { type: 'voice', bus: 'host', gain: 2.6, phone: false },
    caller: { type: 'voice', bus: 'caller', gain: 2.2, phone: true },
    brass: synth('news', PATCH.brass, 0.9),
    tick: synth('news', PATCH.tick, 0.5),
  },
  delay: { steps: 3, feedback: 0.2, lp: 2000 },
  reverb: 0.7,
  tone: 'am',
  level: 0.85,
};

/** Advertising jingles: bright, bouncy and cheap. */
export const AD_KIT: Kit = {
  strips: {
    drums: { gain: 0.6, rev: 0.1 },
    bass: { gain: 0.5 },
    keys: { gain: 0.34, rev: 0.2, pan: -0.2 },
    bells: { gain: 0.36, rev: 0.35, del: 0.12, pan: 0.2 },
  },
  insts: {
    kick: drum('drums', 'kickSoft', 0.7),
    clap: drum('drums', 'clap', 0.45),
    shaker: drum('drums', 'shaker', 0.2),
    tamb: drum('drums', 'tamb', 0.2),
    crash: drum('drums', 'crash', 0.3),
    bass: synth('bass', PATCH.upright, 0.9),
    chord: synth('keys', PATCH.stab, 0.8),
    organ: synth('keys', PATCH.organ, 0.5),
    glock: synth('bells', PATCH.glock, 0.9),
    brass: synth('keys', PATCH.brass, 0.7),
  },
  delay: { steps: 3, feedback: 0.2, lp: 3000 },
  reverb: 0.7,
  tone: 'fm',
  level: 0.8,
};
