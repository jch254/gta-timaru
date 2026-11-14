import type { ChunkBuilder, LandmarkBuilder, LandmarkPlacement } from '../../../core/types';
import { flagpole, gothicRange, stoneSet } from './common';
import { Kit, type V3, arcade, cone, drum, lancet, num, sphere, wedge } from './kit';

/**
 * Sign of the Takahe: the neo-Gothic stone roadhouse on Dyers Pass Road. A hall range, a gabled cross wing, a
 * battlemented tower with a stair turret and a pointed entrance porch, all on a stone terrace. Local +z faces
 * the road. 30 × 22 m terrace; tower 16.5 m, turret 20.5 m.
 */
export const signOfTheTakahe: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  // Warm grey-brown Port Hills stone with cream dressings.
  const s = { ...stoneSet(m), grey: m.get('limestone', { color: 0xa89a9e }) };

  k.footing(0, -1, 30, 22, 0.2, s.grey);
  gothicRange(k, -2, -3, 22, 8.5, 8, 5.5, s, { gables: [-5], ends: 'a' });
  gothicRange(k, 9.5, -1, 15, 8, 8.5, 5.5, s, { alongZ: true });
  const gable = k.sub(9.5, 0, 6.5, 0);
  gable.lancets(s.glow, 5, 2.2, 3, 1.0, 4.6, 0.03, 0, s.dress).lancets(s.glass, 1, 9.6, 1, 0.7, 1.8, 0.3);

  // Battlemented tower in the angle, with the entrance at its foot.
  const tx = 2.6;
  const tz = 3.6;
  k.solid(tx, 0, tz, 5.4, 15, 5.4, s.grey);
  k.box(tx, 15, tz, 5.9, 0.4, 5.9, s.dress);
  k.box(tx, 7.6, tz, 5.6, 0.3, 5.6, s.dress);
  k.faces(tx, tz, 5.9, 5.9, 15.4).forEach(({ k: face }) => {
    for (const x of [-2.35, 0, 2.35]) face.dbox(x, 0, -0.25, 1.2, 1.1, 0.5, s.grey);
  });
  k.faces(tx, tz, 5.4, 5.4).forEach(({ k: face }, i) => {
    if (i === 2) return;
    face.lancets(s.glass, 1, 9.4, 1, 0.9, 3, 0.03, 0, s.dress).lancets(s.glow, 1, 4.6, 1, 0.9, 2.4, 0.03, 0, s.dress);
  });
  k.geo(arcade(4.4, 3.9, 1.1, [{ cx: 0, w: 2.2, h: 3.4, rise: 1.6 }], [[2.2, 3.9], [0, 5.2], [-2.2, 3.9]]), s.dress, tx, 0, tz + 3.2);
  k.geo(lancet(1.9, 3.1, 1.4), s.door, tx, 0, tz + 2.74);
  k.cyl(-0.4, 0, 6.5, 1.1, 1.1, 18.4, s.grey, 8).collide(-0.4, 0, 6.5, 1.9, 18.4, 1.9);
  k.cyl(-0.4, 18.4, 6.5, 1.3, 1.3, 0.4, s.dress, 8);
  k.geo(cone(1.2, 2.1, 8), s.slate, -0.4, 18.8, 6.5);

  // Chimneys, an oriel on the hall front, the terrace wall and steps.
  for (const [x, y, z] of [[-9, 11, -3], [3, 11, -3], [9.5, 11.5, -5]]) k.box(x, y, z, 1.1, 4, 1.1, s.grey);
  k.box(-9, 1, 1.7, 3.4, 5.2, 0.9, s.dress);
  k.sub(-9, 0, 2.15, 0).panes(m.windows('house'), 3, 3.6, 2, 1.1, 3.6, 0.02);
  k.solid(-4.5, 0.2, 9.7, 20, 0.9, 0.5, s.grey);
  k.box(9.5, -0.3, 10.6, 5, 0.5, 1.6, s.dress);

  // The hanging sign by the road.
  k.dbox(13, 0.2, 9.4, 0.22, 4.2, 0.22, s.door).dbox(12, 4.1, 9.4, 2.4, 0.18, 0.18, s.door);
  k.sign('SIGN OF THE\nTAKAHE', 11.9, 3.2, 9.46, 1.8, 1.2, 0, { bg: '#2c3a34', fg: '#e9dfc2', style: 'paint' });
  k.sign('SIGN OF THE\nTAKAHE', 11.9, 3.2, 9.34, 1.8, 1.2, Math.PI, { bg: '#2c3a34', fg: '#e9dfc2', style: 'paint' });

  flagpole(k, -0.4, 6.5, 24, 0x1f3a7a);
  k.prop('tree-pine', -12.5, -10.5, 0.4, 0.9).prop('tree-pine', 12, -11.5, 2, 0.8).prop('flax', -13.5, 6).prop('flax', 6.5, 9).prop('tree-cabbage', -13.6, 9.5, 1, 0.8);
  k.light(tx, 3.4, tz + 5, 0xffd9a0, 1.2, 16);
  k.flush();
};

/**
 * Sign of the Kiwi: the small rest house at the top of Dyers Pass. Stone base, dark timber walls, a hipped
 * shingle roof with wide eaves, a gabled porch and a stone chimney, with the sign hanging from a timber frame
 * on stone piers beside the road. Local +z faces the road. House 13 × 8 m.
 */
export const signOfTheKiwi: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const stone = m.get('limestone', { color: 0xa09496 });
  const timber = m.get('weatherboard', { color: 0x5d4634 });
  const beamWood = m.get('timber', { color: 0x4a3626 });
  const shingle = m.get('slate', { color: 0x6a6258 });

  k.footing(0, -1, 17, 12, 0.25, stone);
  k.solid(0, 0.25, -1.5, 13, 3, 8, timber);
  k.box(0, 0.25, -1.5, 13.2, 1.2, 8.2, stone);
  k.roof(0, 3.25, -1.5, 14.8, 9.8, 2.9, shingle, false, 3.2);
  k.box(4.2, 0.25, -3.6, 1.3, 7, 1.3, stone);

  // Gabled porch.
  k.roof(0, 2.95, 3.5, 3.4, 5, 1.6, shingle, true);
  k.pediment(0, 2.95, 5.24, 4.8, 1.55, 0.12, timber);
  for (const x of [-2.1, 2.1]) k.dbox(x, 0.25, 5, 0.2, 2.7, 0.2, beamWood);
  const front = k.sub(0, 0, 2.5, 0);
  front.quad(0, 1.3, 0.04, 1.1, 2.05, m.get('timber', { color: 0x3a2a1e }));
  front.panes(m.windows('house'), 4, 2.1, 2, 1.3, 1.2, 0.04, -4.2).panes(m.windows('house'), 4, 2.1, 2, 1.3, 1.2, 0.04, 4.2);
  k.sub(6.5, 0, -1.5, Math.PI / 2).panes(m.windows('house'), 6, 2.1, 2, 1.3, 1.2);
  k.sub(-6.5, 0, -1.5, -Math.PI / 2).panes(m.windows('house'), 6, 2.1, 2, 1.3, 1.2);

  // The sign, hung from a timber gallows on two stone piers.
  for (const x of [-8.3, -4.3]) {
    k.solid(x, 0, 8.6, 0.8, 2.2, 0.8, stone);
    k.dbox(x, 2.2, 8.6, 0.26, 2.4, 0.26, beamWood);
  }
  k.dbox(-6.3, 4.5, 8.6, 5.4, 0.26, 0.26, beamWood);
  k.roof(-6.3, 4.76, 8.6, 5.8, 1.2, 0.5, shingle);
  k.sign('SIGN OF\nTHE KIWI', -6.3, 3.5, 8.67, 2.2, 1.4, 0, { bg: '#e9dfc2', fg: '#3a2a1e', style: 'paint' });
  k.sign('SIGN OF\nTHE KIWI', -6.3, 3.5, 8.53, 2.2, 1.4, Math.PI, { bg: '#e9dfc2', fg: '#3a2a1e', style: 'paint' });
  k.beam([-7.2, 4.5, 8.6], [-7.2, 4.2, 8.6], 0.05, beamWood).beam([-5.4, 4.5, 8.6], [-5.4, 4.2, 8.6], 0.05, beamWood);

  // Terrace wall, picnic seats and planting.
  k.solid(3.5, 0.25, 5.6, 8, 0.8, 0.5, stone);
  k.prop('chch-bench', 6, 8, 0).prop('chch-bench', 9.5, 3, Math.PI / 2);
  k.prop('flax', -9.5, 3).prop('flax', 9.6, -6).prop('flax', -3, 7.4).prop('tree-cabbage', -10.5, -5, 0, 0.9).prop('tree-cabbage', 10.5, 7.5, 2, 0.75);
  k.light(0, 2.6, 5, 0xffd9a0, 1.1, 14);
  k.flush();
};

/**
 * Sugarloaf television mast: a square steel lattice tower in red and white bands with an antenna column on top,
 * microwave dishes, red obstruction lights and the transmitter building at its foot. `params.height` sets the
 * height (default 84 m: the real mast is 121 m, shortened to suit the compressed hills). 26 × 24 m compound.
 */
export const sugarloafTower: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  const height = Math.max(40, num(p, 'height', 84));
  const red = m.get('paintedMetal', { color: 0xc2271d });
  const white = m.get('paintedMetal', { color: 0xf2f0ea });
  const conc = m.get('concrete');
  const lamp = m.emitter(0xff2a1a, 'night');

  k.footing(0, 0, 26, 24, 0.3, conc);
  // Transmitter building.
  k.solid(-6.3, 0.3, -6, 11.4, 8.5, 9, conc);
  k.box(-6.3, 8.8, -6, 11.9, 0.4, 9.5, m.get('concrete', { color: 0x8f8b82 }));
  k.quad(-6.3, 5.6, -1.46, 10, 3.2, m.windows('office'), 0, true);
  k.quad(-9, 1.5, -1.46, 1.2, 2.3, m.get('paintedMetal', { color: 0x4d5560 }));
  k.geo(drum(1.1, 0.4, 14), white, -9, 10.6, -4).geo(drum(0.8, 0.35, 12).rotateY(0.9), white, -2.5, 10.3, -7.5);
  k.dbox(-9, 9.2, -4.4, 0.2, 1.4, 0.2, white).dbox(-2.5, 9.2, -7.8, 0.2, 1.1, 0.2, white);

  // Lattice mast: four legs tapering upwards, a ring and cross-bracing per band.
  const mx = 4.6;
  const mz = 2.4;
  const base = 0.3;
  const lattice = height * 0.8;
  const bands = 8;
  const halfAt = (y: number) => 4.2 + (0.9 - 4.2) * ((y - base) / lattice);
  const corner = (y: number, i: number): V3 => {
    const h = halfAt(y);
    return [mx + (i === 0 || i === 3 ? -h : h), y, mz + (i < 2 ? -h : h)];
  };
  for (let b = 0; b < bands; b++) {
    const y0 = base + (lattice * b) / bands;
    const y1 = base + (lattice * (b + 1)) / bands;
    const paint = b % 2 ? white : red;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      k.beam(corner(y0, i), corner(y1, i), 0.44 - b * 0.03, paint);
      k.beam(corner(y1, i), corner(y1, j), 0.2, paint);
      k.beam(corner(y0, i), corner(y1, j), 0.15, paint).beam(corner(y0, j), corner(y1, i), 0.15, paint);
    }
    if (b === 3 || b === 5) {
      // Dish platform.
      const h = halfAt(y1) + 0.9;
      k.dbox(mx, y1, mz, h * 2, 0.2, h * 2, m.get('paintedMetal', { color: 0x6c7075 }));
      k.geo(drum(1.0, 0.4, 12), white, mx - 0.5, y1 + 1.4, mz + h).geo(drum(0.9, 0.4, 12).rotateY(Math.PI / 2), white, mx + h, y1 + 1.3, mz + 0.4);
    }
    if (b === 3) for (let i = 0; i < 4; i++) k.geo(sphere(0.22, 6), lamp, ...corner(y1, i));
  }
  const top = base + lattice;
  k.beam([mx, top, mz], [mx, top + (height - lattice) * 0.5, mz], 0.8, white);
  k.beam([mx, top + (height - lattice) * 0.5, mz], [mx, base + height, mz], 0.6, red);
  for (let i = 0; i < 4; i++) k.dbox(mx + [0.75, 0, -0.75, 0][i], top + 1, mz + [0, 0.75, 0, -0.75][i], 0.3, (height - lattice) * 0.4, 0.3, white);
  k.geo(sphere(0.3, 6), lamp, mx, base + height + 0.2, mz);
  for (let i = 0; i < 4; i++) {
    const [x, , z] = corner(base, i);
    k.box(x, base, z, 1.1, 0.9, 1.1, conc).collide(x, base, z, 0.9, 4, 0.9);
  }

  // Security fence round the compound.
  const wire = m.get('paintedMetal', { color: 0x8c9296 });
  const fence: [number, number][] = [[-12.4, -11.4], [12.4, -11.4], [12.4, 11.4], [-12.4, 11.4]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = fence[i];
    const [bx, bz] = fence[(i + 1) % 4];
    for (const y of [1.2, 2.3]) k.beam([ax, y, az], [bx, y, bz], 0.06, wire);
    const n = Math.round(Math.hypot(bx - ax, bz - az) / 4.1);
    for (let j = 0; j < n; j++) k.dbox(ax + ((bx - ax) * j) / n, 0.3, az + ((bz - az) * j) / n, 0.08, 2.1, 0.08, wire);
  }
  k.light(mx, 6, mz, 0xff5a40, 0.8, 26);
  k.flush();
};

/**
 * Gondola station (base or summit): a round cable terminal with the bull wheel, the first two pylons of the line
 * with cabins on the rope, and the station building on the side away from the cable. The line heads for the other
 * station when the map has one, otherwise straight out the back.
 */
function gondolaStation(p: LandmarkPlacement, out: ChunkBuilder, summit: boolean): void {
  const other = out.world.landmarks.find((l) => l.kind === (summit ? 'gondola-base' : 'gondola-summit'));
  const line = other ? Math.atan2(other.x - p.x, other.z - p.z) : p.heading + Math.PI;
  // If the cable would leave over the building, turn the building round.
  const k = Kit.at(p, out, { heading: Math.cos(line - p.heading) > 0.3 ? p.heading + Math.PI : p.heading });
  const c = k.sub(0, 0, 0, line - k.heading);
  const m = k.m;
  const conc = m.get('concrete');
  const steel = m.get('paintedMetal', { color: 0xe6e6e0 });
  const dark = m.get('paintedMetal', { color: 0x2c2f33 });
  const teal = m.get('corrugated', { color: 0x2f6f66 });
  const wall = m.get('plaster', { color: 0xe4ddca });
  const glass = m.get('glass', { color: 0x2c3a40 });

  // Terminal: octagonal roof on columns over the bull wheel.
  k.footing(0, 0, 14, 14, 0.3, conc);
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    k.dbox(Math.cos(a) * 5.7, 0.3, Math.sin(a) * 5.7, 0.4, 5.6, 0.4, steel);
  }
  k.cyl(0, 5.9, 0, 6.6, 6.6, 0.5, teal, 8);
  k.geo(cone(6.6, 1.5, 8), teal, 0, 6.4, 0);
  k.cyl(0, 0.3, 0, 0.5, 0.65, 4.1, conc, 8).collide(0, 0.3, 0, 1.2, 4.1, 1.2);
  k.cyl(0, 4.4, 0, 2.3, 2.3, 0.3, m.get('paintedMetal', { color: 0xb5241c }), 16);

  // The line: two ropes over two pylons, with three cabins.
  const rope = 4.55;
  const pylons = [14, 26].map((z, i) => {
    const g = Math.min(c.ground(0, z), rope + 12);
    const h = Math.min(30, Math.max(5, (i ? 10.5 : 9) + Math.max(0, -g - 12)));
    c.geo(cone(0.45, h, 8, 0.28), steel, 0, g, z);
    c.collide(0, g, z, 0.9, h, 0.9);
    c.dbox(0, g + h - 0.3, z, 6, 0.35, 0.5, steel);
    for (const x of [-2.3, 2.3]) c.dbox(x, g + h - 0.02, z, 0.24, 0.24, 2.2, dark);
    return { z, y: g + h + 0.25 };
  });
  const path: V3[] = [[0, rope, 0], [0, pylons[0].y, pylons[0].z], [0, pylons[1].y, pylons[1].z]];
  for (const x of [-2.3, 2.3]) for (let i = 0; i < 2; i++) c.beam([x, path[i][1], path[i][2]], [x, path[i + 1][1], path[i + 1][2]], 0.07, dark);
  const cabin = (x: number, seg: number, t: number, colour: number) => {
    const y = path[seg][1] + (path[seg + 1][1] - path[seg][1]) * t;
    const z = path[seg][2] + (path[seg + 1][2] - path[seg][2]) * t;
    c.beam([x, y, z], [x, y - 1.5, z], 0.08, dark);
    c.dbox(x, y - 2.5, z, 1.5, 0.95, 1.6, glass).dbox(x, y - 3.3, z, 1.5, 0.8, 1.6, m.get('paintedMetal', { color: colour }));
    c.dbox(x, y - 1.55, z, 1.6, 0.14, 1.7, steel);
  };
  cabin(2.3, 0, 0.55, 0xb5241c);
  cabin(2.3, 1, 0.5, 0x2f6f66);
  cabin(-2.3, 0, 0.8, 0xe0b030);

  // Optional: carry the pylons right across to the other station (these lie outside the clear radius).
  if (summit && other && p.params?.line === true) {
    const span = Math.hypot(other.x - p.x, other.z - p.z);
    if (span > 80 && span < 1600) {
      const n = Math.max(1, Math.ceil((span - 52) / 60));
      let prev = pylons[1];
      for (let i = 1; i <= n; i++) {
        const z = 26 + ((span - 52) * i) / n;
        const g = c.ground(0, z);
        const h = i === n ? 10.5 : 12;
        if (i < n) {
          c.geo(cone(0.45, h, 8, 0.28), steel, 0, g, z).dbox(0, g + h - 0.3, z, 6, 0.35, 0.5, steel);
        }
        for (const x of [-2.3, 2.3]) c.beam([x, prev.y, prev.z], [x, g + h + 0.25, z], 0.07, dark);
        prev = { z, y: g + h + 0.25 };
      }
    }
  }

  // Station building on the +z side.
  if (!summit) {
    k.footing(0, 13, 22.4, 9.4, 0.3, conc);
    k.solid(0, 0.3, 13, 22, 6.2, 9, wall);
    k.geo(wedge(23.2, 10.4, 2.2, 2.45, 0, 0.25), teal, 0, 6.5, 13);
    k.box(0, 4.6, 7.6, 8, 0.3, 2.4, teal);
    k.quad(-5.5, 2.1, 17.54, 9, 3, m.windows('shop')).quad(6.5, 2.1, 17.54, 7, 3, m.windows('shop'));
    k.quad(0.8, 1.5, 17.54, 2.4, 2.4, glass);
    k.sign('GONDOLA', 0, 5.3, 17.55, 7, 1.2, 0, { bg: '#2f6f66', fg: '#f4f0e2', style: 'block' });
    k.drape(0, 22, 22, 8, m.get('footpath', { color: 0xc9c2b2 }));
    k.prop('chch-bench', -6, 19.2, 0).prop('chch-bench', 7, 19.2, 0).prop('chch-lamp-standard', -10, 24).prop('chch-lamp-standard', 10, 24);
    k.prop('flax', -12, 19).prop('tree-cabbage', 12.2, 19.5, 1, 0.8);
    flagpole(k, 4, 25, 8, 0x2f6f66);
    k.light(0, 4, 19, 0xffe2b0, 1.2, 18);
  } else {
    // Summit: a two-storey viewing building with a deck and a round café end.
    k.footing(0, 14, 24, 13, 0.3, m.get('limestone', { color: 0xa09496 }));
    k.solid(0, 0.3, 13.5, 20, 7.5, 10, wall);
    k.box(0, 7.8, 13.5, 21, 0.4, 11, teal);
    k.box(0, 4.6, 7.6, 8, 0.3, 2.4, teal);
    k.quad(0, 6, 18.54, 17.5, 3.2, m.windows('office'), 0, true).quad(-4, 2.1, 18.54, 9, 2.6, m.windows('shop'));
    k.box(0, 3.9, 19.9, 22, 0.3, 2.6, conc);
    for (const x of [-10.8, -5.4, 0, 5.4, 10.8]) k.dbox(x, 4.2, 21.1, 0.1, 1.1, 0.1, steel);
    k.dbox(0, 5.25, 21.1, 21.8, 0.08, 0.08, steel).dbox(0, 4.7, 21.1, 21.8, 0.05, 0.05, steel);
    k.cyl(9.6, 0.3, 17, 4.2, 4.2, 7.9, wall, 12).collide(9.6, 0.3, 17, 7, 7.9, 7);
    k.geo(cone(4.7, 2.2, 12), teal, 9.6, 8.2, 17);
    k.sub(9.6, 0, 17, Math.PI / 4).quad(0, 5.6, 4.24, 3, 2.4, glass);
    k.sign('GONDOLA', -4, 4.6, 18.55, 6, 1, 0, { bg: '#2f6f66', fg: '#f4f0e2', style: 'block' });
    k.beam([-8.5, 8.2, 11], [-8.5, 17, 11], 0.18, steel);
    k.geo(sphere(0.2, 6), m.emitter(0xff2a1a, 'night'), -8.5, 17.1, 11);
    flagpole(k, -11, 20.5, 9, 0x2f6f66);
    k.light(0, 4, 20, 0xffe2b0, 1.2, 18);
  }
  k.flush();
}

/** Gondola base station in the Heathcote Valley. Local +z is the car-park front. */
export const gondolaBase: LandmarkBuilder = (p, out) => gondolaStation(p, out, false);

/** Gondola summit station on Mt Cavendish. `params.line: true` strings pylons and rope all the way to the base. */
export const gondolaSummit: LandmarkBuilder = (p, out) => gondolaStation(p, out, true);
