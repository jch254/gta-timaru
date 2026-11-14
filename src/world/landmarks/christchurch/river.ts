import type { LandmarkBuilder } from '../../../core/types';
import { Kit, type Pt2, headingTowardsWater, prism, wedge } from './kit';

/**
 * Antigua Boat Sheds: a row of six gabled timber bays striped green and white, boat doors opening onto a deck
 * over the Avon, a jetty with punts, and hire canoes. Local +z is the river side; if the map's heading points the
 * other way the sheds turn to face whichever side has water within 26 m. 25 m long, jetty reaching 17–23 m out.
 */
export const antiguaBoatsheds: LandmarkBuilder = (p, out) => {
  const world = out.world;
  const wet = world.waterDepthAt(p.x, p.z);
  const k = Kit.at(p, out, { heading: headingTowardsWater(p, world, 26), y: world.groundAt(p.x, p.z) + (wet > 0 ? wet + 0.6 : 0) });
  const m = k.m;
  const green = m.get('weatherboard', { color: 0x2f5d3f });
  const white = m.get('weatherboard', { color: 0xf1ead8 });
  const iron = m.get('corrugated', { color: 0x9aa0a4 });
  const deckTimber = m.get('timber', { color: 0x7d6a55 });
  const pile = m.get('timber', { color: 0x4a3d32 });

  // Where the water is, and how high it stands against the bank.
  // With no water in reach the boats simply sit on the grass.
  let waterY = 0.12;
  let shore = 7;
  for (let z = 2; z <= 26; z += 2) {
    const depth = k.water(0, z);
    if (depth > 0.2) {
      waterY = Math.min(-0.3, k.ground(0, z) + depth);
      shore = z;
      break;
    }
  }
  const reach = Math.min(23, Math.max(16.6, shore + 7));

  // The sheds: one long body under six gabled roofs running towards the river.
  k.footing(0, -3.9, 25.4, 11.2, 0.1, pile);
  k.solid(0, 0.1, -3.9, 25.2, 3, 11, green);
  for (let bay = 0; bay < 6; bay++) {
    const cx = -10.5 + bay * 4.2;
    k.roof(cx, 3.1, -3.9, 11, 4.3, 1.9, iron, true);
    // Striped front: six boards a bay, each with its slice of the gable above.
    for (let s = 0; s < 6; s++) {
      const x0 = -2.1 + s * 0.7;
      const x1 = x0 + 0.7;
      const h = (x: number) => 1.9 * (1 - Math.abs(x) / 2.1);
      const colour = s % 2 ? white : green;
      k.dbox(cx + x0 + 0.35, 0.1, 1.63, 0.7, 3, 0.06, colour);
      const slice: Pt2[] = [[x0, 0], [x1, 0]];
      if (h(x1) > 1e-3) slice.push([x1, h(x1)]);
      if (h(x0) > 1e-3) slice.push([x0, h(x0)]);
      k.geo(prism(slice, 0.06), colour, cx, 3.1, 1.63);
    }
    k.pediment(cx, 3.1, -9.42, 4.2, 1.9, 0.08, bay % 2 ? green : white);
    // Boat doors: some standing open on the dark interior.
    const open = bay !== 1 && bay !== 4;
    k.quad(cx, 1.4, 1.67, 3.2, 2.6, open ? m.get('plain', { color: 0x15130f }) : white);
    if (!open) k.dbox(cx, 0.1, 1.68, 0.1, 2.6, 0.03, green);
  }

  // Street side: door, windows and the name board.
  const back = k.sub(0, 0, -9.4, Math.PI);
  back.quad(0, 1.15, 0.04, 1.6, 2.1, m.get('timber', { color: 0x5a3b27 }));
  back.panes(m.windows('house'), 16, 1.75, 4, 1.3, 1.2, 0.04, -3).panes(m.windows('house'), 5, 1.75, 2, 1.3, 1.2, 0.04, 8.5);
  back.sign('ANTIGUA BOAT SHEDS', 0, 2.75, 0.05, 6.4, 0.7, 0, { bg: '#f1ead8', fg: '#234a31', style: 'paint' });
  back.sign('BOATS FOR HIRE', 7, 2.75, 0.05, 3.2, 0.5, 0, { bg: '#234a31', fg: '#f1ead8', style: 'paint' });

  // Deck, jetty and launching ramp on piles.
  k.solid(0, -0.25, 4.1, 28, 0.4, 5, deckTimber);
  k.solid(6, -0.25, (6.6 + reach) / 2, 2.4, 0.4, reach - 6.6, deckTimber);
  k.geo(wedge(4, 7, -0.05, 0.15, waterY - 0.5, waterY - 0.3), deckTimber, -8, 0, 10.1);
  const pileH = 1.25 - waterY;
  for (let x = -13; x <= 13; x += 6.5) k.dbox(x, waterY - 1.5, 6.3, 0.26, pileH, 0.26, pile);
  for (let z = 9; z <= reach; z += 3.5) k.dbox(4.9, waterY - 1.5, z, 0.24, pileH, 0.24, pile).dbox(7.1, waterY - 1.5, z, 0.24, pileH + 1, 0.24, pile);

  // The fleet: punts along the jetty, canoes afloat and stacked on the deck, a skiff.
  k.prop('chch-punt', 8.3, reach - 5, 0, 1, undefined, waterY);
  k.prop('chch-punt', 3.7, reach - 4.4, Math.PI, 1, undefined, waterY);
  const hire = [0xc0392b, 0xe0b030, 0x2f6fa8, 0x2f8a4a, 0xe07a2a];
  k.prop('chch-canoe', -9, 15, 0.3, 1, hire[0], waterY).prop('chch-canoe', -6.4, 16.2, -0.5, 1, hire[2], waterY);
  k.prop('chch-skiff', -1, reach - 2.5, Math.PI / 2 + 0.1, 1, undefined, waterY);
  for (let i = 0; i < 4; i++) k.prop('chch-canoe', -12.6 + i * 1.05, 4.2, 0, 1, hire[(i + 1) % hire.length], 0.24);
  k.prop('chch-bench', 11.5, 3, -Math.PI / 2, 1, undefined, 0.15);

  if (k.free(-16.5, -2, 2)) k.prop('tree-willow', -16.5, -2, 1.2, 0.9);
  if (k.free(16.8, -5, 2)) k.prop('tree-willow', 16.8, -5, 2.6, 0.8);
  k.prop('chch-lamp-standard', 2.2, -10.8);
  k.light(0, 3, 4, 0xffe2b0, 1.1, 18);
  k.flush();
};
