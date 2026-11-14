import type { LandmarkBuilder } from '../../../core/types';
import { asphalt, flagpole, whiteLine } from './common';
import { Kit, type Pt2, wedge } from './kit';

/** Covered grandstand in a kit whose +z faces the field: raked seating in front, rooms and a wall behind, a roof on posts. */
function grandstand(g: Kit, len: number, depth: number, roofColor: number, seatColor: number, name?: string): void {
  const m = g.m;
  const white = m.get('paintedMetal', { color: 0xecebe4 });
  g.geo(wedge(len, depth * 0.78, 0, 9.5, 0, 1.4), m.get('timber', { color: seatColor }), 0, 0, depth * 0.11);
  g.box(0, 0, depth / 2 + 0.1, len, 1.1, 0.14, white);
  g.box(0, 0, -depth * 0.39, len, 12, depth * 0.22, m.get('brick'));
  g.geo(wedge(len + 2, depth * 0.82, 12.3, 12.6, 10.9, 11.2), m.get('corrugated', { color: roofColor }), 0, 0, -depth * 0.09);
  g.box(0, 10.3, depth * 0.32, len + 2, 0.9, 0.16, white);
  const posts = Math.round(len / 12);
  for (let i = 0; i <= posts; i++) g.dbox(-len / 2 + (i * len) / posts, 4.6, depth * 0.06, 0.3, 6.6, 0.3, m.get('paintedMetal', { color: 0x3c4a44 }));
  g.quad(0, 0.75, depth / 2 + 0.18, 3, 1.3, m.get('plain', { color: 0x16181a }));
  if (name) g.sign(name, 0, 10.75, depth * 0.32 + 0.09, Math.min(22, len * 0.4), 0.8, 0, { bg: '#ecebe4', fg: '#7a1418', style: 'block', border: false });
  // Stepped colliders up the rake.
  g.collide(0, 0, depth * 0.37, len, 2.6, depth * 0.26).collide(0, 0, depth * 0.11, len, 5.4, depth * 0.26).collide(0, 0, -depth * 0.26, len, 9.5, depth * 0.48);
}

/**
 * Lancaster Park as it was in 1995: a turf oval marked for rugby with a cricket block in the middle, covered
 * grandstands on three sides, the open Embankment on the fourth, a turnstile gatehouse and a perimeter fence.
 * No light towers. Local +z is the gate side. `params.embankment: 'front'` swaps the Embankment and the main stand.
 * Enclosure 196 × 180 m; everything within 108 m of the centre.
 */
export const lancasterPark: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const conc = m.get('concrete');
  const line = whiteLine(m);

  // Oval turf, concrete apron, sealed concourse.
  k.disc(0, 0, 97, 86, [[0.68, m.get('grass', { color: 0x5f9c3c })], [0.742, conc], [1, asphalt(m)]], 0.02, 40);
  // Rugby markings: touchlines, goal lines, dead-ball lines, halfway and the 22s.
  for (const z of [-32, 32]) k.dbox(0, 0.035, z, 94.12, 0.02, 0.12, line);
  for (const x of [-47, -25, 0, 25, 47]) k.dbox(x, 0.035, 0, 0.12, 0.02, 64, line);
  for (const x of [-53, 53]) k.dbox(x, 0.035, 0, 0.12, 0.02, 64, line);
  k.dbox(0, 0.03, 0, 26, 0.012, 20, m.get('grass', { color: 0x76a846 }));
  k.dbox(0, 0.045, 0, 22, 0.012, 3.1, m.get('grass', { color: 0xc4ba8a }));
  k.prop('chch-rugby-posts', -47, 0, Math.PI / 2).prop('chch-rugby-posts', 47, 0, Math.PI / 2);

  // Stands on three sides.
  const flip = p.params?.embankment === 'front' ? -1 : 1;
  grandstand(k.sub(0, 0, flip * 74, flip === 1 ? Math.PI : 0), 96, 19, 0x8a9096, 0x6c7a66, 'LANCASTER PARK');
  grandstand(k.sub(82, 0, 0, -Math.PI / 2), 60, 18, 0x7a8288, 0x7a6a55);
  grandstand(k.sub(-82, 0, 0, Math.PI / 2), 60, 18, 0x7a8288, 0x7a6a55);
  k.box(0, 12.7, flip * 80, 10, 2.2, 3, m.get('paintedMetal', { color: 0xecebe4 }));
  flagpole(k, -40, flip * 82, 18, 0xb0161e);
  flagpole(k, 40, flip * 82, 18, 0x16181a);

  // The Embankment: an earth bank terraced in concrete on the field side, grassed at the top and behind.
  const e = k.sub(0, 0, -flip * 73.5, flip === 1 ? 0 : Math.PI);
  const bank = m.get('grass', { color: 0x6a8f45 });
  for (let i = 0; i < 8; i++) e.box(0, 0, 9 - 2.25 * (i + 0.5), 96, 0.95 * (i + 1), 2.25, i < 5 ? conc : bank);
  e.geo(wedge(96, 5, 0, 0.3, 0, 7.6), bank, 0, 0, -11.5);
  e.collide(0, 0, 6.75, 96, 1.9, 4.5).collide(0, 0, 1.125, 96, 4.75, 6.75).collide(0, 0, -5.625, 96, 7.6, 6.75);
  const board = m.get('paintedMetal', { color: 0x1c2a22 });
  e.dbox(-5, 7.6, -7.4, 0.4, 2.2, 0.4, board).dbox(5, 7.6, -7.4, 0.4, 2.2, 0.4, board);
  e.box(0, 9.8, -7.4, 14, 5, 1.2, board);
  e.sign('CANTERBURY  12\nVISITORS  9', 0, 12.3, -6.78, 12, 4, 0, { bg: '#101612', fg: '#f2efe2', style: 'block', border: false });

  // Turnstile gatehouse in the fence line on the gate side.
  const g = k.sub(0, 0, 90, 0);
  const brick = m.get('brick');
  const steel = m.get('paintedMetal', { color: 0x4d5560 });
  for (let i = 0; i < 6; i++) {
    g.solid(-15 + i * 6, 0, 0, 1.6, 3.4, 3, brick);
    if (i < 5) {
      for (const dx of [-0.75, 0.75]) g.dbox(-12 + i * 6 + dx, 0, 0, 0.12, 1.1, 0.12, steel).dbox(-12 + i * 6 + dx, 0.95, 0, 1.3, 0.06, 0.06, steel);
    }
  }
  g.box(0, 3.4, 0, 33, 0.7, 3.6, conc);
  g.box(0, 4.1, 0, 12, 1.7, 0.5, brick);
  g.sign('LANCASTER PARK', 0, 4.95, 0.27, 11, 1.3, 0, { bg: '#ecebe4', fg: '#7a1418', style: 'block' });
  g.sign('LANCASTER PARK', 0, 4.95, -0.27, 11, 1.3, Math.PI, { bg: '#ecebe4', fg: '#7a1418', style: 'block' });

  // Corrugated-iron perimeter fence with chamfered corners.
  const ring: Pt2[] = [[16.5, 90], [58, 90], [98, 44], [98, -44], [58, -90], [-58, -90], [-98, -44], [-98, 44], [-58, 90], [-16.5, 90]];
  const iron = m.get('corrugated', { color: 0x586a5c });
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[i + 1];
    k.sub((ax + bx) / 2, 0, (az + bz) / 2, Math.atan2(-(bz - az), bx - ax)).solid(0, 0, 0, Math.hypot(bx - ax, bz - az), 2.6, 0.2, iron);
  }

  k.light(0, 3, 93, 0xffe2b0, 1.3, 22).light(0, 9, flip * 70, 0xfff2d6, 1.2, 30);
  k.flush();
};
