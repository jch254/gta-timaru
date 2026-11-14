import { describe, expect, it } from 'vitest';
import { getProp } from '../../props';
import { LANDMARKS } from '../registry';
import { buildLandmark, fakeMaterials, PRIMITIVE_OPS, REAL_BRANDS, signature } from '../rural/fakes';
import { CLEAR_RADIUS } from '../rural/kit';
import './index';

const KINDS = [
  'timaru-basilica',
  'caroline-bay-soundshell',
  'caroline-bay-carnival',
  'caroline-bay-tearooms',
  'timaru-port',
  'timaru-lighthouse',
  'landing-service-building',
  'timaru-station',
  'timaru-hospital',
  'timaru-police',
  'smithfield-works',
  'washdyke-saleyards',
  'phar-lap-raceway',
];

const SITES = [
  { label: 'flat ground at the origin', at: {}, world: {} },
  { label: 'sloping ground, turned', at: { x: 412.5, z: 4980.25, heading: 2.2 }, world: { ground: (x: number, z: number) => 14 + x * 0.02 - z * 0.012 } },
];

describe('Timaru landmarks', () => {
  it('registers every kind in the contract', () => {
    for (const kind of KINDS) expect(LANDMARKS[kind], kind).toBeTypeOf('function');
  });

  for (const kind of KINDS) {
    const radius = CLEAR_RADIUS[kind];
    const large = radius >= 40;
    for (const site of SITES) {
      it(`${kind}: builds on ${site.label} inside its ${radius} m clear radius and budget`, () => {
        const { out, placement } = buildLandmark(LANDMARKS[kind], kind, radius, site.at, site.world);
        expect(out.problems).toEqual([]);
        expect(out.records.length).toBeGreaterThan(8);
        expect(out.count(...PRIMITIVE_OPS)).toBeLessThanOrEqual(large ? 400 : 120);
        expect(out.count('light')).toBeLessThanOrEqual(2);
        expect(out.count('collider')).toBeGreaterThan(0);
        expect(out.triangles).toBeLessThan(30000);
        const reach = out.reach(placement.x, placement.z);
        expect(reach.distance, `${reach.record?.op} at ${reach.distance.toFixed(1)} m`).toBeLessThanOrEqual(radius * 1.1);
        const materials = fakeMaterials();
        for (const r of out.records) {
          if (r.op === 'instance') expect(getProp(r.kind!, materials), `prop kind ${r.kind}`).not.toBeNull();
          if (r.material?.kind === 'sign') expect(r.material.text).not.toMatch(REAL_BRANDS);
        }
        const again = buildLandmark(LANDMARKS[kind], kind, radius, site.at, site.world);
        expect(signature(again.out)).toBe(signature(out));
      });
    }
  }

  it('moors the freighter and trawlers when there is water behind the port', () => {
    const dry = buildLandmark(LANDMARKS['timaru-port'], 'timaru-port', 130);
    const wet = buildLandmark(LANDMARKS['timaru-port'], 'timaru-port', 130, {}, { water: (_x, z) => (z < -70 ? 6 : 0) });
    expect(wet.out.problems).toEqual([]);
    const names = (b: typeof wet) => b.out.records.filter((r) => r.material?.kind === 'sign').map((r) => r.material!.text);
    expect(names(wet)).toContain('CANTERBURY TRADER');
    expect(names(dry)).not.toContain('CANTERBURY TRADER');
    // Hulls float at sea level, not at the height of the wharf.
    const ship = wet.out.records.find((r) => r.material?.text === 'CANTERBURY TRADER')!;
    expect(ship.y).toBeLessThan(8);
    expect(wet.out.reach(0, 0).distance).toBeLessThanOrEqual(130 * 1.1);
  });

  it('leaves the Smithfield staff car park open: no colliders or props on the front apron', () => {
    const { out } = buildLandmark(LANDMARKS['smithfield-works'], 'smithfield-works', 110);
    const onApron = out.records.filter((r) => (r.op === 'collider' || r.op === 'instance' || r.op === 'box' || r.op === 'cylinder') && r.x > -26 && r.x < 46 && r.z > 44 && r.z < 80);
    expect(onApron).toEqual([]);
  });
});
