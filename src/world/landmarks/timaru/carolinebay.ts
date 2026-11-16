import { LAMP_WARM } from '../../scatter/util';
import * as THREE from 'three';
import { TAU } from '../../../core/math';
import type { LandmarkBuilder } from '../../../core/types';
import { type Batch, flagpole, Geo, picnicTable, Site, sub, verandah, walls, windowRow } from '../rural/kit';

/** Surface of revolution cut into wedges of alternating colour (tent roofs, carousel canopies). */
function striped(b: Batch, mats: readonly THREE.Material[], cx: number, cy: number, cz: number, profile: readonly (readonly [number, number])[], wedges: number): void {
  for (let i = 0; i < wedges; i++) b.g(mats[i % mats.length]).lathe(cx, cy, cz, profile, 1, (TAU * i) / wedges, (TAU * (i + 1)) / wedges);
}

/**
 * Caroline Bay sound shell (1937): white concrete quarter-sphere over a raised stage between stepped
 * Art Deco wings, with rows of slatted benches on the lawn. Stage 18 × 12 m, shell radius 8.5 m.
 */
export const soundshell: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const white = s.mat('plaster', 0xf2efe6);
  const concrete = s.mat('concrete', 0xcfcabd);
  const lining = s.mat('plaster', 0xbfd4d6);
  const green = s.mat('timber', 0x2f5a44);
  const b = s.batch();

  // Stage and steps.
  out.box(f, 0, -0.15, -17, 18, 2.7, 12, concrete);
  out.collider(f, 0, 0.6, -17, 18, 1.2, 12);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const top = 0.9 - k * 0.3;
      out.box(f, side * 7.4, top / 2 - 0.4, -10.7 + k * 0.4, 2.4, top + 0.8, 0.4, concrete);
      out.collider(f, side * 7.4, top / 2, -10.7 + k * 0.4, 2.4, top, 0.4);
    }
  }

  // The shell: outside white, inside a pale sea green, with a proscenium arch across the front.
  const arc = (r: number, rise: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      pts.push([r * Math.cos(a), 1.2 + rise * Math.sin(a)]);
    }
    return pts;
  };
  b.g(white).lathe(0, 0, -15, arc(8.5, 8.5), 18, Math.PI, TAU, true);
  b.g(lining).lathe(0, 0, -15, arc(8.25, 8.25), 18, Math.PI, TAU, true, true);
  b.g(white).arch(0, 1.2, -14.6, 8.25, 9.5, 1.0, 0, Math.PI, 18);
  out.collider(f, 0, 4, -23, 14, 6, 1);
  const bulbs = b.g(s.m.emitter(0xffe6a8, 'night'));
  for (let i = 1; i < 18; i++) {
    const a = (Math.PI * i) / 18;
    bulbs.box(Math.cos(a) * 8.9, 1.2 + Math.sin(a) * 8.9, -14.05, 0.2, 0.2, 0.12);
  }

  // Stepped wings (band rooms) either side.
  for (const side of [-1, 1]) {
    walls(out, f, side * 11.7, -16, 4.6, 6.2, 7, white);
    out.box(f, side * 11.7, 6.5, -16, 3.6, 0.6, 6, white);
    walls(out, f, side * 16.6, -16.5, 5.2, 3.8, 6, white);
    out.box(f, side * 16.6, 3.95, -16.5, 5.5, 0.3, 6.3, concrete);
    out.collider(f, side * 14, 3, -16, 10, 6, 7);
    out.quad(f, side * 16.6, 2.2, -13.47, 2.4, 1.1, s.m.windows('house'));
    out.box(f, side * 11.7, 1.05, -12.47, 1, 2.1, 0.08, green);
    for (const y of [4.6, 5.2]) out.box(f, side * 11.7, y, -12.46, 3.2, 0.12, 0.1, concrete);
  }
  s.sign(f, 'CAROLINE BAY', -11.7, 3.4, -12.45, 3.6, 4.5, { bg: '#f2efe6', fg: '#2f5a44', style: 'block', border: false });
  s.sign(f, 'SOUND SHELL', 11.7, 3.4, -12.45, 3.6, 4.5, { bg: '#f2efe6', fg: '#2f5a44', style: 'block', border: false });

  // Benches on the lawn: nine rows in three blocks, each set on the ground where it stands.
  const seats = b.g(green);
  const legs = b.g(concrete);
  for (let row = 0; row < 9; row++) {
    const z = -3 + row * 3.2;
    for (const cx of [-12, 0, 12]) {
      const y = s.gy(cx, z);
      seats.box(cx, y + 0.45, z, 10, 0.06, 0.42);
      seats.box(cx, y + 0.8, z + 0.22, 10, 0.34, 0.05);
      for (const lx of [-4.4, 0, 4.4]) legs.post(cx + lx, y - 0.1, z + 0.02, 0.1, 0.52, 0.46);
      out.collider(f, cx, y + 0.45, z + 0.05, 10, 0.9, 0.5);
    }
  }
  b.flush();

  s.light(0, 6, -12, LAMP_WARM, 1.6, 30);
  s.light(0, 5, 10, LAMP_WARM, 0.8, 28);
};

const STALLS: { name: string; a: number; b: number }[] = [
  { name: 'CANDY FLOSS', a: 0xe77a9a, b: 0xf6efe0 },
  { name: 'HOT CHIPS', a: 0xd9a12a, b: 0xf6efe0 },
  { name: 'CHOCOLATE WHEEL', a: 0x8a2f2a, b: 0xf0d27a },
  { name: 'HOOPLA', a: 0x2f6d8a, b: 0xf6efe0 },
  { name: 'TOFFEE APPLES', a: 0xb0271f, b: 0xf6efe0 },
  { name: 'LUCKY DIP', a: 0x3a7d4a, b: 0xf0d27a },
  { name: 'COCONUT SHY', a: 0x6a4a8a, b: 0xf6efe0 },
  { name: 'HOT DOGS & DRINKS', a: 0xc8501e, b: 0xf6efe0 },
];

const BULBS = [0xff4a3a, 0xffd23a, 0x4ade6a, 0x4a9cff];

/**
 * The Caroline Bay summer carnival (Boxing Day to mid January): a midway of striped stalls under strings of
 * coloured lights, a merry-go-round, a 25 m Ferris wheel, a chair-o-plane, dodgems and a sideshow tent.
 */
export const carnival: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const steel = s.mat('paintedMetal', 0xe9e6dc);
  const dark = s.mat('paintedMetal', 0x34383c);
  const red = s.mat('cloth', 0xb8322a);
  const cream = s.mat('cloth', 0xf3ecd8);
  const blue = s.mat('cloth', 0x2f5f8f);
  const yellow = s.mat('cloth', 0xe2b53a);
  const timber = s.mat('timber', 0x8a6a48);
  const gold = s.mat('metal', 0xd2ad55, { roughness: 0.35, metalness: 0.8 });
  const warm = m.emitter(0xffe6a8, 'night');
  const bulbMats = BULBS.map((c) => m.emitter(c, 'night'));
  const paints = [0xc8322a, 0x2f6fae, 0xe2b53a, 0x3a8a56].map((c) => s.mat('paintedMetal', c));

  // Trodden midway from the gate up to the rides.
  const path = new Geo();
  s.ribbon(path, [[0, 62], [0, -8]], 9, 0.06);
  s.ribbon(path, [[-28, -8], [30, -8]], 6, 0.06);
  path.flush(out, s.ground('gravel'), f);

  // ── Entrance arch and ticket booth ──
  {
    const fe = s.at(0, 61);
    const b = s.batch(fe);
    for (const side of [-1, 1]) {
      walls(out, fe, side * 5.2, 0, 1.2, 5.6, 1.2, s.mat('plaster', 0xf3ecd8));
      out.box(fe, side * 5.2, 5.9, 0, 1.5, 0.5, 1.5, s.mat('plaster', 0xb8322a));
      out.collider(fe, side * 5.2, 2.8, 0, 1.2, 5.6, 1.2);
    }
    out.box(fe, 0, 5.3, 0, 9.4, 1.9, 0.3, s.mat('plaster', 0xb8322a));
    s.signBoard(fe, 'CAROLINE BAY CARNIVAL', 0, 5.3, 0, 9, 6, { bg: '#f3ecd8', fg: '#b8322a', style: 'paint' });
    const g = b.g(warm);
    for (let i = 0; i <= 14; i++) g.box(-4.9 + i * 0.7, 6.4, 0, 0.2, 0.2, 0.2);
    // Ticket booth.
    walls(out, fe, 8.6, -1.5, 2.4, 2.5, 2.4, s.mat('weatherboard', 0xf3ecd8));
    b.g(red).taper(8.6, 2.5, -1.5, 3, 3, 0, 0, 1.3);
    out.quad(fe, 8.6, 1.6, -0.28, 1.4, 0.9, m.windows('shop'));
    s.sign(fe, 'TICKETS', 8.6, 2.25, -0.27, 1.8, 4.5, { bg: '#b8322a', fg: '#f3ecd8', style: 'block' });
    out.collider(fe, 8.6, 1.25, -1.5, 2.4, 2.5, 2.4);
    b.flush();
  }

  // ── Stalls down both sides of the midway ──
  STALLS.forEach((stall, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const z = 46 - Math.floor(i / 2) * 8.5;
    const fs = s.at(side * 10.5, z, (-side * Math.PI) / 2);
    const b = s.batch(fs);
    const ca = s.mat('cloth', stall.a);
    const cb = s.mat('cloth', stall.b);
    // Canvas back and sides, counter, striped roof with a valance.
    const canvas = b.g(cb);
    canvas.box(0, 1.3, -1.6, 5, 2.6, 0.06).box(-2.5, 1.3, 0, 0.06, 2.6, 3.2).box(2.5, 1.3, 0, 0.06, 2.6, 3.2);
    b.g(timber).box(0, 0.5, 1.5, 5, 1, 0.5);
    b.g(s.mat('timber', 0xd8c9a0)).box(0, 1.03, 1.5, 5.2, 0.06, 0.7).box(0, 1.5, -1.4, 4.6, 0.05, 0.4);
    for (let k = 0; k < 6; k++) {
      const x0 = -2.7 + k * 0.9;
      b.g(k % 2 === 0 ? ca : cb).slab([x0, 2.6, 2.1], [x0 + 0.9, 2.6, 2.1], [x0 + 0.9, 3.3, -1.7], [x0, 3.3, -1.7], 0.05);
      b.g(k % 2 === 0 ? cb : ca).box(x0 + 0.45, 2.42, 2.1, 0.9, 0.36, 0.04);
    }
    for (const px of [-2.5, 2.5]) b.g(steel).post(px, 0, 1.9, 0.08, 2.6);
    s.sign(fs, stall.name, 0, 3.05, 2.14, 4.4, 5.5, { bg: '#' + stall.b.toString(16).padStart(6, '0'), fg: '#' + (stall.a & 0x7f7f7f).toString(16).padStart(6, '0'), style: i % 3 === 0 ? 'script' : 'paint' });
    if (stall.name === 'CHOCOLATE WHEEL') {
      for (let k = 0; k < 12; k++) b.g(k % 2 === 0 ? ca : cb).arch(0, 1.9, -1.52, 0.08, 0.75, 0.04, (TAU * k) / 12, (TAU * (k + 1)) / 12, 1);
    } else {
      const prizes = b.g(paints[i % paints.length]);
      for (let k = 0; k < 5; k++) prizes.box(-1.8 + k * 0.9, 1.72, -1.4, 0.34, 0.38, 0.3);
    }
    b.g(warm).box(0, 2.3, 1.6, 4.4, 0.06, 0.1);
    b.flush();
    out.collider(fs, 0, 1.3, 0, 5, 2.6, 3.4);
  });

  // ── Strings of coloured lights over the midway ──
  {
    const b = s.batch();
    const poles = b.g(dark);
    const wire = b.g(s.mat('plain', 0x2a2a2a));
    const tops: [number, number, number][][] = [[], []];
    [-1, 1].forEach((side, k) => {
      for (const z of [56, 42, 28, 14]) {
        const y = s.gy(side * 5.6, z);
        poles.tube([side * 5.6, y - 0.3, z], [side * 5.6, y + 5.4, z], 0.07, 0.05, 6);
        tops[k].push([side * 5.6, y + 5.3, z]);
      }
    });
    let n = 0;
    const string = (a: [number, number, number], c: [number, number, number]) => {
      const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
      const steps = Math.max(2, Math.round(len / 0.9));
      let prev = a;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const sag = 4 * t * (1 - t) * Math.min(1.1, len * 0.06);
        const q: [number, number, number] = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag, a[2] + (c[2] - a[2]) * t];
        if (i % 3 === 0 || i === steps) {
          wire.beam(prev, q, 0.025);
          prev = q;
        }
        if (i < steps) b.g(bulbMats[n++ % bulbMats.length]).box(q[0], q[1] - 0.1, q[2], 0.17, 0.17, 0.17);
      }
    };
    for (let i = 0; i < 4; i++) {
      string(tops[0][i], tops[1][i]);
      if (i < 3) for (const k of [0, 1]) string(tops[k][i], tops[k][i + 1]);
    }
    b.flush();
  }

  // ── Merry-go-round ──
  {
    const fc = s.at(0, 3);
    const b = s.batch(fc);
    b.g(timber).lathe(0, 0, 0, [[6, -0.6], [6, 0.45], [0, 0.45]], 20);
    b.g(s.mat('plaster', 0xf3ecd8)).lathe(0, 0, 0, [[1.3, 0.45], [1.3, 4.6]], 12);
    striped(b, [red, cream], 0, 0, 0, [[6.5, 4.0], [6.5, 4.5], [1.0, 6.5], [0, 6.7]], 16);
    b.g(gold).lathe(0, 0, 0, [[0, 6.7], [0.3, 6.85], [0.3, 7.1], [0, 7.3]], 8);
    const horses = [0xf2efe6, 0x3a3230, 0x8a5a3c, 0xd9d2c2].map((c) => b.g(s.mat('plain', c, { roughness: 0.5 })));
    const brass = b.g(gold);
    for (let i = 0; i < 12; i++) {
      const a = (TAU * i) / 12;
      const r = i % 2 === 0 ? 4.9 : 3.3;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const lift = 1.0 + (i % 3) * 0.3;
      brass.tube([x, 0.45, z], [x, 4.3, z], 0.035, 0.035, 5, false);
      const h = horses[i % horses.length];
      h.at(x, lift, z, -a, () => {
        h.box(0, 0.35, 0, 0.36, 0.42, 1.25);
        h.box(0, 0.78, 0.6, 0.2, 0.62, 0.3);
        h.box(0, 1.02, 0.86, 0.19, 0.24, 0.5);
        for (const lz of [-0.45, 0.45]) h.box(0, -0.12, lz, 0.3, 0.55, 0.12);
      });
    }
    const lamps = b.g(warm);
    for (let i = 0; i < 24; i++) {
      const a = (TAU * i) / 24;
      lamps.box(Math.cos(a) * 6.55, 4.15, Math.sin(a) * 6.55, 0.18, 0.18, 0.18);
    }
    b.flush();
    out.collider(fc, 0, 2, 0, 8.6, 4.4, 8.6);
  }

  // ── Ferris wheel ──
  {
    const fw = s.at(-32, -24, 0.3);
    const b = s.batch(fw);
    const R = 12.5;
    const hub = 14.6;
    const frame = b.g(steel);
    for (const side of [-1, 1]) {
      frame.arch(0, hub, side * 1.3, R - 0.14, R + 0.14, 0.14, 0, TAU, 32);
      frame.arch(0, hub, side * 1.3, R * 0.55 - 0.08, R * 0.55 + 0.08, 0.1, 0, TAU, 24);
      for (let i = 0; i < 16; i++) {
        const a = (TAU * i) / 16;
        frame.beam([0, hub, side * 1.3], [Math.cos(a) * R, hub + Math.sin(a) * R, side * 1.3], 0.1);
      }
      // A-frame legs.
      for (const lx of [-6.2, 6.2]) b.g(dark).beam([lx, 0, side * 2.1], [0, hub, side * 1.7], 0.5, 0.36);
      b.g(dark).beam([-3.1, hub / 2, side * 1.9], [3.1, hub / 2, side * 1.9], 0.3, 0.2);
    }
    b.g(dark).tube([0, hub, -2.2], [0, hub, 2.2], 0.5, 0.5, 10);
    const rim = b.g(warm);
    for (let i = 0; i < 12; i++) {
      const a = (TAU * (i + 0.5)) / 12;
      const x = Math.cos(a) * R;
      const y = hub + Math.sin(a) * R;
      frame.tube([x, y, -1.3], [x, y, 1.3], 0.06, 0.06, 5, false);
      const tub = b.g(paints[i % paints.length]);
      tub.box(x, y - 1.75, 0, 1.7, 0.75, 1.5).box(x, y - 0.55, 0, 1.9, 0.08, 1.7);
      for (const sz of [-0.8, 0.8]) frame.beam([x, y, sz], [x, y - 1.4, sz], 0.05);
    }
    for (let i = 0; i < 32; i++) {
      const a = (TAU * i) / 32;
      rim.box(Math.cos(a) * (R + 0.3), hub + Math.sin(a) * (R + 0.3), 1.42, 0.2, 0.2, 0.12);
    }
    // Loading deck and operator's hut.
    out.box(fw, 0, 0.1, 0, 15, 1, 6, timber);
    out.collider(fw, 0, 0.3, 0, 15, 0.6, 6);
    walls(out, fw, 8.8, 2.6, 2, 2.4, 2, s.mat('weatherboard', 0xb8322a));
    out.box(fw, 8.8, 2.5, 2.6, 2.4, 0.15, 2.4, cream);
    b.flush();
    s.light(-32, 8, -18, 0xffe2a0, 1.3, 34);
  }

  // ── Chair-o-plane ──
  {
    const fc = s.at(30, -22);
    const b = s.batch(fc);
    b.g(timber).lathe(0, 0, 0, [[4.6, -0.6], [4.6, 0.4], [0, 0.4]], 8);
    striped(b, [s.mat('paintedMetal', 0xc8322a), s.mat('paintedMetal', 0xf3ecd8)], 0, 0, 0, [[1.0, 0.4], [0.75, 8.6]], 8);
    // The canopy leans the way the real ones do when spinning; chairs swing out on their chains.
    const tilted = s.batch(fc.clone().multiply(new THREE.Matrix4().makeRotationZ(0.14).setPosition(0, 8.6, 0)));
    striped(tilted, [red, yellow], 0, 0, 0, [[5.4, 0], [5.4, 0.5], [1.2, 1.9], [0, 2]], 12);
    tilted.g(yellow).lathe(0, 0, 0, [[0, -0.02], [5.4, 0]], 12);
    tilted.flush();
    const chairs = [b.g(paints[0]), b.g(paints[1]), b.g(paints[3])];
    const chain = b.g(dark);
    for (let i = 0; i < 12; i++) {
      const a = (TAU * i) / 12;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const y0 = 8.5 + c * 0.7;
      const y1 = 3.4 + c * 0.9;
      const a0: [number, number, number] = [c * 5.1, y0, sn * 5.1];
      const a1: [number, number, number] = [c * 7.0, y1, sn * 7.0];
      chain.beam(a0, a1, 0.03);
      const ch = chairs[i % chairs.length];
      ch.at(a1[0], a1[1], a1[2], -a, () => {
        ch.box(0, -0.25, 0, 0.5, 0.08, 0.5);
        ch.box(-0.22, 0.0, 0, 0.06, 0.5, 0.5);
      });
    }
    const lamps = b.g(warm);
    for (let i = 0; i < 16; i++) {
      const a = (TAU * i) / 16;
      lamps.box(Math.cos(a) * 5.45, 8.75 + Math.cos(a) * 0.76, Math.sin(a) * 5.45, 0.18, 0.18, 0.18);
    }
    b.flush();
    out.collider(fc, 0, 4.3, 0, 2, 8.6, 2);
    out.collider(fc, 0, 0.2, 0, 8, 0.4, 8);
  }

  // ── Dodgems pavilion ──
  {
    const fd = s.at(-33, 30, Math.PI / 2);
    const b = s.batch(fd);
    out.box(fd, 0, -0.2, 0, 16, 0.9, 11, s.mat('paintedMetal', 0x8a8f94));
    out.box(fd, 0, 4.5, 0, 17, 0.3, 12, s.mat('corrugated', 0xb8322a));
    out.box(fd, 0, 4.0, 5.9, 17, 0.8, 0.12, cream);
    s.sign(fd, 'DODGEMS', 0, 4.0, 5.98, 6, 6, { bg: '#f3ecd8', fg: '#2f5f8f', style: 'block' });
    const posts = b.g(steel);
    for (const px of [-7.8, -2.6, 2.6, 7.8]) for (const pz of [-5.3, 5.3]) posts.post(px, 0, pz, 0.16, 4.4);
    const kerb = b.g(yellow);
    kerb.box(0, 0.5, -5.4, 16, 0.5, 0.2).box(-7.9, 0.5, 0, 0.2, 0.5, 11).box(7.9, 0.5, 0, 0.2, 0.5, 11);
    for (const kx of [-5.4, 5.4]) kerb.box(kx, 0.5, 5.4, 5.2, 0.5, 0.2);
    [[-5, -2, 0.4], [-1, 2.5, 2.1], [3, -1.5, 4], [5.5, 2.8, 5.2], [0.5, -3.4, 1.2]].forEach(([cx, cz, yaw], i) => {
      const car = b.g(paints[i % paints.length]);
      car.at(cx, 0.25, cz, yaw, () => {
        car.box(0, 0.3, 0, 1.1, 0.45, 1.8);
        car.box(0, 0.62, -0.5, 0.9, 0.3, 0.5);
      });
      b.g(dark).at(cx, 0.25, cz, yaw, () => {
        b.g(dark).box(0, 0.12, 0, 1.3, 0.2, 2.0);
        b.g(dark).tube([0, 0.5, -0.8], [0, 4.1, -0.8], 0.02, 0.02, 4, false);
      });
    });
    b.g(warm).box(0, 4.3, 0, 12, 0.05, 0.3);
    b.flush();
  }

  // ── Sideshow tent ──
  {
    const ft = s.at(33, 27);
    const b = s.batch(ft);
    striped(b, [blue, cream], 0, 0, 0, [[7.5, -0.5], [7.5, 2.6]], 16);
    striped(b, [cream, blue], 0, 0, 0, [[7.9, 2.5], [1.2, 6.6], [0, 6.9]], 16);
    const g = b.g(steel);
    flagpole(g, 0, 6.6, 0, 2.2);
    b.g(red).poly([[0.04, 8.7, 0], [1.3, 8.4, 0], [0.04, 8.1, 0]], true);
    b.g(s.mat('cloth', 0x2a2420)).box(-7.3, 1.1, 0, 0.5, 2.2, 2.2);
    b.flush();
    s.sign(ft, 'HALL OF MIRRORS', -7.62, 2.9, 0, 4.4, 5.5, { bg: '#f0d27a', fg: '#8a2f2a', style: 'script' }, -Math.PI / 2);
    out.collider(ft, 0, 1.5, 0, 12.5, 3, 12.5);
  }

  s.light(0, 5, 34, 0xffdf9a, 1.5, 34);
};

/**
 * Caroline Bay tearooms (1930s): long plastered pavilion with a tiled hip roof, a gabled entrance bay
 * and verandahs either side, looking out over the lawn. 24 × 10 m.
 */
export const tearooms: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const wall = s.mat('plaster', 0xefe6cf);
  const roof = s.mat('rooftile', 0x9a4a32);
  const trim = s.mat('plain', 0x2f5a44, { roughness: 0.6 });
  const white = s.mat('plain', 0xf7f3e8, { roughness: 0.6 });
  const b = s.batch();

  walls(out, f, 0, -2, 24, 3.8, 10, wall);
  out.gable(f, 0, 3.8, -2, 25, 11, 2.7, roof, 5);
  out.collider(f, 0, 1.9, -2, 24, 3.8, 10);
  out.box(f, 0, 0.35, -2, 24.1, 0.7, 10.1, s.mat('plaster', 0xb9ad94));

  // Entrance bay with its own gable facing the bay.
  walls(out, f, 0, 4, 6.4, 4.4, 2.4, wall);
  out.gable(sub(f, 0, 0, 3.4, Math.PI / 2), 0, 4.4, 0, 4.4, 7.2, 2.2, roof);
  b.g(wall).poly([[-3.3, 4.4, 5.62], [3.3, 4.4, 5.62], [0, 6.42, 5.62]]);
  out.collider(f, 0, 2.2, 4, 6.4, 4.4, 2.4);
  out.box(f, 0, 1.15, 5.23, 1.8, 2.3, 0.08, s.mat('glass', 0x31424c));
  for (const side of [-1, 1]) out.quad(f, side * 2.1, 1.75, 5.22, 1.3, 1.7, s.m.windows('house'));
  s.sign(f, 'BAY TEAROOMS', 0, 3.6, 5.24, 5, 5, { bg: '#2f5a44', fg: '#f2ead6', style: 'script' });
  b.g(trim).disc(0, 5.25, 5.64, 0.45, 12);

  // Verandahs, windows and doors along the front.
  for (const side of [-1, 1]) {
    const x0 = side === 1 ? 3.2 : -12;
    const x1 = side === 1 ? 12 : -3.2;
    verandah(b, roof, white, x0, x1, 3, 2.8, 3.6, 2.7, 4);
    b.g(s.mat('concrete')).box((x0 + x1) / 2, 0.08, 4.4, x1 - x0, 0.16, 2.8);
    windowRow(out, f, x0 + 0.3, x1 - 0.3, 4, 1.7, 3.03, 1.5, 1.6, s.m.windows('house'));
    out.quad(f, side * 12.03, 1.7, -2, 1.5, 1.5, s.m.windows('house'), (side * Math.PI) / 2);
    out.quad(f, side * 12.03, 1.7, -5, 1.5, 1.5, s.m.windows('house'), (side * Math.PI) / 2);
  }
  windowRow(out, f, -11, 11, 6, 1.9, -7.03, 1.3, 1.2, s.mat('glass'), Math.PI);
  out.box(f, 7, 5.6, -3, 0.9, 2.6, 0.9, s.mat('brick'));
  out.box(f, 7, 6.95, -3, 1.1, 0.14, 1.1, s.mat('concrete'));

  // Tables on the lawn and a flagpole.
  const tables = b.g(s.mat('timber', 0x7a5a3c));
  for (const [x, z] of [[-8, 10], [-3, 12.5], [4, 11], [9, 13]] as const) {
    const y = s.gy(x, z);
    picnicTable(tables, x, y, z, s.rng.range(-0.3, 0.3));
    out.collider(f, x, y + 0.4, z, 1.8, 0.8, 1.6);
  }
  flagpole(b.g(white), -13.5, s.gy(-13.5, 7), 7, 7);
  b.flush();
  s.prop('tree-cabbage', 14.5, 8, 1.2);
  s.prop('flax', -11, 6.4, 0.4);
  s.prop('flax', 11.4, 6.6, 2.2);
  s.light(0, 2.6, 6.5, 0xffdca0, 1.2, 18);
};

