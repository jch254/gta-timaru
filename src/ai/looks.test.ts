import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import type { DistrictType, HumanoidLook } from '../core/types';
import { BARKS, barkLine, chatLine, completeLook, pedName, pickOutfit, randomLook, type LookContext } from './looks';

const day = (district: DistrictType, hour = 11, weekday = true, cold = false): LookContext => ({ district, hour, weekday, cold });

function sample(n: number, ctx: LookContext, seed = 1): HumanoidLook[] {
  const rng = new Rng(seed);
  const out: HumanoidLook[] = [];
  for (let i = 0; i < n; i++) out.push(randomLook(rng, ctx));
  return out;
}

describe('street population', () => {
  it('is about half women', () => {
    const looks = sample(4000, day('shops'));
    const women = looks.filter((l) => l.female).length / looks.length;
    expect(women).toBeGreaterThan(0.46);
    expect(women).toBeLessThan(0.54);
  });

  it('produces valid, varied looks', () => {
    const looks = sample(3000, day('villa'));
    const tops = new Set<string>();
    const hats = new Set<string>();
    const hair = new Set<string>();
    const skins = new Set<number>();
    for (const l of looks) {
      for (const c of [l.skin, l.hair, l.top, l.legs, l.shoes]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
      expect(l.height!).toBeGreaterThan(0.7);
      expect(l.height!).toBeLessThan(1.15);
      expect(l.bulk!).toBeGreaterThan(0.8);
      expect(l.bulk!).toBeLessThan(1.35);
      if (l.hat && l.hat !== 'none') expect(l.hatColor).toBeDefined();
      tops.add(l.topStyle!);
      hats.add(l.hat ?? 'none');
      hair.add(l.hairStyle!);
      skins.add(l.skin);
    }
    expect(tops.size).toBeGreaterThanOrEqual(5);
    expect(hats.has('cap')).toBe(true);
    expect(hats.has('beanie')).toBe(true);
    expect(hats.has('brim')).toBe(true);
    expect(hair.has('mullet')).toBe(true);
    expect(hair.has('bald')).toBe(true);
    expect(skins.size).toBeGreaterThanOrEqual(10);
    // Stubbies and jandals are everywhere.
    expect(looks.some((l) => l.shorts)).toBe(true);
    // Never a police hat or helmet on a member of the public.
    expect(hats.has('police')).toBe(false);
    expect(hats.has('helmet')).toBe(false);
  });

  it('dresses for the district', () => {
    const count = (ctx: LookContext, test: (l: HumanoidLook) => boolean) => sample(1500, ctx, 5).filter(test).length / 1500;
    const hiVis = (l: HumanoidLook) => l.topStyle === 'hiVis';
    expect(count(day('industrial'), hiVis)).toBeGreaterThan(0.3);
    expect(count(day('rural'), hiVis)).toBeGreaterThan(0.08);
    expect(count(day('cbd'), hiVis)).toBe(0);
    // Suits (dark jacket and matching trousers) turn up in town during office hours.
    const suit = (l: HumanoidLook) => l.topStyle === 'jacket' && l.top === l.legs && [0x2b2e35, 0x1e2a44, 0x4a3a2c, 0x3a3f48].includes(l.top);
    expect(count(day('cbd'), suit)).toBeGreaterThan(0.08);
    expect(count(day('rural'), suit)).toBe(0);
    // Bush shirts and brimmed hats out in the country.
    expect(count(day('rural'), (l) => l.topStyle === 'bushShirt')).toBeGreaterThan(0.3);
    expect(count(day('rural'), (l) => l.hat === 'brim')).toBeGreaterThan(0.15);
    expect(count(day('statehouse'), (l) => l.topStyle === 'jersey')).toBeGreaterThan(0.08);
  });

  it('only sends school uniforms out on school days', () => {
    const rng = new Rng(3);
    let school = 0;
    for (let i = 0; i < 2000; i++) {
      if (pickOutfit(rng, 'shops', 15.2, true) === 'school') school++;
      expect(pickOutfit(rng, 'shops', 21, true)).not.toBe('school');
      expect(pickOutfit(rng, 'shops', 11, false)).not.toBe('school');
    }
    expect(school).toBeGreaterThan(50);
    // Children are smaller.
    const kids = sample(3000, day('shops', 15.2)).filter((l) => l.topStyle === 'uniform' && (l.height ?? 1) < 0.91);
    expect(kids.length).toBeGreaterThan(50);
  });

  it('wraps up when it is cold', () => {
    const beanies = (ctx: LookContext) => sample(3000, ctx, 8).filter((l) => l.hat === 'beanie').length;
    const shorts = (ctx: LookContext) => sample(3000, ctx, 8).filter((l) => l.shorts).length;
    expect(beanies(day('statehouse', 11, true, true))).toBeGreaterThan(beanies(day('statehouse')));
    expect(shorts(day('statehouse', 11, true, true))).toBeLessThan(shorts(day('statehouse')));
  });

  it('is deterministic for a seed', () => {
    expect(sample(50, day('cbd'), 42)).toEqual(sample(50, day('cbd'), 42));
    expect(sample(50, day('cbd'), 42)).not.toEqual(sample(50, day('cbd'), 43));
  });

  it('fills in a scripted character without overriding what was asked for', () => {
    const rng = new Rng(6);
    for (let i = 0; i < 200; i++) {
      const look = completeLook(rng, { topStyle: 'uniform', top: 0x1e2a44, hat: 'police', female: true }, day('cbd'));
      expect(look.topStyle).toBe('uniform');
      expect(look.top).toBe(0x1e2a44);
      expect(look.hat).toBe('police');
      expect(look.female).toBe(true);
      expect(['long', 'bob', 'short', 'mullet']).toContain(look.hairStyle);
      expect(look.skin).toBeDefined();
      expect(look.legs).toBeDefined();
    }
    expect(completeLook(new Rng(1), undefined, day('cbd'))).toEqual(randomLook(new Rng(1), day('cbd')));
  });
});

describe('names and barks', () => {
  it('uses first names only, none of them the story characters', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 300; i++) {
      const name = pedName(rng, i % 2 === 0);
      expect(name).toMatch(/^[A-Z][a-zāēīōū]+$/);
      expect(['Rena', 'Mack', 'Dazza']).not.toContain(name);
    }
  });

  it('keeps every line short enough for a subtitle', () => {
    for (const lines of Object.values(BARKS)) {
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(line.length).toBeGreaterThan(2);
        expect(line.length).toBeLessThanOrEqual(48);
      }
    }
  });

  it('includes everyday te reo Māori, written with macrons', () => {
    const all = Object.values(BARKS).flat().join(' ');
    for (const word of ['Kia ora', 'Ka pai', 'e hoa', 'Aroha mai', 'Mōrena', 'Whānau', 'kai', 'mahi', 'tamariki', 'Ka kite', 'Auē']) expect(all).toContain(word);
    // The same words without their macrons would be misspellings.
    for (const wrong of ['Morena', 'Whanau', 'Aue!']) expect(all).not.toContain(wrong);
  });

  it('picks lines from the right list', () => {
    const rng = new Rng(4);
    for (let i = 0; i < 50; i++) {
      expect(BARKS.bump).toContain(barkLine(rng, 'bump'));
      expect(BARKS.hijacked).toContain(barkLine(rng, 'hijacked'));
    }
    const weather = new Set<string>();
    for (let i = 0; i < 400; i++) weather.add(chatLine(rng, 'norwester', false, 14));
    expect([...weather].some((l) => (BARKS.norwester as readonly string[]).includes(l))).toBe(true);
    expect([...weather].some((l) => (BARKS.chat as readonly string[]).includes(l))).toBe(true);
    expect([...weather].some((l) => (BARKS.night as readonly string[]).includes(l))).toBe(false);
    const late = new Set<string>();
    for (let i = 0; i < 400; i++) late.add(chatLine(rng, 'clear', true, 23));
    expect([...late].some((l) => (BARKS.night as readonly string[]).includes(l))).toBe(true);
    const early = new Set<string>();
    for (let i = 0; i < 400; i++) early.add(chatLine(rng, 'clear', false, 7));
    expect(early.has('Mōrena.')).toBe(true);
  });
});
