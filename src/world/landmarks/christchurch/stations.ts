import { LAMP_WARM } from '../../scatter/util';
import type { LandmarkBuilder } from '../../../core/types';
import { carPark, clockFace, flagpole, whiteLine } from './common';
import { Kit, disc, drum, nearestRail, wedge } from './kit';

/**
 * The old Christchurch railway station on Moorhouse Avenue (1960): a long three-storey brick range with a taller
 * entrance block and a square clock tower. Local +z is the Moorhouse Ave front; the platform verandah is behind.
 * 84 m long; tower 32 m.
 */
export const oldRailwayStation: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const brick = m.get('brick');
  const conc = m.get('concrete', { color: 0xcfc9ba });
  const win = m.windows('house');
  const glass = m.get('glass', { color: 0x1f2a30 });

  // Main range.
  k.solid(0, 0, 3, 84, 11, 13, brick);
  k.box(0, 11, 3, 84.4, 0.5, 13.4, conc);
  k.box(0, 0, 3, 84.2, 0.7, 13.2, conc);
  const front = k.sub(0, 0, 9.5, 0);
  const rear = k.sub(0, 0, -3.5, Math.PI);
  for (const y of [2.4, 5.8, 9.0]) {
    front.panes(win, 28, y, 9, 1.5, 1.9, 0.04, -27).panes(win, 28, y, 9, 1.5, 1.9, 0.04, 27);
    if (y > 4.5) rear.panes(win, 80, y, 24, 1.5, 1.9);
  }
  for (const side of [k.sub(42, 0, 3, Math.PI / 2), k.sub(-42, 0, 3, -Math.PI / 2)]) for (const y of [2.4, 5.8, 9.0]) side.panes(win, 10, y, 3, 1.5, 1.9);

  // Entrance block: tall glazing between brick piers, a concrete frame and a flat canopy over the doors.
  k.solid(0, 0, 9.5, 22, 13.5, 7, brick);
  k.box(0, 13.5, 9.5, 22.6, 0.6, 7.6, conc);
  const entry = k.sub(0, 0, 13, 0);
  entry.panes(glass, 18, 8.2, 5, 2.4, 8.2, 0.05);
  entry.quad(0, 1.7, 0.05, 10, 2.9, m.windows('shop'));
  entry.box(0, 3.3, 2, 16, 0.35, 4.4, conc);
  for (const x of [-7.4, 7.4]) entry.dbox(x, 0, 3.9, 0.3, 3.3, 0.3, conc);
  entry.sign('RAILWAY STATION', 0, 12.8, 0.06, 12, 1, 0, { bg: '#6f3527', fg: '#efe6d0', style: 'block', border: false });

  // Clock tower beside the entrance.
  const tx = -16;
  const tz = 7.5;
  k.solid(tx, 0, tz, 7.5, 27, 7.5, brick);
  k.box(tx, 27, tz, 8.1, 0.6, 8.1, conc);
  k.box(tx, 27.6, tz, 5, 3, 5, conc);
  k.box(tx, 30.6, tz, 5.8, 0.4, 5.8, conc);
  k.faces(tx, tz, 7.5, 7.5).forEach(({ k: face }) => {
    clockFace(face, 0, 22.6, 0.02, 1.9, 0, 4, 37);
    face.quad(0, 11, 0.04, 1.0, 13, glass);
    face.dbox(-1.3, 4.5, 0.05, 0.35, 15, 0.2, conc).dbox(1.3, 4.5, 0.05, 0.35, 15, 0.2, conc);
  });
  flagpole(k, tx, tz, 36, 0x1f3a7a);

  // Platform and verandah along the back.
  k.solid(0, -0.3, -7.5, 82, 0.8, 8, conc);
  k.box(0, 4.3, -7.2, 80, 0.3, 7.4, m.get('corrugated', { color: 0x8a9096 }));
  for (let i = 0; i < 11; i++) k.dbox(-38 + i * 7.6, 0.5, -10.4, 0.22, 3.8, 0.22, m.get('paintedMetal', { color: 0x4a5a52 }));
  k.sign('CHRISTCHURCH', 0, 3.2, -10.5, 6, 0.8, Math.PI, { bg: '#1c2f52', fg: '#f4f0e2', style: 'block' });

  // Forecourt parking.
  carPark(k, 0, 27, 60, 22, [22, 34.5]);
  if (k.free(-27, 28, 0.5)) k.prop('lamp', -27, 28, Math.PI / 2);
  if (k.free(27, 28, 0.5)) k.prop('lamp', 27, 28, -Math.PI / 2);
  k.light(0, 4.5, 17, LAMP_WARM, 1.4, 26);
  k.flush();
};

/**
 * Addington (the 1993 Christchurch station): a low platform, a small modern station building, a platform
 * shelter and a car park. The station turns itself to lie along the nearest main-line track when there is one
 * within 30 m; otherwise the platform is 14 m behind the placement, along local x.
 */
export const addingtonStation: LandmarkBuilder = (p, out) => {
  const rail = nearestRail(out.world, p.x, p.z, 30, 'main');
  let heading = p.heading;
  let back = 14;
  if (rail) {
    back = rail.distance;
    if (back > 1) heading = Math.atan2(p.x - rail.x, p.z - rail.z);
    else {
      // Standing on the track: face whichever way across it is closer to the authored heading.
      const across = Math.atan2(rail.tz, -rail.tx);
      heading = Math.cos(across - p.heading) >= 0 ? across : across + Math.PI;
    }
  }
  const k = Kit.at(p, out, { heading });
  const m = k.m;
  const conc = m.get('concrete');
  const steel = m.get('paintedMetal', { color: 0x2f5d6b });
  const roof = m.get('corrugated', { color: 0x3f7a86 });
  const board = { bg: '#1c2f52', fg: '#f4f0e2', style: 'block' as const };
  const t = -back; // track centreline
  const half = Math.min(30, Math.sqrt(Math.max(64, 38 * 38 - back * back)));

  // Platform with a painted edge line.
  k.solid(0, -0.4, t + 4, half * 2, 1.3, 4.6, conc);
  k.box(0, 0.9, t + 1.95, half * 2, 0.02, 0.25, whiteLine(m));

  // Station building at ground level behind the platform, under a mono-pitch roof.
  const bx = Math.min(4, half - 10);
  k.solid(bx, 0, t + 10.3, 18, 4.2, 7.4, m.get('plaster', { color: 0xd9d2c0 }));
  k.geo(wedge(19.6, 9.6, 1.5, 1.75, 0, 0.25), roof, bx, 4.2, t + 10.3);
  k.quad(bx - 2, 1.7, t + 14.04, 11, 2.6, m.windows('shop'));
  k.quad(bx + 6.4, 1.15, t + 14.04, 1.8, 2.3, m.get('glass'));
  k.sign('CHRISTCHURCH', bx, 3.6, t + 14.05, 7, 0.8, 0, board);
  k.quad(bx, 2.6, t + 6.56, 12, 1.6, m.windows('shop'), Math.PI);
  k.geo(wedge(5, 3.2, 0, 0.9, 0, 0.02), conc, bx - 12, 0, t + 7.9);

  // Platform shelter and name boards.
  const sx = bx - 16 < -half + 6 ? bx + 16 : bx - 16;
  k.box(sx, 3.5, t + 4.2, 12, 0.18, 4.2, roof);
  for (const x of [-5.4, 0, 5.4]) k.dbox(sx + x, 0.9, t + 5.9, 0.16, 2.6, 0.16, steel).dbox(sx + x, 0.9, t + 2.6, 0.16, 2.6, 0.16, steel);
  k.quad(sx, 2.1, t + 6.0, 10.6, 2.2, m.get('glass', { color: 0x3a4a50 }), Math.PI);
  k.prop('chch-bench', sx - 2.5, t + 5.4, Math.PI, 1, undefined, 0.9).prop('chch-bench', sx + 2.5, t + 5.4, Math.PI, 1, undefined, 0.9);
  for (const x of [-half + 5, half - 5]) {
    k.dbox(x - 1.6, 0.9, t + 5.8, 0.12, 2.4, 0.12, steel).dbox(x + 1.6, 0.9, t + 5.8, 0.12, 2.4, 0.12, steel);
    k.sign('CHRISTCHURCH', x, 2.9, t + 5.74, 3.6, 0.7, Math.PI, board).sign('CHRISTCHURCH', x, 2.9, t + 5.86, 3.6, 0.7, 0, board);
  }

  // Car park in front, with lamps and a little planting.
  const z0 = t + 15.5;
  const z1 = Math.min(z0 + 19, 32);
  if (z1 - z0 > 8) {
    carPark(k, 0, (z0 + z1) / 2, 44, z1 - z0, [z0 + 3, z1 - 3]);
    for (const x of [-20, 20]) if (k.free(x, (z0 + z1) / 2, 0.5)) k.prop('lamp', x, (z0 + z1) / 2, x < 0 ? Math.PI / 2 : -Math.PI / 2);
    k.prop('flax', -23.2, z0 + 1).prop('flax', 23.2, z0 + 1).prop('tree-cabbage', -23.4, z1 - 2, 0, 0.8);
  }
  k.light(sx, 3.2, t + 4.2, 0xffe9c4, 1.2, 18).light(bx, 3.4, t + 15, 0xffe9c4, 1.2, 20);
  k.flush();
};

/**
 * Tram stop: a small timber shelter and a parked heritage tram (cream over red, clerestory roof, open end
 * platforms). The tram sits on the nearest tram track within 9 m; the shelter stands on the placement's side of it.
 * `params.livery: 'green'` swaps the red for green.
 */
export const tramStop: LandmarkBuilder = (p, out) => {
  const rail = nearestRail(out.world, p.x, p.z, 9, 'tram');
  let k: Kit;
  if (rail) {
    // Frame on the track: x along the rails, with the placement (and so the shelter) on the −z side.
    let heading = Math.atan2(-rail.tz, rail.tx);
    if ((p.x - rail.x) * Math.sin(heading) + (p.z - rail.z) * Math.cos(heading) > 0) heading += Math.PI;
    k = Kit.at(p, out, { x: rail.x, z: rail.z, heading });
  } else {
    k = Kit.at(p, out).sub(0, 0, 3.2, 0);
  }
  const m = k.m;
  const cream = m.get('timber', { color: 0xeadfbe });
  const body = m.get('timber', { color: p.params?.livery === 'green' ? 0x2f5a3c : 0x9c2420 });
  const dark = m.get('paintedMetal', { color: 0x26282a });
  const roofGrey = m.get('paintedMetal', { color: 0x6c7075 });
  const glass = m.get('glass', { color: 0x2a363c });

  // Running gear.
  k.box(0, 0.45, 0, 9.6, 0.4, 2.0, dark);
  for (const bx of [-2.9, 2.9]) {
    k.box(bx, 0.1, 0, 2.1, 0.45, 1.5, dark);
    for (const wx of [-0.7, 0.7]) for (const wz of [-0.62, 0.62]) k.geo(drum(0.4, 0.12, 10), m.get('metal'), bx + wx, 0.4, wz);
  }
  // Saloon: panelled sides, a band of windows between slim posts, cant rail.
  k.box(0, 0.85, 0, 7.2, 0.95, 2.2, body);
  k.box(0, 1.8, 0, 7.26, 0.12, 2.26, cream);
  k.box(0, 1.92, 0, 7.1, 0.75, 2.1, glass);
  k.box(0, 2.67, 0, 7.26, 0.22, 2.26, cream);
  for (let i = 0; i <= 8; i++) for (const z of [-1.08, 1.08]) k.dbox(-3.6 + i * 0.9, 1.92, z, 0.09, 0.75, 0.08, cream);
  // Open end platforms with dash panels, corner posts, a headlamp and a destination board.
  for (const end of [-1, 1]) {
    k.box(end * 4.75, 0.85, 0, 0.12, 1.0, 2.0, body);
    for (const z of [-1.0, 1.0]) k.dbox(end * 4.7, 0.85, z, 0.08, 1.85, 0.08, cream).dbox(end * 3.62, 0.85, z, 0.08, 1.85, 0.08, cream);
    k.dbox(end * 4.83, 1.2, 0, 0.06, 0.24, 0.24, m.emitter(0xfff0c8, 'night'));
    k.sign('CATHEDRAL SQ', end * 4.84, 2.52, 0, 1.3, 0.26, (end * Math.PI) / 2, { bg: '#111111', fg: '#f4e9c8', style: 'block', border: false });
    k.dbox(end * 4.3, 0.3, 1.15, 0.7, 0.06, 0.3, dark).dbox(end * 4.3, 0.3, -1.15, 0.7, 0.06, 0.3, dark);
  }
  // Roof with a clerestory, and the trolley pole.
  k.box(0, 2.89, 0, 10.2, 0.14, 2.36, roofGrey);
  k.box(0, 3.03, 0, 8.2, 0.34, 1.2, cream);
  k.dbox(0, 3.1, 0, 7.8, 0.18, 1.23, glass);
  k.box(0, 3.37, 0, 8.6, 0.1, 1.42, roofGrey);
  k.dbox(0.5, 3.47, 0, 0.5, 0.16, 0.4, dark);
  k.beam([0.5, 3.6, 0], [-3.7, 5.4, 0], 0.06, dark);
  k.collide(0, 0.1, 0, 10, 3.3, 2.3);

  // Shelter facing the track.
  const timber = m.get('weatherboard', { color: 0xe6dcc0 });
  const green = m.get('corrugated', { color: 0x2f5a3c });
  k.box(0, 0, -2.7, 9, 0.12, 1.7, m.get('footpath'));
  k.solid(0, 0, -5.0, 5, 2.3, 0.14, timber);
  k.box(-2.43, 0, -4.3, 0.14, 2.3, 1.3, timber).box(2.43, 0, -4.3, 0.14, 2.3, 1.3, timber);
  k.dbox(-2.4, 0, -3.25, 0.12, 2.3, 0.12, cream).dbox(2.4, 0, -3.25, 0.12, 2.3, 0.12, cream);
  k.roof(0, 2.3, -4.15, 5.9, 2.7, 0.75, green, false, 0.9);
  k.sign('TRAM STOP', 0, 2.1, -3.18, 1.9, 0.34, 0, { bg: '#2f5a3c', fg: '#f4e9c8', style: 'paint' });
  k.prop('chch-bench', 0, -4.55, 0);
  k.prop('chch-lamp-standard', 3.5, -3.4);
  k.dbox(-3.4, 0, -3.3, 0.07, 2.6, 0.07, dark);
  k.geo(disc(0.28, 12), m.get('plain', { color: 0xb0161e }), -3.4, 2.5, -3.24);
  k.light(0, 2.6, -3, LAMP_WARM, 1, 12);
  k.flush();
};
