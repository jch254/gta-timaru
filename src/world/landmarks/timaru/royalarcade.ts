import * as THREE from 'three';
import type { LandmarkBuilder, SignOptions } from '../../../core/types';
import { CLOTHES, Interior } from '../interior';
import { Site, sub } from '../rural/kit';

/**
 * The Royal Arcade in 1995: the pedestrian lane from Stafford Street (east, local +z) up to Sophia Street
 * (west, local −z), lined with two-storey shops over cellars and bridged at first floor at its mid-point
 * (docs/research/11-timaru-landmarks.md section 6). It is mid-restoration: no glass roof yet (only the new
 * brackets for it on the parapets), scaffolding on part of the north side and at the Sophia end, a skip, mesh
 * fence panels, the builders' and council's boards, half the shops boarded up and the rest open as usual.
 *
 * Local frame: x across (north +x), z along the lane; the lane is 4 m wide and follows the ground, climbing
 * about 4.6 m from Stafford to Sophia on six straight ramps.
 */

const HALF = 27;
const LANE = 2;
const GROUND = 3.7;
/** Where one building ends and the next begins, Stafford end first. */
const BREAKS = [27, 16, 6, -6, -16, -27];

const BOOKS = [0x6a2a2a, 0x2a3a5a, 0x3a5a3a, 0xc8b890, 0x8a6a3a, 0xd8d0c0, 0x5a2a4a, 0x1c2a3a];
const WOOL = [0xe07aa8, 0xf0d070, 0x5ab0c8, 0xe8e2d8, 0x8a1f2a, 0x3f8f4a, 0xb8a0d8, 0xd8642a];
const BRASS = [0xd8b040, 0xc8c8cc, 0x8a6a3a];

type Trade = 'clothes' | 'clocks' | 'books' | 'wool';

interface Frontage {
  state: 'open' | 'boarded' | 'closed';
  name?: string;
  look?: SignOptions;
  trade?: Trade;
  wall: number;
  brick?: boolean;
  /** Lane to parapet. */
  h: number;
}

/** North side (+x), Stafford end first. */
const NORTH: Frontage[] = [
  { state: 'open', name: 'THE RAG TRADE', trade: 'clothes', look: { bg: '#8a1f1f', fg: '#f6edd0', style: 'paint' }, wall: 0xe4d6b8, h: 8.2 },
  { state: 'boarded', wall: 0xc9b48a, h: 7.8 },
  { state: 'closed', wall: 0xd8d0bc, brick: true, h: 8.6 },
  { state: 'open', name: 'THE DOG-EARED PAGE', trade: 'books', look: { bg: '#1f4a36', fg: '#f6edd0', style: 'paint' }, wall: 0xb8c4a8, h: 7.9 },
  { state: 'boarded', wall: 0xe0c89a, h: 8.1 },
];

/** South side (−x), Stafford end first. */
const SOUTH: Frontage[] = [
  { state: 'open', name: 'TICK TOCK WATCHMAKERS', trade: 'clocks', look: { bg: '#1d2a44', fg: '#e8d8a0', style: 'paint' }, wall: 0xd8cbb0, brick: true, h: 8.4 },
  { state: 'boarded', wall: 0xe8dcc4, h: 7.7 },
  { state: 'closed', wall: 0xcfc0a0, h: 8.6 },
  { state: 'open', name: 'KNIT ONE PURL ONE', trade: 'wool', look: { bg: '#f6edd0', fg: '#7a2a5a', style: 'script' }, wall: 0xd8b8a0, h: 8 },
  { state: 'boarded', wall: 0xc8c0b0, h: 7.9 },
];

const POSTERS = ['POST NO BILLS', 'CLOSED FOR RESTORATION', 'LIVE AT THE MILLSTONE · FRIDAY'];
const FASCIA_ASPECT = 4.8 / 0.46;

export const royalArcade: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const I = new Interior(out, f, s.seed);
  const glass = I.glass;

  // The lane follows the ground along its centre line, sampled every 9 m.
  const knots: number[] = [];
  for (let k = 0; k <= 6; k++) knots.push(s.gy(0, -HALF + 9 * k));
  const laneY = (z: number) => {
    const t = Math.min(6, Math.max(0, (z + HALF) / 9));
    const k = Math.min(5, Math.floor(t));
    return knots[k] + (knots[k + 1] - knots[k]) * (t - k) + 0.04;
  };

  const paving = s.mat('footpath', 0x9a958a);
  const drain = s.mat('concrete', 0x6a6660);
  const timber = s.mat('timber', 0x4a3a2a);
  const ply = s.mat('timber', 0xb89a6a);
  const tube = s.mat('metal', 0x9aa0a4, { roughness: 0.5 });
  const boards = s.mat('timber', 0xa88a5a);
  const darkMat = s.mat('plain', 0x1a1a1c);
  const bracket = s.mat('paintedMetal', 0x3a3f44);
  const tile = s.mat('plain', 0x2f4a3a);

  // ── Lane: paving on six ramps with a drainage channel down the middle ──
  for (let k = 0; k < 6; k++) {
    const z0 = -HALF + 9 * k;
    const z1 = z0 + 9;
    const y0 = laneY(z0);
    const y1 = laneY(z1);
    I.g(paving).slabUp([-LANE, y0, z0], [LANE, y0, z0], [LANE, y1, z1], [-LANE, y1, z1], 0.3);
    I.g(drain).slabUp([-0.15, y0 + 0.012, z0], [0.15, y0 + 0.012, z0], [0.15, y1 + 0.012, z1], [-0.15, y1 + 0.012, z1], 0.02);
    I.ramp(0, z0, 2 * LANE, y1 - y0, 9, 0, y0);
  }

  // ── Shops along both sides ──
  const display = (sx: number, zc: number, fl: number, trade: Trade) => {
    const D = new Interior(out, sub(f, 0, fl, 0), s.seed + Math.round(zc * 10) + sx * 7);
    const face = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    out.quad(sub(f, 0, fl, 0), sx * 3.39, 1.85, zc, 5.2, 3.7, D.paint(0xe8dcc8, 'plaster'), face);
    D.g(m.emitter(0xffe8c0, 'night')).box(sx * 2.75, 3.3, zc, 0.15, 0.15, 0.15);
    if (trade === 'clothes') {
      D.mannequin(sx * 2.8, zc - 1.7, face, CLOTHES[1]);
      D.mannequin(sx * 2.8, zc - 0.4, face, CLOTHES[9]);
      D.rack(sx * 2.95, zc + 0.85, 1.2, Math.PI / 2);
    } else if (trade === 'clocks') {
      D.g(D.paint(0x5a3a24, 'timber')).box(sx * 3.1, 0.95, zc - 1.7, 0.35, 1.9, 0.5);
      D.b.at(sx * 2.92, 1.55, zc - 1.7, face, () => D.g(D.paint(0xf2ead6)).disc(0, 0, 0, 0.17, 12));
      for (let k = 0; k < 4; k++) D.b.at(sx * 3.37, 1.5 + (k % 2) * 0.7, zc - 0.6 + k * 0.5, face, () => D.g(D.paint(BRASS[k % BRASS.length], 'metal')).disc(0, 0, 0, 0.16, 12));
      D.table(sx * 2.7, zc + 0.4, 1.2, 0.5, Math.PI / 2, BRASS);
    } else if (trade === 'books') {
      D.gondola(sx * 3.15, zc - 0.5, 3.6, face, { single: true, h: 1.6, shelves: 4, colors: BOOKS });
      D.table(sx * 2.55, zc + 0.4, 1, 0.5, Math.PI / 2, BOOKS);
    } else {
      D.gondola(sx * 3.15, zc - 0.5, 3.6, face, { single: true, h: 1.8, shelves: 5, colors: WOOL, fill: 0.95 });
      D.table(sx * 2.55, zc + 0.4, 1, 0.5, Math.PI / 2, WOOL);
    }
    D.flush();
  };

  let poster = 0;
  const building = (sx: 1 | -1, i: number, fr: Frontage) => {
    const z1 = BREAKS[i];
    const z0 = BREAKS[i + 1];
    const zc = (z0 + z1) / 2;
    const len = z1 - z0;
    const fl = laneY(zc);
    const base = Math.min(laneY(z0), laneY(z1)) - 1.6;
    const top = fl + fr.h;
    const wall = fr.brick ? s.mat('brick') : s.mat('plaster', fr.wall);
    const trim = s.mat('plaster', fr.brick ? 0xd8cbb0 : 0xefe6d2);
    const x = (u: number) => sx * u;
    const face = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    const sz0 = zc - 2.6;
    const sz1 = zc + 2.6;
    const open = fr.state === 'open';

    // Mass, with a 1.4 m deep display window let into the ground storey of an open shop.
    if (open) {
      const gh = fl + GROUND - base;
      out.box(f, x(4.5), base + gh / 2, (z0 + sz0) / 2, 5, gh, sz0 - z0, wall);
      out.box(f, x(4.5), base + gh / 2, (sz1 + z1) / 2, 5, gh, z1 - sz1, wall);
      out.box(f, x(5.2), base + gh / 2, zc, 3.6, gh, 5.2, wall);
      out.box(f, x(4.5), (fl + GROUND + top) / 2, zc, 5, top - fl - GROUND, len, wall);
      I.g(s.mat('timber', 0x7a5a3a)).box(x(2.7), (base + fl) / 2, zc, 1.4, fl - base, 5.2);
      display(sx, zc, fl, fr.trade!);
    } else out.box(f, x(4.5), (base + top) / 2, zc, 5, top - base, len, wall);
    out.collider(f, x(4.5), (base + top) / 2, zc, 5, top - base, len);

    // Shopfront.
    const t = I.g(trim);
    t.box(x(1.95), fl + 3.15, zc, 0.1, 0.6, 5.6);
    if (fr.name) s.sign(f, fr.name, x(1.89), fl + 3.15, zc, 4.8, FASCIA_ASPECT, { border: false, ...fr.look }, face);
    if (open) {
      const gz0 = sz0;
      const gz1 = sz1 - 1.15;
      const gzc = (gz0 + gz1) / 2;
      const zd = sz1 - 0.6;
      I.g(glass).box(x(2.06), fl + 1.625, gzc, 0.03, 2.25, gz1 - gz0).box(x(2.08), fl + 1.15, zd, 0.03, 2.3, 0.9).box(x(2.08), fl + 2.52, zd, 0.03, 0.44, 0.9);
      I.g(tile).box(x(2.03), fl + 0.25, gzc, 0.08, 0.5, gz1 - gz0);
      t.box(x(2.06), fl + 3.225, zc, 0.12, 0.95, 5.2);
      const fr2 = I.g(timber);
      for (const z of [gz0 + 0.04, gzc, gz1, zd - 0.47, zd + 0.47, sz1 - 0.05]) fr2.box(x(2.04), fl + 1.375, z, 0.08, 2.75, 0.07);
      fr2.box(x(2.04), fl + 0.5, gzc, 0.09, 0.06, gz1 - gz0).box(x(2.04), fl + 2.75, zc, 0.09, 0.06, 5.2).box(x(2.04), fl + 2.3, zd, 0.09, 0.05, 0.94);
    } else if (fr.state === 'boarded') {
      for (let k = 0; k < 4; k++) I.g(ply).box(x(1.97), fl + 1.35 - (k % 2) * 0.06, sz0 + 0.65 + k * 1.3, 0.04, 2.7 - (k % 2) * 0.12, 1.26);
      for (const k of [1, 3]) {
        const text = POSTERS[poster++ % POSTERS.length];
        s.sign(f, text, x(1.945), fl + 1.6, sz0 + 0.65 + k * 1.3, 1.1, 1.1 / 0.8, { bg: text === POSTERS[2] ? '#e5b52b' : '#f2ead6', fg: '#1c1c1c', style: 'block' }, face);
      }
    } else {
      I.g(s.mat('plain', 0xe8e6dc)).box(x(1.98), fl + 1.65, zc, 0.03, 2.3, 5);
      t.box(x(1.97), fl + 0.25, zc, 0.06, 0.5, 5.2);
      s.sign(f, 'TO LET · PH 03 684 2290', x(1.96), fl + 1.8, zc, 1.8, 6, { bg: '#f6edd0', fg: '#8a1f1f', style: 'block' }, face);
    }

    // Door to the rooms upstairs at one end, a cellar light at the other.
    const sgn = (i + (sx > 0 ? 0 : 1)) % 2 === 0 ? 1 : -1;
    const zd = zc + sgn * 3.7;
    const yd = laneY(zd);
    I.g(timber).box(x(1.97), yd + 1.1, zd, 0.06, 2.2, 1);
    I.g(glass).box(x(1.97), yd + 2.45, zd, 0.04, 0.4, 0.9);
    t.box(x(1.94), yd + 2.72, zd, 0.12, 0.12, 1.3);
    const zl = zc - sgn * 3.8;
    const yl = laneY(zl);
    t.box(x(1.98), yl + 0.28, zl, 0.06, 0.5, 1.1);
    out.quad(f, x(1.94), yl + 0.28, zl, 0.9, 0.35, darkMat, face);
    for (let k = -1; k <= 1; k++) I.g(bracket).box(x(1.93), yl + 0.28, zl + k * 0.25, 0.03, 0.35, 0.03);

    // First floor: sash windows, some boarded; string course, cornice, parapet.
    const n = Math.max(2, Math.floor(len / 2.8));
    for (let k = 0; k < n; k++) {
      const zk = z0 + ((k + 0.5) * len) / n;
      const shut = fr.state === 'boarded' && k % 2 === 1;
      out.quad(f, x(1.99), fl + 5.35, zk, 0.95, 1.7, shut ? ply : m.windows('house'), face);
      t.box(x(1.95), fl + 4.45, zk, 0.12, 0.1, 1.2).box(x(1.94), fl + 6.32, zk, 0.14, 0.18, 1.25);
    }
    t.box(x(1.95), fl + 3.82, zc, 0.12, 0.2, len);
    t.box(x(1.88), top - 0.75, zc, 0.24, 0.3, len);
    t.box(x(4.5), top + 0.06, zc, 5.1, 0.12, len);
    // New brackets for the glass canopy that is not up yet.
    for (let zk = -24; zk <= 24; zk += 4) {
      if (zk < z0 + 0.5 || zk > z1 - 0.5) continue;
      I.g(bracket).box(x(2.05), top + 0.3, zk, 0.12, 0.6, 0.12).box(x(1.8), top + 0.55, zk, 0.5, 0.1, 0.1);
    }

    // Street fronts at the two ends.
    const end = i === 0 ? HALF : i === BREAKS.length - 2 ? -HALF : 0;
    if (end !== 0) {
      const e = Math.sign(end);
      const yS = laneY(end);
      const yaw = e > 0 ? 0 : Math.PI;
      const zf = end + e * 0.01;
      if (fr.state === 'boarded') for (let k = 0; k < 3; k++) I.g(ply).box(x(3.1 + k * 1.3), yS + 1.35, end + e * 0.03, 1.26, 2.7, 0.04);
      else out.quad(f, x(4.5), yS + 1.6, zf, 4.2, 2.2, m.windows('shop'), yaw);
      t.box(x(4.5), yS + 3.15, end + e * 0.05, 5, 0.6, 0.1);
      if (fr.name) s.sign(f, fr.name, x(4.5), yS + 3.15, end + e * 0.11, 4.2, FASCIA_ASPECT, { border: false, ...fr.look }, yaw);
      for (const u of [3.3, 5.7]) out.quad(f, x(u), fl + 5.35, zf, 0.95, 1.7, m.windows('house'), yaw);
      t.box(x(4.5), top - 0.75, end + e * 0.08, 5, 0.3, 0.24);
      if (e > 0) {
        // Suspended verandah over the Stafford Street footpath.
        const yv = yS + 3.5;
        I.g(s.mat('corrugated', 0x9aa0a0)).slabUp([x(2.1), yv - 0.1, end + 2.6], [x(7), yv - 0.1, end + 2.6], [x(7), yv + 0.06, end], [x(2.1), yv + 0.06, end], 0.06);
        I.g(bracket).box(x(4.55), yv - 0.3, end + 2.6, 4.9, 0.45, 0.08);
        for (const u of [3, 6]) I.g(bracket).tube([x(u), yv + 2.3, end + 0.02], [x(u), yv, end + 2.45], 0.025, 0.025, 5);
      }
    }
  };
  NORTH.forEach((fr, i) => building(1, i, fr));
  SOUTH.forEach((fr, i) => building(-1, i, fr));

  // ── The first-floor bridge at the mid-point ──
  const fl0 = laneY(0);
  const bridge = s.mat('plaster', 0xe6d2a8);
  const bt = I.g(s.mat('plaster', 0xefe6d2));
  out.box(f, 0, fl0 + 5.7, 0, 2 * LANE, 3.6, 4, bridge);
  out.collider(f, 0, fl0 + 5.7, 0, 2 * LANE, 3.6, 4);
  for (const e of [-1, 1]) {
    for (const xw of [-0.95, 0.95]) {
      out.quad(f, xw, fl0 + 5.6, e * 2.01, 0.9, 1.6, m.windows('house'), e > 0 ? 0 : Math.PI);
      bt.box(xw, fl0 + 4.72, e * 2.03, 1.1, 0.1, 0.1);
    }
    bt.box(0, fl0 + 7.3, e * 2.06, 4, 0.25, 0.14).box(0, fl0 + 3.98, e * 2.04, 4, 0.16, 0.1);
  }
  I.g(s.mat('timber', 0x8a7a62)).box(0, fl0 + 3.88, 0, 2 * LANE, 0.04, 4);

  // ── Entrance arches with the name over them, at both ends ──
  const stone = s.mat('plaster', 0xe8dcc0);
  const name = { bg: '#1d2a44', fg: '#e8d8a0', style: 'paint', border: false } as const;
  for (const e of [1, -1]) {
    const zf = e * HALF;
    const cz = e * (HALF - 0.25);
    const yA = laneY(zf) + 3;
    const g = I.g(stone);
    g.arch(0, yA, cz, 2, 2.45, 0.5, 0, Math.PI, 12);
    const th0 = Math.acos(2 / 2.45);
    for (const sx of [-1, 1]) {
      for (let j = 0; j < 5; j++) {
        const a = th0 + ((Math.PI / 2 - th0) * j) / 5;
        const b = th0 + ((Math.PI / 2 - th0) * (j + 1)) / 5;
        const pa: [number, number] = [sx * 2.45 * Math.cos(a), yA + 2.45 * Math.sin(a)];
        const pb: [number, number] = [sx * 2.45 * Math.cos(b), yA + 2.45 * Math.sin(b)];
        for (const zz of [cz + 0.25, cz - 0.25]) g.poly([[pa[0], pa[1], zz], [pb[0], pb[1], zz], [pb[0], yA + 2.46, zz], [pa[0], yA + 2.46, zz]], true);
      }
    }
    g.box(0, yA + 3.25, cz, 4.9, 1.6, 0.5).box(0, yA + 4.15, cz, 5.2, 0.2, 0.7).box(0, yA + 2.3, cz, 0.4, 0.5, 0.6);
    out.collider(f, 0, yA + 3.25, cz, 4.9, 1.6, 0.5);
    s.sign(f, 'ROYAL ARCADE', 0, yA + 3.25, zf + e * 0.01, 3.8, 3.8 / 0.7, name, e > 0 ? 0 : Math.PI);
    s.sign(f, 'ROYAL ARCADE', 0, yA + 3.25, zf - e * 0.51, 3.8, 3.8 / 0.7, name, e > 0 ? Math.PI : 0);
  }

  // ── Restoration: scaffolding, skip, fence panels and the boards ──
  const scaffold = (sx: 1 | -1, za: number, zb: number, bays: number) => {
    const tg = I.g(tube);
    const bg = I.g(boards);
    const xIn = sx * 1.7;
    const xOut = sx * 0.85;
    const pitch = (zb - za) / bays;
    const lifts = [2, 4, 6].map((h) => Math.max(laneY(za), laneY(zb)) + h);
    const head = lifts[2] + 1.05;
    for (let k = 0; k <= bays; k++) {
      const z = za + k * pitch;
      const y0 = laneY(z);
      for (const xs of [xIn, xOut]) {
        tg.tube([xs, y0, z], [xs, head, z], 0.024, 0.024, 5, false);
        bg.box(xs, y0 + 0.02, z, 0.22, 0.04, 0.5);
        out.collider(f, xs, (y0 + head) / 2, z, 0.1, head - y0, 0.1);
      }
      for (const y of lifts) {
        tg.tube([xIn + sx * 0.12, y, z], [xOut - sx * 0.12, y, z], 0.024, 0.024, 5, false);
        I.g(bracket).box(xOut, y, z, 0.07, 0.07, 0.07);
      }
    }
    for (const y of lifts) {
      for (const xs of [xIn, xOut]) tg.tube([xs, y - 0.06, za - 0.15], [xs, y - 0.06, zb + 0.15], 0.024, 0.024, 5, false);
      tg.tube([xOut, y + 0.5, za], [xOut, y + 0.5, zb], 0.024, 0.024, 5, false).tube([xOut, y + 1, za], [xOut, y + 1, zb], 0.024, 0.024, 5, false);
      for (let k = 0; k < bays; k++) {
        // The first bay of the bottom lift is left open for the ladder.
        if (y === lifts[0] && k === 0) continue;
        const zc = za + (k + 0.5) * pitch;
        for (let b = 0; b < 4; b++) bg.box(xIn + ((xOut - xIn) * (b + 0.5)) / 4, y + 0.045, zc, 0.2, 0.04, pitch - 0.04);
        bg.box(xOut + sx * 0.02, y + 0.15, zc, 0.03, 0.15, pitch);
      }
    }
    for (let k = 0; k < bays; k += 2) tg.tube([xOut, laneY(za + k * pitch) + 0.3, za + k * pitch], [xOut, lifts[2], za + Math.min(bays, k + 2) * pitch], 0.024, 0.024, 5, false);
    // Ladder up to the first lift.
    const xl = (xIn + xOut) / 2;
    const yl = laneY(za + 1.9);
    for (const e of [-0.2, 0.2]) tg.beam([xl + e, yl, za + 1.9], [xl + e, lifts[0] + 1, za + 0.35], 0.04, 0.06);
    for (let r = 1; r < 9; r++) {
      const q = r / 9;
      tg.box(xl, yl + (lifts[0] + 1 - yl) * q, za + 1.9 - 1.55 * q, 0.4, 0.03, 0.03);
    }
    return lifts;
  };
  const north = scaffold(1, 3, 15, 5);
  scaffold(-1, -21.6, -14.4, 3);
  // The builders' board on the north scaffold's guard rail, facing the lane.
  I.g(ply).box(0.82, north[0] + 0.6, 9, 0.03, 1, 6);
  s.sign(f, 'ROYAL ARCADE RESTORATION · REOPENING 1996', 0.8, north[0] + 0.78, 9, 5.6, 5.6 / 0.55, { bg: '#1d2a44', fg: '#f2ead6', style: 'block' }, -Math.PI / 2);
  s.sign(f, 'PLAINS HERITAGE BUILDERS LTD · PH 03 688 5172', 0.8, north[0] + 0.33, 9, 5.6, 5.6 / 0.3, { bg: '#f0c33a', fg: '#1c1c1c', style: 'block', border: false }, -Math.PI / 2);

  // Mesh fence panels closing off the foot of the north scaffold.
  const mesh = s.mat('metal', 0xb8bcc0, { transparent: true, opacity: 0.35, doubleSided: true });
  const rail = s.mat('metal', 0x9aa0a4);
  for (const [za, zb] of [[3.2, 6.7], [6.8, 10.3]] as const) {
    const zc = (za + zb) / 2;
    const y = laneY(zc);
    I.g(mesh).box(0.6, y + 1.05, zc, 0.01, 1.9, zb - za);
    I.g(rail).tube([0.6, y + 0.1, za], [0.6, y + 2, za], 0.02, 0.02, 5).tube([0.6, y + 0.1, zb], [0.6, y + 2, zb], 0.02, 0.02, 5);
    I.g(rail).tube([0.6, y + 2, za], [0.6, y + 2, zb], 0.02, 0.02, 5, false).tube([0.6, y + 0.1, za], [0.6, y + 0.1, zb], 0.02, 0.02, 5, false);
    for (const z of [za, zb]) I.g(darkMat).box(0.6, y + 0.06, z, 0.22, 0.12, 0.6);
    out.collider(f, 0.6, y + 1, zc, 0.1, 2, zb - za);
  }
  s.sign(f, 'DANGER · HARD HAT AREA', 0.59, laneY(5) + 1.3, 5, 1.4, 2.8, { bg: '#f0c33a', fg: '#1c1c1c', style: 'block' }, -Math.PI / 2);

  // The skip, in front of the boarded shop at the Sophia end.
  {
    const zc = -23.8;
    const y = laneY(zc);
    const slope = Math.atan2(laneY(zc + 1) - laneY(zc - 1), 2);
    const g = I.g(s.mat('paintedMetal', 0xd9a02a));
    const rubble = I.g(s.mat('plain', 0x8a7a6a));
    g.with(new THREE.Matrix4().makeRotationX(-slope).setPosition(1.12, y, zc), () => {
      g.taper(0, 0, 0, 1.45, 2.6, 1.75, 3.6, 1.15);
      for (let k = 0; k < 6; k++) rubble.box(-0.5 + (k % 3) * 0.5, 1.2, -1 + Math.floor(k / 3) * 1.4, 0.5, 0.18, 0.7, k * 0.6);
    });
    I.g(ply).box(1.1, y + 1.45, zc + 0.5, 0.06, 0.06, 2.2, 0.3);
    out.collider(f, 1.12, y + 0.6, zc, 1.75, 1.2, 3.6);
  }

  // Council heritage notice on the wall at the Stafford end.
  I.g(s.mat('plain', 0xf4f2ee)).box(-1.97, laneY(25.6) + 1.6, 25.6, 0.04, 1.1, 1.6);
  s.signStack(f, ['TIMARU DISTRICT COUNCIL', 'HERITAGE NOTICE', 'RESTORATION WORK IN PROGRESS', 'PEDESTRIANS PLEASE TAKE CARE'], -1.94, laneY(25.6) + 1.6, 25.6, 1.5, 0.22, { bg: '#f4f2ee', fg: '#1d3a5a', style: 'block' }, Math.PI / 2);

  // Sandwich board outside the bookshop, which is open as usual.
  {
    const z = -10.2;
    const y = laneY(z);
    const g = I.g(s.mat('timber', 0xe8e2d0));
    for (const e of [-1, 1]) g.slabUp([1.45 + e * 0.05, y + 0.9, z - 0.3], [1.45 + e * 0.05, y + 0.9, z + 0.3], [1.45 + e * 0.3, y, z + 0.3], [1.45 + e * 0.3, y, z - 0.3], 0.02);
    const board = m.sign('SHOPS OPEN AS USUAL', { aspect: 0.55 / 0.7, bg: '#f2ead6', fg: '#1f4a36', style: 'paint' });
    // Each face leans in towards the hinge at the top, as the board does.
    for (const e of [-1, 1]) out.quad(sub(f, 1.45 + e * 0.175, y + 0.45, z, e > 0 ? Math.PI / 2 : -Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(-0.27)), 0, 0, 0.012, 0.55, 0.7, board, 0);
    out.collider(f, 1.45, y + 0.45, z, 0.6, 0.9, 0.6);
  }

  // Wall lanterns on brackets, and the two night lights: the Stafford mouth and under the bridge.
  const lamp = m.emitter(0xffd8a0, 'night');
  for (const [sx, z] of [[1, 20], [-1, 9], [1, -9], [-1, -25]] as const) {
    const y = laneY(z) + 3.1;
    I.g(bracket).box(sx * 1.8, y + 0.25, z, 0.4, 0.05, 0.05);
    I.g(lamp).box(sx * 1.62, y, z, 0.2, 0.3, 0.2);
  }
  s.light(0, laneY(25.5) + 3, 25.5, 0xffe8c8, 140, 16);
  s.light(0, fl0 + 3.4, 0, 0xffe8c8, 120, 16);
  I.flush();
};

