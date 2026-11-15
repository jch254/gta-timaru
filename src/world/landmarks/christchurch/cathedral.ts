import type { ChunkBuilder, LandmarkBuilder, LandmarkPlacement } from '../../../core/types';
import { DRESSING_OFF, ROUND3_OFF } from '../../scatter/util';
import { asphalt, bronze, lawn, statue, stoneSet, whiteLine } from './common';
import { Kit, cone, disc, lancet, pyramid, ring, sphere, steps, tartan, wedge } from './kit';

/**
 * ChristChurch Cathedral as it stood before 2011. Local +z is the west front, which faces the open Square.
 * About 61 m long; nave ridge 22.5 m; tower and spire 64 m to the top of the cross. Fits a 40 m radius.
 */
export const cathedral: LandmarkBuilder = (p, out) => {
  const k = Kit.at(p, out);
  // The cathedral's stone is a lighter grey than the dark basalt of the Arts Centre.
  const s = { ...stoneSet(k.m), grey: k.m.get('limestone', { color: 0x9eadcc }) };
  const copper = k.m.get('slate', { color: 0x7fb7a2 });

  // Nave with lean-to aisles and a clerestory.
  k.solid(0, 0, 7, 9.8, 14.5, 34, s.grey);
  k.roof(0, 14.5, 2.4, 43, 10.8, 8, s.slate, true);
  k.box(0, 14.1, 7, 10.1, 0.4, 34.1, s.dress);
  for (const side of [-1, 1]) {
    k.solid(side * 7.2, 0, 6, 4.6, 6.5, 32, s.grey);
    k.box(side * 7.25, 0, 6, 5.0, 0.6, 32.4, s.dress);
    k.geo(wedge(32.4, 5.2, 3.2, 3.5, -0.1, 0.2), s.slate, side * 7.3, 6.5, 6, (side * Math.PI) / 2);
    const aisle = k.sub(side * 9.5, 0, 6, (side * Math.PI) / 2);
    for (let i = 0; i < 5; i++) aisle.geo(lancet(1.7, 3.72), s.dress, -12 + i * 6, 1.88, 0.03).geo(lancet(1.3, 3.4), i % 2 ? s.glow : s.glass, -12 + i * 6, 2, 0.055);
    for (let i = 0; i < 6; i++) k.box(side * 9.95, 0, -9 + i * 6, 0.9, 6.3, 0.8, s.grey);
    k.sub(side * 4.9, 0, 6, (side * Math.PI) / 2).lancets(s.glass, 30, 10.9, 10, 0.8, 2.6);
    k.geo(lancet(1.2, 3.2), s.glass, side * 7.2, 2, 22.04);
  }

  // Transepts and crossing.
  k.solid(0, 0, -14.5, 31, 14.5, 9, s.grey);
  k.roof(0, 14.5, -14.5, 30.9, 9.8, 7.4, s.slate);
  for (const side of [-1, 1]) {
    k.pediment(side * 15.3, 14.5, -14.5, 9.3, 7.7, 0.5, s.grey, (side * Math.PI) / 2);
    const end = k.sub(side * 15.5, 0, -14.5, (side * Math.PI) / 2);
    end.lancets(s.glow, 5.4, 4.2, 3, 1.1, 6.6, 0.03, 0, s.dress);
    end.geo(disc(1.1, 12), s.glass, 0, 13, 0.04).geo(ring(1.15, 0.12, 12), s.dress, 0, 13, 0.06);
    for (const bz of [-10.4, -18.6]) k.box(side * 15.9, 0, bz, 0.9, 9, 0.9, s.grey);
  }

  // Chancel, apse and vestries.
  k.solid(0, 0, -24, 9.8, 13.5, 10, s.grey);
  k.roof(0, 13.5, -24.3, 10.6, 10.6, 7.2, s.slate, true);
  k.cyl(0, 0, -29, 4.9, 4.9, 13.5, s.grey, 8).collide(0, 0, -31, 7, 13.5, 5);
  k.geo(cone(5.25, 6.8, 8), s.slate, 0, 13.5, -29);
  for (const a of [-7 / 8, -5 / 8, -3 / 8, -1 / 8]) {
    const angle = a * Math.PI;
    k.sub(Math.cos(angle) * 4.55, 0, -29 + Math.sin(angle) * 4.55, Math.PI / 2 - angle).lancets(s.glow, 1, 4, 1, 1.1, 6.2, 0.03, 0, s.dress);
  }
  for (const side of [-1, 1]) {
    k.solid(side * 7.4, 0, -24, 5, 5.5, 7, s.grey);
    k.geo(wedge(7.4, 5.4, 2.2, 2.45, -0.1, 0.15), s.slate, side * 7.5, 5.5, -24, (side * Math.PI) / 2);
  }

  // West front: gable, rose window, arcade of small lancets, gabled porch and corner turrets.
  k.pediment(0, 14.5, 23.8, 10.2, 8.6, 0.6, s.grey);
  k.geo(disc(2.3, 20), s.glow, 0, 11.2, 24.04).geo(ring(2.35, 0.2, 20), s.dress, 0, 11.2, 24.06).geo(ring(0.75, 0.14, 12), s.dress, 0, 11.2, 24.08);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.beam([Math.cos(a) * 0.75, 11.2 + Math.sin(a) * 0.75, 24.08], [Math.cos(a) * 2.3, 11.2 + Math.sin(a) * 2.3, 24.08], 0.14, s.dress);
  }
  k.geo(lancet(0.8, 2.2), s.glass, 0, 16.4, 24.13);
  k.sub(0, 0, 24, 0).lancets(s.glass, 8, 6.2, 5, 0.7, 2);
  k.solid(0, 0, 25.7, 5.4, 4.4, 3.4, s.grey);
  k.roof(0, 4.4, 25.6, 3.4, 5.8, 2.6, s.slate, true);
  k.pediment(0, 4.4, 27.3, 5.7, 2.9, 0.4, s.dress);
  k.geo(lancet(2.9, 4.0, 2.0), s.dress, 0, 0, 27.42).geo(lancet(2.2, 3.6, 1.6), s.door, 0, 0, 27.45);
  k.box(0, 0, 28.3, 6.6, 0.3, 1.8, s.dress);
  for (const side of [-1, 1]) {
    k.cyl(side * 5.2, 0, 23.7, 0.85, 0.85, 19, s.grey, 8);
    k.geo(cone(1.0, 3.4, 8), s.dress, side * 5.2, 19, 23.7);
  }

  // Bell tower at the north-west corner (left of the west front), nearly free-standing, with the spire.
  const tx = -14.6;
  const tz = 17;
  k.solid(tx, 0, tz, 8.4, 31, 8.4, s.grey);
  k.box(-9.95, 0, tz, 1.2, 5, 4, s.grey);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box(tx + sx * 4.05, 0, tz + sz * 4.05, 1.5, 23, 1.5, s.grey);
      k.geo(pyramid(1.5, 1.5, 1.7), s.dress, tx + sx * 4.05, 23, tz + sz * 4.05);
      k.dbox(tx + sx * 4.1, 31.55, tz + sz * 4.1, 1.0, 2.3, 1.0, s.dress);
      k.geo(pyramid(1.0, 1.0, 3.0), s.dress, tx + sx * 4.1, 33.85, tz + sz * 4.1);
    }
  }
  for (const y of [9.5, 19, 24.6]) k.box(tx, y, tz, 8.75, 0.4, 8.75, s.dress);
  k.box(tx, 31, tz, 9.3, 0.55, 9.3, s.dress);
  k.faces(tx, tz, 8.4, 8.4).forEach(({ k: face }, i) => {
    face.lancets(s.lead, 4.6, 25.3, 2, 1.25, 4.9);
    face.lancets(s.glass, 1, 12, 1, 1.1, 4, 0.03, 0, s.dress).lancets(s.glass, 1, 20.3, 1, 0.8, 2.6);
    if (i === 0) face.geo(lancet(2.5, 3.9, 1.8), s.dress, 0, 0, 0.04).geo(lancet(1.9, 3.4, 1.5), s.door, 0, 0, 0.07);
    face.dbox(0, 31.55, 0.3, 7.2, 1.1, 0.25, s.dress);
  });
  // Spire: stone below, copper-sheathed above, with gablets at its foot.
  const spireH = 31;
  const stoneH = 12.6;
  const rTop = 4.0 * (1 - stoneH / spireH);
  k.cyl(tx, 31.55, tz, rTop, 4.0, stoneH, s.grey, 8);
  k.geo(cone(rTop, spireH - stoneH, 8), copper, tx, 31.55 + stoneH, tz);
  k.geo(ring(rTop + 0.12, 0.16, 8, true), s.dress, tx, 31.55 + stoneH, tz);
  k.faces(tx, tz, 7.3, 7.3, 31.55).forEach(({ k: face }) => {
    face.dbox(0, 0, 0, 1.3, 2.7, 1.0, s.grey);
    face.geo(pyramid(1.5, 1.2, 1.7), s.dress, 0, 2.7, 0).geo(lancet(0.6, 1.8), s.lead, 0, 0.5, 0.52);
  });
  k.dbox(tx, 62.4, tz, 0.16, 2.1, 0.16, s.lead).dbox(tx, 63.55, tz, 0.95, 0.16, 0.16, s.lead);

  k.light(0, 4.5, 31, 0xffd9a0, 1.3, 24);
  k.flush();
};

/** Invented food caravans for the Square: name, body colour, trim colour. */
const CARAVANS: readonly (readonly [string, number, number])[] = [
  ['HOT DOGS & CHIPS', 0xf1e9d2, 0xb5261e],
  ['COFFEE & PIES', 0xe9eef0, 0x2b4a6b],
  ['WAFFLES', 0xf0d98a, 0x2f5d3a],
];

/**
 * Cathedral Square as it was in 1995, the busy middle of town: banded stone paving; plane trees and cast-iron
 * lamp standards down both sides of the Colombo Street axis and round the cathedral; the Citizens' War Memorial
 * beside the north wall; the founder's statue facing the west door; the police kiosk and a taxi rank in the
 * south-west corner; the giant chess set; food caravans and picnic tables in the lee of the south aisle;
 * city buses laid up at their stops outside the loop; a speaker's ladder under the tower; and pigeons.
 *
 * Local frame: +z is west (the cathedral's front), +x is south. The paved walks (the Colombo axis at z = 48, the
 * Worcester arm at x = 0, the loop at x = ±54 and z = −64) are where people walk and the tram runs, so everything
 * stands off them by its own half-width; each spot is also tested against the map, so the furniture follows
 * wherever the walks and rails are actually drawn.
 */
export const cathedralSquare: LandmarkBuilder = function* (p, out) {
  const k = Kit.at(p, out);
  const m = k.m;
  const world = out.world;
  squarePaving(k, false);
  if (DRESSING_OFF) {
    k.flush();
    return;
  }

  const e = k.f.elements;
  const wx = (lx: number, lz: number) => e[0] * lx + e[8] * lz + e[12];
  const wz = (lx: number, lz: number) => e[2] * lx + e[10] * lz + e[14];
  const rails: { x: number; z: number }[] = [];
  for (const line of world.railways) for (const q of line.points) if (Math.hypot(q.x - p.x, q.z - p.z) < p.clearRadius + 20) rails.push(q);
  const cathedrals = world.landmarks.filter((l) => l.kind === 'chch-cathedral' && Math.hypot(l.x - p.x, l.z - p.z) < p.clearRadius + l.clearRadius);
  const others = world.landmarks.filter((l) => l !== p && l.kind !== 'chch-cathedral' && Math.hypot(l.x - p.x, l.z - p.z) < p.clearRadius + l.clearRadius + 4);
  const places = world.places.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < p.clearRadius + 20);
  /** True when something of radius `r` may stand at a local point: off the cathedral, every walk, the tram and the markers. */
  const ok = (lx: number, lz: number, r: number): boolean => {
    if (Math.hypot(lx, lz) + Math.min(r, 3) > p.clearRadius + 4) return false;
    const x = wx(lx, lz);
    const z = wz(lx, lz);
    for (const c of cathedrals) {
      // The cathedral's footprint in its own frame (+z its west front): nave, aisles, transepts, tower and porch.
      const dx = x - c.x;
      const dz = z - c.z;
      const cx = dx * Math.cos(c.heading) - dz * Math.sin(c.heading);
      const cz = dx * Math.sin(c.heading) + dz * Math.cos(c.heading);
      if (cx > -20.5 - r && cx < 17.5 + r && cz > -35.5 - r && cz < 30.6 + r) return false;
    }
    const hit = world.graph.nearest(x, z, 30);
    if (hit && hit.distance < hit.edge.width / 2 + r) return false;
    for (const q of rails) if (Math.hypot(q.x - x, q.z - z) < r + 3.3) return false;
    for (const l of others) if (Math.hypot(l.x - x, l.z - z) < l.clearRadius + r) return false;
    for (const q of places) if (Math.hypot(q.x - x, q.z - z) < r + 4) return false;
    return true;
  };
  const put = (kind: string, lx: number, lz: number, yaw = 0, r = 0.5, scale = 1, tint?: number): boolean => {
    if (!ok(lx, lz, r)) return false;
    k.prop(kind, lx, lz, yaw, scale, tint);
    return true;
  };
  const NORTH = -Math.PI / 2;
  const SOUTH = Math.PI / 2;
  const EAST = Math.PI;
  const lit = (lx: number, ly: number, lz: number, color = 0xffe2b0, intensity = 140, range = 20) => out.light(wx(lx, lz), e[13] + ly, wz(lx, lz), color, intensity, range);
  const pigeons = (cx: number, cz: number, n: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      const a = i * 2.4;
      const r = spread * (0.35 + ((i * 7) % 10) / 15);
      put('chch-pigeon', cx + Math.sin(a) * r, cz + Math.cos(a) * r, i * 1.7, 0.2);
    }
  };

  yield;
  // ── The Colombo Street axis: lamp standards, seats and planters down both edges ──
  for (let x = -68; x <= 68; x += 17) {
    if (x !== 0) put('chch-lamp-standard', x, 38.7, 0, 0.3);
    if (Math.abs(x) < 55) put('chch-lamp-standard', x, 57.5, 0, 0.3);
  }
  for (const x of [-25.5, -8.5, 8.5, 25.5]) put('chch-bench', x, 38.3, 0, 0.9);
  for (const x of [-42, -25.5, 25.5, 42]) put('chch-bench', x, 57.9, EAST, 0.9);
  for (const [x, z] of [[-12.5, 37.6], [12.5, 37.6], [-9.6, 61], [9.6, 73], [-9.6, 76], [42, 38.2], [-42, 38.2]]) put('chch-planter', x, z, x, 1);

  // Bedding displays in stone-edged beds: `n` drifts side by side along local x (or along z when `turned`).
  const soil = m.get('plain', { color: 0x3f3226 });
  const edging = m.get('bluestone');
  const bed = (lx: number, lz: number, n: number, turned = false) => {
    const len = n * 2.2 + 0.5;
    if (ROUND3_OFF || !ok(lx, lz, 1.2) || !ok(lx + (turned ? 0 : len / 2 - 1), lz + (turned ? len / 2 - 1 : 0), 1.2) || !ok(lx - (turned ? 0 : len / 2 - 1), lz - (turned ? len / 2 - 1 : 0), 1.2)) return;
    const c = k.sub(lx, 0, lz, turned ? Math.PI / 2 : 0);
    c.dbox(0, 0, 0, len + 0.36, 0.24, 2.16, edging).dbox(0, 0.2, 0, len, 0.08, 1.8, soil);
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 2.2;
      k.prop('flower-bed', turned ? lx : lx + o, turned ? lz + o : lz, turned ? Math.PI / 2 : 0, 1, undefined, 0.26);
    }
  };
  for (const x of [-59.5, -46.5, 46.5, 59.5]) bed(x, 38.6, 2);
  for (const x of [-34, 34]) bed(x, 61.5, 3);
  for (const z of [-9, 17]) bed(-33.5, z, 2, true);
  for (const z of [-27, -12]) bed(41.5, z, 2, true);

  // ── West front: lamps either side of the door, bike stands, the speaker's ladder under the tower ──
  put('chch-lamp-standard', -5.4, 32.6, 0, 0.3);
  put('chch-lamp-standard', 5.4, 32.6, 0, 0.3);
  put('bike-stand', 21, 33.5, SOUTH, 1.4);
  put('bike-stand', 21, 37.2, SOUTH, 1.4);
  put('bin', 15, 38.4, 0, 0.4);
  put('bin', -19, 38.4, 0, 0.4);
  if (ok(-14.5, 33, 1.2)) {
    const c = k.sub(-14.5, 0, 33, 0.5);
    const timber = m.get('timber', { color: 0x9a7a4e });
    for (const side of [-1, 1]) {
      c.beam([side * 0.28, 0, 0.5], [side * 0.22, 2.1, 0], 0.06, timber).beam([side * 0.28, 0, -0.5], [side * 0.22, 2.1, 0], 0.06, timber);
    }
    for (let i = 1; i <= 5; i++) c.dbox(0, i * 0.34, 0.5 - i * 0.081, 0.5, 0.04, 0.12, timber);
    c.dbox(0, 2.1, 0, 0.6, 0.05, 0.28, timber);
    c.dbox(1.1, 0, 0.2, 0.6, 0.36, 0.42, m.get('timber', { color: 0x6b5236 }));
    c.sign('SPEAKERS CORNER', 1.1, 0.19, 0.415, 0.56, 0.22, 0, { bg: '#e9dfc4', fg: '#3a2a1c', style: 'paint' });
  }
  pigeons(2, 35, 9, 5);
  lit(0, 5, 35, 0xffe2b0, 150, 24);

  yield;
  // ── North side, inside the loop: the Citizens' War Memorial against the nave, trees, seats facing the tram ──
  if (ok(-33, 4, 4.2)) {
    const c = k.sub(-33, 0, 4, NORTH);
    const stone = m.get('limestone', { color: 0xd9d4c6 });
    const metal = bronze(m);
    c.box(0, 0, 0, 8.4, 0.3, 7.6, m.get('bluestone')).box(0, 0.3, 0, 6.8, 0.3, 6, stone);
    c.solid(0, 0.6, -0.3, 4.6, 2.3, 3.2, stone).box(0, 2.9, -0.3, 5, 0.25, 3.6, stone);
    // The tall stone cross.
    c.solid(0, 3.15, -0.5, 2.1, 9.2, 1.5, stone).box(0, 8.1, -0.5, 5.4, 1.5, 1.3, stone).box(0, 12.35, -0.5, 1.6, 0.9, 1.1, stone);
    c.dbox(0, 5.2, 0.28, 0.5, 5.6, 0.1, metal).dbox(0, 8.6, 0.28, 2.6, 0.45, 0.1, metal);
    // Bronze figures along the front of the base and one with raised arms at the foot of the cross.
    for (const x of [-1.5, -0.5, 0.5, 1.5]) {
      c.dbox(x, 0.6, 1.75, 0.5, 1.25, 0.34, metal).geo(sphere(0.17, 8), metal, x, 2.02, 1.75);
      c.beam([x - 0.3, 1.7, 1.75], [x - 0.36, 1.0, 1.82], 0.13, metal).beam([x + 0.3, 1.7, 1.75], [x + 0.36, 1.0, 1.82], 0.13, metal);
    }
    c.dbox(0, 3.15, 0.75, 0.62, 1.5, 0.4, metal).geo(sphere(0.2, 8), metal, 0, 4.85, 0.75);
    c.beam([-0.36, 4.5, 0.75], [-1.0, 5.4, 0.75], 0.15, metal).beam([0.36, 4.5, 0.75], [1.0, 5.4, 0.75], 0.15, metal);
    c.sign('1914 – 1918', 0, 1.9, 1.31, 3, 0.46, 0, { bg: '#d9d4c6', fg: '#4a4438', style: 'block', border: false });
    lit(-39, 4, 4, 0xfff0d0, 130, 18);
  }
  for (const z of [-50, -35, -20, 24]) put('tree-plane', -36, z, z * 0.7, 2.6, 0.82 + ((z + 60) % 7) / 40);
  for (const z of [-42, -27, 15, 31]) put('chch-bench', -45.6, z, NORTH, 0.9);
  for (const z of [-34, -12, 23]) put('chch-lamp-standard', -47.4, z, 0, 0.3);

  // ── South side, inside the loop: food caravans and picnic tables in the lee of the aisle, trees, seats ──
  CARAVANS.forEach(([text, body, trimColor], i) => {
    const z = 29.5 - i * 8.4;
    if (!ok(26.5, z, 2.4)) return;
    const c = k.sub(26.5, 0, z, SOUTH);
    const paint = m.get('paintedMetal', { color: body });
    const trim = m.get('paintedMetal', { color: trimColor });
    const under = m.get('rubber');
    c.dbox(0, 0.28, 0, 4, 0.28, 1.9, under).dbox(-1.0, 0, 0.9, 0.62, 0.62, 0.2, under).dbox(-1.0, 0, -0.9, 0.62, 0.62, 0.2, under);
    c.beam([-2.1, 0.42, 0], [-3.3, 0.42, 0], 0.09, under).dbox(-3.3, 0, 0, 0.1, 0.44, 0.1, under);
    c.dbox(0, 0.56, 0, 4.2, 1.9, 2, paint).dbox(0, 2.46, 0, 4.34, 0.1, 2.14, trim).dbox(0, 0.56, 0, 4.22, 0.5, 2.02, trim);
    c.quad(0.2, 1.72, 1.012, 2.5, 0.84, m.get('glass', { color: 0x1c2228 }));
    c.dbox(0.2, 1.27, 1.15, 2.6, 0.05, 0.32, m.get('metal')).dbox(0.2, 2.24, 1.5, 2.7, 0.05, 1.0, trim);
    c.quad(-1.6, 1.3, 1.012, 0.7, 1.5, trim);
    c.sign(text, 0.2, 2.72, 1.02, 3.4, 0.42, 0, { bg: '#' + trimColor.toString(16).padStart(6, '0'), fg: '#f6efdc', style: i === 2 ? 'script' : 'block' });
    c.collide(0, 0, 0, 4.2, 2.6, 2);
  });
  lit(31, 3.2, 21, 0xffdfa0, 140, 18);
  for (const z of [27, 17, 7]) put('picnic-table', 33.5, z, z * 0.3 + 1.2, 1.3);
  put('bin', 31, 33.6, 0, 0.4);
  put('bin', 31, 2.4, 0, 0.4);
  pigeons(33, 12, 6, 4);
  for (const z of [-50, -35, -20, -5, 37]) put('tree-plane', 37, z, z * 0.9, 2.6, 0.82 + ((z + 60) % 9) / 50);
  for (const z of [-42, -27, -12, 31]) put('chch-bench', 45.6, z, SOUTH, 0.9);
  for (const z of [-34, -5, 23]) put('chch-lamp-standard', 47.4, z, 0, 0.3);

  // ── Behind the apse: a grove and seats ──
  for (const [x, z] of [[-27, -46], [-9, -49], [9, -49], [27, -46], [0, -42]]) put('tree-plane', x, z, x + z, 2.6, 0.78 + (Math.abs(x) % 5) / 25);
  for (const x of [-18, 18]) put('chch-bench', x, -55.5, EAST, 0.9);

  yield;
  // ── Outside the loop: buses laid up at their stops under a row of trees, north and south ──
  [[62.4, -22.5], [62.4, -10.5], [-62.4, -17]].forEach(([x, z], i) => {
    if (!ok(x, z - 5, 1.4) || !ok(x, z + 5, 1.4) || !put('bus-parked', x, z, i === 2 ? EAST : 0, 1.4)) return;
    k.collide(x, 0, z, 2.5, 3, 10.6);
  });
  for (const side of [-1, 1]) {
    // A bus-stop flag on a post, seats and a bin (painted signs and seats rather than shelters: the Square's
    // stops were open to the sky).
    if (ok(side * 64.8, 4, 0.3)) {
      k.beam([side * 64.8, 0, 4], [side * 64.8, 2.7, 4], 0.06, m.get('metal'));
      for (const yaw of [0, Math.PI]) k.sign('BUS STOP', side * 64.8, 2.42, 4 + (yaw ? -0.04 : 0.04), 0.9, 0.4, yaw, { bg: '#1f5a3a', fg: '#f6efdc', style: 'block' });
    }
    put('chch-bench', side * 66.4, 9, side === 1 ? NORTH : SOUTH, 0.9);
    put('chch-bench', side * 66.4, 14, side === 1 ? NORTH : SOUTH, 0.9);
    put('bin', side * 64.6, 7, 0, 0.4);
    for (const z of [-33, -19, 22, 33]) put('tree-plane', side * 69, z, z * side, 2.6, 0.8 + ((z + 40) % 6) / 30);
  }

  // ── North-west corner: the founder's statue facing the cathedral, and the giant chess set ──
  if (ok(-15.5, 66, 2.2)) {
    statue(k, -15.5, 66, EAST, 3);
    k.collide(-15.5, 0, 66, 2.3, 3.4, 2.3);
    lit(-15.5, 5.5, 63, 0xffe2b0, 130, 18);
    if (out.lod === 0) pigeons(-15.5, 66, 8, 4.6);
  }
  if (ok(-30.5, 65, 3.6)) {
    const c = k.sub(-30.5, 0, 65, 0);
    const cell = 0.62;
    c.dbox(0, 0, 0, cell * 8 + 0.3, 0.035, cell * 8 + 0.3, m.get('bluestone', { color: 0x4a4c50 }));
    const light = m.get('limestone', { color: 0xe6dfcc });
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2 === 0) c.dbox((i - 3.5) * cell, 0.03, (j - 3.5) * cell, cell, 0.012, cell, light);
    // A game in progress: rank 0 is the back row (scale by piece), a few men advanced or taken.
    const BACK = [1.2, 1.1, 1.15, 1.45, 1.55, 1.15, 1.1, 1.2];
    const men: [number, number, number, number][] = [];
    for (let i = 0; i < 8; i++) {
      if (i !== 1) men.push([i, 0, BACK[i], 0xf1ead6]);
      if (i !== 6) men.push([i, 7, BACK[i], 0x26272b]);
      if (i !== 3) men.push([i, i === 4 ? 3 : 1, 0.9, 0xf1ead6]);
      if (i !== 5) men.push([i, i === 3 ? 4 : i === 2 ? 5 : 6, 0.9, 0x26272b]);
    }
    men.push([2, 2, 1.1, 0xf1ead6], [5, 5, 1.1, 0x26272b]);
    for (const [i, j, scale, tint] of men) k.prop('chess-piece', -30.5 + (i - 3.5) * cell, 65 + (j - 3.5) * cell, 0, scale, tint);
    put('chch-bench', -30.5, 69.6, EAST, 0.9);
    put('chch-bench', -35.4, 65, SOUTH, 0.9);
  }
  put('tree-plane', -43, 60.5, 1, 2.6, 0.85);
  put('tree-plane', -22.5, 72.5, 2, 2.6, 0.8);

  yield;
  // ── South-west corner: police kiosk and the taxi rank ──
  if (ok(22, 66.5, 3.4)) {
    const c = k.sub(22, 0, 66.5, EAST);
    const wall = m.get('plaster', { color: 0xe9e2cf });
    c.solid(0, 0, 0, 4.4, 3, 3.4, wall);
    c.box(0, 0, 0, 4.5, 0.9, 3.5, m.get('brick'));
    c.roof(0, 3, 0, 5.4, 4.4, 1.3, m.get('corrugated', { color: 0x4d6a5c }), false, 1.7);
    c.quad(-0.7, 1.8, 1.72, 2.2, 1.3, m.windows('shop'));
    c.quad(1.45, 1.05, 1.72, 0.9, 2.05, m.get('paintedMetal', { color: 0x23395f }));
    c.quad(2.22, 1.8, 0, 1.6, 1.2, m.windows('house'), Math.PI / 2).quad(-2.22, 1.8, 0, 1.6, 1.2, m.windows('house'), -Math.PI / 2);
    c.sign('POLICE', 0, 2.72, 1.73, 2.6, 0.5, 0, { bg: '#1d3a6b', fg: '#ffffff', style: 'block' });
    c.sign('POLICE', 0, 2.72, -1.73, 2.6, 0.5, Math.PI, { bg: '#1d3a6b', fg: '#ffffff', style: 'block' });
    c.dbox(0, 4.3, 0, 0.3, 0.3, 0.3, m.emitter(0x3a6cff, 'night'));
  }
  put('chch-bench', 12.5, 59.4, EAST, 0.9);
  const TAXI = [0xe9e4d2, 0xd9c23a, 0xe9e4d2];
  let rank = false;
  TAXI.forEach((tint, i) => {
    rank = put('car-parked', 33.5 + i * 5.3, 60.4, SOUTH, 1.4, 1, tint) || rank;
  });
  if (rank && ok(30.2, 59.2, 0.3)) {
    const post = m.get('metal');
    k.beam([30.2, 0, 59.2], [30.2, 2.6, 59.2], 0.06, post);
    k.sign('TAXIS', 30.2, 2.35, 59.24, 0.9, 0.36, 0, { bg: '#f2c020', fg: '#1a1a1a', style: 'block' });
    k.sign('TAXIS', 30.2, 2.35, 59.16, 0.9, 0.36, Math.PI, { bg: '#f2c020', fg: '#1a1a1a', style: 'block' });
  }
  put('tree-plane', 40.5, 66.5, 3, 2.6, 0.8);
  k.flush();
};

const SQUARE_R = 78;

/**
 * The Square's banded stone paving. With `annex`, the same pattern carried on over the block south of the
 * Worcester arm instead (exactly the cells the Square itself leaves out, so the two never overlap).
 */
function squarePaving(k: Kit, annex: boolean): void {
  const m = k.m;
  const pale = m.get('footpath', { color: 0xcdc6b6 });
  const dark = m.get('footpath', { color: 0x8c8780 });
  const red = m.get('brick', { color: 0xcbb0a2 });
  const R = SQUARE_R;
  const near = tartan(-R, R, 18, 1.4, 9);
  const far = tartan(R, 126, 18, 1.4, 9);
  const along = annex ? { at: [...near.at, ...far.at.slice(1)], isBand: [...near.isBand, ...far.isBand] } : near;
  k.pave(near.at, along.at, (i, j, cx, cz) => {
    // The Square keeps whole cells only, so its stepped edge stays inside the clear radius (+10 %).
    const reach = (v: number[], n: number) => Math.max(Math.abs(v[n]), Math.abs(v[n + 1]));
    const inside = Math.hypot(reach(near.at, i), reach(along.at, j)) <= R + 2.5;
    if (annex ? inside || cx < 8 || cz < 56 : !inside) return null;
    if (near.isBand[i] && along.isBand[j]) return red;
    return near.isBand[i] || along.isBand[j] ? dark : pale;
  });
}

/**
 * The block south-west of the Square, between the Worcester arm and the backs of Hereford Street: no building
 * plot can stand there (the Square's and the tram stop's clear radii between them cover every frontage), so it is
 * dressed as what such blocks were in 1995: a public car park and a grove of plane trees on a lawn. This lies
 * outside the Square's clear radius, so it is built by the set-piece scatterer, not the landmark; `allow` is its
 * test for a free spot (world coordinates, radius).
 */
export function cathedralSquareAnnex(p: LandmarkPlacement, out: ChunkBuilder, allow: (x: number, z: number, r: number) => boolean): void {
  const k = Kit.at(p, out);
  const m = k.m;
  const e = k.f.elements;
  const wx = (lx: number, lz: number) => e[0] * lx + e[8] * lz + e[12];
  const wz = (lx: number, lz: number) => e[2] * lx + e[10] * lz + e[14];
  const put = (kind: string, lx: number, lz: number, yaw = 0, r = 0.5, scale = 1, tint?: number): boolean => {
    if (!allow(wx(lx, lz), wz(lx, lz), r)) return false;
    k.prop(kind, lx, lz, yaw, scale, tint);
    return true;
  };
  const SOUTH = Math.PI / 2;
  const EAST = Math.PI;
  squarePaving(k, true);

  const x0 = 53;
  const rows = [67.5, 79.5, 84.5, 96.5];
  const lines = tartan(x0, x0 + 26, 2.6, 0.12, x0, 30);
  const seal = asphalt(m);
  const paint = whiteLine(m);
  k.pave(lines.at, [65, 70, 77, 87, 94, 99], (i, _j, _x, z) => (lines.isBand[i] && rows.some((r) => Math.abs(z - r) < 2.5) ? paint : seal), 0.06);
  const PAINT = [0xb5261e, 0xe8e6df, 0x1f3f7a, 0x2d5f3b, 0xc9b27a, 0x7a1f2a, 0x8f959a, 0xd9c23a, 0x2a2a2e, 0x5f8fb5, 0xe0d6c0];
  rows.forEach((z, r) => {
    for (let i = 0; i < 10; i++) {
      const h = (i * 37 + r * 101 + 13) % 17;
      if (h < 6) continue;
      put('car-parked', x0 + 1.3 + i * 2.6, z + ((h % 3) - 1) * 0.15, (r % 2 ? Math.PI : 0) + ((h % 5) - 2) * 0.02, 1.2, 1, PAINT[(i * 5 + r * 3) % PAINT.length]);
    }
  });
  // The lead's street lamp and the plain bench are kinds this chunk already draws.
  put('lamp', x0 + 13, 73.5, SOUTH, 0.3);
  put('lamp', x0 + 13, 90.5, SOUTH + Math.PI, 0.3);
  out.light(wx(x0 + 13, 82), e[13] + 5, wz(x0 + 13, 82), 0xffe2b0, 120, 22);

  k.pave(steps(23, 47, 8), steps(74, 124, 10), () => lawn(m), 0.05);
  for (const x of [28, 38]) for (const z of [79, 90, 101, 112, 121]) put('tree-plane', x + (z % 2) * 4, z, x * z, 2.4, 0.84 + ((x + z) % 7) / 40);
  for (const z of [84, 106]) put('bench', 49.2, z, SOUTH, 0.9);
  for (const x of [30, 40]) put('bench', x, 72.6, EAST, 0.9);
  put('picnic-table', 31.5, 95.5, 0.4, 1.3);
  put('picnic-table', 38.5, 117, 1.9, 1.3);

  // A row of planes along the south edge, where Colombo Street comes in.
  for (const z of [-30, -10, 10, 30]) put('tree-plane', 81.5, z, z + 5, 2.4, 0.86 + ((z + 40) % 9) / 60);
  for (const z of [-20, 0, 20]) put('bench', 80.6, z, -Math.PI / 2, 0.9);
  k.flush();
}
