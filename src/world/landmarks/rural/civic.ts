import { LAMP_WARM } from '../../scatter/util';
import { TAU } from '../../../core/math';
import type { LandmarkBuilder } from '../../../core/types';
import { bench, clockFace, flagpole, gableRoof, Geo, picnicTable, rugbyPosts, Site, type V3, verandah, walls, windowRow } from './kit';

/**
 * Ashburton clock tower (1976), Baring Square East: four concrete fins rising 16 m from a paved plinth to a
 * cubic clock chamber with a face on each side, about 21 m in all; the old post-office clock movement sits
 * in a glazed room at the base. A shallow pool and seats in front.
 */
export const clockTower: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const concrete = s.mat('concrete', 0xd4d0c4);
  const paving = s.mat('footpath', 0xc8b9a0);
  const b = s.batch();

  // Plinth: two broad steps.
  out.box(f, 0, -0.35, 0, 11, 1.3, 11, paving);
  out.collider(f, 0, 0.15, 0, 11, 0.3, 11);
  out.box(f, 0, 0.4, -0.5, 6.4, 0.25, 6.4, paving);
  out.collider(f, 0, 0.4, -0.5, 6.4, 0.25, 6.4);

  // Fins, ties and the clock chamber.
  const cz = -0.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.box(f, sx * 1.75, 8.2, cz + sz * 1.75, 0.5, 15.4, 1.3, concrete);
      out.box(f, sx * 1.35, 8.2, cz + sz * 2.15, 1.3, 15.4, 0.5, concrete);
    }
  }
  for (const y of [5.6, 10.6]) {
    for (const side of [-1, 1]) {
      out.box(f, 0, y, cz + side * 2.15, 3.4, 0.35, 0.4, concrete);
      out.box(f, side * 1.75, y, cz, 0.4, 0.35, 3.6, concrete);
    }
  }
  out.box(f, 0, 18.2, cz, 4.8, 4.6, 4.8, concrete);
  out.box(f, 0, 20.7, cz, 5.4, 0.4, 5.4, s.mat('concrete', 0xb9b4a8));
  out.box(f, 0, 15.75, cz, 5.2, 0.3, 5.2, s.mat('concrete', 0xb9b4a8));
  out.collider(f, 0, 10.5, cz, 4.8, 21, 4.8);
  const dial = b.g(s.m.emitter(0xfff6dc, 'night'));
  const hands = b.g(s.mat('plain', 0x1a1a1a, { roughness: 0.5 }));
  const hour = 1 + (s.seed % 11);
  const minute = ((s.seed >> 4) % 12) * 5;
  for (let i = 0; i < 4; i++) {
    const yaw = (i * Math.PI) / 2;
    b.at(0, 0, cz, 0, () => clockFace(dial, hands, yaw, 0, 18.2, 2.42, 1.75, hour, minute));
  }
  b.g(s.mat('paintedMetal', 0x3a3f44)).tube([0, 20.9, cz], [0, 22.3, cz], 0.06, 0.03, 6);

  // Glazed room with the old movement, and a bell hung in the frame.
  b.g(s.mat('glass', 0x4a6470, { roughness: 0.15 })).box(0, 2.1, cz, 3, 3.2, 3);
  out.box(f, 0, 3.8, cz, 3.6, 0.25, 3.6, concrete);
  b.g(s.mat('metal', 0x8a6a3a, { roughness: 0.45, metalness: 0.8 })).lathe(0, 11.6, cz, [[0.75, 0], [0.62, 0.35], [0.4, 0.95], [0.2, 1.2], [0, 1.25]], 12);

  // Pool, seats and planting.
  out.box(f, 0, 0.36, 3.9, 7, 0.22, 2.2, concrete);
  b.g(s.mat('glass', 0x3a7f86)).box(0, 0.47, 3.9, 6.5, 0.02, 1.7);
  const seats = b.g(s.mat('timber', 0x6a4a30));
  for (const side of [-1, 1]) bench(seats, side * 4.6, 0.3, -0.5, (-side * Math.PI) / 2);
  b.flush();
  for (const [x, z] of [[-6.6, 6.4], [6.6, 6.4], [-6.6, -6.4], [6.6, -6.4]] as const) s.prop('bush', x, z, x + z, 1);
  s.light(0, 17, 4, 0xfff0d0, 1.3, 30);
};

/**
 * The Rakaia salmon: a giant leaping salmon (about 11 m of fish) on a river-stone plinth beside SH1.
 * The body is skinned from elliptical rings along a curved spine; back, flank stripe and belly are
 * separate skins so the colours stay crisp.
 */
export const salmon: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const b = s.batch();

  // Plinth of river stones with a concrete cap.
  b.g(s.mat('shingle')).prism(0, 0, 0, [[2.6, -1], [2.1, 1.5]], 10);
  b.g(s.mat('concrete')).prism(0, 0, 0, [[2.25, 1.5], [2.25, 1.75], [0, 1.75]], 10);
  out.collider(f, 0, 0.9, 0, 4.2, 1.8, 4.2);

  // Spine in the x–y plane, tail low on the left, head high and arching over to the right.
  const P0: [number, number] = [-2.3, 3.5];
  const P1: [number, number] = [-2.0, 8.6];
  const P2: [number, number] = [2.0, 12.9];
  const spine = (t: number): [number, number] => [(1 - t) * (1 - t) * P0[0] + 2 * t * (1 - t) * P1[0] + t * t * P2[0], (1 - t) * (1 - t) * P0[1] + 2 * t * (1 - t) * P1[1] + t * t * P2[1]];
  const tangent = (t: number): [number, number] => {
    const dx = 2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]);
    const dy = 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
    const l = Math.hypot(dx, dy);
    return [dx / l, dy / l];
  };
  // Half depth of the body (back to belly) along the fish; half width is a little over half of that.
  const depth = (t: number) => {
    const keys: [number, number][] = [[0, 0.3], [0.08, 0.36], [0.22, 0.8], [0.45, 1.2], [0.68, 1.08], [0.85, 0.82], [0.95, 0.5], [1, 0.1]];
    for (let i = 0; i < keys.length - 1; i++) {
      if (t <= keys[i + 1][0]) {
        const k = (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
        return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * (k * k * (3 - 2 * k));
      }
    }
    return 0.1;
  };
  const N = 16;
  const SEG = 12;
  // Point on ring `i` at angle phi: phi = +90° is the belly side (inside of the arch), -90° the back.
  const ringPoint = (i: number, phi: number, grow = 1): V3 => {
    const t = i / N;
    const [x, y] = spine(t);
    const [tx, ty] = tangent(t);
    const ry = depth(t) * grow;
    const rx = ry * 0.56;
    const c = Math.cos(phi) * rx;
    const sn = Math.sin(phi) * ry;
    return [x + ty * sn, y - tx * sn, c];
  };
  const skin = (g: Geo, from: number, to: number, steps: number, grow = 1) => g.sheet(N, steps, (i, j) => ringPoint(i, from + ((to - from) * j) / steps, grow));
  const back = b.g(s.mat('paintedMetal', 0x4f5f58, { roughness: 0.45, metalness: 0.35 }));
  const stripe = b.g(s.mat('paintedMetal', 0xc79a96, { roughness: 0.4, metalness: 0.35 }));
  const belly = b.g(s.mat('paintedMetal', 0xd6dcdb, { roughness: 0.35, metalness: 0.45 }));
  const D = -Math.PI / 2;
  // Angles must fall as j rises for the skin to face outwards.
  skin(back, D + 1.05, D - 1.05, 6);
  skin(stripe, D + 1.45, D + 1.05, 2);
  skin(stripe, D - 1.05, D - 1.45, 2);
  skin(belly, D + TAU - 1.45, D + 1.45, SEG - 4);

  // Fins: flat blades in the plane of the leap, seen from both sides.
  const fin = b.g(s.mat('paintedMetal', 0x5a6862, { roughness: 0.5, metalness: 0.3 }));
  const at = (t: number, along: number, across: number): V3 => {
    const [x, y] = spine(t);
    const [tx, ty] = tangent(t);
    // `across` > 0 is towards the belly, < 0 towards the back.
    return [x + tx * along + ty * across, y + ty * along - tx * across, 0];
  };
  fin.poly([at(0.02, 0.3, 0), at(0, -1.5, -1.7), at(0, -0.8, 0), at(0, -1.5, 1.7)], true);
  fin.poly([at(0.5, 0.9, -1.1), at(0.5, -0.7, -1.15), at(0.5, -1.3, -2.05), at(0.5, 0.2, -1.75)], true);
  fin.poly([at(0.2, 0.3, -0.7), at(0.2, -0.25, -0.72), at(0.2, -0.45, -1.1)], true);
  fin.poly([at(0.42, 0.5, 1.1), at(0.42, -0.5, 1.15), at(0.42, -0.9, 1.9)], true);
  fin.poly([at(0.2, 0.35, 0.7), at(0.2, -0.4, 0.72), at(0.2, -0.75, 1.35)], true);
  for (const side of [-1, 1]) {
    const a = at(0.76, 0.4, 0.75);
    const c = at(0.76, -0.5, 0.8);
    const tip = at(0.76, -0.9, 1.7);
    fin.poly([[a[0], a[1], side * 0.5], [c[0], c[1], side * 0.5], [tip[0], tip[1], side * 1.05]], true);
    // Eye.
    const e = ringPoint(Math.round(N * 0.9), side === 1 ? -0.5 : Math.PI + 0.5, 1.02);
    b.g(s.mat('plain', 0x14140f, { roughness: 0.3 })).lathe(e[0], e[1] - 0.14, e[2], [[0, 0], [0.15, 0.07], [0.15, 0.21], [0, 0.28]], 8);
  }

  // Steel post up into the belly, name board, a table and planting.
  const [px, py] = spine(0.3);
  b.g(s.mat('paintedMetal', 0x3a3f44)).tube([-0.4, 1.7, 0], [px + 0.5, py - 0.2, 0], 0.22, 0.18, 8);
  const tables = b.g(s.mat('timber', 0x7a5a3c));
  const ty0 = s.gy(-7.5, 4);
  picnicTable(tables, -7.5, ty0, 4, 0.4);
  out.collider(f, -7.5, ty0 + 0.4, 4, 1.8, 0.8, 1.6);
  b.flush();
  const gravel = new Geo();
  s.drape(gravel, 0, 8, 16, 5, 0.05);
  gravel.flush(out, s.ground('gravel'), f);
  s.signStack(f, ['RAKAIA', 'HOME OF THE BIG SALMON'], 6.4, s.gy(6.4, 4.6) + 1.5, 4.6, 3, 0.62, { bg: '#1f4a36', fg: '#f2ead6', style: 'paint' }, -0.35, true);
  for (const sx of [-1.2, 1.2]) out.box(f, 6.4 + sx * Math.cos(0.35), s.gy(6.4, 4.6) + 0.4, 4.6 + sx * Math.sin(0.35), 0.1, 2.2, 0.1, s.mat('timber', 0x4f4338));
  for (const [x, z, k] of [[-3.6, -3.4, 'flax'], [3.8, -3, 'flax'], [0.6, -4.4, 'flax'], [-4.6, 1.2, 'bush'], [4.8, 1.6, 'bush']] as const) s.prop(k, x, z, x * 3, 1);
  s.light(3.5, 2, 5, 0xfff0d0, 1.4, 22);
};

/**
 * Country school: a 1950s open-air-style classroom block (a wall of windows to the sun, a covered way
 * behind), an office block with the flagpole, sometimes a second block, toilets and a bike shed, a sealed
 * court, a playground, a fenced pool and a field with rugby posts. The board at the gate carries the
 * placement's name.
 */
export const school: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const rng = s.rng;
  const wall = s.mat('weatherboard', rng.pick([0xf1ead8, 0xe6dcc0, 0xdfe6d8]));
  const roof = s.mat('corrugated', rng.pick([0x8b3027, 0x5c6268, 0x35603f]), { metalness: 0.3 });
  const trim = s.mat('plain', 0xf7f3e8, { roughness: 0.6 });
  const doors = [0x2f6fae, 0xc8322a, 0xe2b53a, 0x3a8a56].map((c) => s.mat('plain', c, { roughness: 0.5 }));
  const steel = s.mat('paintedMetal', 0x8a8f94);

  const classrooms = (cx: number, cz: number, len: number) => {
    const fa = s.at(cx, cz);
    const b = s.batch(fa);
    walls(out, fa, 0, 0, len, 3.3, 8, wall);
    gableRoof(out, b.g(wall), fa, 0, 3.3, 0, len, 8, 1.3, roof, 0.6);
    out.collider(fa, 0, 1.65, 0, len, 3.3, 8);
    // The window wall: big multi-pane windows with hoppers above.
    const n = Math.floor(len / 2.75);
    windowRow(out, fa, -len / 2 + 0.4, len / 2 - 0.4, n, 1.75, 4.03, 2.4, 1.7, m.windows('house'));
    windowRow(out, fa, -len / 2 + 0.4, len / 2 - 0.4, n, 2.95, 4.03, 2.4, 0.5, m.get('glass'));
    // Covered way and classroom doors on the other side.
    const fb = s.at(cx, cz, Math.PI);
    const bb = s.batch(fb);
    verandah(bb, roof, trim, -len / 2, len / 2, 4, 2.4, 3.1, 2.5, Math.round(len / 4.4));
    bb.g(s.mat('concrete')).box(0, 0.06, 5.2, len, 0.12, 2.4);
    const rooms = Math.round(len / 9);
    for (let i = 0; i < rooms; i++) {
      const x = -len / 2 + (len * (i + 0.5)) / rooms;
      bb.g(doors[i % doors.length]).box(x - 2.6, 1.05, 4.04, 0.95, 2.1, 0.08);
      out.quad(fb, x + 1, 2.2, 4.03, 3.4, 1, m.get('glass'));
    }
    bb.flush();
    b.flush();
  };
  classrooms(-4, 30, 44);
  if (rng.chance(0.65)) classrooms(-11, 12, 30);

  // Office and staffroom.
  {
    const fo = s.at(28, 30.5);
    const b = s.batch(fo);
    walls(out, fo, 0, 0, 12, 3.2, 7, wall);
    out.gable(fo, 0, 3.2, 0, 13, 8, 1.5, roof, 3.5);
    out.collider(fo, 0, 1.6, 0, 12, 3.2, 7);
    out.box(fo, -2, 1.05, 3.54, 1, 2.1, 0.08, doors[0]);
    b.g(roof).slab([-3.4, 2.4, 5.2], [-0.6, 2.4, 5.2], [-0.6, 2.75, 3.5], [-3.4, 2.75, 3.5], 0.07);
    for (const x of [-3.3, -0.7]) b.g(trim).post(x, 0, 5.05, 0.1, 2.4);
    windowRow(out, fo, 0, 5.6, 2, 1.8, 3.53, 2, 1.4, m.windows('house'));
    s.sign(fo, 'OFFICE', -2, 2.5, 3.55, 1.4, 4, { bg: '#f7f3e8', fg: '#22313a', style: 'block' });
    b.flush();
    s.light(26, 2.6, 36, LAMP_WARM, 1, 16);
  }

  // Toilets and bike shed.
  {
    const ft = s.at(11, 12);
    walls(out, ft, 0, 0, 6, 2.7, 4, s.mat('concrete', 0xcfc8b8));
    out.box(ft, 0, 2.85, 0, 6.6, 0.2, 4.6, roof);
    out.collider(ft, 0, 1.35, 0, 6, 2.7, 4);
    for (const [x, label] of [[-1.6, 'BOYS'], [1.6, 'GIRLS']] as const) {
      out.box(ft, x, 1, 2.04, 0.9, 2, 0.08, doors[x < 0 ? 0 : 1]);
      s.sign(ft, label, x, 2.3, 2.05, 1.1, 3.5, { bg: '#f7f3e8', fg: '#22313a', style: 'block' });
    }
    const fb = s.at(25, 10.5);
    const b = s.batch(fb);
    out.box(fb, 0, 0.9, -1.4, 10, 2.6, 0.12, wall);
    b.g(roof).slab([-5.2, 2.1, 1.6], [5.2, 2.1, 1.6], [5.2, 2.5, -1.6], [-5.2, 2.5, -1.6], 0.07);
    for (let x = -4.9; x <= 4.9; x += 2.45) b.g(steel).post(x, 0, 1.4, 0.08, 2.1);
    for (let x = -4; x <= 4; x += 1) b.g(steel).arch(x, 0.05, 0.2, 0.36, 0.4, 0.04, 0, Math.PI, 6);
    b.flush();
    out.collider(fb, 0, 1.1, -1.4, 10, 2.2, 0.2);
  }

  const main = s.batch();
  // Sealed court with netball hoops and four-square.
  {
    const tar = new Geo();
    s.drape(tar, 6, -6, 28, 16, 0.05);
    tar.flush(out, s.ground('asphalt'), f);
    const paint = new Geo();
    for (const [x0, z0, x1, z1] of [[-7, -13, 19, -13], [19, -13, 19, 1], [19, 1, -7, 1], [-7, 1, -7, -13], [1.7, -13, 1.7, 1], [10.3, -13, 10.3, 1]] as const) s.line(paint, x0, z0, x1, z1, 0.08);
    for (const [x0, z0, x1, z1] of [[-5, -4, -1, -4], [-3, -6, -3, -2], [-5, -6, -1, -6], [-5, -2, -1, -2], [-5, -6, -5, -2], [-1, -6, -1, -2]] as const) s.line(paint, x0, z0, x1, z1, 0.06);
    paint.flush(out, s.ground('plain', 0xe8e6da, -4), f);
    const g = main.g(steel);
    for (const x of [-7.3, 19.3]) {
      const y = s.gy(x, -6);
      g.tube([x, y - 0.3, -6], [x, y + 3.05, -6], 0.04, 0.04, 6);
      main.g(s.mat('paintedMetal', 0xc8322a)).lathe(x + (x < 0 ? 0.25 : -0.25), y + 3.05, -6, [[0.19, 0], [0.21, 0.02], [0.19, 0.04]], 8);
    }
  }

  // Playground: jungle gym, swings, slide and seesaw on a bark patch.
  {
    const bark = new Geo();
    s.drape(bark, -31, -4, 16, 14, 0.05);
    bark.flush(out, s.ground('sand', 0xa88a62), f);
    const y = s.gy(-31, -4);
    const g = main.g(s.mat('paintedMetal', 0x2f6fae));
    // Jungle gym: a 3 × 3 lattice of pipes.
    for (let i = 0; i <= 3; i++) {
      for (let j = 0; j <= 3; j++) {
        const x = -37 + i;
        const z = -9 + j;
        g.tube([x, y - 0.2, z], [x, y + 2.2, z], 0.03, 0.03, 4, false);
      }
      for (const h of [1.1, 2.2]) {
        g.tube([-37 + i, y + h, -9], [-37 + i, y + h, -6], 0.03, 0.03, 4, false);
        g.tube([-37, y + h, -9 + i], [-34, y + h, -9 + i], 0.03, 0.03, 4, false);
      }
    }
    out.collider(f, -35.5, y + 1.1, -7.5, 3, 2.2, 3);
    // Swings.
    const r = main.g(s.mat('paintedMetal', 0xc8322a));
    for (const x of [-30.5, -25.5]) for (const dz of [-1, 1]) r.tube([x, y - 0.2, -8 + dz], [x, y + 2.5, -8], 0.04, 0.04, 5, false);
    r.tube([-30.5, y + 2.5, -8], [-25.5, y + 2.5, -8], 0.04, 0.04, 5, false);
    const chain = main.g(s.mat('paintedMetal', 0x3a3f44));
    for (const x of [-29.3, -28, -26.7]) {
      for (const dx of [-0.22, 0.22]) chain.beam([x + dx, y + 2.5, -8], [x + dx, y + 0.55, -7.8], 0.02);
      chain.box(x, y + 0.52, -7.8, 0.5, 0.05, 0.2);
    }
    // Slide.
    const sl = main.g(s.mat('metal', 0xb9bdc0, { roughness: 0.3 }));
    sl.slab([-37.3, y + 0.1, 0.4], [-36.7, y + 0.1, 0.4], [-36.7, y + 2, -3.2], [-37.3, y + 2, -3.2], 0.04);
    for (const dx of [-0.3, 0.3]) g.beam([-37 + dx, y - 0.2, -4.2], [-37 + dx, y + 2.6, -3.3], 0.04);
    for (let k = 1; k < 6; k++) g.beam([-37.3, y + k * 0.36, -4.2 + k * 0.13], [-36.7, y + k * 0.36, -4.2 + k * 0.13], 0.03);
    // Seesaw.
    main.g(s.mat('timber', 0xe2b53a)).beam([-28.5, y + 0.35, 0.2], [-25.3, y + 0.75, 0.6], 0.22, 0.05);
    r.post(-26.9, y - 0.1, 0.4, 0.1, 0.62);
  }

  // Pool behind a tall fence, with a changing shed.
  {
    const y = s.gy(41, -4);
    out.box(f, 41, y - 0.35, -4, 17.4, 1, 10.4, s.mat('concrete', 0xd4d0c4));
    main.g(s.mat('glass', 0x4fa8c0, { roughness: 0.12 })).box(41, y + 0.12, -4, 14, 0.06, 7);
    const fence = main.g(steel);
    s.fence(fence, [[31.2, -10.6], [50.8, -10.6], [50.8, 2.6], [31.2, 2.6]], { height: 1.8, spacing: 2.45, rails: 3, post: 0.06, rail: [0.03, 0.03], closed: true });
    for (const [x, z, w, d] of [[41, -10.6, 19.6, 0.2], [41, 2.6, 19.6, 0.2], [31.2, -4, 0.2, 13.2], [50.8, -4, 0.2, 13.2]] as const) out.collider(f, x, y + 0.9, z, w, 1.8, d);
    const fc = s.at(41, 5.6);
    walls(out, fc, 0, 0, 5, 2.4, 3, wall);
    out.box(fc, 0, 2.5, 0, 5.6, 0.16, 3.6, roof);
    out.collider(fc, 0, 1.2, 0, 5, 2.4, 3);
    s.sign(fc, 'SCHOOL BATHS', 0, 1.9, 1.52, 2.6, 5, { bg: '#f7f3e8', fg: '#1f4a8a', style: 'block' });
  }

  // Field with rugby posts and a marked boundary.
  {
    const paint = new Geo();
    for (const [x0, z0, x1, z1] of [[-40, -60, 40, -60], [40, -60, 40, -24], [40, -24, -40, -24], [-40, -24, -40, -60], [0, -60, 0, -24], [-34, -60, -34, -24], [34, -60, 34, -24]] as const) s.line(paint, x0, z0, x1, z1, 0.12, 0.07);
    paint.flush(out, s.ground('plain', 0xe8e6da, -4), f);
    const g = main.g(s.mat('paintedMetal', 0xf4f1e8));
    for (const x of [-34, 34]) {
      const y = s.gy(x, -42);
      rugbyPosts(g, x, y, -42, Math.PI / 2, 6.5, 4.6);
      out.collider(f, x, y + 3, -42, 0.3, 6, 4.9);
    }
  }

  // Front fence, gate, name board and flagpole.
  {
    const g = main.g(trim);
    s.fence(g, [[-42, 66], [-3, 66]], { height: 1.0, spacing: 2.4, rails: 2, post: 0.1 });
    s.fence(g, [[3, 66], [42, 66]], { height: 1.0, spacing: 2.4, rails: 2, post: 0.1 });
    const title = s.label((p.name || 'District School').toUpperCase());
    s.signBoard(f, title, -11, s.gy(-11, 63.5) + 1.7, 63.5, 6, 5, { bg: '#1f4a36', fg: '#f2ead6', style: 'paint' });
    for (const sx of [-2.8, 2.8]) main.g(s.mat('timber', 0x4f4338)).post(-11 + sx, s.gy(-11 + sx, 63.5) - 0.2, 63.5, 0.12, 2.6);
    flagpole(g, 16, s.gy(16, 44), 44, 8);
    const path = new Geo();
    s.ribbon(path, [[0, 66], [0, 36]], 2, 0.05);
    path.flush(out, s.ground('footpath'), f);
  }
  main.flush();

  for (let z = -58; z <= 2; z += 12) s.prop('tree-pine', -47, z, z, 1.1);
  for (const [x, z] of [[-30, 50], [22, 54], [38, 48]] as const) s.prop('tree-oak', x, z, x, 0.9);
  s.light(-4, 2.6, 24, LAMP_WARM, 0.9, 20);
};

const CLUBS = [
  { name: 'TUSSOCK RANGERS', a: 0x1f4a36, b: 0xe2b53a },
  { name: "NOR'WEST ROVERS", a: 0x8a1f1f, b: 0xf2efe6 },
  { name: 'BRAIDED RIVER', a: 0x1f3a6a, b: 0x9ac0e0 },
  { name: 'PLAINS COUNTRY', a: 0x1c1c1c, b: 0xd9722a },
];
const hex = (color: number) => '#' + color.toString(16).padStart(6, '0');

/**
 * Rugby ground: a marked pitch (94 m between goal lines, 62 m wide) with posts and corner flags, clubrooms
 * with a verandah towards the pitch, a small covered stand, a scoreboard on the far touchline, two training
 * lights and a gravel car park. Club name and colours are invented and picked by the seed.
 */
export const rugbyField: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const club = CLUBS[s.seed % CLUBS.length];
  const name = s.label(club.name);
  const white = s.mat('paintedMetal', 0xf4f1e8);
  const colour = s.mat('plain', club.a, { roughness: 0.6 });
  const b = s.batch();
  const CZ = -7;

  // Mown pitch and its lines.
  const turf = new Geo();
  s.drape(turf, 0, CZ, 110, 66, 0.04, 0, 6);
  turf.flush(out, s.ground('grass', 0x8a9150, -1), f);
  const paint = new Geo();
  const line = (x0: number, z0: number, x1: number, z1: number) => s.line(paint, x0, z0, x1, z1, 0.12, 0.08);
  for (const z of [CZ - 31, CZ + 31]) line(-53, z, 53, z);
  for (const x of [-53, -47, -25, 0, 25, 47, 53]) line(x, CZ - 31, x, CZ + 31);
  for (const x of [-10, 10]) for (let z = CZ - 29; z < CZ + 29; z += 8) line(x, z, x, z + 4);
  for (const x of [-42, 42]) for (const z of [CZ - 26, CZ - 13, CZ, CZ + 13, CZ + 26]) line(x - 1.5, z, x + 1.5, z);
  paint.flush(out, s.ground('plain', 0xe8e6da, -4), f);
  const posts = b.g(white);
  for (const x of [-47, 47]) {
    const y = s.gy(x, CZ);
    rugbyPosts(posts, x, y, CZ, Math.PI / 2, 9, 5.6);
    out.collider(f, x, y + 4, CZ, 0.3, 8, 6);
    b.g(colour).tube([x, y, CZ - 2.8], [x, y + 1.8, CZ - 2.8], 0.16, 0.16, 8).tube([x, y, CZ + 2.8], [x, y + 1.8, CZ + 2.8], 0.16, 0.16, 8);
  }
  const flags = b.g(s.mat('cloth', club.b));
  for (const x of [-47, 0, 47]) {
    for (const z of [CZ - 31, CZ + 31]) {
      const y = s.gy(x, z);
      posts.tube([x, y, z], [x, y + 1.3, z], 0.015, 0.015, 4, false);
      flags.poly([[x, y + 1.3, z], [x + 0.3, y + 1.18, z], [x, y + 1.05, z]], true);
    }
  }

  // Clubrooms, verandah to the pitch.
  {
    const fc = s.at(-4, 36, Math.PI);
    const bc = s.batch(fc);
    const wall = s.mat('weatherboard', 0xf1ead8);
    const roof = s.mat('corrugated', club.a, { metalness: 0.3 });
    walls(out, fc, 0, 0, 20, 3.3, 9, wall);
    gableRoof(out, bc.g(wall), fc, 0, 3.3, 0, 20, 9, 1.9, roof, 0.4);
    verandah(bc, roof, s.mat('plain', 0xf7f3e8, { roughness: 0.6 }), -10, 10, 4.5, 2.8, 3.2, 2.5, 5);
    bc.g(s.mat('concrete')).box(0, 0.08, 5.9, 20, 0.16, 2.8);
    out.collider(fc, 0, 1.65, 0, 20, 3.3, 9);
    windowRow(out, fc, -9, -1, 3, 1.7, 4.53, 1.8, 1.3, m.windows('house'));
    out.box(fc, 1.6, 1.3, 4.54, 2.6, 1.5, 0.08, s.mat('paintedMetal', 0xc9ccd0));
    for (const [x, label] of [[5, 'HOME'], [8, 'VISITORS']] as const) {
      out.box(fc, x, 1.05, 4.54, 0.9, 2.1, 0.08, colour);
      s.sign(fc, label, x, 2.4, 4.55, 1.5, 4, { bg: '#f7f3e8', fg: hex(club.a), style: 'block' });
    }
    bc.flush();
    s.sign(fc, `${name} RUGBY FOOTBALL CLUB`, 0, 2.42, 7.34, 12, 16, { bg: hex(club.a), fg: hex(club.b), style: 'paint' });
    s.sign(fc, `${name} R.F.C.`, 0, 2.6, -4.54, 7, 7, { bg: hex(club.a), fg: hex(club.b), style: 'paint' }, Math.PI);
    windowRow(out, fc, -8, 8, 4, 1.8, -4.53, 1.4, 1.1, m.get('glass'), Math.PI);
    out.box(fc, -7.5, 5.4, 1.5, 0.8, 2.2, 0.8, s.mat('brick'));
    s.light(-4, 2.6, 30, LAMP_WARM, 1.1, 18);
  }

  // Small covered stand.
  {
    const fs = s.at(20, 31, Math.PI);
    const bs = s.batch(fs);
    const tiers = bs.g(s.mat('concrete'));
    const seats = bs.g(colour);
    for (let k = 0; k < 4; k++) {
      const top = 0.5 + k * 0.55;
      tiers.box(0, top / 2 - 0.4, 1.8 - k * 1.1, 16, top + 0.8, 1.1);
      seats.box(0, top + 0.26, 1.7 - k * 1.1, 15.4, 0.07, 0.42);
    }
    out.box(fs, 0, 1.6, -2.2, 16, 4.6, 0.2, s.mat('corrugated', 0xb9b4a8));
    bs.g(s.mat('corrugated', club.a, { metalness: 0.3 })).slab([-8.4, 4.6, 3], [8.4, 4.6, 3], [8.4, 4, -2.4], [-8.4, 4, -2.4], 0.1);
    for (const x of [-7.8, 0, 7.8]) bs.g(white).post(x, 0, 2.6, 0.12, 4.5);
    bs.flush();
    out.collider(fs, 0, 1, 0, 16, 2, 4.6);
  }

  // Scoreboard across the pitch, training lights, touchline rail.
  {
    const y = s.gy(0, CZ - 35);
    out.box(f, 0, y + 3.3, CZ - 35, 7, 2.8, 0.3, s.mat('timber', 0x1f2a24));
    for (const sx of [-2.8, 2.8]) out.box(f, sx, y + 0.8, CZ - 35, 0.22, 2.6, 0.22, s.mat('timber', 0x4f4338));
    s.signStack(f, ['HOME        VISITORS', '12                9'], 0, y + 3.3, CZ - 34.84, 6.6, 1.2, { bg: '#1f2a24', fg: '#f4f1e8', style: 'block' });
    out.collider(f, 0, y + 2.3, CZ - 35, 7, 4.6, 0.4);
    const pole = b.g(s.mat('paintedMetal', 0x8a8f94));
    const lamp = b.g(m.emitter(0xfff4d8, 'night'));
    for (const x of [-30, 30]) {
      const py = s.gy(x, 27.5);
      pole.tube([x, py - 0.4, 27.5], [x, py + 11, 27.5], 0.14, 0.09, 8);
      pole.box(x, py + 11, 27.4, 1.6, 0.12, 0.12);
      lamp.box(x - 0.5, py + 10.85, 27.2, 0.5, 0.3, 0.35).box(x + 0.5, py + 10.85, 27.2, 0.5, 0.3, 0.35);
      out.collider(f, x, py + 5, 27.5, 0.4, 10, 0.4);
    }
    s.light(0, 10, 20, 0xfff4d8, 1.6, 60);
    s.fence(posts, [[-52, 26], [-16, 26]], { height: 1.0, spacing: 3, rails: 1, post: 0.08, rail: [0.07, 0.05], proud: 0 });
    s.fence(posts, [[8, 26], [52, 26]], { height: 1.0, spacing: 3, rails: 1, post: 0.08, rail: [0.07, 0.05], proud: 0 });
  }

  // Scrum machine parked by the stand.
  {
    const y = s.gy(38, 29);
    const g = b.g(s.mat('paintedMetal', 0x3a3f44));
    g.box(38, y + 0.25, 29, 2.4, 0.2, 1.6).box(38, y + 0.7, 28.3, 2.4, 0.9, 0.12);
    const pads = b.g(colour);
    for (const dx of [-0.8, 0, 0.8]) pads.box(38 + dx, y + 0.85, 28.15, 0.55, 0.5, 0.25);
  }

  // Gravel car park and the sign at the gate.
  const gravel = new Geo();
  s.drape(gravel, -4, 50, 44, 14, 0.05);
  gravel.flush(out, s.ground('gravel'), f);
  b.flush();
  s.signBoard(f, `${name} R.F.C.`, 14, s.gy(14, 60) + 2, 60, 5, 5, { bg: hex(club.a), fg: hex(club.b), style: 'paint' });
  for (const sx of [-2.3, 2.3]) out.box(f, 14 + sx, s.gy(14 + sx, 60) + 0.8, 60, 0.12, 2.6, 0.12, s.mat('timber', 0x4f4338));
};
