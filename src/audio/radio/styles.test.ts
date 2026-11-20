import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng';
import { footSound, gunSound, meleeSound, strideLength } from '../index';
import { STATIONS, STATION_DEFS, nextStation, programItem, stationName, type Item } from './dial';
import type { Kit } from './kit';
import { makeMotif, realize, row, type Ev } from './song';
import { IDENT_IDS } from './stings';
import { country, dance, dub, indie, lounge, rock } from './styles';
import { SCALES, chordPcs, roman } from './theory';
import { STEPS_PER_BAR } from './timing';

const SESSION = 1234;

function allBars(item: Item): Ev[][] {
  const bars: Ev[][] = [];
  for (let b = 0; b < item.plan.bars; b++) bars.push(item.style.bar(item.plan, b));
  return bars;
}

/** WebAudio nodes an event creates, roughly (drum 2, synth oscillators + envelope + filter, pluck 2 per string). */
function nodeCost(kit: Kit, e: Ev): number {
  const inst = kit.insts[e.ch];
  if (!inst) return 0;
  const notes = e.ns ? e.ns.length : 1;
  if (inst.type === 'drum') return 2;
  if (inst.type === 'pluck') return 2 * notes;
  if (inst.type === 'riser') return 3;
  if (inst.type === 'voice') return 0;
  const p = inst.patch;
  const perNote = (1 + (p.unison?.length ?? 0)) * (p.fm ? 3 : 1) + (p.sub ? 2 : 0);
  return notes * perNote + 1 + (p.cutoff !== undefined ? 1 : 0) + (p.vib ? 2 : 0);
}

describe('the dial', () => {
  it('has at least five invented stations with a frequency in the name', () => {
    expect(STATIONS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
    expect(new Set(STATIONS.map((s) => s.name)).size).toBe(STATIONS.length);
    for (const s of STATIONS) {
      expect(s.name).toMatch(/\d{2,4}(\.\d)? ?(FM|AM)|(FM|AM) \d{2,4}(\.\d)?/);
      expect(s.blurb.length).toBeGreaterThan(10);
    }
    expect(new Set(STATION_DEFS.map((s) => s.genre)).size).toBe(STATION_DEFS.length);
    // Every station has its own ident.
    expect([...IDENT_IDS].sort()).toEqual(STATIONS.map((s) => s.id).sort());
  });

  it('cycles through every station and then off', () => {
    const ids = STATIONS.map((s) => s.id);
    const seen: (string | null)[] = [];
    let cur: string | null = null;
    for (let i = 0; i < ids.length + 1; i++) {
      cur = nextStation(cur);
      seen.push(cur);
    }
    expect(seen).toEqual([...ids, null]);
    expect(nextStation(null)).toBe(ids[0]);
    expect(nextStation(ids[ids.length - 1])).toBeNull();
    expect(nextStation('no-such-station')).toBe(ids[0]);
    expect(nextStation(null, [])).toBeNull();
  });

  it('names the dial position', () => {
    expect(stationName(null)).toBe('Radio off');
    expect(stationName(STATIONS[1].id)).toBe(STATIONS[1].name);
    expect(stationName('nope')).toBe('Radio off');
  });
});

describe.each(STATION_DEFS.map((s) => [s.id, s] as const))('station %s', (id, def) => {
  const items = Array.from({ length: 14 }, (_, i) => programItem(id, i, SESSION));

  it('alternates music with idents and ads, and never repeats a track', () => {
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain('track');
    expect(kinds).toContain('ident');
    if (id === 'partyline') {
      expect(kinds).toContain('talk');
      expect(kinds).toContain('news');
    }
    const tracks = items.filter((i) => i.kind === 'track');
    const prints = tracks.map((t) => JSON.stringify([t.plan.bpm, t.plan.key, t.plan.data]));
    expect(new Set(prints).size).toBe(tracks.length);
    // A different session gets a different running order.
    expect(JSON.stringify(programItem(id, 0, 99).plan.data)).not.toBe(JSON.stringify(items[0].plan.data));
  });

  it('is deterministic for a given position in the programme', () => {
    const again = programItem(id, 4, SESSION);
    expect(again.plan).toEqual(items[4].plan);
    expect(allBars(again)).toEqual(allBars(items[4]));
  });

  it('has sensible lengths', () => {
    for (const item of items) {
      expect(item.steps).toBe(item.plan.bars * STEPS_PER_BAR);
      expect(item.plan.bpm).toBeGreaterThanOrEqual(60);
      expect(item.plan.bpm).toBeLessThanOrEqual(160);
      if (item.kind === 'track') {
        expect(item.duration).toBeGreaterThan(50);
        expect(item.duration).toBeLessThan(240);
      } else {
        expect(item.duration).toBeGreaterThan(2.5);
        expect(item.duration).toBeLessThan(32);
      }
    }
  });

  it('only writes parts its band can play, inside the bar and in a playable range', () => {
    for (const item of items) {
      const kit = item.kit;
      let total = 0;
      allBars(item).forEach((bar, b) => {
        total += bar.length;
        for (const e of bar) {
          const where = `${id} ${item.kind} bar ${b} ${e.ch}`;
          expect(e.step, where).toBeGreaterThanOrEqual(0);
          expect(e.step, where).toBeLessThan(STEPS_PER_BAR);
          expect(e.d, where).toBeGreaterThan(0);
          expect(e.d, where).toBeLessThanOrEqual(32);
          expect(e.v, where).toBeGreaterThan(0);
          expect(e.v, where).toBeLessThanOrEqual(1.01);
          if (e.ch === 'throw') {
            expect(kit.strips[String(e.a)], `${where} → ${String(e.a)}`).toBeDefined();
            continue;
          }
          const inst = kit.insts[e.ch];
          expect(inst, where).toBeDefined();
          expect(kit.strips[inst.bus], `${where} bus ${inst.bus}`).toBeDefined();
          const notes = e.ns ?? (e.n !== undefined ? [e.n] : []);
          if (inst.type === 'synth' || inst.type === 'pluck' || inst.type === 'voice') expect(notes.length, where).toBeGreaterThan(0);
          for (const n of notes) {
            expect(Number.isFinite(n), where).toBe(true);
            expect(n, where).toBeGreaterThanOrEqual(24);
            expect(n, where).toBeLessThanOrEqual(103);
          }
        }
      });
      expect(total, `${id} ${item.kind} is silent`).toBeGreaterThan(8);
    }
  });

  it('keeps the audio graph busy but modest', () => {
    for (const item of items) {
      const barSeconds = STEPS_PER_BAR * item.stepDur;
      let worst = 0;
      for (const bar of allBars(item)) {
        const nodes = bar.reduce((n, e) => n + nodeCost(item.kit, e), 0);
        worst = Math.max(worst, nodes / barSeconds);
        expect(bar.length, `${id} ${item.kind} events in a bar`).toBeLessThan(140);
      }
      // Nodes created per second in the busiest bar.
      expect(worst, `${id} ${item.kind} node rate`).toBeLessThan(260);
    }
  });

  it('stays in key: tunes and chords belong to the scale, bass and riffs may add passing notes', () => {
    for (const item of items.filter((i) => i.kind === 'track')) {
      const p = item.plan;
      const minorKey = p.sections.some((s) => s.chords[0].root === p.key && s.chords[0].q.startsWith('min'));
      const scale: readonly number[] = minorKey ? SCALES.minor : SCALES.major;
      let total = 0;
      let inKey = 0;
      allBars(item).forEach((bar) => {
        for (const e of bar) {
          const inst = item.kit.insts[e.ch];
          if (!inst || inst.type === 'drum' || inst.type === 'riser' || inst.type === 'voice') continue;
          if (e.ch === 'bass' || e.ch === 'riff' || e.ch === 'gtrm') continue;
          for (const n of e.ns ?? (e.n !== undefined ? [e.n] : [])) {
            total++;
            if (scale.includes((((Math.round(n) - p.key) % 12) + 12) % 12)) inKey++;
          }
        }
      });
      expect(total).toBeGreaterThan(100);
      expect(inKey / total, `${id} ${p.style} seed ${p.seed}`).toBeGreaterThan(0.88);
    }
  });

  it('tracks begin and end like songs', () => {
    for (const item of items.filter((i) => i.kind === 'track' && i.style !== lounge)) {
      const bars = allBars(item);
      const last = bars[bars.length - 1];
      // The final bar is a held chord, not a full groove.
      expect(last.length).toBeLessThan(bars[Math.floor(bars.length / 2)].length);
      expect(last.some((e) => e.d >= 8)).toBe(true);
      expect(item.plan.sections[0].kind).toBe('intro');
      expect(item.plan.sections.reduce((n, s) => n + s.bars, 0)).toBe(item.plan.bars);
    }
    expect(def.music.plan(1).style).toBe(def.music.id);
  });
});

describe('song writing', () => {
  it('drum rows read left to right', () => {
    const out: Ev[] = [];
    row(out, 'kick', 'x...o...-...g...');
    expect(out.map((e) => e.step)).toEqual([0, 4, 8, 12]);
    expect(out.map((e) => e.v)).toEqual([1, 0.72, 0.5, 0.28]);
  });

  it('motifs stay in range, start somewhere stable and resolve', () => {
    for (let seed = 1; seed < 60; seed++) {
      const m = makeMotif(new Rng(seed), { cells: ['x...x.x.x...x...', 'x.x.x...x.....x.'], lo: -2, hi: 9, scaleLen: 7 });
      expect(m.length).toBe(2);
      for (const bar of m) {
        for (const n of bar) {
          expect(n.deg).toBeGreaterThanOrEqual(-2);
          expect(n.deg).toBeLessThanOrEqual(9);
          expect(n.step + n.d).toBeLessThanOrEqual(STEPS_PER_BAR);
        }
      }
      const end = m[1][m[1].length - 1];
      expect([0, 2, 4]).toContain(((end.deg % 7) + 7) % 7);
    }
  });

  it('melodies agree with the chord on strong beats', () => {
    const chord = roman(0, 'IV');
    const motif = makeMotif(new Rng(5), { cells: ['x...x...x...x...'], lo: 0, hi: 9, scaleLen: 7 });
    const notes = realize(motif[0], 'lead', 60, 'major', chord, 0.8);
    for (const e of notes) {
      expect((SCALES.major as readonly number[]).includes(e.n! % 12)).toBe(true);
      if (e.step % 8 === 0) expect(chordPcs(chord)).toContain(e.n! % 12);
    }
  });

  it('every genre writes in its own tempo range and feel', () => {
    const bpm = (style: { plan(seed: number): { bpm: number } }): number[] => Array.from({ length: 40 }, (_, i) => style.plan(i * 7919 + 1).bpm);
    const range = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)];
    expect(range(bpm(dub))[1]).toBeLessThanOrEqual(80);
    expect(range(bpm(dance))[0]).toBeGreaterThanOrEqual(122);
    expect(range(bpm(rock))[0]).toBeGreaterThanOrEqual(104);
    expect(range(bpm(country))[0]).toBeGreaterThanOrEqual(72);
    expect(range(bpm(indie))[1]).toBeLessThanOrEqual(150);
    expect(range(bpm(lounge))[1]).toBeLessThanOrEqual(116);
    // Reggae swings; the drum machine does not.
    expect(dub.plan(3).swing).toBeGreaterThan(0.2);
    expect(dance.plan(3).swing).toBe(0);
    // Dub drops the kick on the off-beat "one drop" or runs four-on-the-floor; dance is always four-on-the-floor.
    const d = dance.plan(11);
    const mid = dance.bar(d, 12).filter((e) => e.ch === 'kick').map((e) => e.step);
    expect(mid).toEqual([0, 4, 8, 12]);
  });
});

describe('event mapping helpers', () => {
  it('picks footsteps by surface', () => {
    expect(footSound('road')).toBe('footstep');
    expect(footSound('footpath')).toBe('footstep');
    expect(footSound('paving')).toBe('footstep');
    expect(footSound('gravel')).toBe('footGravel');
    expect(footSound('shingle')).toBe('footGravel');
    expect(footSound('grass')).toBe('footGrass');
    expect(footSound('field')).toBe('footGrass');
    expect(footSound('sand')).toBe('footSand');
    expect(footSound('water')).toBe('footWet');
  });

  it('maps weapons to reports', () => {
    expect(gunSound('pistol')).toBe('pistol');
    expect(gunSound('shotgun', 'shotgun')).toBe('shotgun');
    expect(gunSound('sawnoff', 'shotgun')).toBe('shotgun');
    expect(gunSound('rifle')).toBe('rifle');
    expect(gunSound('bat', 'melee')).toBeNull();
    expect(gunSound('fists', 'fists')).toBeNull();
    expect(gunSound('knife', 'melee')).toBeNull();
    expect(gunSound('katana', 'melee')).toBeNull();
  });

  it('gives a blade its cut and leaves fists, clubs and guns alone', () => {
    expect(meleeSound({ kind: 'melee', blade: true })).toBe('slash');
    expect(meleeSound({ kind: 'melee' })).toBeNull();
    expect(meleeSound({ kind: 'melee', blade: false })).toBeNull();
    expect(meleeSound({ kind: 'fists' })).toBeNull();
    expect(meleeSound({ kind: 'pistol', blade: true })).toBeNull();
    expect(meleeSound(undefined)).toBeNull();
    expect(meleeSound(null)).toBeNull();
  });

  it('walks at about two steps a second and sprints at about three and a half', () => {
    expect(1.9 / strideLength(1.9)).toBeGreaterThan(1.6);
    expect(1.9 / strideLength(1.9)).toBeLessThan(2.3);
    expect(6.8 / strideLength(6.8)).toBeGreaterThan(3.1);
    expect(6.8 / strideLength(6.8)).toBeLessThan(3.9);
  });
});
