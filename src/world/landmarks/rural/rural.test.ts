import { describe, expect, it } from 'vitest';
import { getProp } from '../../props';
import { LANDMARKS } from '../registry';
import { buildLandmark, fakeMaterials, PRIMITIVE_OPS, REAL_BRANDS, signature, variantOf } from './fakes';
import { CLEAR_RADIUS } from './kit';
import './index';

const KINDS = [
  'ashburton-clock-tower',
  'rakaia-salmon',
  'woolshed',
  'grain-silo',
  'service-station',
  'country-pub',
  'country-church',
  'war-memorial',
  'school',
  'rugby-field',
  'rail-station-small',
  'marae',
];

// Rural kinds are placed many times, so try a spread of positions (seeds), headings and ground shapes.
const SITES: { x: number; z: number; heading: number; ground?: (x: number, z: number) => number }[] = [{ x: 0, z: 0, heading: 0 }];
for (let i = 0; i < 12; i++) {
  SITES.push({
    x: -1300 + i * 173.5,
    z: -2600 + i * 611.25,
    heading: i * 0.83,
    ground: i % 2 === 0 ? undefined : (x, z) => 9 + Math.sin(x * 0.01) * 2 + z * 0.01 * (i % 3),
  });
}

describe('rural landmarks', () => {
  it('registers every kind in the contract, including the marae', () => {
    for (const kind of KINDS) expect(LANDMARKS[kind], kind).toBeTypeOf('function');
  });

  for (const kind of KINDS) {
    const radius = CLEAR_RADIUS[kind];
    const large = radius >= 40;
    it(`${kind}: every variant stays inside its ${radius} m clear radius and budget`, () => {
      const seen = new Set<string>();
      for (const site of SITES) {
        const options = site.ground ? { ground: site.ground } : {};
        const { out, placement } = buildLandmark(LANDMARKS[kind], kind, radius, { ...site, name: 'Hinds School' }, options);
        expect(out.problems).toEqual([]);
        expect(out.records.length).toBeGreaterThan(8);
        expect(out.count(...PRIMITIVE_OPS)).toBeLessThanOrEqual(large ? 400 : 120);
        expect(out.count('light')).toBeLessThanOrEqual(2);
        expect(out.count('collider')).toBeGreaterThan(0);
        expect(out.triangles).toBeLessThan(20000);
        const reach = out.reach(placement.x, placement.z);
        expect(reach.distance, `${reach.record?.op} at ${reach.distance.toFixed(1)} m`).toBeLessThanOrEqual(radius * 1.1);
        const materials = fakeMaterials();
        for (const r of out.records) {
          if (r.op === 'instance') expect(getProp(r.kind!, materials), `prop kind ${r.kind}`).not.toBeNull();
          if (r.material?.kind === 'sign') expect(r.material.text).not.toMatch(REAL_BRANDS);
        }
        const again = buildLandmark(LANDMARKS[kind], kind, radius, { ...site, name: 'Hinds School' }, options);
        expect(signature(again.out)).toBe(signature(out));
        seen.add(variantOf(out));
      }
      // These are placed many times over, so the seed has to make a visible difference.
      if (!['ashburton-clock-tower', 'rakaia-salmon'].includes(kind)) expect(seen.size).toBeGreaterThan(2);
    });
  }

  it('paints the placement name on the school board, the station board and the marae gateway', () => {
    const texts = (kind: string, name: string) =>
      buildLandmark(LANDMARKS[kind], kind, CLEAR_RADIUS[kind], { name })
        .out.records.filter((r) => r.material?.kind === 'sign')
        .map((r) => r.material!.text);
    expect(texts('school', 'Hinds School')).toContain('HINDS SCHOOL');
    expect(texts('rail-station-small', 'Hinds Railway Station')).toContain('HINDS');
    expect(texts('marae', 'Arowhenua Marae')).toContain('AROWHENUA MARAE');
  });

  it('keeps the marae ātea clear: nothing solid between the gateway and the house', () => {
    const { out } = buildLandmark(LANDMARKS.marae, 'marae', 50);
    const onLawn = out.records.filter((r) => (r.op === 'collider' || r.op === 'instance' || r.op === 'box') && Math.abs(r.x) < 14 && r.z > 6 && r.z < 33);
    expect(onLawn).toEqual([]);
  });
});
