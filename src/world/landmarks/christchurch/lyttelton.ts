import type { LandmarkBuilder } from '../../../core/types';
import { asphalt, flagpole } from './common';
import { Kit, type Pt2, type V3, cone, headingTowardsWater, lancet, plinth, prism, sphere, steps } from './kit';

/**
 * Lyttelton road tunnel portal. The road runs along local z through an opening at least 9.8 m wide and 6 m high
 * (wider if the road is); the hill is on −z. A concrete headwall, a curved canopy projecting 9 m over the
 * carriageway on side walls, splayed wing walls and the name. Nothing collides on the centreline.
 * If the map's heading faces into the hill the portal turns round.
 */
export const tunnelPortal: LandmarkBuilder = (p, out) => {
  const world = out.world;
  const sin = Math.sin(p.heading);
  const cos = Math.cos(p.heading);
  // Compare the ground either side of the road, ahead and behind, to find the hill.
  const level = (dz: number) => {
    let h = 0;
    for (const lx of [-22, 22]) h += world.heightAt(p.x + lx * cos + dz * sin, p.z - lx * sin + dz * cos);
    return h / 2;
  };
  const k = Kit.at(p, out, { heading: level(16) > level(-16) + 2 ? p.heading + Math.PI : p.heading });
  const m = k.m;
  const conc = m.get('concrete');
  const dark = m.get('concrete', { color: 0x8f8b82 });
  const road = world.graph.nearest(p.x, p.z, 12);
  const a = Math.min(6.6, Math.max(4.9, ((road ? road.edge.width : 7.4) + 2.2) / 2 + 0.15));
  const clear = 6;

  // Headwall with the mouth cut out of it.
  const wall: Pt2[] = [[-15, -1.5], [-a, -1.5], [-a, clear - 0.6], [-a + 0.6, clear], [a - 0.6, clear], [a, clear - 0.6], [a, -1.5], [15, -1.5], [15, 8], [9.3, 10.5], [-9.3, 10.5], [-15, 8]];
  k.geo(prism(wall, 1.2), conc, 0, 0, -0.6);
  k.box(0, 10.5, -0.6, 19.2, 0.45, 1.6, dark);
  for (const side of [-1, 1]) {
    k.collide((side * (15 + a)) / 2, 0, -0.6, 15 - a, 9, 1.2);
    for (const x of [9.2, 12.6]) k.dbox(side * x, 0, 0.1, 0.5, x > 10 ? 8.4 : 9.6, 0.3, dark);
  }

  // Curved canopy on side walls.
  const span = a + 0.9;
  const sag = 1.6;
  const radius = (span * span + sag * sag) / (2 * sag);
  const theta = Math.asin(span / radius);
  const arc = (r: number, t: number): Pt2 => [r * Math.sin(t), clear + sag - radius + r * Math.cos(t)];
  const shell: Pt2[] = [];
  for (let i = 0; i <= 10; i++) shell.push(arc(radius, -theta + (2 * theta * i) / 10));
  for (let i = 10; i >= 0; i--) shell.push(arc(radius + 0.4, -theta + (2 * theta * i) / 10));
  k.geo(prism(shell, 9), conc, 0, 0, 4.5);
  for (const side of [-1, 1]) {
    k.solid(side * (a + 0.45), -1.5, 4.5, 0.9, clear + 1.7, 9, conc);
    k.sign('TUNNEL\nLIGHTS ON', side * (a + 0.45), 2.6, 9.02, 0.8, 0.8, 0, { bg: '#f0c33a', fg: '#1c1c1c', style: 'block' });
    // Wing wall splaying out from the front of the side wall, stepping down with the bank.
    const dx = side * 5.5;
    const dz = 10;
    const len = Math.hypot(dx, dz);
    const w = k.sub(side * (a + 0.45), 0, 9, Math.atan2(-dz, dx));
    w.geo(prism([[0, -1.5], [len, -1.5], [len, 1.2], [0, 5.2]], 0.7), conc);
    w.collide(len / 2, 0, 0, len, 3, 0.7);
  }
  k.dbox(0, clear + sag - 0.14, 4.5, 0.4, 0.1, 7, m.emitter(0xffe9c0, 'night'));
  // The name stands on the front edge of the canopy, where it can be read from the road.
  k.box(0, clear + sag + 0.3, 8.8, 11.4, 1.6, 0.36, dark);
  k.sign('LYTTELTON TUNNEL', 0, clear + sag + 1.1, 8.99, 10.5, 1.3, 0, { bg: '#b9b4a6', fg: '#22262a', style: 'block' });
  k.light(0, 6, 5, 0xffe9c0, 1.5, 22);
  k.flush();
};

/**
 * Lyttelton port. Local +z is the harbour (the port turns to face whichever side has water within 90 m). A 200 m
 * wharf on piles along the first water ahead of the placement, with a container gantry crane and two luffing
 * wharf cranes; a freighter and a ferry-sized ship alongside; and behind the wharf a cargo shed, container
 * stacks, oil tanks and a coal stockpile. Everything within about 112 m of the placement.
 */
export const lytteltonPort: LandmarkBuilder = (p, out) => {
  const world = out.world;
  const deckY = Math.max(world.groundAt(p.x, p.z), world.seaLevel + 2.2);
  const k = Kit.at(p, out, { heading: headingTowardsWater(p, world, 90), y: deckY });
  const m = k.m;
  const sea = world.seaLevel - deckY;
  const conc = m.get('concrete');
  const steel = m.get('paintedMetal', { color: 0x3f6a86 });
  const ochre = m.get('paintedMetal', { color: 0xcf9a2e });
  const darkMetal = m.get('paintedMetal', { color: 0x26282b });
  const white = m.get('paintedMetal', { color: 0xf0efe9 });

  // The quay follows the first water straight ahead (14 m ahead if there is none).
  let shore = 14;
  for (let z = -10; z <= 40; z += 2) {
    if (k.water(0, z) > 0.5) {
      shore = z;
      break;
    }
  }
  const quay = shore + 10;
  const back = shore - 14;

  // Wharf deck on piles, with a timber fender face and bollards.
  k.solid(0, -1.4, (back + quay) / 2, 200, 1.7, quay - back, conc);
  k.box(0, -1.7, quay + 0.2, 200, 1.7, 0.4, m.get('timber', { color: 0x4a3d32 }));
  for (let x = -95; x <= 95; x += 10) {
    k.dbox(x, sea - 4, quay - 1.5, 0.7, 2.6 - sea, 0.7, m.get('timber', { color: 0x3d342c }));
    k.geo(cone(0.3, 0.5, 8, 0.2), darkMetal, x + 5, 0.3, quay - 0.8);
  }

  // Sealed yard behind the wharf.
  const yardBack = Math.max(back - 46, -62);
  k.pave(steps(-100, 100, 20), steps(yardBack, back, 12), () => asphalt(m));

  // Everything in the yard stands on its own patch of ground (never below the high-water mark).
  const floor = sea + 0.4;

  // Cargo shed.
  const iron = m.get('corrugated', { color: 0xb9b4a8 });
  const shed = k.seat(-66, back - 12, 0, floor);
  shed.solid(0, 0, 0, 56, 8, 16, iron);
  shed.roof(0, 8, 0, 57, 17, 3, m.get('corrugated', { color: 0x8a9096 }));
  for (const x of [-18, 0, 18]) shed.quad(x, 2.6, 8.04, 8, 5.2, m.get('paintedMetal', { color: 0x55606a }));
  shed.sign('LYTTELTON  SHED 3', 0, 6.6, 8.05, 14, 1.4, 0, { bg: '#e9e4d6', fg: '#222222', style: 'block' });

  // Oil tanks in a bund.
  const tank = m.get('paintedMetal', { color: 0xe6e4dc });
  const tankZ = Math.max(yardBack + 9.5, back - 34);
  for (const [x, r, h] of [[-84, 8, 11], [-64, 8, 11], [-46, 6, 9]]) {
    const t = k.seat(x, tankZ, 0, floor);
    t.cyl(0, 0, 0, r, r, h, tank, 16).collide(0, 0, 0, r * 1.6, h, r * 1.6);
    t.geo(cone(r, 1.1, 16), m.get('paintedMetal', { color: 0xc9c7bf }), 0, h, 0);
  }
  if (tankZ + 9.6 < back - 20.6) k.seat(-66, tankZ + 9.6, 0, floor).box(0, 0, 0, 58, 0.9, 0.4, conc);

  // Container stacks: two double rows, one to three high.
  const boxColours = [0x8a3324, 0x2f5a8a, 0x3f6a4a, 0x9a9a94, 0xc46a2a, 0xe6e2d6, 0x6a2f2f];
  for (let row = 0; row < 4; row++) {
    const stack = k.seat(0.6, back - 9 - row * 2.7 - (row > 1 ? 9 : 0), 0, floor);
    for (let col = 0; col < 4; col++) {
      const high = 1 + ((row * 5 + col * 3 + 1) % 3);
      for (let level = 0; level < high; level++) stack.box(-19.2 + col * 12.8, level * 2.6, 0, 12.2, 2.59, 2.44, m.get('corrugated', { color: boxColours[(row * 3 + col * 5 + level * 2) % boxColours.length] }));
    }
    if (row % 2 === 0) stack.collide(0, 0, -1.35, 51, 5.2, 5.2);
  }

  // Coal stockpile with a stacker conveyor.
  const coal = m.get('gravel', { color: 0x1d1d20 });
  const coalZ = Math.max(yardBack + 16, back - 30);
  const pile = k.seat(62, coalZ, 0, floor);
  pile.geo(cone(15, 8.6, 12), coal, 0, -0.6, 0).geo(cone(11, 6.6, 10), coal, 18, -0.6, 6).geo(cone(9, 5.6, 10), coal, -15, -0.6, 2);
  pile.collide(0, 0, 0, 16, 5, 16);
  pile.beam([-22, 0.6, -9], [-1, 9.4, -0.5], 0.9, ochre).beam([-11.5, -0.6, -4.7], [-11.5, 5, -4.7], 0.4, ochre);

  // Container gantry crane: portal legs, a boom out over the ship, A-frame and stays.
  const gx = -44;
  const legs: V3[] = [];
  for (const dx of [-9, 9]) for (const z of [back + 4, quay - 3]) legs.push([gx + dx, 0.3, z]);
  for (const [x, , z] of legs) {
    k.beam([x, 0.3, z], [x, 27, z], 1.2, steel);
    k.collide(x, 0.3, z, 1.4, 6, 1.4);
  }
  for (const dx of [-9, 9]) k.beam([gx + dx, 26.4, back + 4], [gx + dx, 26.4, quay - 3], 1.0, steel).beam([gx + dx, 8, back + 4], [gx + dx, 8, quay - 3], 0.7, steel);
  for (const z of [back + 4, quay - 3]) k.beam([gx - 9, 26.4, z], [gx + 9, 26.4, z], 1.0, steel);
  for (const dx of [-2.6, 2.6]) k.beam([gx + dx, 27.6, back - 8], [gx + dx, 27.6, quay + 28], 1.4, steel);
  const apex: V3 = [gx, 41, back + 6];
  for (const dx of [-2.6, 2.6]) {
    k.beam([gx + dx, 27.6, back + 4], apex, 0.6, steel).beam([gx + dx, 27.6, quay - 3], apex, 0.6, steel);
    k.beam(apex, [gx + dx, 28.2, quay + 26], 0.3, steel).beam(apex, [gx + dx, 28.2, back - 7], 0.3, steel);
  }
  k.dbox(gx, 28.3, back - 3, 7, 4, 9, white);
  k.dbox(gx, 24.6, quay + 9, 3.2, 2.6, 3.4, white);
  for (const dx of [-1.1, 1.1]) k.beam([gx + dx, 24.6, quay + 9], [gx + dx, 15.2, quay + 9], 0.08, darkMetal);
  k.dbox(gx, 12.6, quay + 9, 2.44, 2.59, 6.1, m.get('corrugated', { color: 0xc46a2a }));

  // Two level-luffing wharf cranes.
  for (const cx of [-62, 30]) {
    const cz = quay - 5;
    for (const dx of [-3, 3]) for (const dz of [-3, 3]) k.beam([cx + dx, 0.3, cz + dz], [cx + dx * 0.5, 8, cz + dz * 0.5], 0.5, ochre);
    k.collide(cx, 0.3, cz, 6, 7.7, 6);
    k.dbox(cx, 8, cz, 4.2, 3.6, 5.2, ochre);
    k.beam([cx, 10.5, cz + 2], [cx, 29, cz + 21], 0.55, ochre).beam([cx, 11.6, cz - 1.5], [cx, 19, cz - 1], 0.4, ochre).beam([cx, 19, cz - 1], [cx, 29, cz + 21], 0.14, darkMetal);
    k.beam([cx, 29, cz + 21], [cx, 14, cz + 21], 0.07, darkMetal);
  }

  // Freighter alongside, bow to the left.
  const oxide = m.get('paintedMetal', { color: 0x7a2f26 });
  const hullDark = m.get('paintedMetal', { color: 0x1f2a36 });
  const deckPaint = m.get('paintedMetal', { color: 0x6a5a4a });
  const fx = -38;
  const fz = quay + 7.9;
  const hull: Pt2[] = [[-40, 0], [-30, -5.2], [-18, -6.5], [34, -6.5], [40, -5], [40, 5], [34, 6.5], [-18, 6.5], [-30, 5.2]];
  const top = sea + 6.2;
  k.geo(plinth(hull, 2.1), oxide, fx, sea - 1.2, fz).geo(plinth(hull, 5.3), hullDark, fx, sea + 0.9, fz);
  k.geo(plinth(hull.map(([x, z]): Pt2 => [x * 0.985, z * 0.93]), 0.08), deckPaint, fx, top, fz);
  k.geo(plinth([[-40, 0], [-30, -5.2], [-24, -5.9], [-24, 5.9], [-30, 5.2]], 1.6), hullDark, fx, top, fz);
  k.collide(fx, sea - 1, fz, 80, 7.2, 13);
  k.box(fx + 24, top, fz, 16, 3, 11.6, white).box(fx + 23, top + 3, fz, 13, 2.8, 10.2, white).box(fx + 20.5, top + 5.8, fz, 7, 2.6, 12.6, white);
  k.dbox(fx + 16.96, top + 6.6, fz, 0.08, 1.0, 11.6, darkMetal);
  k.cyl(fx + 27, top + 5.8, fz, 1.5, 1.8, 5, m.get('paintedMetal', { color: 0xd3ac62 }), 12).cyl(fx + 27, top + 10.8, fz, 1.55, 1.52, 1.1, darkMetal, 12);
  for (const hx of [-22, -6, 9]) k.box(fx + hx, top, fz, 11, 1.1, 8, m.get('paintedMetal', { color: 0x59626b }));
  k.box(fx - 6, top + 1.1, fz - 1.3, 6.1, 2.59, 2.44, m.get('corrugated', { color: 0x2f5a8a })).box(fx - 6, top + 1.1, fz + 1.3, 6.1, 2.59, 2.44, m.get('corrugated', { color: 0x8a3324 }));
  for (const mx of [-14, 1.5]) {
    for (const dz of [-2.4, 2.4]) k.beam([fx + mx, top, fz + dz], [fx + mx, top + 12, fz + dz], 0.5, ochre);
    k.beam([fx + mx, top + 11.4, fz - 2.4], [fx + mx, top + 11.4, fz + 2.4], 0.4, ochre);
    k.beam([fx + mx, top + 2, fz], [fx + mx - 7, top + 6.5, fz - 1], 0.3, ochre).beam([fx + mx, top + 2, fz], [fx + mx + 6, top + 7, fz + 1], 0.3, ochre);
  }
  k.beam([fx - 36, top + 1.6, fz - 3], [fx - 30, 0.6, quay - 0.8], 0.07, darkMetal).beam([fx + 38, top, fz - 5], [fx + 33, 0.6, quay - 0.8], 0.07, darkMetal);

  // Ferry-sized passenger ship, bow to the right.
  const sx = 52;
  const sz = quay + 6.9;
  const ferry: Pt2[] = [[27, 0], [19, -4.6], [8, -5.5], [-24, -5.5], [-27, -3.5], [-27, 3.5], [-24, 5.5], [8, 5.5], [19, 4.6]];
  const ferryGreen = m.get('paintedMetal', { color: 0x1f4a3c });
  const main = sea + 5.4;
  k.geo(plinth(ferry, 1.9), ferryGreen, sx, sea - 1.2, sz).geo(plinth(ferry, 4.7), white, sx, sea + 0.7, sz);
  k.geo(plinth(ferry.map(([x, z]): Pt2 => [x * 0.985, z * 0.93]), 0.08), m.get('paintedMetal', { color: 0x4f6a5a }), sx, main, sz);
  k.collide(sx, sea - 1, sz, 54, 6.4, 11);
  k.box(sx - 3, main, sz, 38, 2.6, 9.6, white).box(sx - 4, main + 2.6, sz, 30, 2.5, 8.6, white).box(sx + 8, main + 5.1, sz, 8, 2.4, 10.4, white);
  for (const side of [-1, 1]) {
    k.dbox(sx - 3, main + 1.1, sz + side * 4.8, 35, 0.9, 0.08, darkMetal).dbox(sx - 4, main + 3.6, sz + side * 4.3, 27, 0.9, 0.08, darkMetal);
    for (const bx of [-14, -7, 0]) k.dbox(sx + bx, main + 5.1, sz + side * 4.6, 5, 1.1, 1.7, m.get('paintedMetal', { color: 0xd96a1e }));
  }
  k.dbox(sx + 12.02, main + 5.9, sz, 0.08, 0.9, 9.6, darkMetal);
  k.cyl(sx - 9, main + 5.1, sz, 1.7, 2.0, 5.2, ferryGreen, 12).cyl(sx - 9, main + 8.2, sz, 1.82, 1.86, 0.9, white, 12);
  k.beam([sx + 9, main + 7.5, sz], [sx + 9, main + 14, sz], 0.25, white).beam([sx + 7.6, main + 12, sz], [sx + 10.4, main + 12, sz], 0.12, white);
  k.beam([sx + 24, main, sz - 2], [sx + 21, 0.6, quay - 0.8], 0.07, darkMetal).beam([sx - 26, main, sz - 3], [sx - 22, 0.6, quay - 0.8], 0.07, darkMetal);

  for (const [x, z] of [[-30, back - 5], [34, back - 5], [-96, back - 30], [30, back - 34]]) if (z > yardBack + 2 && k.free(x, z, 1)) k.prop('lamp', x, z, 0);
  k.light(gx, 8, quay - 6, 0xfff0d6, 1.6, 34).light(40, 8, back + 2, 0xfff0d6, 1.5, 30);
  k.flush();
};

/**
 * The Timeball Station: a castellated three-storey stone block with an octagonal tower carrying the time ball
 * on its mast, and a lower wing, on a stone terrace. Local +z faces the harbour. 18 × 15 m; mast top 22 m.
 */
export const timeballStation: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  const m = k.m;
  // Red-brown local scoria with pale stone quoins and string courses.
  const stone = m.get('limestone', { color: 0xb08878 });
  const dress = m.get('limestone');
  const glass = m.get('glass', { color: 0x1a232c });
  const house = m.windows('house');
  const dark = m.get('paintedMetal', { color: 0x2b2d30 });

  k.footing(0, -1, 18, 15, 0.25, stone);

  // Three-storey block with battlements.
  k.solid(1.5, 0.25, -2.5, 9, 10.2, 9, stone);
  for (const y of [3.7, 7.1]) k.box(1.5, y, -2.5, 9.2, 0.25, 9.2, dress);
  k.box(1.5, 10.45, -2.5, 9.5, 0.35, 9.5, dress);
  k.faces(1.5, -2.5, 9.5, 9.5, 10.8).forEach(({ k: face }) => {
    for (const x of [-3.9, -1.3, 1.3, 3.9]) face.dbox(x, 0, -0.25, 1.4, 0.9, 0.5, stone);
  });
  k.faces(1.5, -2.5, 9, 9).forEach(({ k: face }, i) => {
    if (i === 3) return;
    // The tower covers the left of the front; the door takes its ground floor.
    for (const y of i === 0 ? [5.5, 8.8] : [2.3, 5.5, 8.8]) face.panes(house, i === 0 ? 4.4 : 7, y, i === 0 ? 2 : 3, 1.0, 1.7, 0.04, i === 0 ? 2.1 : 0);
  });
  k.geo(lancet(1.3, 2.5, 0.8), m.get('timber', { color: 0x4a3324 }), 3.6, 0.25, 2.05);

  // Octagonal tower with the time ball.
  const tx = -1.6;
  const tz = 3.1;
  k.cyl(tx, 0.25, tz, 2.7, 2.7, 15, stone, 8).collide(tx, 0.25, tz, 4.6, 15, 4.6);
  k.cyl(tx, 15.25, tz, 3.0, 3.0, 0.4, dress, 8);
  k.cyl(tx, 7.6, tz, 2.8, 2.8, 0.25, dress, 8);
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const face = k.sub(tx + Math.cos(a) * 2.5, 0, tz + Math.sin(a) * 2.5, Math.PI / 2 - a);
    face.dbox(0, 15.65, 0, 1.2, 0.9, 0.5, stone);
    if (Math.sin(a) > -0.2) face.geo(lancet(0.7, 2.2), glass, 0, 3.4, 0.02).geo(lancet(0.7, 2.2), glass, 0, 8.4, 0.02).geo(lancet(0.7, 1.8), glass, 0, 12.2, 0.02);
  }
  k.beam([tx, 15.6, tz], [tx, 21.8, tz], 0.18, dark);
  k.geo(sphere(0.85, 12), m.get('paintedMetal', { color: 0x34373b }), tx, 18.4, tz);
  k.beam([tx - 1.1, 21, tz], [tx + 1.1, 21, tz], 0.08, dark).beam([tx, 21, tz - 1.1], [tx, 21, tz + 1.1], 0.08, dark);
  k.geo(cone(0.2, 0.7, 6), dark, tx, 21.8, tz);

  // Lower wing.
  k.solid(-6, 0.25, -3.5, 6, 5, 7, stone);
  k.box(-6, 5.25, -3.5, 6.4, 0.3, 7.4, dress);
  k.sub(-6, 0, 0, 0).panes(house, 4.4, 2.6, 2, 1.0, 1.7);
  k.sub(-9, 0, -3.5, -Math.PI / 2).panes(house, 5, 2.6, 2, 1.0, 1.7);

  // Terrace wall, name board and flagstaff.
  k.solid(2.5, 0.25, 6.2, 12, 0.9, 0.5, stone);
  k.sign('TIMEBALL STATION', 4, 1.75, 6.47, 3.4, 0.6, 0, { bg: '#2c3a34', fg: '#e9dfc2', style: 'paint' });
  k.dbox(2.5, 1.15, 6.2, 0.1, 0.9, 0.1, dark).dbox(5.5, 1.15, 6.2, 0.1, 0.9, 0.1, dark);
  flagpole(k, 5.4, -6, 16, 0x1f3a7a);
  k.light(tx, 4, tz + 4, 0xffd9a0, 1.1, 16);
  k.flush();
};
