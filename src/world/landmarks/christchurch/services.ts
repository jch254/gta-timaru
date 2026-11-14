import type { LandmarkBuilder } from '../../../core/types';
import { carPark, flagpole } from './common';
import { Kit, drum, sphere } from './kit';

/**
 * Christchurch Hospital: a nine-storey 1970s ward slab on a two-storey podium, a lower clinical wing, an older
 * brick wing, the boiler-house chimney, an ambulance bay and a sign at the road. Local +z is the Riccarton Ave
 * front with the entrance and car park. Fits a 66 m circle; the slab is 38 m high, the chimney 40 m.
 */
export const hospital: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const conc = m.get('concrete', { color: 0xc9c4b6 });
  const dark = m.get('concrete', { color: 0x9a968c });
  const brick = m.get('brick');
  const win = m.windows('office');
  const house = m.windows('house');

  // Podium and ward slab.
  k.solid(0, 0, -10, 76, 7.6, 30, conc);
  k.box(0, 7.6, -10, 76.6, 0.5, 30.6, dark);
  k.solid(0, 8.1, -14, 60, 30, 16, conc);
  k.box(0, 38.1, -14, 60.6, 0.6, 16.6, dark);
  k.quad(0, 22.5, -5.96, 57.5, 28.8, win, 0, true).quad(0, 22.5, -22.04, 57.5, 28.8, win, Math.PI, true);
  for (const side of [-1, 1]) {
    k.box(side * 31.5, 0, -14, 5, 40.5, 10, dark);
    k.quad(side * 34.04, 22.5, -14, 5, 28.8, win, (side * Math.PI) / 2, true);
  }
  k.box(8, 38.7, -14, 20, 3.4, 10, dark).box(-20, 38.7, -14, 8, 5.5, 9, dark);
  const podium = k.sub(0, 0, 5, 0);
  podium.panes(house, 24, 5.4, 8, 1.8, 1.6, 0.04, -24).panes(house, 24, 5.4, 8, 1.8, 1.6, 0.04, 24).panes(house, 12, 2.2, 4, 1.8, 1.6, 0.04, 30);

  // Clinical wing (right) and the older brick wing (left).
  k.solid(44, 0, 10, 18, 17, 34, conc);
  k.box(44, 17, 10, 18.5, 0.5, 34.5, dark);
  k.quad(34.96, 9.6, 10, 30, 12.8, win, -Math.PI / 2, true).quad(53.04, 9.6, 10, 30, 12.8, win, Math.PI / 2, true).quad(44, 9.6, 27.04, 15, 12.8, win, 0, true);
  k.solid(-46, 0, 8, 14, 13, 26, brick);
  k.roof(-46, 13, 8, 27, 15, 3.6, m.get('rooftile'), true, 4.5);
  for (const face of [k.sub(-39, 0, 8, Math.PI / 2), k.sub(-53, 0, 8, -Math.PI / 2)]) for (const y of [2.4, 5.6, 8.8, 11.6]) face.panes(house, 24, y, 7, 1.3, 1.7);
  k.sub(-46, 0, 21, 0).panes(house, 11, 5.6, 3, 1.3, 1.7).panes(house, 11, 8.8, 3, 1.3, 1.7);

  // Boiler house and chimney behind.
  k.solid(-22, 0, -34, 14, 8, 10, brick);
  k.cyl(-31, 0, -34, 1.3, 1.9, 40, m.get('concrete', { color: 0xb1aca0 }), 12).collide(-31, 0, -34, 3.4, 40, 3.4);
  k.cyl(-31, 38, -34, 1.38, 1.38, 1.2, m.get('paintedMetal', { color: 0x7a2a22 }), 12);

  // Main entrance under a canopy.
  k.quad(0, 2, 5.04, 16, 3.2, m.windows('shop'));
  k.box(0, 4, 8.2, 20, 0.5, 6.6, dark);
  for (const x of [-9, -3, 3, 9]) k.dbox(x, 0, 11, 0.45, 4, 0.45, conc);
  k.sign('CHRISTCHURCH HOSPITAL', 0, 4.9, 11.52, 13, 1, 0, { bg: '#f1ede2', fg: '#1f3d5a', style: 'block' });

  // Ambulance bay to the left of the entrance.
  const white = m.get('paintedMetal', { color: 0xeeeeea });
  k.box(-24, 4.3, 9.6, 14, 0.45, 9.2, white);
  for (const x of [-30.4, -17.6]) for (const z of [6, 13.6]) k.dbox(x, 0, z, 0.4, 4.3, 0.4, m.get('paintedMetal', { color: 0xb5241c }));
  k.quad(-24, 1.9, 5.04, 9, 3.2, m.get('glass', { color: 0x2c3a40 }));
  k.sign('AMBULANCES ONLY', -24, 4.53, 14.22, 8, 0.6, 0, { bg: '#b5241c', fg: '#ffffff', style: 'block' });
  k.sign('EMERGENCY', -24, 6.4, 5.05, 7, 1, 0, { bg: '#6a1010', fg: '#ffe9e0', style: 'neon' });

  // Sign at the road, car park, lamps and trees.
  k.solid(0, 0, 57, 10, 1.9, 0.6, conc);
  k.sign('CHRISTCHURCH HOSPITAL', 0, 1.1, 57.32, 9, 1.2, 0, { bg: '#1f3d5a', fg: '#f1ede2', style: 'block' });
  k.sign('CHRISTCHURCH HOSPITAL', 0, 1.1, 56.68, 9, 1.2, Math.PI, { bg: '#1f3d5a', fg: '#f1ede2', style: 'block' });
  carPark(k, 4, 36.5, 60, 31, [24.5, 36.5, 48.5]);
  for (const [x, z] of [[-24, 30.5], [30, 42.5]]) if (k.free(x, z, 0.5)) k.prop('lamp', x, z, x < 0 ? Math.PI / 2 : -Math.PI / 2);
  for (const [x, z, s] of [[-34, 30, 1], [-36, 44, 0.9], [-30, 56, 0.8], [40, 40, 0.9], [44, 52, 0.8]]) if (k.free(x, z, 4)) k.prop('tree-oak', x, z, x, s);
  flagpole(k, 14, 13, 10, 0x1f3a7a);
  k.light(0, 3.6, 10, 0xfff0d6, 1.4, 24).light(-24, 3.8, 10, 0xffe0d0, 1.3, 20);
  k.flush();
};

/**
 * Central Police Station (1973): a thirteen-storey concrete tower with precast fins and a service core on a
 * two-storey podium, radio mast on the roof, entrance canopy with the blue lamp, and a car park in front.
 * Local +z is the Hereford St front. Tower 50 m, mast top 66 m.
 */
export const policeStation: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const conc = m.get('concrete', { color: 0xbfb9aa });
  const dark = m.get('concrete', { color: 0x8d897f });
  const win = m.windows('office');
  const blue = { bg: '#1d3a6b', fg: '#ffffff', style: 'block' as const };

  // Podium and tower.
  k.solid(0, 0, -8, 34, 7, 24, conc);
  k.box(0, 7, -8, 34.5, 0.5, 24.5, dark);
  k.solid(-2, 7.5, -9, 22.5, 42.6, 17.5, conc);
  k.box(-2, 50.1, -9, 23, 0.6, 18, dark);
  k.quad(-2, 28.8, -0.21, 20, 41.6, win, 0, true).quad(-2, 28.8, -17.79, 20, 41.6, win, Math.PI, true);
  k.quad(-13.29, 28.8, -9, 15, 41.6, win, -Math.PI / 2, true);
  for (let i = 0; i <= 8; i++) for (const z of [-0.1, -17.9]) k.dbox(-12 + i * 2.5, 8, z, 0.35, 42, 0.55, conc);
  k.solid(11.5, 0, -9, 5, 53.5, 9, dark);
  k.sub(14, 0, -9, Math.PI / 2).panes(m.get('glass', { color: 0x1f2a30 }), 1, 29, 1, 1.2, 40);
  // Ground and first floor.
  const front = k.sub(0, 0, 4, 0);
  front.panes(m.windows('house'), 30, 5.3, 10, 1.7, 1.5).panes(m.windows('house'), 10, 2.2, 3, 1.7, 1.5, 0.04, 11);
  front.quad(-2, 1.7, 0.04, 8, 2.9, m.windows('shop'));
  k.quad(17.04, 1.9, -12, 9, 3.4, m.get('paintedMetal', { color: 0x59626b }), Math.PI / 2);

  // Roof plant, radio mast and dishes.
  k.box(-4, 50.7, -9, 13, 3, 10, dark);
  const steel = m.get('paintedMetal', { color: 0xd8d8d2 });
  k.beam([-4, 53.7, -9], [-4, 66, -9], 0.3, steel);
  for (const y of [57, 60.5, 63.5]) k.beam([-5.6, y, -9], [-2.4, y, -9], 0.12, steel).beam([-4, y, -10.6], [-4, y, -7.4], 0.12, steel);
  k.geo(drum(0.8, 0.3, 12), steel, -4, 55.2, -8.5).geo(drum(0.6, 0.3, 12).rotateY(Math.PI / 2), steel, -3.5, 58.6, -9);
  k.geo(sphere(0.18, 6), m.emitter(0xff2a1a, 'night'), -4, 66.1, -9);

  // Entrance: canopy, sign and the blue lamp.
  k.box(-2, 3.5, 6.4, 12, 0.4, 4.8, dark);
  for (const x of [-7.5, 3.5]) k.dbox(x, 0, 8.4, 0.4, 3.5, 0.4, conc);
  k.sign('POLICE', -2, 6.3, 4.06, 8, 1.3, 0, blue);
  k.sign('CENTRAL POLICE STATION', -2, 4.15, 8.82, 8.5, 0.5, 0, blue);
  k.dbox(5.2, 0, 9.4, 0.14, 2.7, 0.14, m.get('paintedMetal', { color: 0x1c1c1e }));
  k.geo(sphere(0.3, 8), m.emitter(0x3a6cff, 'night'), 5.2, 2.95, 9.4);

  // Car park for patrol cars, with its sign and a boundary wall.
  carPark(k, 0, 21.5, 30, 20, [15, 28]);
  k.solid(-15.4, 0, 21.5, 0.4, 1.1, 20, conc).solid(15.4, 0, 21.5, 0.4, 1.1, 20, conc);
  k.dbox(12.8, 0, 12.2, 0.1, 2.2, 0.1, steel);
  k.sign('POLICE VEHICLES ONLY', 12.8, 2, 12.26, 2.4, 0.6, 0, blue);
  flagpole(k, -12, 9, 9, 0x1f3a7a);
  if (k.free(-14.4, 21.5, 0.5)) k.prop('lamp', -14.4, 21.5, Math.PI / 2);
  k.light(-2, 3.2, 8, 0xdfe8ff, 1.3, 20);
  k.flush();
};
