import type * as THREE from 'three';
import { TAU } from '../../../core/math';
import type { LandmarkBuilder } from '../../../core/types';
import { bench, gableRoof, Geo, Site, sub, type V3, walls, windowRow } from '../rural/kit';

/**
 * Hull skin from stations along the length (local x, bow at +x): [x, half beam, deck height].
 * `rail` gets the bulwark (seen from both sides); the sides tuck in towards the keel.
 */
function hull(side: Geo, deck: Geo, rail: Geo, stations: readonly (readonly [number, number, number])[], keel: number, bulwark: number, tuck = 0.55): void {
  for (let i = 0; i < stations.length - 1; i++) {
    const [x0, b0, d0] = stations[i];
    const [x1, b1, d1] = stations[i + 1];
    for (const sgn of [1, -1]) {
      const skin: V3[] = [[x0, keel, sgn * b0 * tuck], [x1, keel, sgn * b1 * tuck], [x1, d1, sgn * b1], [x0, d0, sgn * b0]];
      side.poly(sgn === 1 ? skin : skin.reverse());
      const top: V3[] = [[x0, d0, sgn * b0], [x1, d1, sgn * b1], [x1, d1 + bulwark, sgn * b1], [x0, d0 + bulwark, sgn * b0]];
      rail.poly(sgn === 1 ? top : top.reverse(), true);
    }
    if (b1 < 1e-6) deck.poly([[x0, d0, b0], [x1, d1, 0], [x0, d0, -b0]]);
    else deck.poly([[x0, d0, b0], [x1, d1, b1], [x1, d1, -b1], [x0, d0, -b0]]);
  }
  const [xs, bs, ds] = stations[0];
  side.poly([[xs, keel, -bs * tuck], [xs, keel, bs * tuck], [xs, ds + bulwark, bs], [xs, ds + bulwark, -bs]]);
}

const TRAWLERS = [
  { name: 'MOLLYMAWK', hull: 0x2f5d8a, house: 0xf2efe6 },
  { name: 'SOUTHERN LASS', hull: 0x2f6a4a, house: 0xf2efe6 },
  { name: 'SHEARWATER', hull: 0xa5332a, house: 0xe9e0c8 },
];

/** Inshore trawler, 18 m: forward wheelhouse, mast, stern gantry and net drum. Frame at the waterline, bow along +x. */
function trawler(s: Site, f: THREE.Matrix4, variant: number): void {
  const t = TRAWLERS[variant % TRAWLERS.length];
  const b = s.batch(f);
  const paint = b.g(s.mat('paintedMetal', t.hull));
  const white = b.g(s.mat('paintedMetal', t.house));
  const steel = b.g(s.mat('paintedMetal', 0x4a4f54));
  hull(paint, b.g(s.mat('timber', 0x8a7a62)), paint, [[-9, 2.0, 1.1], [-6, 2.6, 1.0], [0, 2.7, 1.1], [4.5, 2.3, 1.5], [7.4, 1.2, 2.0], [9, 0, 2.3]], -1.4, 0.55);
  // Wheelhouse with a band of windows, mast and radar.
  white.box(2.6, 2.45, 0, 3.6, 2.4, 3.2);
  white.box(2.6, 3.72, 0, 4.1, 0.14, 3.7);
  const glass = b.g(s.mat('glass'));
  glass.box(4.42, 2.9, 0, 0.04, 0.8, 2.8).box(2.6, 2.9, 1.62, 3, 0.8, 0.04).box(2.6, 2.9, -1.62, 3, 0.8, 0.04);
  steel.tube([1.6, 3.7, 0], [1.6, 8.2, 0], 0.09, 0.06, 6);
  steel.beam([1.6, 6.6, -1.3], [1.6, 6.6, 1.3], 0.07);
  white.box(2.2, 4.25, 0, 0.3, 0.2, 1.3);
  // Working deck aft: gantry, net drum, trawl doors and fish bins.
  for (const side of [-1, 1]) steel.beam([-7.6, 1.2, side * 1.9], [-8.2, 5.2, side * 0.9], 0.16);
  steel.beam([-8.2, 5.2, -0.9], [-8.2, 5.2, 0.9], 0.16);
  steel.tube([-5.6, 1.9, -1.4], [-5.6, 1.9, 1.4], 0.62, 0.62, 8);
  for (const side of [-1, 1]) steel.box(-8.3, 2.1, side * 1.6, 0.12, 1.5, 0.9);
  const bins = b.g(s.mat('plain', variant % 2 ? 0xd9722a : 0x3a7fb0, { roughness: 0.6 }));
  for (const [x, z] of [[-2.2, 1.2], [-2.2, -1.1], [-3.4, 0.1]] as const) bins.box(x, 1.5, z, 1, 0.7, 1.1);
  const floats = b.g(s.mat('plain', 0xe8742a, { roughness: 0.5 }));
  for (let i = 0; i < 4; i++) floats.lathe(-6.9 + i * 0.5, 2.75, 0.4 - (i % 2) * 0.8, [[0, -0.22], [0.22, 0], [0, 0.22]], 6);
  b.flush();
  for (const side of [-1, 1]) s.sign(f, t.name, 6.6, 1.55, side * 1.72, 2, 5, { bg: '#f2efe6', fg: '#1c2a3a', style: 'block', border: false }, side === 1 ? 0.42 : Math.PI - 0.42);
}

/** Coastal freighter, 64 m: two holds worked by derricks, accommodation and funnel aft. Bow along +x. */
function freighter(s: Site, f: THREE.Matrix4): void {
  const b = s.batch(f);
  const black = b.g(s.mat('paintedMetal', 0x23272c));
  const deck = b.g(s.mat('paintedMetal', 0x7a3a2c));
  const white = b.g(s.mat('paintedMetal', 0xf0ede4));
  const buff = b.g(s.mat('paintedMetal', 0xc9a560));
  const grey = b.g(s.mat('paintedMetal', 0x6f7a72));
  hull(black, deck, black, [[-32, 4.4, 4.4], [-28, 5.3, 4.2], [-10, 5.5, 4.0], [16, 5.5, 4.0], [26, 3.7, 4.6], [32, 0, 5.4]], -3.2, 1.0, 0.7);
  // Forecastle and two hatches.
  white.box(27.2, 5.5, 0, 6, 1.4, 5.2);
  for (const x of [-3.5, 13.5]) {
    grey.box(x, 4.7, 0, 12, 1.3, 7.2);
    derrick(buff, x + 7.6);
  }
  // Accommodation block aft, bridge, funnel and lifeboats.
  white.box(-21, 5.5, 0, 13, 3, 9.6).box(-21.5, 8.3, 0, 10, 2.6, 8.4).box(-19.5, 10.7, 0, 5.5, 2.4, 9.8);
  white.box(-19.5, 12, 0, 6.2, 0.2, 10.6);
  const glass = b.g(s.mat('glass'));
  glass.box(-16.72, 10.9, 0, 0.04, 0.9, 8.6);
  for (const side of [-1, 1]) {
    glass.box(-21.5, 8.5, side * 4.22, 8, 0.7, 0.04).box(-21, 5.8, side * 4.82, 10, 0.7, 0.04);
    b.g(s.mat('plain', 0xe8742a, { roughness: 0.6 })).box(-24.5, 8.2, side * 4.9, 4.4, 1.1, 1.5);
  }
  buff.tube([-24.8, 9.6, 0], [-25.6, 15, 0], 1.6, 1.5, 12);
  b.g(s.mat('paintedMetal', 0x2f5d8a)).tube([-25.25, 12.6, 0], [-25.45, 14, 0], 1.62, 1.6, 12, false);
  buff.tube([-18.5, 12, 0], [-18.5, 17.5, 0], 0.12, 0.08, 6);
  b.flush();
  for (const side of [-1, 1]) s.sign(f, 'CANTERBURY TRADER', 25.5, 4.2, side * 3.95, 5, 6, { bg: '#23272c', fg: '#f0ede4', style: 'block', border: false }, side === 1 ? 0.36 : Math.PI - 0.36);
}

/** Mast house with a kingpost and two cargo booms. */
function derrick(g: Geo, x: number): void {
  g.box(x, 5.2, 0, 2.2, 2.4, 3.4);
  g.tube([x, 6.4, 0], [x, 16, 0], 0.32, 0.2, 8);
  g.beam([x, 13.5, -3], [x, 13.5, 3], 0.2);
  for (const dir of [-1, 1]) g.beam([x + dir * 0.4, 6.8, dir * 0.6], [x + dir * 7.5, 11.5, dir * 2.2], 0.24);
}

/** Level-luffing wharf crane on a portal, about 30 m to the jib head. */
function crane(s: Site, f: THREE.Matrix4, color: number, slew: number): void {
  const b = s.batch(f);
  const paint = b.g(s.mat('paintedMetal', color));
  const dark = b.g(s.mat('paintedMetal', 0x3a3f44));
  for (const sx of [-3.2, 3.2]) for (const sz of [-3.2, 3.2]) paint.post(sx, -0.5, sz, 0.7, 8);
  paint.box(0, 7.9, 0, 7.6, 0.9, 7.6);
  dark.lathe(0, 8.35, 0, [[2.4, 0], [2.4, 0.5], [0, 0.5]], 12);
  paint.at(0, 8.85, 0, slew, () => {
    paint.box(0, 1.8, -1.2, 4, 3.6, 5.6);
    paint.box(0, 3.75, -1.2, 4.3, 0.2, 6);
    dark.box(0, 1.2, -4.6, 3.4, 2.2, 1.4);
    // A-frame, jib and tie.
    for (const sx of [-1.3, 1.3]) {
      paint.beam([sx, 3.6, -2.6], [0, 13.5, -1], 0.3);
      paint.beam([sx, 3.6, 1.2], [0, 13.5, -1], 0.3);
      paint.beam([sx, 2.4, 1.6], [0, 19.5, 21], 0.4, 0.55);
    }
    for (const t of [0.25, 0.5, 0.75]) paint.beam([-1.3 * (1 - t), 2.4 + 17.1 * t, 1.6 + 19.4 * t], [1.3 * (1 - t), 2.4 + 17.1 * t, 1.6 + 19.4 * t], 0.2);
    dark.beam([0, 13.5, -1], [0, 19.5, 21], 0.1);
    dark.beam([0, 19.5, 21], [0, 9, 21], 0.06);
    dark.box(0, 8.6, 21, 0.5, 0.8, 0.5);
  });
  b.g(s.mat('glass')).at(0, 8.85, 0, slew, () => b.g(s.mat('glass')).box(0, 2.4, 1.62, 3, 1.3, 0.04));
  b.flush();
  s.out.collider(f, 0, 4, 0, 7.4, 8, 7.4);
}

const BOX_COLORS = [0x8a2f2a, 0x2f5d8a, 0x3a6a4a, 0xb9a23a, 0x9a5a2a, 0x7a7f84, 0xd8d2c2, 0x355f6a];

/**
 * Port of Timaru: two rows of concrete grain silos with a headhouse and shiploader gallery, three wharf
 * sheds, two wharf cranes, a coastal freighter and fishing trawlers alongside, log stacks, containers,
 * bulk tanks and a gatehouse. The wharf line slides forward if the water's edge is closer than expected;
 * with no water in reach the trawlers sit on a hardstand instead.
 */
export const port: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const rng = s.rng;
  const concrete = s.mat('concrete');
  const b = s.batch();

  // Find the water's edge behind the site.
  let zW = -62;
  let foundWater = false;
  const wet = (lx: number, lz: number) => out.world.waterDepthAt(s.wx(lx, lz), s.wz(lx, lz)) > 0.4;
  scan: for (let z = -30; z >= -118; z -= 8) {
    for (const x of [-50, 0, 50]) {
      if (wet(x, z)) {
        zW = Math.min(-40, Math.max(-62, z + 6));
        foundWater = true;
        break scan;
      }
    }
  }

  // ── Wharf ──
  out.box(f, 0, -1.9, zW + 7, 210, 4, 14, concrete);
  out.collider(f, 0, -1.9, zW + 7, 210, 4, 14);
  out.box(f, 0, 0.2, zW + 0.4, 210, 0.3, 0.5, s.mat('timber', 0x4f4338));
  const bollards = b.g(s.mat('paintedMetal', 0x2a2c2e));
  for (let x = -96; x <= 96; x += 16) bollards.lathe(x, 0.1, zW + 1.6, [[0.28, 0], [0.22, 0.5], [0.36, 0.55], [0.36, 0.7], [0, 0.72]], 8);

  // ── Grain silos, gallery, headhouse and shiploader ──
  for (let i = 0; i < 6; i++) {
    for (const z of [-14, -1.6]) out.cylinder(f, -52 + i * 12.4, 15, z, 6, 6, 34, concrete, 16);
  }
  out.collider(f, -21, 16, -7.8, 74, 32, 24.5);
  out.box(f, -21, 33.8, -7.8, 76, 3.6, 5.4, s.mat('corrugated', 0xc9c6bc));
  walls(out, f, 21, -7.8, 9, 45, 11.5, concrete);
  out.box(f, 21, 45.6, -7.8, 10, 1.2, 12.5, s.mat('corrugated', 0x8f959a));
  out.collider(f, 21, 22.5, -7.8, 9, 45, 11.5);
  windowRow(out, f, 16.5, 25.5, 2, 40, -2.02, 2.4, 1.6, s.mat('glass'));
  windowRow(out, f, 16.5, 25.5, 2, 30, -2.02, 2.4, 1.6, s.mat('glass'));
  s.sign(f, 'PORT GRAIN SILOS', -21, 26, 4.45, 30, 8, { bg: '#b7b3a8', fg: '#3a3a3a', style: 'block', border: false });
  const gallery = b.g(s.mat('corrugated', 0xc9c6bc));
  gallery.beam([21, 33, -13.5], [21, 13.5, zW + 9], 2.4, 2.6);
  const steel = b.g(s.mat('paintedMetal', 0x5a6068));
  for (const t of [0.45, 0.85]) {
    const z = -13.5 + (zW + 9 + 13.5) * t;
    const y = 33 - 19.5 * t;
    for (const sx of [-1.6, 1.6]) steel.beam([21 + sx * 2, -0.3, z], [21 + sx * 0.6, y - 1.2, z], 0.3);
  }
  steel.box(21, 13, zW + 6.5, 3.4, 3, 5).beam([21, 13, zW + 4], [21, 9.5, zW - 4], 0.9);

  // ── Wharf sheds ──
  const sheds: [number, number, number, string][] = [
    [52, 44, 0xb9b4a8, 'CAROLINE COOL STORES'],
    [92, 22, 0x6f8a9a, 'BAY FISHERIES CO-OP'],
    [-84, 40, 0xc8c2a8, 'SHED 3 · GENERAL CARGO'],
  ];
  const ends = b.g(s.mat('corrugated', 0xa9a59a));
  for (const [x, len, color, name] of sheds) {
    const z = zW + 23.5;
    const skin = s.mat('corrugated', color, { metalness: 0.3 });
    walls(out, f, x, z, len, 6.5, 13, skin);
    gableRoof(out, ends, f, x, 6.5, z, len, 13, 2.3, s.mat('corrugated', 0x8f959a, { metalness: 0.3 }), 0.3);
    out.collider(f, x, 3.25, z, len, 6.5, 13);
    for (const dx of len > 30 ? [-len / 4, len / 4] : [0]) {
      for (const side of [-1, 1]) out.box(f, x + dx, 2.3, z + side * 6.53, 5, 4.6, 0.1, s.mat('paintedMetal', 0x55606a));
    }
    s.sign(f, name, x, 5.4, z + 6.56, Math.min(16, len * 0.6), 8, { bg: '#e9e4d6', fg: '#22313a', style: 'block' });
  }

  // ── Cranes ──
  crane(s, sub(f, -24, 0.12, zW + 7), 0xd9a520, 2.6 + rng.range(-0.3, 0.3));
  crane(s, sub(f, 38, 0.12, zW + 7), 0x7f97a8, 3.4 + rng.range(-0.3, 0.3));

  // ── Ships: afloat where there is water, otherwise hauled out on the hardstand ──
  const afloat = (lx: number, half: number): number | null => {
    for (let z = zW - half - 0.9; z > zW - half - 34; z -= 6) {
      if (Math.hypot(Math.abs(lx) + 12, z - half) < 128 && wet(lx, z) && wet(lx - 8, z) && wet(lx + 8, z)) return z;
    }
    return null;
  };
  const sea = out.world.seaLevel;
  const zShip = foundWater ? afloat(-12, 5.5) : null;
  if (zShip !== null) freighter(s, out.frameAt(s.wx(-12, zShip), sea, s.wz(-12, zShip), p.heading));
  [58, 79, 100].forEach((x, i) => {
    const z = foundWater ? afloat(x, 2.7) : null;
    if (z !== null) trawler(s, out.frameAt(s.wx(x, z), sea, s.wz(x, z), p.heading + (i === 1 ? Math.PI : 0)), i);
    else if (i < 2) {
      // Hardstand: on a cradle, keel clear of the ground.
      const hx = 52 + i * 24;
      const fh = s.at(hx, 70, 0.2 - i * 0.5, 1.75);
      trawler(s, fh, i);
      const cradle = s.batch(fh);
      for (const cx of [-5, 0, 5]) cradle.g(s.mat('timber', 0x5a4a38)).box(cx, -1.2, 0, 0.4, 1.1, 4.4);
      cradle.flush();
      out.collider(fh, 0, 0, 0, 18, 3.5, 5);
    }
  });

  // ── Log stacks ──
  const logs = b.g(s.mat('bark'));
  for (const [x, z] of [[-84, 24], [-84, 36], [-84, 48], [-64, 30], [-64, 44]] as const) {
    const y = s.gy(x, z);
    for (let layer = 0; layer < 4; layer++) {
      for (let k = 0; k < 5 - layer; k++) {
        const r = 0.36 + rng.range(-0.04, 0.05);
        const lz = z + (k - (4 - layer) / 2) * 0.78;
        const off = rng.range(-0.4, 0.4);
        logs.tube([x - 5.5 + off, y + 0.38 + layer * 0.66, lz], [x + 5.5 + off, y + 0.38 + layer * 0.66, lz], r, r * 0.9, 6);
      }
    }
    out.collider(f, x, y + 1.3, z, 11.4, 2.6, 4.2);
  }

  // ── Containers ──
  for (const z of [18, 30, 42]) {
    for (const x of [48, 62, 76, 90]) {
      const y = s.gy(x, z);
      const long = rng.chance(0.45);
      const high = rng.int(1, 3);
      for (let k = 0; k < high; k++) {
        const len = long ? 12.2 : 6.1;
        out.box(f, x + (long ? 0 : rng.pick([-3.05, 3.05])), y + 1.3 + k * 2.6, z, len, 2.59, 2.44, s.mat('corrugated', rng.pick(BOX_COLORS), { metalness: 0.4 }));
      }
      out.collider(f, x, y + high * 1.3, z, 12.2, high * 2.6, 2.44);
    }
  }

  // ── Bulk tanks ──
  for (const x of [-92, -76]) {
    out.cylinder(f, x, 4, 6, 7, 7, 10, s.mat('paintedMetal', 0xe9e6dc), 18);
    b.g(s.mat('paintedMetal', 0xe9e6dc)).lathe(x, 9, 6, [[7, 0], [0, 1.1]], 18);
    out.collider(f, x, 4.5, 6, 12, 9, 12);
  }

  // ── Light masts, fish bins on the wharf ──
  const lamp = b.g(m.emitter(0xfff0c8, 'night'));
  for (const [x, z] of [[4, zW + 16], [70, 8]] as const) {
    const y = s.gy(x, z);
    steel.tube([x, y - 0.5, z], [x, y + 22, z], 0.3, 0.16, 8);
    steel.box(x, y + 22.2, z, 3.4, 0.3, 1.2);
    lamp.box(x, y + 21.95, z, 3, 0.2, 0.9);
    s.light(x, y + 20, z, 0xfff0c8, 2.2, 60);
  }
  const bins = b.g(s.mat('plain', 0x3a7fb0, { roughness: 0.6 }));
  for (let i = 0; i < 6; i++) bins.box(64 + (i % 3) * 1.3, 0.5 + Math.floor(i / 3) * 0.75, zW + 9, 1.2, 0.72, 1);

  // ── Gatehouse, boom and front fence ──
  {
    const fg = s.at(6, 96);
    walls(out, fg, 0, 0, 3.4, 2.7, 3, s.mat('weatherboard', 0xe9e0c8));
    out.box(fg, 0, 2.85, 0, 4.2, 0.2, 3.8, s.mat('corrugated', 0x8f959a));
    out.quad(fg, 0, 1.7, 1.52, 2.2, 1, m.windows('shop'));
    out.collider(fg, 0, 1.35, 0, 3.4, 2.7, 3);
    const bg = s.batch(fg);
    bg.g(s.mat('paintedMetal', 0xd8d2c2)).post(-2.4, 0, 1.2, 0.2, 1.2);
    bg.g(s.mat('paintedMetal', 0xc8322a)).beam([-2.4, 1.1, 1.2], [-9.4, 1.5, 1.2], 0.1);
    bg.flush();
    s.signBoard(s.at(-12, 100), 'PORT OF TIMARU', 0, 3, 0, 8, 5, { bg: '#1d3a5a', fg: '#f2ead6', style: 'block' });
    const posts = b.g(s.mat('paintedMetal', 0x5a6068));
    for (const sx of [-3.6, 3.6]) posts.post(-12 + sx, s.gy(-12 + sx, 100) - 0.3, 100, 0.16, 4.2);
    const fence = b.g(s.mat('metal', 0x8f959a, { roughness: 0.6 }));
    s.fence(fence, [[-74, 100], [-17, 100]], { height: 2, spacing: 3, rails: 2, post: 0.07, rail: [0.04, 0.04] });
    s.fence(fence, [[10, 100], [74, 100]], { height: 2, spacing: 3, rails: 2, post: 0.07, rail: [0.04, 0.04] });
  }
  b.flush();
};

/**
 * Blackett's lighthouse (1878): a small white timber tower, six-sided and tapering, with a gallery and a
 * lantern room; about 11 m to the vane. Sits inside a picket fence.
 */
export const lighthouse: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const b = s.batch();
  const white = b.g(s.mat('weatherboard', 0xf4f1e8));
  const trim = b.g(s.mat('plain', 0xf7f3e8, { roughness: 0.6 }));
  const red = b.g(s.mat('paintedMetal', 0x8f2a22));
  // Six flat faces, one of them square to the front for the door.
  b.g(s.mat('concrete')).prism(0, 0, 0, [[3, -1], [3, 0.25], [0, 0.25]], 6);
  white.prism(0, 0, 0, [[2.5, 0.25], [1.55, 7.6]], 6);
  // Gallery deck and rail.
  trim.lathe(0, 0, 0, [[1.6, 7.45], [2.35, 7.6], [2.35, 7.75], [0, 7.75]], 12);
  for (let i = 0; i < 12; i++) {
    const a = (TAU * i) / 12;
    const a2 = (TAU * (i + 1)) / 12;
    const q: V3 = [Math.cos(a) * 2.25, 7.75, Math.sin(a) * 2.25];
    const q2: V3 = [Math.cos(a2) * 2.25, 7.75, Math.sin(a2) * 2.25];
    trim.beam(q, [q[0], 8.7, q[2]], 0.05);
    trim.beam([q[0], 8.7, q[2]], [q2[0], 8.7, q2[2]], 0.05);
    trim.beam([q[0], 8.25, q[2]], [q2[0], 8.25, q2[2]], 0.03);
  }
  // Lantern room, roof and vane.
  white.lathe(0, 0, 0, [[1.3, 7.75], [1.3, 8.2]], 8);
  b.g(s.mat('glass', 0x9fc0c8, { roughness: 0.1 })).lathe(0, 0, 0, [[1.25, 8.2], [1.25, 9.5]], 8);
  b.g(s.m.emitter(0xfff2c0, 'night')).lathe(0, 0, 0, [[0, 8.4], [0.3, 8.5], [0.3, 9.2], [0, 9.3]], 6);
  for (let i = 0; i < 8; i++) {
    const a = (TAU * i) / 8;
    trim.post(Math.cos(a) * 1.27, 8.2, Math.sin(a) * 1.27, 0.07, 1.3);
  }
  red.lathe(0, 0, 0, [[1.5, 9.5], [1.5, 9.65], [0.5, 10.4], [0, 10.55]], 8);
  red.lathe(0, 0, 0, [[0, 10.5], [0.2, 10.7], [0, 10.9]], 6);
  red.tube([0, 10.8, 0], [0, 11.5, 0], 0.03, 0.02, 4);
  // Door, porch hood and windows on the faces.
  const dark = b.g(s.mat('plain', 0x2f3a36, { roughness: 0.5 }));
  white.box(0, 1.35, 2.02, 1.3, 2.3, 0.36);
  dark.box(0, 1.3, 2.2, 0.95, 2.1, 0.06);
  red.slab([-0.8, 2.5, 2.9], [0.8, 2.5, 2.9], [0.8, 2.85, 1.95], [-0.8, 2.85, 1.95], 0.06);
  for (const [a, y] of [[Math.PI / 2 + TAU / 3, 3.6], [Math.PI / 2 - TAU / 3, 5.4], [Math.PI / 2, 5.6]] as const) {
    const r = 2.5 - ((y - 0.25) / 7.35) * 0.95;
    dark.at(Math.cos(a) * r * 0.9, y, Math.sin(a) * r * 0.9, Math.PI / 2 - a, () => dark.box(0, 0, 0, 0.6, 0.9, 0.14));
  }
  // Picket fence and name board.
  const ring: [number, number][] = [];
  for (let i = 0; i < 12; i++) ring.push([Math.cos((TAU * i) / 12 + 0.26) * 8, Math.sin((TAU * i) / 12 + 0.26) * 8]);
  s.fence(trim, [...ring.slice(4), ...ring.slice(0, 3)], { height: 0.95, spacing: 1.4, rails: 2, post: 0.09, rail: [0.07, 0.03] });
  b.flush();
  s.signBoard(f, "BLACKETT'S LIGHTHOUSE 1878", 5.2, 1.1, 7.4, 2.6, 4, { bg: '#2f3a36', fg: '#f2ead6', style: 'paint' }, 0.5);
  out.box(f, 5.2, 0.3, 7.4, 0.1, 1.2, 0.1, s.mat('timber', 0x4f4338));
  out.collider(f, 0, 4, 0, 4, 8, 4);
  s.light(0, 8.9, 0, 0xfff2c0, 2, 45);
};

/**
 * Landing Service Building (1871): a long two-storey bluestone warehouse with limestone dressings and a row
 * of arched cart doors. 46 × 14 m under a twin-gabled iron roof.
 */
export const landingService: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const stone = s.mat('bluestone');
  const lime = s.mat('limestone');
  const roof = s.mat('corrugated', 0x6a6f74, { metalness: 0.3 });
  const b = s.batch();
  const gl = b.g(lime);
  const doors = b.g(s.mat('timber', 0x3f2c20));
  const glass = b.g(s.mat('glass', 0x26323c));

  walls(out, f, 0, 0, 46, 8.2, 14, stone, 2);
  out.collider(f, 0, 4.1, 0, 46, 8.2, 14);
  // Two parallel gables running the length of the building.
  for (const z of [-3.5, 3.5]) gableRoof(out, b.g(stone), f, 0, 8.2, z, 46, 7, 2.6, roof, 0.15);
  out.box(f, 0, 4.3, 0, 46.3, 0.35, 14.3, lime);
  out.box(f, 0, 8.1, 0, 46.5, 0.4, 14.5, lime);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.box(f, sx * 22.85, 3.1, sz * 6.85, 0.6, 10.2, 0.6, lime);

  // Front: seven arched doorways below, square-headed windows above.
  for (let i = 0; i < 7; i++) {
    const x = -18.9 + i * 6.3;
    gl.at(x, 0, 7, 0, () => {
      gl.arch(0, 2.5, 0.06, 1.5, 1.95, 0.24, 0, Math.PI, 8);
      for (const side of [-1, 1]) gl.box(side * 1.72, 1.25, 0.06, 0.45, 2.5, 0.24);
      gl.box(0, 4.55, 0.1, 0.5, 0.6, 0.3);
    });
    doors.box(x, 1.25, 7.03, 3, 2.5, 0.06);
    doors.arch(x, 2.5, 7.03, 0, 1.5, 0.06, 0, Math.PI, 8);
    for (const face of [1, -1]) {
      glass.box(x, 6.2, face * 7.03, 1.3, 1.7, 0.06);
      gl.box(x, 7.2, face * 7.05, 1.9, 0.3, 0.14).box(x, 5.25, face * 7.05, 1.7, 0.2, 0.18);
    }
    if (i % 2 === 1) glass.box(x, 2, -7.03, 1.3, 1.7, 0.06);
  }
  // Gable ends: a loading door, a round window in each gable.
  for (const side of [-1, 1]) {
    gl.at(side * 23, 0, 0, (side * Math.PI) / 2, () => {
      for (const x of [-3.5, 3.5]) {
        gl.arch(x, 9.4, 0.2, 0.55, 0.8, 0.14, 0, TAU, 12);
        glass.disc(x, 9.4, 0.19, 0.55, 12);
        glass.box(x, 6.2, 0.03, 1.3, 1.7, 0.06);
      }
      doors.box(0, 1.5, 0.03, 2.6, 3, 0.06);
      gl.box(0, 3.15, 0.05, 3.2, 0.3, 0.14);
    });
  }
  b.flush();
  s.sign(f, 'LANDING SERVICE BUILDING · 1871', 0, 3.75, 7.06, 9, 9, { bg: '#2a2f33', fg: '#d9cfb4', style: 'paint' });
  out.box(f, 0, -0.42, 8.6, 46, 1, 3, s.mat('footpath'));
  s.light(0, 3.4, 9, 0xffdca0, 1, 22);
};

/**
 * Timaru railway station (1967): a long low modern block with a taller glazed concourse, a canopy over the
 * forecourt and a cantilevered canopy over the platform behind (track side is -z). Marked car park in front.
 */
export const station: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const brick = s.mat('brick');
  const concrete = s.mat('concrete', 0xd2cec2);
  const b = s.batch();

  walls(out, f, 0, 1, 56, 4.2, 10, brick);
  out.box(f, 0, 4.45, 0.5, 58, 0.5, 12.6, concrete);
  out.collider(f, 0, 2.1, 1, 56, 4.2, 10);
  walls(out, f, 0, 1.5, 16, 7, 12, concrete);
  out.box(f, 0, 7.25, 1.5, 17.2, 0.5, 13.2, concrete);
  out.collider(f, 0, 3.5, 1.5, 16, 7, 12);
  out.quad(f, 0, 3.6, 7.54, 12.5, 5.4, m.windows('office'), 0, true);
  out.box(f, 0, 1.2, 7.56, 3.6, 2.4, 0.08, s.mat('glass', 0x31424c));
  windowRow(out, f, -27, -9, 6, 2.3, 6.03, 2.2, 1.5, m.windows('shop'));
  windowRow(out, f, 9, 27, 6, 2.3, 6.03, 2.2, 1.5, m.windows('shop'));
  windowRow(out, f, -27, 27, 14, 2.4, -4.03, 2.2, 1.3, m.windows('shop'), Math.PI);
  s.sign(f, 'TIMARU', 0, 6.55, 7.56, 6, 4, { bg: '#d2cec2', fg: '#1d2a44', style: 'block', border: false });
  // Clock on the concourse front.
  {
    const dial = b.g(s.mat('plain', 0xf4f1e8, { roughness: 0.5 }));
    const hands = b.g(s.mat('plain', 0x1c1c1c, { roughness: 0.5 }));
    dial.at(6.4, 6.3, 7.56, 0, () => dial.disc(0, 0, 0, 0.6, 16));
    hands.box(6.4, 6.5, 7.6, 0.06, 0.5, 0.02).box(6.58, 6.3, 7.6, 0.36, 0.06, 0.02);
  }
  // Forecourt canopy on round columns.
  out.box(f, 0, 3.55, 10.4, 20, 0.3, 5.6, concrete);
  for (const x of [-9, -3, 3, 9]) out.cylinder(f, x, 1.7, 12.6, 0.16, 0.16, 3.4, s.mat('paintedMetal', 0x3a3f44), 8);

  // Platform with ramps, a cantilevered canopy and name boards.
  out.box(f, 0, -0.1, -6.6, 72, 1.8, 5.2, s.mat('asphalt'));
  out.collider(f, 0, 0.4, -6.6, 72, 0.8, 5.2);
  out.box(f, 0, 0.81, -8.95, 72, 0.02, 0.3, s.mat('plain', 0xf2efe6));
  const ramps = b.g(s.mat('asphalt'));
  for (const side of [-1, 1]) {
    const x0 = side * 36;
    const x1 = side * 38.6;
    ramps.polyUp([[x0, 0.8, -4], [x1, -0.05, -4], [x1, -0.05, -9.2], [x0, 0.8, -9.2]]);
  }
  const steel = b.g(s.mat('paintedMetal', 0x3a3f44));
  const canopy = b.g(s.mat('corrugated', 0xd8d4c6, { metalness: 0.3 }));
  canopy.slab([-27, 4.3, -9.4], [27, 4.3, -9.4], [27, 3.9, -4], [-27, 3.9, -4], 0.14);
  for (let x = -25; x <= 25; x += 10) {
    steel.post(x, 0.8, -5.4, 0.22, 3.1);
    steel.beam([x, 3.85, -4.4], [x, 4.15, -9.2], 0.14, 0.26);
  }
  const seat = b.g(s.mat('timber', 0x6a4a30));
  for (const x of [-20, -8, 8, 20]) bench(seat, x, 0.8, -4.7, 0);
  const lamp = b.g(m.emitter(0xfff0c8, 'night'));
  for (let x = -20; x <= 20; x += 10) lamp.box(x, 3.95, -7, 1.2, 0.08, 0.3);
  b.flush();
  for (const x of [-31, 31]) {
    s.signBoard(f, 'TIMARU', x, 2.6, -5.4, 3.6, 4.5, { bg: '#f2efe6', fg: '#1c1c1c', style: 'block' });
    for (const sx of [-1.6, 1.6]) out.box(f, x + sx, 1.9, -5.4, 0.1, 2.2, 0.1, s.mat('paintedMetal', 0x3a3f44));
  }

  // Car park in front.
  const tar = new Geo();
  s.drape(tar, 0, 22.5, 52, 15, 0.05);
  tar.flush(out, s.ground('asphalt'), f);
  const paint = new Geo();
  s.bays(paint, -13.6, 27.6, 9, Math.PI);
  s.bays(paint, 13.6, 27.6, 9, Math.PI);
  s.bays(paint, -13.6, 17.4, 7);
  paint.flush(out, s.ground('plain', 0xe8e6da, -4), f);
  s.prop('lamp', -27.5, 22, Math.PI / 2);
  s.prop('lamp', 27.5, 24, -Math.PI / 2);
  s.light(0, 3, 11, 0xffe6b8, 1.4, 26);
  s.light(0, 3.5, -7, 0xffe6b8, 1.2, 40);
};

