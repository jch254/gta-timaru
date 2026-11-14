import type { LandmarkBuilder } from '../../../core/types';
import { clockFace, flagpole, gothicRange, lawn, stoneSet } from './common';
import { Kit, type Opening, arcade, cone, disc, dome, lancet, pyramid, ring, wedge } from './kit';

/**
 * The Arts Centre (the former university college): grey stone Gothic Revival ranges round two quadrangles.
 * Local +z is the Worcester Boulevard front with the clock tower and the Great Hall. Footprint 104 × 76 m.
 */
export const artsCentre: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const s = stoneSet(m);

  // Perimeter ranges and the cross range between the quadrangles.
  gothicRange(k, -47.5, 0, 76, 9, 9, 5.5, s, { alongZ: true, gables: [-24, 0, 24], gablesBack: [10] });
  gothicRange(k, 47.5, 0, 76, 9, 9, 5.5, s, { alongZ: true, gablesBack: [-24, 0, 24] });
  gothicRange(k, 0, -33.5, 86, 9, 9, 5.5, s, { gablesBack: [-30, -10, 10, 30], gables: [-21.5], ends: 'none' });
  gothicRange(k, 0, 0, 58, 9, 8, 5, s, { alongZ: true, gables: [-14], gablesBack: [14], ends: 'none' });
  gothicRange(k, -29.5, 33.5, 27, 9, 9, 5.5, s, { gables: [-7, 7], ends: 'none' });
  gothicRange(k, -1, 33.5, 14, 9, 9, 5.5, s, { gables: [0], ends: 'none' });

  // Clock tower over the Worcester Boulevard entrance.
  const tx = -12;
  const tz = 34.2;
  k.solid(tx, 0, tz, 7.6, 20, 8.2, s.grey);
  for (const y of [9.2, 14.2]) k.box(tx, y, tz, 7.9, 0.35, 8.5, s.dress);
  k.box(tx, 20, tz, 8.3, 0.5, 8.9, s.dress);
  k.geo(pyramid(8.0, 8.6, 7.5), s.slate, tx, 20.5, tz);
  k.faces(tx, tz, 7.6, 8.2).forEach(({ k: face }, i) => {
    clockFace(face, 0, 16.9, 0.02, 1.55, 0);
    face.lancets(s.lead, 3.6, 10.4, 2, 0.9, 2.8);
    if (i === 0) {
      face.geo(lancet(4.0, 5.6, 2.6), s.dress, 0, 0, 0.04).geo(lancet(3.2, 5.0, 2.2), s.lead, 0, 0, 0.07);
      face.sign('THE ARTS CENTRE', 0, 7.2, 0.06, 5.4, 0.9, 0, { bg: '#2c3a34', fg: '#e9dfc2', style: 'paint' });
    }
  });
  for (const sx of [-1, 1]) {
    k.cyl(tx + sx * 3.9, 0, tz + 4.2, 0.55, 0.55, 21.5, s.grey, 8);
    k.geo(cone(0.7, 2.2, 8), s.dress, tx + sx * 3.9, 21.5, tz + 4.2);
  }

  // Great Hall: taller and wider, tall lancets between buttresses, a flèche on the ridge and a stair turret.
  gothicRange(k, 24.5, 32, 37, 12, 12, 8.5, s, { windows: false, ends: 'a' });
  for (const [side, yaw] of [[38, 0], [26, Math.PI]] as [number, number][]) {
    const wall = k.sub(24.5, 0, side, yaw);
    for (let i = 0; i < 7; i++) wall.geo(lancet(2.1, 7.52), s.dress, -15 + i * 5, 2.46, 0.03).geo(lancet(1.7, 7.2), i % 2 ? s.glass : s.glow, -15 + i * 5, 2.6, 0.055);
    if (yaw === 0) for (let i = 0; i < 8; i++) wall.box(-17.5 + i * 5, 0, 0.45, 0.8, 10, 0.9, s.grey);
  }
  k.cyl(24.5, 20.2, 32, 0.9, 0.9, 2.2, s.lead, 8);
  k.geo(cone(1.15, 6.5, 8), s.slate, 24.5, 22.4, 32);
  k.cyl(6.6, 0, 38.3, 1.4, 1.4, 17, s.grey, 8).collide(6.6, 0, 38.3, 2.4, 17, 2.4);
  k.geo(cone(1.6, 4.2, 8), s.slate, 6.6, 17, 38.3);

  // Observatory tower with its copper dome, in the corner of the west quadrangle.
  k.cyl(-39.4, 0, -25.4, 2.7, 2.7, 17.5, s.grey, 8).collide(-39.4, 0, -25.4, 4.6, 17.5, 4.6);
  k.cyl(-39.4, 17.5, -25.4, 3.0, 3.0, 0.5, s.dress, 8);
  k.geo(dome(2.75, 2.5, 12), m.get('slate', { color: 0x7fb7a2 }), -39.4, 18, -25.4);
  k.sub(-39.4, 0, -22.88, 0).lancets(s.glass, 1, 4, 1, 0.9, 2.4).lancets(s.glass, 1, 11, 1, 0.9, 2.4);

  // Cloister arcades: north side of the west quadrangle and west side of the east quadrangle.
  const cloister = (c: Kit, len: number) => {
    const openings: Opening[] = [];
    const n = Math.floor((len - 1.2) / 3.2);
    for (let i = 0; i < n; i++) openings.push({ cx: (i - (n - 1) / 2) * 3.2, w: 2.2, h: 2.9, rise: 1.5 });
    c.geo(arcade(len, 3.7, 0.45, openings), s.dress, 0, 0, 2.5);
    c.geo(wedge(len, 3.0, 0.75, 0.95, -0.05, 0.15), s.slate, 0, 3.6, 1.35);
    c.box(0, -0.2, 1.3, len, 0.26, 2.9, m.get('footpath', { color: 0xbdb6a6 }));
  };
  cloister(k.sub(-23.75, 0, 29, Math.PI), 38);
  cloister(k.sub(4.5, 0, -1.5, Math.PI / 2), 54);

  // Quadrangles: gravel walks round and across a lawn.
  const walk = m.get('gravel', { color: 0xc9bfa6 });
  const grass = lawn(m);
  const quad = (x0: number, x1: number, z0: number, z1: number) => {
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    k.pave([x0, x0 + 2.4, mx - 1.1, mx + 1.1, x1 - 2.4, x1], [z0, z0 + 2.4, mz - 1.1, mz + 1.1, z1 - 2.4, z1], (i, j) => (i % 2 === 0 || j % 2 === 0 ? walk : grass));
    k.prop('tree-oak', mx - (x1 - x0) / 4, mz + (z1 - z0) / 4, 1, 0.75);
    k.prop('chch-bench', mx + 3, z0 + 1.3, 0).prop('chch-bench', mx - 3, z1 - 1.3, Math.PI);
    k.prop('chch-lamp-standard', mx + 1.9, mz + 1.9);
  };
  quad(-43, -4.5, -29, 26);
  quad(7.5, 43, -29, 26);
  flagpole(k, tx, tz, 31.5, 0x1f3a7a);

  k.light(tx, 5, tz + 7, 0xffd9a0, 1.2, 22);
  k.flush();
};

/**
 * Canterbury Museum: Mountfort's stone front on Rolleston Avenue (local +z) with the gabled entrance porch, a rose
 * window and the flèche on the ridge, and the plainer later galleries behind. 44 m wide, about 46 m deep.
 */
export const museum: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const s = stoneSet(m);

  gothicRange(k, 0, 12, 44, 12, 10, 7, s, { gables: [-16.5, 16.5] });

  // Entrance block and porch.
  k.solid(0, 0, 20.5, 11, 11, 5, s.grey);
  k.roof(0, 11, 17.2, 11.4, 11.6, 7, s.slate, true);
  k.pediment(0, 11, 22.75, 11.5, 7.6, 0.6, s.grey);
  k.geo(disc(1.7, 16), s.glow, 0, 13.6, 23.07).geo(ring(1.75, 0.16, 16), s.dress, 0, 13.6, 23.09);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.beam([0, 13.6, 23.1], [Math.cos(a) * 1.7, 13.6 + Math.sin(a) * 1.7, 23.1], 0.12, s.dress);
  }
  k.sub(0, 0, 23, 0).lancets(s.glass, 9, 6.4, 4, 0.8, 2.6);
  k.geo(lancet(3.0, 4.9, 2.3), s.door, 0, 0, 23.04);
  k.geo(arcade(7.4, 5.4, 1.3, [{ cx: 0, w: 3.6, h: 5.0, rise: 2.5 }], [[3.7, 5.4], [0, 7.9], [-3.7, 5.4]]), s.dress, 0, 0, 23.7);
  k.collide(-2.75, 0, 23.7, 1.9, 5.4, 1.3).collide(2.75, 0, 23.7, 1.9, 5.4, 1.3);
  for (const sx of [-1, 1]) k.cyl(sx * 2.15, 0, 24.55, 0.26, 0.26, 2.6, s.dress, 8);
  k.box(0, -0.3, 25.2, 9, 0.6, 2.4, s.dress);

  // Flèche.
  k.cyl(0, 16.4, 12, 1.0, 1.0, 3.2, s.lead, 8);
  k.geo(cone(1.3, 9, 8), m.get('slate', { color: 0x7fb7a2 }), 0, 19.6, 12);
  k.dbox(0, 28.4, 12, 0.1, 1.3, 0.1, s.lead);

  // Later gallery wings behind: plain stone-faced blocks with a raised hall and roof lanterns.
  const plain = m.get('limestone', { color: 0xcbc4b2 });
  k.solid(0, 0, -7, 40, 9.5, 26, plain);
  k.box(0, 9.5, -7, 40.4, 0.5, 26.4, m.get('concrete'));
  k.box(7, 10, -9, 20, 3.6, 16, plain);
  k.roof(-10, 10, -7, 16, 6, 1.8, m.get('glass', { color: 0x4a5a60 }), true);
  k.faces(0, -7, 40, 26).forEach(({ k: face, len }, i) => {
    if (i !== 0) face.panes(m.windows('house'), len - 6, 6.2, Math.floor((len - 6) / 4.5), 1.6, 2.2);
  });

  k.sign('CANTERBURY MUSEUM', -9.5, 1.5, 24.6, 4.4, 0.9, 0, { bg: '#2c3a34', fg: '#e9dfc2', style: 'paint' });
  k.dbox(-11.5, 0, 24.55, 0.14, 2, 0.14, s.lead).dbox(-7.5, 0, 24.55, 0.14, 2, 0.14, s.lead);
  k.prop('chch-lamp-standard', -6.2, 26.2).prop('chch-lamp-standard', 6.2, 26.2);
  flagpole(k, 12, 24.5, 12, 0x1f3a7a);
  k.light(0, 5, 27, 0xffd9a0, 1.2, 20);
  k.flush();
};
