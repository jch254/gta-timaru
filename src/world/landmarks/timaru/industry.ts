import { LAMP_WARM } from '../../scatter/util';
import { TAU } from '../../../core/math';
import type { LandmarkBuilder } from '../../../core/types';
import { gableRoof, Geo, Site, verandah, walls, windowRow } from '../rural/kit';
import { PROP } from '../rural/props';

const HIDES = [0x2a2623, 0x7a4a2a, 0xb08a5a, 0x5a3a26];
const FLEECE = [0xffffff, 0xf2ecdc, 0xe4dcc8, 0xd8cfb8];

/** Truck loading ramp: a race climbing from the ground at +z to deck height at -z, with rails. Local frame. */
function loadingRamp(deck: Geo, rails: Geo, x: number, z: number, y: number, length = 4.5, height = 1.2, width = 1.1): void {
  const z0 = z - length / 2;
  const z1 = z + length / 2;
  deck.slab([x - width / 2, y, z1], [x + width / 2, y, z1], [x + width / 2, y + height, z0], [x - width / 2, y + height, z0], 0.12);
  for (const side of [-1, 1]) {
    const sx = x + (side * width) / 2;
    for (const h of [0.5, 1.0]) rails.beam([sx, y + h, z1], [sx, y + height + h, z0], 0.05, 0.1);
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      rails.post(sx, y - 0.2, z1 + (z0 - z1) * t, 0.1, height * t + 1.3);
    }
  }
}

/**
 * Smithfield freezing works: a 90 × 48 m block of saw-tooth-roofed brick sheds, a windowless cold store with
 * a loading dock, the boiler house and its 46 m brick chimney, an office block, a water tower, covered
 * stock yards with a race up into the works, a gatehouse, and the staff car park left open and level on
 * the front side.
 */
export const smithfield: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const rng = s.rng;
  const brick = s.mat('brick');
  const iron = s.mat('corrugated', 0x9aa0a4, { metalness: 0.3 });
  const rusty = s.mat('corrugated', 0x8a6a58, { metalness: 0.3 });
  const concrete = s.mat('concrete');
  const steel = s.mat('paintedMetal', 0x5a6068);

  // ── Main sheds with a saw-tooth roof (teeth step along x, south lights glazed) ──
  {
    const fm = s.at(-25, -46);
    const b = s.batch(fm);
    walls(out, fm, 0, 0, 90, 9, 48, brick, 2.5);
    out.collider(fm, 0, 5.5, 0, 90, 11, 48);
    const roof = b.g(iron);
    const glass = b.g(s.mat('glass', 0x6f8a94, { roughness: 0.25 }));
    const infill = b.g(brick);
    for (let i = 0; i < 9; i++) {
      const x0 = -45 + i * 10;
      const xr = x0 + 7.4;
      const x1 = x0 + 10;
      roof.poly([[x0, 9, 24.2], [xr, 12.8, 24.2], [xr, 12.8, -24.2], [x0, 9, -24.2]]);
      glass.poly([[xr, 12.8, 24.2], [x1, 9, 24.2], [x1, 9, -24.2], [xr, 12.8, -24.2]]);
      infill.poly([[x0, 9, 24.02], [x1, 9, 24.02], [xr, 12.8, 24.02]]);
      infill.poly([[x1, 9, -24.02], [x0, 9, -24.02], [xr, 12.8, -24.02]]);
    }
    // Loading doors, high windows and painted lettering on the front wall.
    for (const x of [-32, -8, 30]) out.box(fm, x, 2.4, 24.05, 5, 4.8, 0.1, s.mat('paintedMetal', 0x55606a));
    windowRow(out, fm, -44, 44, 16, 6.9, 24.03, 2.6, 1.5, m.get('glass'));
    windowRow(out, fm, -23, 23, 8, 6.9, -45.03, 2.6, 1.5, m.get('glass'), -Math.PI / 2);
    s.sign(fm, 'SMITHFIELD FREEZING WORKS', 9, 4.6, 24.06, 26, 9, { bg: '#e9e4d6', fg: '#3a2a22', style: 'paint' });
    s.sign(fm, "NOR'WEST MEAT EXPORT CO. LTD", 9, 2.4, 24.06, 15, 9, { bg: '#e9e4d6', fg: '#3a2a22', style: 'block', border: false });
    // Roof vents.
    const vents = b.g(steel);
    for (const x of [-30, -10, 10, 30]) vents.lathe(x + 3.7, 11.2, -6, [[0.5, 0], [0.5, 1.6], [0.8, 1.7], [0, 2.1]], 8);
    b.flush();
  }

  // ── Cold store with a canopied loading dock ──
  {
    const fc = s.at(46, -48);
    walls(out, fc, 0, 0, 40, 14, 36, s.mat('plaster', 0xe9e4d6), 2.5);
    out.box(fc, 0, 14.2, 0, 40.6, 0.5, 36.6, concrete);
    out.collider(fc, 0, 7, 0, 40, 14, 36);
    out.box(fc, 0, 0.1, 19.6, 36, 2.4, 3.2, concrete);
    out.collider(fc, 0, 0.6, 19.6, 36, 1.2, 3.2);
    out.box(fc, 0, 5.2, 20.4, 38, 0.25, 5, iron);
    for (let i = 0; i < 5; i++) out.box(fc, -14 + i * 7, 2.9, 18.05, 3.4, 3.4, 0.1, s.mat('paintedMetal', 0xd8d2c2));
    s.sign(fc, 'COLD STORE No. 2', 0, 10.5, 18.04, 12, 8, { bg: '#e9e4d6', fg: '#22313a', style: 'block' });
    const b = s.batch(fc);
    for (let x = -18; x <= 18; x += 9) b.g(steel).post(x, 1.3, 22.6, 0.16, 3.9);
    b.flush();
  }

  // ── Boiler house and the chimney ──
  {
    const fb = s.at(30, -12);
    const b = s.batch(fb);
    walls(out, fb, 0, 0, 18, 10, 12, brick, 2);
    gableRoof(out, b.g(brick), fb, 0, 10, 0, 18, 12, 3, rusty, 0.2);
    out.collider(fb, 0, 5, 0, 18, 10, 12);
    windowRow(out, fb, -8, 8, 4, 6, 6.03, 2, 3.4, m.get('glass'));
    out.box(fb, 0, 2, 6.05, 4, 4, 0.1, s.mat('paintedMetal', 0x55606a));
    // Square plinth, then the tapering round stack with a corbelled cap.
    out.box(fb, 13.5, 1.5, 0, 6.4, 7, 6.4, brick);
    out.collider(fb, 13.5, 6, 0, 6.4, 12, 6.4);
    const stack = b.g(brick);
    stack.lathe(13.5, 0, 0, [[2.7, 5], [1.75, 44], [2.05, 44.5], [2.05, 45.6], [1.5, 45.6]], 16);
    b.g(s.mat('plain', 0x2a2420, { roughness: 1 })).lathe(13.5, 0, 0, [[1.5, 45.55], [0, 45.55]], 16);
    b.g(s.mat('plaster', 0xe9e4d6)).lathe(13.5, 0, 0, [[1.98, 36], [1.9, 39]], 16);
    b.flush();
  }

  // ── Offices and amenities ──
  {
    const fo = s.at(-8, -8);
    walls(out, fo, 0, 0, 30, 7, 10, brick);
    out.gable(fo, 0, 7, 0, 31, 11, 2.4, s.mat('rooftile', 0x7a4a3a), 5);
    out.collider(fo, 0, 3.5, 0, 30, 7, 10);
    for (const y of [1.9, 5.1]) windowRow(out, fo, -14, 14, 9, y, 5.03, 1.8, 1.5, m.windows('house'));
    out.box(fo, 0, 1.1, 5.05, 1.8, 2.2, 0.1, s.mat('timber', 0x4a2f20));
    out.box(fo, 0, 2.7, 6, 4, 0.2, 2, concrete);
    s.sign(fo, 'OFFICE · TIME KEEPER', 0, 3.3, 5.06, 4.5, 6, { bg: '#f2ead6', fg: '#3a2a22', style: 'paint' });
  }

  // ── Water tower ──
  {
    const ft = s.at(-50, -8);
    const b = s.batch(ft);
    const g = b.g(steel);
    for (const sx of [-2.2, 2.2]) {
      for (const sz of [-2.2, 2.2]) g.beam([sx * 1.25, -0.5, sz * 1.25], [sx, 14, sz], 0.3);
      for (const y of [4.5, 9.5]) {
        const k = 1.25 - 0.25 * (y / 14);
        g.beam([sx * k, y, -2.2 * k], [sx * k, y, 2.2 * k], 0.16).beam([-2.2 * k, y, sx * k], [2.2 * k, y, sx * k], 0.16);
      }
    }
    b.g(s.mat('corrugated', 0xa9adb0, { metalness: 0.4 })).lathe(0, 14, 0, [[0, 0], [3.3, 0], [3.3, 4.2], [0, 5.2]], 14);
    b.flush();
    out.collider(ft, 0, 7, 0, 5.4, 14, 5.4);
  }

  // ── Stock yards: timber pens, part roofed, with a covered race up into the works ──
  {
    const b = s.batch();
    const rails = b.g(s.mat('timber', 0x8a7a66));
    for (let i = 0; i <= 6; i++) s.fence(rails, [[-98 + i * 6, -18], [-98 + i * 6, 30]], { height: 1.3, spacing: 3, rails: 3, post: 0.14 });
    for (let j = 0; j <= 8; j++) s.fence(rails, [[-98, -18 + j * 6], [-62, -18 + j * 6]], { height: 1.3, spacing: 3, rails: 3, post: 0.14 });
    const y0 = s.gy(-80, -12);
    const cover = b.g(rusty);
    cover.slab([-98.6, y0 + 3.2, -5.6], [-61.4, y0 + 3.2, -5.6], [-61.4, y0 + 4.1, -18.6], [-98.6, y0 + 4.1, -18.6], 0.1);
    for (let x = -98; x <= -62; x += 6) for (const z of [-18, -6]) b.g(s.mat('timber', 0x6a5a48)).post(x, y0 - 0.2, z, 0.18, z === -18 ? 4.2 : 3.4);
    // Race climbing from the yards to the killing floor.
    const race = b.g(iron);
    race.beam([-66, y0 + 1.4, -18.6], [-66, y0 + 6.2, -21.9], 2.2, 2.4);
    // Truck ramps on the road side of the yards.
    const yr = s.gy(-80, 32);
    for (const x of [-89, -71]) {
      loadingRamp(b.g(s.mat('timber', 0x7a6a56)), rails, x, 32.4, yr);
      out.collider(f, x, yr + 0.5, 31.4, 1.3, 1.2, 2.6);
    }
    b.flush();
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 8; j++) {
        if (!rng.chance(0.3)) continue;
        const n = rng.int(3, 6);
        for (let k = 0; k < n; k++) s.prop(PROP.sheep, -95 + i * 6 + rng.range(-1.9, 1.9), -15 + j * 6 + rng.range(-1.9, 1.9), rng.range(0, TAU), rng.range(0.9, 1.05), rng.pick(FLEECE));
      }
    }
    for (const [x, z, w, d] of [[-80, -18.2, 36, 0.3], [-80, 30.2, 36, 0.3], [-98.2, 6, 0.3, 48], [-61.8, 6, 0.3, 48]] as const) out.collider(f, x, s.gy(x, z) + 0.7, z, w, 1.4, d);
  }

  // ── Staff car park: open and level, front side ──
  {
    const tar = new Geo();
    s.drape(tar, 10, 62, 76, 40, 0.05);
    s.ribbon(tar, [[0, 100], [0, 82]], 8, 0.05);
    tar.flush(out, s.ground('asphalt'), f);
    const paint = new Geo();
    for (const z of [47.4, 62.4, 76.6]) s.bays(paint, 10, z, 26, z > 70 ? Math.PI : 0);
    s.bays(paint, 10, 57.2, 26, Math.PI);
    paint.flush(out, s.ground('plain', 0xe8e6da, -4), f);
    const gravel = new Geo();
    s.ribbon(gravel, [[-28, 37], [-60, 37], [-80, 37]], 7, 0.05);
    s.ribbon(gravel, [[-4, 41], [-28, 37]], 7, 0.05);
    gravel.flush(out, s.ground('gravel'), f);
    s.signBoard(f, 'STAFF CAR PARK', -30.5, s.gy(-30.5, 80) + 2, 80, 3.6, 5, { bg: '#f2ead6', fg: '#3a2a22', style: 'block' }, Math.PI / 2);
    out.box(f, -30.5, s.gy(-30.5, 80) + 0.8, 80, 0.12, 2.6, 0.12, steel);
    s.prop('lamp', -30, 60, Math.PI / 2);
    s.prop('lamp', 50, 64, -Math.PI / 2);
    s.light(10, 6, 62, LAMP_WARM, 1.6, 55);
  }

  // ── Gatehouse, boom and front fence ──
  {
    const fg = s.at(7, 93);
    const b = s.batch(fg);
    walls(out, fg, 0, 0, 3.6, 2.8, 3.2, brick);
    out.box(fg, 0, 2.95, 0, 4.6, 0.2, 4.2, concrete);
    out.quad(fg, -1.82, 1.7, 0, 2.2, 1, m.windows('shop'), -Math.PI / 2);
    out.quad(fg, 0, 1.7, 1.62, 2.2, 1, m.windows('shop'));
    out.collider(fg, 0, 1.4, 0, 3.6, 2.8, 3.2);
    b.g(s.mat('paintedMetal', 0xd8d2c2)).post(-2.6, 0, 1.4, 0.2, 1.2);
    b.g(s.mat('paintedMetal', 0xc8322a)).beam([-2.6, 1.1, 1.4], [-10.6, 1.6, 1.4], 0.1);
    b.flush();
    s.signBoard(s.at(-16, 95), 'SMITHFIELD WORKS', 0, 2.9, 0, 9, 6, { bg: '#3a2a22', fg: '#f2ead6', style: 'paint' });
    const main = s.batch();
    const posts = main.g(steel);
    for (const sx of [-4, 4]) posts.post(-16 + sx, s.gy(-16 + sx, 95) - 0.3, 95, 0.16, 4);
    const fence = main.g(s.mat('metal', 0x8f959a, { roughness: 0.6 }));
    s.fence(fence, [[-58, 92], [-22, 92]], { height: 2, spacing: 3, rails: 2, post: 0.07, rail: [0.04, 0.04] });
    s.fence(fence, [[10, 92], [56, 92]], { height: 2, spacing: 3, rails: 2, post: 0.07, rail: [0.04, 0.04] });
    main.flush();
    s.light(2, 4, 94, LAMP_WARM, 1.2, 24);
  }
};

/**
 * Washdyke saleyards: a 72 × 54 m grid of timber pens with overhead drovers' walks, a twelve-sided covered
 * selling ring, an office and canteen, truck loading ramps and a gravel yard. Some pens hold stock.
 */
export const saleyards: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const rng = s.rng;
  const timber = s.mat('timber', 0x8a7a66);
  const b = s.batch();
  const rails = b.g(timber);

  // Pens: 12 × 9 of 6 m, with a drafting lane left open through the middle.
  for (let i = 0; i <= 12; i++) {
    const x = -50 + i * 6;
    s.fence(rails, [[x, -42], [x, -18]], { height: 1.4, spacing: 3, rails: 3, post: 0.14 });
    s.fence(rails, [[x, -12], [x, 12]], { height: 1.4, spacing: 3, rails: 3, post: 0.14 });
  }
  for (let j = 0; j <= 9; j++) s.fence(rails, [[-50, -42 + j * 6], [22, -42 + j * 6]], { height: 1.4, spacing: 3, rails: 3, post: 0.14 });
  for (const [x, z, w, d] of [[-14, -42.2, 72, 0.3], [-14, 12.2, 72, 0.3], [-50.2, -15, 0.3, 54], [22.2, -15, 0.3, 54]] as const) out.collider(f, x, s.gy(x, z) + 0.7, z, w, 1.4, d);

  // Drovers' walks over the pens.
  const planks = b.g(s.mat('timber', 0x6a5a48));
  for (const z of [-30, 0]) {
    const y = s.gy(-14, z) + 2.4;
    planks.box(-14, y, z, 72, 0.08, 1.1);
    for (const side of [-1, 1]) rails.box(-14, y + 1, z + side * 0.55, 72, 0.06, 0.05);
    for (let x = -50; x <= 22; x += 6) {
      rails.post(x, y - 2.6, z - 0.55, 0.12, 3.7);
      rails.post(x, y - 2.6, z + 0.55, 0.12, 3.7);
    }
    planks.slab([23.4, y - 2.4, z - 0.5], [23.4, y - 2.4, z + 0.5], [22, y, z + 0.5], [22, y, z - 0.5], 0.08);
  }

  // Stock in some of the pens.
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 9; j++) {
      if (j === 4) continue;
      const roll = rng.next();
      const cx = -47 + i * 6;
      const cz = -39 + j * 6;
      if (roll < 0.2) {
        const n = rng.int(3, 6);
        for (let k = 0; k < n; k++) s.prop(PROP.sheep, cx + rng.range(-2, 2), cz + rng.range(-2, 2), rng.range(0, TAU), rng.range(0.9, 1.05), rng.pick(FLEECE));
      } else if (roll < 0.25) {
        const hide = rng.pick(HIDES);
        for (let k = 0; k < 2; k++) s.prop(PROP.cow, cx + rng.range(-1.2, 1.2), cz - 1.2 + k * 2.4, rng.range(0, TAU), 1, hide);
      }
    }
  }

  // Truck ramps along the front of the pens.
  const yr = s.gy(-14, 14.4);
  for (const x of [-41, -23, -5, 13]) {
    loadingRamp(planks, rails, x, 14.4, yr);
    out.collider(f, x, yr + 0.5, 13.4, 1.3, 1.2, 2.6);
  }

  // Selling ring: twelve-sided, open-sided, tiered inside.
  {
    const fr = s.at(42, -14);
    const br = s.batch(fr);
    const a0 = Math.PI / 12;
    br.g(s.mat('weatherboard', 0xe9e0c8)).prism(0, 0, 0, [[9.6, -1], [9.6, 1.3], [9.3, 1.3], [9.3, 0]], 12, a0);
    br.g(s.mat('concrete')).prism(0, 0, 0, [[9.3, 0.5], [7.6, 0.5], [7.6, 0.95], [6, 0.95], [6, 0.05], [0, 0.05]], 12, a0);
    br.g(s.mat('corrugated', 0x8b3027, { metalness: 0.3 })).prism(0, 0, 0, [[10.6, 4.1], [2, 7.2], [2, 7.9], [2.6, 7.9], [0, 8.8]], 12, a0);
    br.g(s.mat('corrugated', 0x5a2620)).prism(0, 0, 0, [[0, 4.3], [10.5, 4.08]], 12, a0);
    const posts = br.g(s.mat('timber', 0xf2efe6));
    for (let i = 0; i < 12; i++) {
      const a = a0 + (TAU * i) / 12;
      posts.post(Math.cos(a) * 9.4, 1.3, Math.sin(a) * 9.4, 0.18, 2.9);
    }
    const ring: [number, number][] = [];
    for (let i = 0; i < 12; i++) ring.push([42 + Math.cos((TAU * i) / 12) * 4, -14 + Math.sin((TAU * i) / 12) * 4]);
    s.fence(rails, ring, { height: 1.3, spacing: 2.1, rails: 3, post: 0.12, closed: true });
    br.flush();
    out.collider(fr, 0, 0.65, -9.4, 19, 1.3, 0.4);
    out.collider(fr, 9.4, 0.65, 0, 0.4, 1.3, 19);
    out.collider(fr, 0, 0.65, 9.4, 19, 1.3, 0.4);
    s.sign(fr, 'SELLING RING', -9.75, 3.2, 0, 4.4, 5.5, { bg: '#f2ead6', fg: '#3a2a22', style: 'paint' }, -Math.PI / 2);
  }

  // Office and canteen.
  {
    const fo = s.at(42, 16, -Math.PI / 2);
    const bo = s.batch(fo);
    walls(out, fo, 0, 0, 12, 3, 6, s.mat('weatherboard', 0xe9e0c8));
    gableRoof(out, bo.g(s.mat('weatherboard', 0xe9e0c8)), fo, 0, 3, 0, 12, 6, 1.6, s.mat('corrugated', 0x8b3027, { metalness: 0.3 }));
    verandah(bo, s.mat('corrugated', 0x8b3027, { metalness: 0.3 }), s.mat('timber', 0xf2efe6), -6, 6, 3, 2, 2.9, 2.3, 4);
    out.collider(fo, 0, 1.5, 0, 12, 3, 6);
    windowRow(out, fo, -5, 1, 2, 1.6, 3.03, 1.5, 1.2, m.windows('house'));
    out.box(fo, 3.4, 1.05, 3.04, 0.9, 2.1, 0.08, s.mat('timber', 0x4a2f20));
    bo.flush();
    s.sign(fo, 'McALLISTER & DOWD · STOCK AND STATION AGENTS', 0, 3.7, 3.5, 9, 9, { bg: '#f2ead6', fg: '#1f4a36', style: 'paint' });
    s.sign(fo, 'CANTEEN', -3.4, 2.5, 3.04, 2, 4, { bg: '#1f4a36', fg: '#f2ead6', style: 'block' });
  }

  // Gravel yard and the sign at the gate.
  const gravel = new Geo();
  s.drape(gravel, 0, 32, 100, 26, 0.05);
  gravel.flush(out, s.ground('gravel'), f);
  b.flush();
  s.signBoard(f, 'WASHDYKE SALEYARDS', 0, s.gy(0, 52) + 2.8, 52, 8, 6, { bg: '#1f4a36', fg: '#f2ead6', style: 'paint' });
  for (const sx of [-3.6, 3.6]) out.box(f, sx, s.gy(sx, 52) + 1.2, 52, 0.16, 3.4, 0.16, timber);
  s.prop('lamp', -30, 20, 0);
  s.prop('lamp', 28, 22, 0);
  s.light(0, 6, 24, LAMP_WARM, 1.3, 45);
  s.light(42, 3.5, -14, LAMP_WARM, 1.2, 22);
};

/**
 * Phar Lap Raceway: a grass oval (about 646 m round the centre line, 16 m wide) inside white running rails,
 * a sand training track inside that, a raked grandstand with a cantilever roof, the totalisator, a birdcage,
 * stables, a judge's box at the winning post, and a gravel car park behind the gates.
 */
export const raceway: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const white = s.mat('paintedMetal', 0xf4f1e8);
  const b = s.batch();
  const CZ = -22;

  const oval = (r: number, step = 9): [number, number][] => {
    const pts: [number, number][] = [];
    const arc = Math.max(6, Math.round((Math.PI * r) / step));
    for (let i = 0; i <= arc; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / arc;
      pts.push([75 + Math.cos(a) * r, CZ + Math.sin(a) * r]);
    }
    for (let i = 0; i <= arc; i++) {
      const a = Math.PI / 2 + (Math.PI * i) / arc;
      pts.push([-75 + Math.cos(a) * r, CZ + Math.sin(a) * r]);
    }
    return pts;
  };

  // Course proper and the training track.
  const turf = new Geo();
  s.ribbon(turf, oval(55), 16, 0.05, true, 6);
  turf.flush(out, s.ground('grass', 0x6a8244, -1), f);
  const sand = new Geo();
  s.ribbon(sand, oval(41), 6, 0.05, true, 6);
  sand.flush(out, s.ground('sand', 0xc2b08a, -1), f);

  // Running rails.
  const rail = b.g(white);
  s.fence(rail, oval(63), { height: 1.1, spacing: 4, rails: 1, post: 0.08, rail: [0.1, 0.07], closed: true, proud: 0 });
  s.fence(rail, oval(47), { height: 1.1, spacing: 4, rails: 1, post: 0.08, rail: [0.1, 0.07], closed: true, proud: 0 });

  // Winning post, furlong pegs and the judge's box.
  const red = b.g(s.mat('paintedMetal', 0xc8322a));
  {
    const y = s.gy(20, CZ + 64);
    rail.post(20, y - 0.3, CZ + 64, 0.14, 4.6);
    red.at(20, y + 4, CZ + 64, 0, () => red.disc(0, 0, 0.08, 0.45, 12));
    red.at(20, y + 4, CZ + 64, Math.PI, () => red.disc(0, 0, 0.08, 0.45, 12));
    const pegs = oval(46.3, 40);
    for (let i = 0; i < pegs.length; i += 2) rail.post(pegs[i][0], s.gy(pegs[i][0], pegs[i][1]) - 0.2, pegs[i][1], 0.1, 1.9);
    const fj = s.at(27, CZ + 66.5, Math.PI);
    walls(out, fj, 0, 0, 2.6, 5.4, 2.6, s.mat('weatherboard', 0xf4f1e8));
    out.gable(fj, 0, 5.4, 0, 3.4, 3.4, 1, s.mat('corrugated', 0x35603f), 1.7);
    out.quad(fj, 0, 4.2, 1.32, 2.2, 1.2, m.windows('shop'));
    out.collider(fj, 0, 2.7, 0, 2.6, 5.4, 2.6);
  }

  // ── Grandstand, facing the course ──
  {
    const fs = s.at(0, 57, Math.PI);
    const bs = s.batch(fs);
    const concrete = s.mat('concrete', 0xd9d4c6);
    walls(out, fs, 0, -6.2, 44, 12.5, 1.6, concrete, 2);
    for (const side of [-1, 1]) walls(out, fs, side * 22.4, 0, 0.8, 9.5, 14, concrete, 2);
    const tiers = bs.g(concrete);
    const seats = bs.g(s.mat('timber', 0x2f5a44));
    for (let k = 0; k < 8; k++) {
      const top = 1.4 + k * 0.75;
      const z = 6 - k * 1.45;
      tiers.box(0, top / 2 - 0.75, z, 44, top + 1.5, 1.45);
      seats.box(0, top + 0.28, z - 0.2, 43, 0.08, 0.5);
    }
    out.collider(fs, 0, 2, 1, 44, 4, 12);
    out.collider(fs, 0, 6.2, -6.2, 44, 12.5, 1.6);
    // Cantilever roof and its columns, fascia sign towards the course.
    bs.g(s.mat('corrugated', 0xe9e6dc, { metalness: 0.3 })).slab([-23, 13.4, 8.2], [23, 13.4, 8.2], [23, 12.2, -7.2], [-23, 12.2, -7.2], 0.3);
    const steel = bs.g(s.mat('paintedMetal', 0x35603f));
    for (let x = -20; x <= 20; x += 10) {
      steel.post(x, 6.5, -4.6, 0.3, 5.8);
      steel.beam([x, 12.1, -6.6], [x, 13, 7.6], 0.2, 0.4);
    }
    // Members' box along the back.
    bs.g(s.mat('glass', 0x55707c, { roughness: 0.2 })).box(0, 10.2, -5.3, 30, 2, 0.1);
    bs.flush();
    s.sign(fs, 'PHAR LAP RACEWAY', 0, 12.9, 8.3, 16, 10, { bg: '#35603f', fg: '#f4f1e8', style: 'paint' });
    s.sign(fs, 'PHAR LAP RACEWAY', 0, 9, -7.03, 18, 9, { bg: '#f4f1e8', fg: '#35603f', style: 'paint' }, Math.PI);
    windowRow(out, fs, -20, 20, 8, 3, -7.03, 2, 1.4, m.get('glass'), Math.PI);
    s.light(0, 10, 50, 0xfff0d0, 1.6, 50);
  }

  // ── Totalisator ──
  {
    const ft = s.at(-52, 62, Math.PI);
    const bt = s.batch(ft);
    walls(out, ft, 0, 0, 30, 4.4, 8, s.mat('plaster', 0xf4f1e8));
    out.gable(ft, 0, 4.4, 0, 31, 9, 2, s.mat('corrugated', 0x35603f, { metalness: 0.3 }), 4);
    out.collider(ft, 0, 2.2, 0, 30, 4.4, 8);
    windowRow(out, ft, -14, 14, 12, 1.6, 4.03, 1.2, 1, m.windows('shop'));
    out.box(ft, 0, 0.95, 4.2, 28.4, 0.08, 0.5, s.mat('timber', 0x6a4a30));
    verandah(bt, s.mat('corrugated', 0x35603f, { metalness: 0.3 }), white, -15, 15, 4, 2.6, 3.9, 3, 6);
    bt.flush();
    s.sign(ft, 'TOTALISATOR', 0, 3.25, 4.04, 9, 9, { bg: '#f4f1e8', fg: '#1c1c1c', style: 'block', border: false });
    s.sign(ft, 'WIN · PLACE · QUINELLA', 0, 5.6, 2.3, 11, 8, { bg: '#1c1c1c', fg: '#f2d23a', style: 'block' });
  }

  // ── Birdcage (parade ring) and stables ──
  {
    const ring: [number, number][] = [];
    for (let i = 0; i < 16; i++) ring.push([52 + Math.cos((TAU * i) / 16) * 11, 62 + Math.sin((TAU * i) / 16) * 7]);
    s.fence(rail, ring, { height: 1.1, spacing: 2.2, rails: 2, post: 0.08, rail: [0.08, 0.05], closed: true });
    for (const z of [58, 70]) {
      const fb = s.at(96, z, Math.PI);
      const skin = s.mat('weatherboard', 0xe9e0c8);
      walls(out, fb, 0, 0, 38, 2.9, 4.6, skin);
      const bb = s.batch(fb);
      gableRoof(out, bb.g(skin), fb, 0, 2.9, 0, 38, 4.6, 1.2, s.mat('corrugated', 0x8b3027, { metalness: 0.3 }), 0.5);
      const doors = bb.g(s.mat('timber', 0x4a2f20));
      for (let i = 0; i < 10; i++) doors.box(-17.1 + i * 3.8, 1.1, 2.32, 1.3, 2.2, 0.06);
      bb.flush();
      out.collider(fb, 0, 1.45, 0, 38, 2.9, 4.6);
    }
  }

  // ── Results board in the infield ──
  {
    const y = s.gy(-14, 20);
    out.box(f, -14, y + 3.4, 20, 9, 3.2, 0.3, s.mat('timber', 0x1f2a24));
    for (const sx of [-3.6, 3.6]) out.box(f, -14 + sx, y + 0.8, 20, 0.25, 2.6, 0.25, s.mat('timber', 0x4f4338));
    s.sign(f, 'RESULTS  1st · 2nd · 3rd', -14, y + 3.4, 20.16, 8.4, 3, { bg: '#1f2a24', fg: '#f4f1e8', style: 'block' });
  }

  // ── Gates, ticket boxes and car park ──
  {
    const gravel = new Geo();
    s.drape(gravel, 0, 100, 120, 26, 0.05, 0, 6);
    s.ribbon(gravel, [[0, 87], [0, 72]], 7, 0.05);
    gravel.flush(out, s.ground('gravel'), f);
    const fg = s.at(0, 120);
    for (const side of [-1, 1]) {
      walls(out, fg, side * 5, 0, 1.2, 4.2, 1.2, s.mat('plaster', 0xf4f1e8));
      out.collider(fg, side * 5, 2.1, 0, 1.2, 4.2, 1.2);
      walls(out, fg, side * 8, -1, 2.2, 2.5, 2.2, s.mat('weatherboard', 0x35603f));
      out.gable(fg, side * 8, 2.5, -1, 2.8, 2.8, 0.9, s.mat('corrugated', 0xf4f1e8), 1.4);
      out.quad(fg, side * 8, 1.5, 0.12, 1.2, 0.8, m.windows('shop'));
      out.collider(fg, side * 8, 1.25, -1, 2.2, 2.5, 2.2);
    }
    out.box(fg, 0, 4.7, 0, 11.4, 1.5, 0.3, s.mat('plaster', 0x35603f));
    s.signBoard(fg, 'PHAR LAP RACEWAY', 0, 4.7, 0.1, 10, 8, { bg: '#35603f', fg: '#f4f1e8', style: 'paint' });
    const fence = b.g(white);
    s.fence(fence, [[-58, 118], [-10, 120]], { height: 1.2, spacing: 3, rails: 2, post: 0.1 });
    s.fence(fence, [[10, 120], [58, 118]], { height: 1.2, spacing: 3, rails: 2, post: 0.1 });
    s.light(0, 4, 116, LAMP_WARM, 1.2, 26);
  }
  b.flush();

  // Poplars behind the back straight, oaks by the stand.
  for (let x = -66; x <= 66; x += 12) s.prop('tree-poplar', x, CZ - 70, x, 0.9 + ((x * 7) % 5) * 0.04);
  s.prop('tree-oak', -26, 66, 1, 1);
  s.prop('tree-oak', 28, 76, 2, 1.1);
  s.prop('tree-oak', 76, 82, 3, 1);
};

