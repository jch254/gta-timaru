import { describe, expect, it } from 'vitest';
import { CHORDS, SCALES, chordPcs, degree, degreeOf, guitarVoicing, isFamiliar, midiHz, nearestChordTone, roman, rootAbove, snapToScale, stack, voiceNear } from './theory';

describe('pitch', () => {
  it('converts MIDI to Hz', () => {
    expect(midiHz(69)).toBeCloseTo(440, 6);
    expect(midiHz(57)).toBeCloseTo(220, 6);
    expect(midiHz(60)).toBeCloseTo(261.626, 2);
  });

  it('walks scale degrees across octaves in both directions', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((d) => degree(60, 'major', d))).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(degree(60, 'major', -1)).toBe(59);
    expect(degree(60, 'major', -7)).toBe(48);
    expect(degree(57, 'minPent', 5)).toBe(69);
    expect(degree(57, 'minPent', -1)).toBe(55);
    for (const name of Object.keys(SCALES) as (keyof typeof SCALES)[]) {
      for (let d = -12; d < 12; d++) {
        expect(degree(60, name, d + 1)).toBeGreaterThan(degree(60, name, d));
        expect(degreeOf(60, name, degree(60, name, d))).toBe(d);
      }
    }
  });

  it('snaps stray notes into the scale', () => {
    expect(snapToScale(0, 'major', 61)).toBe(60);
    expect(snapToScale(0, 'major', 64)).toBe(64);
    expect(snapToScale(9, 'minPent', 70)).toBe(69);
    expect(snapToScale(9, 'minPent', 71)).toBe(72);
    for (let m = 40; m < 90; m++) {
      const s = snapToScale(2, 'dorian', m);
      expect(Math.abs(s - m)).toBeLessThanOrEqual(1);
      expect((SCALES.dorian as readonly number[]).includes((((s - 2) % 12) + 12) % 12)).toBe(true);
    }
  });
});

describe('chords', () => {
  it('reads roman numerals', () => {
    expect(roman(0, 'I')).toEqual({ root: 0, q: 'maj' });
    expect(roman(0, 'vi')).toEqual({ root: 9, q: 'min' });
    expect(roman(0, 'V7')).toEqual({ root: 7, q: 'dom7' });
    expect(roman(0, 'ii7')).toEqual({ root: 2, q: 'min7' });
    expect(roman(0, 'IVmaj7')).toEqual({ root: 5, q: 'maj7' });
    expect(roman(9, 'bVII')).toEqual({ root: 7, q: 'maj' });
    expect(roman(9, 'bVI')).toEqual({ root: 5, q: 'maj' });
    expect(roman(4, 'i')).toEqual({ root: 4, q: 'min' });
    expect(roman(7, 'Isus4')).toEqual({ root: 7, q: 'sus4' });
    expect(roman(7, 'Iadd9')).toEqual({ root: 7, q: 'add9' });
    expect(roman(2, 'I5')).toEqual({ root: 2, q: 'five' });
    expect(() => roman(0, 'H')).toThrow();
    expect(() => roman(0, 'Ifoo')).toThrow();
  });

  it('builds chord tones upward from a floor', () => {
    expect(rootAbove({ root: 4, q: 'maj' }, 40)).toBe(40);
    expect(rootAbove({ root: 3, q: 'maj' }, 40)).toBe(51);
    expect(stack({ root: 0, q: 'maj7' }, 48)).toEqual([48, 52, 55, 59]);
    expect(chordPcs({ root: 9, q: 'min' })).toEqual([9, 0, 4]);
  });

  it('voices successive chords close together', () => {
    const prog = ['I', 'vi', 'IV', 'V', 'bVII', 'ii7', 'V7'].map((s) => voiceNear(roman(0, s), 62));
    for (const v of prog) {
      for (const n of v) expect(Math.abs(n - 62)).toBeLessThanOrEqual(7);
      expect([...v].sort((a, b) => a - b)).toEqual(v);
    }
    // Top voice moves by a fourth at most between neighbours.
    for (let i = 1; i < prog.length; i++) expect(Math.abs(prog[i][prog[i].length - 1] - prog[i - 1][prog[i - 1].length - 1])).toBeLessThanOrEqual(5);
  });

  it('finds the nearest chord tone', () => {
    const c = roman(0, 'I');
    expect(nearestChordTone(c, 61)).toBe(60);
    expect(nearestChordTone(c, 62)).toBe(60);
    expect(nearestChordTone(c, 63)).toBe(64);
    expect(nearestChordTone(c, 67)).toBe(67);
    for (let m = 30; m < 100; m++) expect(chordPcs(c)).toContain(nearestChordTone(c, m) % 12);
  });

  it('lays chords out like a guitar', () => {
    const e = guitarVoicing(roman(4, 'I'), 40);
    expect(e).toEqual([40, 47, 52, 56, 59, 64]);
    const am = guitarVoicing(roman(9, 'i'), 40);
    expect(am[0]).toBe(45);
    expect(am).toContain(60);
    for (const q of Object.keys(CHORDS) as (keyof typeof CHORDS)[]) {
      const v = guitarVoicing({ root: 7, q }, 40);
      expect(v[0]).toBe(43);
      for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThan(v[i - 1]);
      expect(v[v.length - 1] - v[0]).toBeLessThanOrEqual(24);
    }
  });
});

describe('originality guard', () => {
  it('recognises contours it must not reproduce, in any key', () => {
    expect(isFamiliar([0, 3, 5, 0, 3, 6, 5])).toBe(true);
    expect(isFamiliar([52, 55, 57, 52, 55, 58, 57, 40])).toBe(true);
    expect(isFamiliar([64, 64, 67, 64, 62, 60, 59])).toBe(true);
    expect(isFamiliar([0, 2, 4, 5, 7])).toBe(false);
    expect(isFamiliar([])).toBe(false);
  });
});
