import { TAU } from '../../../core/math';
import type { Rng } from '../../../core/rng';
import type { LandmarkBuilder } from '../../../core/types';
// Registers 'bin' and the static parked cars.
import '../../props/extra';
import { LAMP_WARM } from '../../scatter/util';
import { bench, Geo, picnicTable, Site, type V3, walls } from '../rural/kit';

/** A clifftop edge point: where the ground starts to fall away, and which way is seaward. */
interface Edge {
  x: number;
  z: number;
  ox: number;
  oz: number;
  /** Foot of the bank on the same scan line, when there is one. */
  foot: number | null;
}

/** Scan lines across the point, north (−x) to south (+x). The first one is the top of the beach track. */
const LX0 = -38;
const LX1 = 34;
const STEP = 3;

/** Scanning seaward (−z) along a line of constant x: where the clifftop starts to drop, or null. */
function brink(s: Site, x: number): number | null {
  const start = s.gy(x, 48);
  for (let z = 48; z >= -52; z -= 0.75) {
    const up = s.gy(x, z + 3);
    if (up < start - 3) return null;
    if (s.gy(x, z) - up < -0.6) return z + 1.5;
  }
  return null;
}

/** Below a brink on the same line: where the bank flattens out onto the berm, or null. */
function footOf(s: Site, x: number, zb: number): number | null {
  const top = s.gy(x, zb + 1);
  for (let z = zb - 2; z >= -54; z -= 0.75) {
    const y = s.gy(x, z);
    if (y < top - 4 && y - s.gy(x, z + 2) > -0.25) return z;
  }
  return null;
}

/** Lumpy boulder: a jittered, flat-faceted ball squashed at the bottom (sits a third buried). */
function rock(g: Geo, rng: Rng, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, yaw: number): void {
  const SEG = 7;
  const RING = 4;
  const k: number[] = [];
  for (let i = 0; i < (RING - 1) * SEG; i++) k.push(rng.range(0.78, 1.15));
  const top = rng.range(0.75, 1.05);
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const pt = (i: number, j: number): V3 => {
    if (i === 0) return [cx, cy + ry * top, cz];
    if (i === RING) return [cx, cy - ry * 0.35, cz];
    const phi = (Math.PI * i) / RING;
    const th = (TAU * j) / SEG;
    const r = k[(i - 1) * SEG + (j % SEG)];
    const a = Math.sin(phi) * Math.cos(th) * rx * r;
    const b = Math.sin(phi) * Math.sin(th) * rz * r;
    return [cx + a * c + b * sn, cy + Math.max(-0.35, Math.cos(phi) * r) * ry, cz - a * sn + b * c];
  };
  for (let i = 0; i < RING; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = pt(i, j);
      const b = pt(i, j + 1);
      const cc = pt(i + 1, j + 1);
      const d = pt(i + 1, j);
      g.poly([a, b, cc]);
      g.poly([a, cc, d]);
    }
  }
}

/**
 * Pātītī Point (signed PATITI POINT in 1995): the grassy headland reserve south of the port. South Street ends
 * in a sealed car park behind a bluestone archway (Rotary plaque, 1990); a whale pot on a plinth recalls the
 * 1839 whaling station; a gravel path runs out to the lookout at the tip with a pipe railing along the cliff.
 * Below: a boulder revetment round the point, reef rocks, a derelict concrete shell covered in tags, and on the
 * north side a rough track down to South Beach.
 *
 * Front faces up South Street (local +z, inland); the sea is towards local −z. The cliff is found by sampling
 * the ground, so the railing, rocks and beach dressing only appear where the ground really drops.
 */
export const patitiPoint: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const rng = s.rng;
  const b = s.batch();
  const blue = s.mat('bluestone', 0x6c6f72);
  const concrete = s.mat('concrete', 0xb9b4a8);
  const basalt = s.mat('concrete', 0x55585a, { roughness: 0.95 });
  const timber = s.mat('timber', 0x6a5a48);
  const galv = s.mat('metal', 0x9ea3a4, { roughness: 0.55, metalness: 0.7 });
  const bronze = s.mat('metal', 0x7a5c32, { roughness: 0.45, metalness: 0.8 });
  const iron = s.mat('metal', 0x35302c, { roughness: 0.85, metalness: 0.45 });
  const seat = s.mat('timber', 0x7a6248);
  const wet = (lx: number, lz: number) => out.world.waterDepthAt(s.wx(lx, lz), s.wz(lx, lz));

  // ── Find the cliff ──
  const raw: { x: number; z: number }[] = [];
  for (let x = LX0; x <= LX1 + 1e-6; x += STEP) {
    const z = brink(s, x);
    if (z !== null && Math.hypot(x, z) <= 50) raw.push({ x, z });
  }
  const coast = raw.length >= 18;
  const line = coast ? raw : [];
  if (!coast) for (let x = LX0; x <= LX1 + 1e-6; x += STEP) line.push({ x, z: -12 });
  const zs = line.map((q, i) => (i === 0 || i === line.length - 1 ? q.z : (line[i - 1].z + 2 * q.z + line[i + 1].z) / 4));
  const edges: Edge[] = line.map((q, i) => {
    const a = Math.max(0, i - 1);
    const c = Math.min(line.length - 1, i + 1);
    const tx = line[c].x - line[a].x;
    const tz = zs[c] - zs[a];
    const l = Math.hypot(tx, tz) || 1;
    return { x: q.x, z: zs[i], ox: tz / l, oz: -tx / l, foot: coast ? footOf(s, q.x, q.z) : null };
  });
  /** Point `inward` metres back from an edge and `along` metres down the coast (north to south). */
  const off = (e: Edge, inward: number, along = 0): [number, number] => [e.x - e.ox * inward - e.oz * along, e.z - e.oz * inward + e.ox * along];
  const faceSea = (e: Edge) => Math.atan2(e.ox, e.oz);
  let tip = 0;
  edges.forEach((e, i) => {
    if (e.z + 0.001 * Math.abs(e.x) < edges[tip].z + 0.001 * Math.abs(edges[tip].x)) tip = i;
  });
  const lookout = edges[tip];

  // ── Car park: South Street ends at local (0, 60); a drive through the archway into two rows of bays ──
  const tar = new Geo();
  s.drape(tar, 0, 37.5, 40, 19, 0.05);
  s.drape(tar, 0, 52, 7.2, 10, 0.05);
  s.drape(tar, 0, 58.55, 9.5, 3.1, 0.05, 0, 3.1);
  tar.flush(out, s.ground('asphalt'), f);
  const patch = new Geo();
  s.drape(patch, -6, 37, 3.4, 2.2, 0.05, 0.3);
  s.drape(patch, 9, 33.5, 2, 1.6, 0.05, -0.2);
  s.drape(patch, 0.8, 49.5, 2.4, 3, 0.05);
  patch.flush(out, s.ground('asphalt', 0x3f3f3d, -3), f);
  const paint = new Geo();
  s.bays(paint, 0, 31.65, 13);
  s.bays(paint, -11.3, 43.35, 6, Math.PI);
  s.bays(paint, 11.3, 43.35, 6, Math.PI);
  paint.flush(out, s.ground('plain', 0xe2ded0, -4), f);
  // A couple of cars parked up looking at the sea.
  const tints = [0x7a2a22, 0x2f4a6a, 0xc8c2b0, 0x3d5a3a, 0x8a7a52];
  const taken = new Set<number>();
  for (let n = 0; n < 2; n++) {
    let i = rng.int(0, 12);
    while (taken.has(i)) i = (i + 5) % 13;
    taken.add(i);
    s.prop(rng.chance(0.3) ? 'car-parked-wagon' : 'car-parked', -15.6 + i * 2.6, 31.9, Math.PI + rng.range(-0.04, 0.04), 1, rng.pick(tints));
  }
  s.prop('car-parked', 11.3 + rng.int(-2, 2) * 2.6 + 1.3, 43.1, rng.range(-0.04, 0.04), 1, rng.pick(tints));

  // Treated-pine bollards along the seaward edge, with a gap for the path.
  {
    const posts = b.g(timber);
    for (let x = -19.6; x <= 19.61; x += 1.8) {
      if (Math.abs(x) < 1.4) continue;
      const y = s.gy(x, 27.5);
      posts.post(x, y - 0.2, 27.5, 0.18, 0.9);
    }
    for (const side of [-1, 1]) out.collider(s.at(side * 10.5, 27.5), 0, 0.35, 0, 18.6, 0.7, 0.2);
  }

  // Street lamp over the car park: the one light on the point at night.
  {
    const y = s.gy(-21.2, 37.5);
    s.prop('lamp', -21.2, 37.5, Math.PI / 2);
    s.light(-19, y + 7.1, 37.5, LAMP_WARM, 150, 20);
  }

  // ── Stone archway over the drive: rubble bluestone, a segmental arch, a small bronze plaque ──
  {
    const fa = s.at(0, 52);
    const a = s.batch(fa);
    for (const side of [-1, 1]) {
      walls(out, fa, side * 4.65, 0, 1.1, 3.75, 1.1, blue, 0.6);
      a.g(concrete).box(side * 4.65, 3.83, 0, 1.25, 0.16, 1.25);
      out.collider(fa, side * 4.65, 1.9, 0, 1.1, 3.8, 1.1);
    }
    // Inner faces at ±4.1, springing at 3 m, 1.1 m rise.
    const R = (4.1 * 4.1 + 1.1 * 1.1) / 2.2;
    const cy = 4.1 - R;
    const a0 = Math.atan2(3 - cy, 4.1);
    a.g(blue).arch(0, cy, 0, R, R + 0.75, 0.9, a0, Math.PI - a0, 10);
    out.collider(fa, 0, 4.2, 0, 8.2, 1.3, 0.9);
    a.g(bronze).box(4.65, 1.55, 0.565, 0.42, 0.3, 0.03);
    a.flush();
    s.sign(fa, 'PATITI POINT', 0, cy + R + 0.375, 0.465, 2.6, 2.6 / 0.38, { bg: '#d6cfbd', fg: '#2c2b28', style: 'block', border: false });
    for (const side of [-1, 1]) {
      s.prop('flax', side * 6.6, 51.2, side, 0.9);
      s.prop('flax', side * 7.4, 53.4, side * 2, 0.75);
    }
  }

  // ── Whale pot on a low plinth, by the path head ──
  {
    const ft = s.at(-8.5, 24.2, 0.15);
    const t = s.batch(ft);
    walls(out, ft, 0, 0, 2.3, 0.5, 2.3, blue, 0.6);
    t.g(concrete).box(0, 0.54, 0, 2.42, 0.08, 2.42);
    const pot = t.g(iron);
    pot.lathe(0, 0.58, 0, [[0, 0], [0.32, 0.04], [0.56, 0.18], [0.7, 0.42], [0.75, 0.72], [0.8, 0.76], [0.8, 0.84], [0.7, 0.84]], 16, 0, TAU, true);
    pot.lathe(0, 0.58, 0, [[0, 0.14], [0.3, 0.17], [0.52, 0.3], [0.64, 0.52], [0.7, 0.84]], 16, 0, TAU, true, true);
    for (const side of [-1, 1]) pot.box(side * 0.86, 1.36, 0, 0.14, 0.12, 0.22);
    t.flush();
    s.sign(ft, 'WHALE POT · WHALING STATION 1839', 0, 0.26, 1.165, 1.7, 1.7 / 0.24, { bg: '#6b5330', fg: '#e6d6a4', style: 'block', border: false });
    out.collider(ft, 0, 0.72, 0, 2.3, 1.44, 2.3);
    s.prop('bin', 2.4, 26.4, 0.3);
  }

  // ── Gravel path out to the lookout ──
  {
    const [ex, ez] = off(lookout, 5.6);
    const gravel = new Geo();
    s.ribbon(gravel, [[0, 28], [(0 + ex) / 2 + 2.5, (28 + ez) / 2], [ex, ez]], 1.8, 0.07, false, 3);
    gravel.flush(out, s.ground('gravel', 0xb2a58a), f);
    const pad = new Geo();
    const [px, pz] = off(lookout, 3.2);
    s.drape(pad, px, pz, 7, 4.4, 0.07, faceSea(lookout), 2.5);
    pad.flush(out, s.ground('concrete', 0xa9a498, -3), f);
  }

  // ── Railing along the cliff, from beside the beach track round the point ──
  if (coast) {
    const rail = b.g(galv);
    const pts = edges.slice(1).map((e) => off(e, 1.5));
    const ys = pts.map(([x, z]) => s.gy(x, z));
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      rail.tube([x, ys[i] - 0.2, z], [x, ys[i] + 1.08, z], 0.035, 0.035, 6);
      if (i === pts.length - 1) break;
      const [x1, z1] = pts[i + 1];
      for (const h of [0.55, 1.05]) rail.tube([x, ys[i] + h, z], [x1, ys[i + 1] + h, z1], 0.026, 0.026, 6, false);
      const len = Math.hypot(x1 - x, z1 - z);
      if (len > 3.2) {
        const mx = (x + x1) / 2;
        const mz = (z + z1) / 2;
        const my = (ys[i] + ys[i + 1]) / 2;
        rail.tube([mx, my - 0.2, mz], [mx, my + 1.08, mz], 0.035, 0.035, 6);
      }
      const mx = (x + x1) / 2;
      const mz = (z + z1) / 2;
      const ym = s.gy(mx, mz);
      const lo = Math.min(ys[i], ys[i + 1]) - ym;
      const hi = Math.max(ys[i], ys[i + 1]) - ym + 1.15;
      out.collider(s.at(mx, mz, Math.atan2(x1 - x, z1 - z)), 0, (lo + hi) / 2, 0, 0.12, hi - lo, len + 0.1);
    }
  }

  // ── Lookout: benches facing the sea, the council board, a bin ──
  {
    const seats = b.g(seat);
    for (const k of [-2, 2]) {
      const e = edges[Math.min(edges.length - 1, Math.max(0, tip + k))];
      const [x, z] = off(e, 3.6);
      const yaw = faceSea(e);
      bench(seats, x, s.gy(x, z), z, yaw);
      out.collider(s.at(x, z, yaw), 0, 0.45, 0, 1.8, 0.9, 0.5);
    }
    const [bx, bz] = off(lookout, 6.4, -3.4);
    const fb = s.at(bx, bz, faceSea(lookout) + Math.PI);
    const g = s.batch(fb);
    for (const side of [-1, 1]) g.g(timber).post(side * 0.88, -0.3, -0.07, 0.11, 2.3);
    g.g(s.mat('paintedMetal', 0x2f4a3a)).box(0, 1.35, 0, 1.9, 1.3, 0.05);
    g.g(timber).box(0, 2.06, -0.02, 2.1, 0.08, 0.3);
    g.flush();
    const board = { bg: '#2f4a3a', fg: '#efe8d2', style: 'block' as const, border: false };
    s.sign(fb, 'PATITI POINT', 0, 1.82, 0.03, 1.4, 1.4 / 0.2, board);
    s.signStack(
      fb,
      [
        'WHALING STATION 1839',
        'THE WELLER BROTHERS OF OTAGO SET UP A',
        'WHALING STATION ON THE POINT IN 1839.',
        'THE WHALE POT BY THE CAR PARK, USED FOR',
        'RENDERING BLUBBER, RECALLS THOSE DAYS.',
        'LOOK SOUTH TO THE NATURAL SHORELINE,',
        'NORTH TO THE COAST CHANGED BY THE PORT.',
        'RESERVE CHAMPIONED BY TIMARU SOUTH ROTARY',
      ],
      0,
      1.24,
      0.03,
      1.7,
      0.095,
      board,
    );
    out.collider(fb, 0, 1.0, -0.03, 1.95, 2.0, 0.2);
    const [nx, nz] = off(lookout, 6, 3.6);
    s.prop('bin', nx, nz, 0.4);
  }

  // ── The reserve: picnic table, tussock, flax and a few wind-cut shrubs back from the edge ──
  {
    const [tx, tz] = off(lookout, 15, 10);
    if (Math.abs(s.gy(tx, tz)) < 1.2) {
      const yaw = faceSea(lookout) + 0.4;
      picnicTable(b.g(seat), tx, s.gy(tx, tz), tz, yaw);
      out.collider(s.at(tx, tz, yaw), 0, 0.4, 0, 1.8, 0.8, 1.6);
    }
    edges.forEach((e, i) => {
      if (i === 0 || Math.abs(i - tip) <= 2) return;
      const [x, z] = off(e, rng.range(2.6, 6), rng.range(-1, 1));
      const kind = i % 4 === 1 ? 'flax' : i % 5 === 2 ? 'bush' : 'tussock';
      s.prop(kind, x, z, rng.range(0, TAU), kind === 'bush' ? rng.range(0.55, 0.75) : rng.range(0.7, 1.05));
    });
    for (const [x, z] of [[-22, 24], [22, 24], [-24, 47], [24, 47]] as const) s.prop('bush', x, z, rng.range(0, TAU), rng.range(0.6, 0.8));
  }

  // ── Below the cliff: revetment, reef rocks, the old concrete shell, the track to South Beach ──
  if (coast) {
    const stone = b.g(basalt);
    const nearEdge = (x: number) => edges.reduce((best, e) => (Math.abs(e.x - x) < Math.abs(best.x - x) ? e : best), edges[0]);

    // Derelict concrete building on the berm south of the tip.
    let shell: [number, number] | null = null;
    const se = nearEdge(25);
    if (se.foot !== null) {
      const e = { ...se, z: se.foot };
      const [cx, cz] = off(e, -4.2);
      const yaw = faceSea(se);
      const corners = [off({ ...e, x: cx, z: cz }, -2.2, -3), off({ ...e, x: cx, z: cz }, -2.2, 3)];
      if (Math.hypot(cx, cz) <= 46 && wet(cx, cz) === 0 && corners.every(([x, z]) => wet(x, z) === 0)) {
        shell = [cx, cz];
        const fb = s.at(cx, cz, yaw);
        const grey = s.mat('concrete', 0x9f9b90);
        walls(out, fb, 0, -1.9, 5.5, 2.7, 0.2, grey, 2.5);
        walls(out, fb, -2.65, 0, 0.2, 2.7, 3.6, grey, 2.5);
        // South wall with a window hole.
        walls(out, fb, 2.65, 0, 0.2, 1.0, 3.6, grey, 2.5);
        out.box(fb, 2.65, 2.35, 0, 0.2, 0.7, 3.6, grey);
        for (const z of [-1.4, 1.4]) out.box(fb, 2.65, 1.5, z, 0.2, 1.0, 0.8, grey);
        // Front wall with a doorway.
        walls(out, fb, -1.8, 1.9, 1.9, 2.7, 0.2, grey, 2.5);
        walls(out, fb, 1.55, 1.9, 2.4, 2.7, 0.2, grey, 2.5);
        out.box(fb, -0.25, 2.4, 1.9, 1.2, 0.6, 0.2, grey);
        out.collider(fb, 0, 1.0, -1.9, 5.5, 3.2, 0.2);
        out.collider(fb, -2.65, 1.0, 0, 0.2, 3.2, 3.6);
        out.collider(fb, 2.65, 1.0, 0, 0.2, 3.2, 3.6);
        out.collider(fb, -1.8, 1.0, 1.9, 1.9, 3.2, 0.2);
        out.collider(fb, 1.55, 1.0, 1.9, 2.4, 3.2, 0.2);
        const bits = s.batch(fb);
        for (const [x, z] of [[-1.6, -0.9], [0.9, -1.2], [1.8, 0.4]] as const) rock(bits.g(grey), rng, x, 0.05, z, rng.range(0.25, 0.45), rng.range(0.15, 0.3), rng.range(0.25, 0.4), rng.range(0, TAU));
        bits.flush();
        const tag = (text: string, x: number, y: number, z: number, w: number, aspect: number, fg: string, style: 'script' | 'block', yaw = 0) =>
          s.sign(fb, text, x, y, z, w, aspect, { bg: '#9f9b90', fg, style, border: false }, yaw);
        tag('SKUX', -1.85, 1.35, 2.015, 1.4, 2.6, '#b8322a', 'script');
        tag('HOONS', 1.6, 1.0, 2.015, 1.6, 3.2, '#2a2a2a', 'block');
        tag('TIMA RULES', 2.765, 0.65, 0.3, 2.6, 5, '#2f5f9f', 'script', Math.PI / 2);
        tag('03', 0, 1.4, -1.785, 1.4, 1.5, '#d8b02a', 'block');
      }
    }

    // Track down the bank on the north side: from the brink at the first scan line, slanting down towards the point.
    const top = edges[0];
    const low = edges.find((e) => Math.abs(e.x - (LX0 + 9)) < 0.1);
    let bottom: [number, number] | null = null;
    if (top.x === LX0 && low && low.foot !== null) {
      const T = off(top, 0.6);
      const B = off({ ...low, z: low.foot }, -1.5);
      bottom = B;
      const track = new Geo();
      s.ribbon(track, [T, B], 1.5, 0.07, false, 2);
      track.flush(out, s.ground('gravel', 0x8f8470, -3), f);
      const dx = B[0] - T[0];
      const dz = B[1] - T[1];
      const len = Math.hypot(dx, dz);
      const px = -dz / len;
      const pz = dx / len;
      const steps = b.g(s.mat('timber', 0x4f4236));
      for (let d = 1.2; d < len - 0.6; d += 1.1) {
        const x = T[0] + (dx * d) / len;
        const z = T[1] + (dz * d) / len;
        const a: V3 = [x + px * 0.8, s.gy(x + px * 0.8, z + pz * 0.8) + 0.06, z + pz * 0.8];
        const c: V3 = [x - px * 0.8, s.gy(x - px * 0.8, z - pz * 0.8) + 0.06, z - pz * 0.8];
        steps.beam(a, c, 0.18, 0.12);
      }
      // SOUTH BEACH sign at the top, facing back towards the car park.
      const [sx, sz] = off(top, 1.8, -1.2);
      const fs = s.at(sx, sz, faceSea(top) + Math.PI);
      out.box(fs, 0, 0.8, -0.05, 0.1, 2.2, 0.1, timber);
      s.signBoard(fs, 'SOUTH BEACH', 0, 1.65, 0.02, 1.3, 4, { bg: '#2f4a3a', fg: '#efe8d2', style: 'block' });
      out.collider(fs, 0, 0.8, -0.05, 0.12, 1.8, 0.12);
    }

    // Boulder revetment along the foot round the point.
    const clear = (x: number, z: number) => (!shell || Math.hypot(x - shell[0], z - shell[1]) > 5.5) && (!bottom || Math.hypot(x - bottom[0], z - bottom[1]) > 3.5);
    for (const e of edges) {
      if (e.x < -27 || e.foot === null) continue;
      const n = rng.int(1, 2);
      for (let k = 0; k < n; k++) {
        const [x, z] = off({ ...e, z: e.foot }, rng.range(-2.5, 1), rng.range(-1.3, 1.3));
        if (!clear(x, z) || Math.hypot(x, z) > 49 || wet(x, z) > 0.8) continue;
        const r = rng.range(0.6, 1.6);
        const ry = r * rng.range(0.55, 0.8);
        const yaw = rng.range(0, TAU);
        rock(stone, rng, x, s.gy(x, z) + ry * 0.2, z, r, ry, r * rng.range(0.7, 1), yaw);
        if (r > 1.1) out.collider(s.at(x, z, yaw), 0, ry * 0.4, 0, r * 1.5, ry * 1.2, r * 1.3);
      }
    }
    // Reef rocks off the tip (the left-hand reef break), half in the water.
    if (lookout.foot !== null) {
      const base = { ...lookout, z: lookout.foot };
      for (let k = 0; k < 10; k++) {
        const [x, z] = off(base, -rng.range(4, 18), rng.range(-12, 12));
        if (!clear(x, z) || Math.hypot(x, z) > 48 || wet(x, z) > 1) continue;
        const r = rng.range(0.5, 1.3);
        const ry = r * rng.range(0.45, 0.65);
        const yaw = rng.range(0, TAU);
        rock(stone, rng, x, s.gy(x, z), z, r, ry, r * rng.range(0.6, 1), yaw);
        if (r > 1.1) out.collider(s.at(x, z, yaw), 0, ry * 0.3, 0, r * 1.4, ry, r * 1.1);
      }
    }

    // South Beach: driftwood and the burnt-out ring of last weekend's fire, on the dry sand below the track.
    if (bottom) {
      const [bx, bz] = bottom;
      const yTop = s.gy(top.x, top.z + 2);
      const onSand = (x: number, z: number) =>
        Math.hypot(x, z) <= 48 && wet(x, z) === 0 && s.gy(x, z) < yTop - 5 && Math.abs(s.gy(x + 1, z) - s.gy(x - 1, z)) < 0.5 && Math.abs(s.gy(x, z + 1) - s.gy(x, z - 1)) < 0.5;
      const drift = b.g(s.mat('timber', 0xa69d8e, { roughness: 0.95 }));
      for (const [ox, oz, len, yaw] of [[-5, -3, 4.2, 0.4], [-11, 1.5, 2.8, 1.9], [2, -8, 3.4, -0.7], [-15, -5, 5.5, 1.2]] as const) {
        const x = bx + ox;
        const z = bz + oz;
        if (!onSand(x, z)) continue;
        const r = rng.range(0.14, 0.26);
        const hx = Math.sin(yaw) * len * 0.5;
        const hz = Math.cos(yaw) * len * 0.5;
        const a: V3 = [x - hx, s.gy(x - hx, z - hz) + r * 0.6, z - hz];
        const c: V3 = [x + hx, s.gy(x + hx, z + hz) + r * 0.6, z + hz];
        drift.tube(a, c, r, r * 0.7, 7);
        drift.tube([x + hx * 0.3, a[1] + r * 0.4, z + hz * 0.3], [x + hx * 0.3 + hz * 0.25, a[1] + r * 0.4 + 0.5, z + hz * 0.3 - hx * 0.25], r * 0.35, r * 0.15, 5);
      }
      const [fx, fz] = [bx - 6, bz - 1];
      if (onSand(fx, fz)) {
        const fy = s.gy(fx, fz);
        for (let k = 0; k < 9; k++) {
          const t = (TAU * k) / 9;
          rock(stone, rng, fx + Math.cos(t) * 0.75, fy, fz + Math.sin(t) * 0.75, rng.range(0.16, 0.24), rng.range(0.12, 0.18), rng.range(0.14, 0.22), rng.range(0, TAU));
        }
        const ash: V3[] = [];
        for (let k = 0; k < 8; k++) ash.push([fx + Math.cos((TAU * k) / 8) * 0.6, fy + 0.04, fz + Math.sin((TAU * k) / 8) * 0.6]);
        const char = b.g(s.mat('plain', 0x1f1c1a, { roughness: 1 }));
        char.polyUp(ash);
        char.tube([fx - 0.4, fy + 0.1, fz - 0.1], [fx + 0.35, fy + 0.12, fz + 0.2], 0.07, 0.05, 5);
        char.tube([fx - 0.1, fy + 0.1, fz + 0.4], [fx + 0.15, fy + 0.14, fz - 0.35], 0.06, 0.04, 5);
      }
    }
  }

  b.flush();
};
