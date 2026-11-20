import * as THREE from 'three';
import type { LandmarkBuilder, SignOptions } from '../../../core/types';
import { GOODS, Interior, type Mat } from '../interior';
import { bench, Site } from '../rural/kit';

/**
 * The Rink Mall: the arcade mall behind an Edwardian two-storey frontage on the east side of Stafford Street
 * (the Stafford Mall people remember, in the 1906-08 Rink Stables building; docs/research/11-timaru-landmarks.md
 * sections 3 and 7). A 5 m arcade runs back from the street door between glazed shop units to a skylit court
 * with planters and seats; the music-and-magic shop that sold the Theatre Royal tickets faces the court at the
 * far end. The ground drops away behind Stafford Street, so the shop floor is at footpath height on a tall
 * undercroft whose rear wall (loading dock, service doors, louvres) stands on the railway flats, with a stair
 * inside down to a back door.
 *
 * Local frame: floor at the footpath (ground at the middle of the frontage), x across the 34 m frontage, z
 * front (+20, the street) to back (−20).
 */

const HW = 17;
const HD = 20;
const CEIL = 3.4;
const PARAPET = 4.4;
const SILL = 0.45;
const GLAZE = 2.15;
const DOOR = 2.35;

const CDS = [0x1c1c22, 0xe8e2d8, 0x8a1f2a, 0x2f5fa8, 0xd8642a, 0x3f8f4a, 0x7a3f8f, 0xe5b52b, 0x5ab0c8];
const BOOKS = [0x6a2a2a, 0x2a3a5a, 0x3a5a3a, 0xc8b890, 0x8a6a3a, 0xd8d0c0, 0x5a2a4a, 0x1c2a3a];
const CHEMIST = [0xf4f2ee, 0x5ab0c8, 0xe07aa8, 0x2f5fa8, 0xf0d070, 0x3f8f4a, 0xe8e2d0];
const SHOES = [0x2a2420, 0x5a3a24, 0x1c1c1c, 0x8a5a3a, 0x6a6a72];
const JOKES = [0xe5b52b, 0xc8302a, 0x3f8f4a, 0xe07aa8, 0x2f5fa8, 0xf0d070, 0xf4f2ee];
const GOLD = [0xd8b040, 0xc8c8cc, 0xe8d8a0];
const FLOWERS = [0xe8302a, 0xf0d070, 0xe07aa8, 0xf4f2ee, 0x7a3f8f, 0xd8642a];

/**
 * Where the shopkeepers stand (placement frame, heading as everywhere: facing (sin h, cos h)), behind their
 * counters and facing the customers: the music shop's Theatre Royal booking counter, the milk bar, the tote
 * agency and the bargain shop. They stand on the mall floor, which is at footpath height (the ground at the
 * middle of the frontage), not on the terrain under the building.
 */
export const RINK_MALL_STAFF: { x: number; z: number; heading: number }[] = [
  { x: 2.6, z: -18.25, heading: 0 },
  { x: 10.5, z: 13.2, heading: 0 },
  { x: -9.8, z: 8, heading: Math.PI / 2 },
  { x: -6.5, z: 12.6, heading: 0 },
];
const [WIZARDS_TILL, MILK_BAR_TILL, TOTE_TILL, BARGAIN_TILL] = RINK_MALL_STAFF;

/** An opening: `at` along the wall's own axis (local x or z), `sill` and `h` from the floor. */
interface Hole {
  at: number;
  w: number;
  h: number;
  sill?: number;
  glass?: boolean;
}

const win = (at: number, w: number, sill = SILL, h = GLAZE): Hole => ({ at, w, sill, h, glass: true });
const door = (at: number, w: number, glass = false): Hole => ({ at, w, h: DOOR, glass });

/** Record browser: a waist-high bin with two rows of LPs standing in it, sleeves showing above the rim. */
function browser(I: Interior, x: number, z: number, len: number, yaw: number): void {
  const wood = I.paint(0x5a3e2a, 'timber');
  I.b.at(x, 0, z, yaw, () => {
    I.g(wood).box(0, 0.4, 0, len, 0.8, 0.9);
    const n = Math.max(1, Math.floor((len - 0.1) / 0.36));
    for (const row of [-0.22, 0.22]) {
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + 0.05 + ((i + 0.5) * (len - 0.1)) / n;
        I.g(I.paint(CDS[I.rng.int(0, CDS.length - 1)])).box(u, 0.86, row, 0.31, 0.32, 0.34);
      }
    }
  });
  I.collide(x, 0.5, z, len, 1, 0.9, yaw);
}

/** Glass-topped display counter with small pieces laid out on cloth. */
function glassCase(I: Interior, x: number, z: number, len: number, yaw: number, colors: readonly number[], d = 0.6): void {
  I.b.at(x, 0, z, yaw, () => {
    I.g(I.paint(0x3a2a22, 'timber')).box(0, 0.4, 0, len, 0.8, d);
    I.g(I.paint(0x1d2a44, 'cloth')).box(0, 0.81, 0, len - 0.1, 0.02, d - 0.1, 0, false);
    I.g(I.glass).box(0, 0.98, 0, len, 0.34, d);
    const n = Math.max(2, Math.floor(len / 0.3));
    for (let i = 0; i < n; i++) I.g(I.paint(colors[I.rng.int(0, colors.length - 1)], 'metal')).box(-len / 2 + 0.15 + (i * (len - 0.3)) / (n - 1), 0.84, i % 2 ? 0.1 : -0.1, 0.08, 0.05, 0.08);
  });
  I.collide(x, 0.58, z, len, 1.16, d, yaw);
}

/** Board on a wall (facing +z turned `yaw`, bottom at `y`) hung with packets or keys in a grid. */
function pegboard(I: Interior, x: number, y: number, z: number, w: number, h: number, yaw: number, colors: readonly number[], rows: number, cols: number): void {
  I.b.at(x, y, z, yaw, () => {
    I.g(I.paint(0xb89a72, 'timber')).box(0, h / 2, 0.01, w, h, 0.02);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!I.rng.chance(0.85)) continue;
        I.g(I.paint(colors[I.rng.int(0, colors.length - 1)])).box(-w / 2 + ((c + 0.5) * w) / cols, ((r + 0.5) * h) / rows, 0.05, (w / cols) * 0.6, (h / rows) * 0.7, 0.05);
      }
    }
  });
}

/** Milk bar table with a chair either side (along z). */
function cafeSet(I: Interior, x: number, z: number): void {
  const chrome = I.m.get('chrome');
  const vinyl = I.paint(0xb02a2a, 'cloth');
  I.g(I.paint(0xd8c8a0)).box(x, 0.74, z, 0.8, 0.03, 0.8);
  I.g(chrome).post(x, 0, z, 0.06, 0.72).box(x, 0.01, z, 0.45, 0.02, 0.45);
  for (const e of [-1, 1]) {
    const cz = z + e * 0.62;
    I.g(vinyl).box(x, 0.46, cz, 0.42, 0.06, 0.42).box(x, 0.75, cz + e * 0.2, 0.42, 0.5, 0.05);
    I.g(chrome).post(x, 0, cz, 0.04, 0.44);
  }
  I.collide(x, 0.45, z, 0.9, 0.9, 1.8);
}

/** Hydraulic salon chair, modelled facing +z. */
function salonChair(I: Interior, x: number, z: number, yaw: number): void {
  const chrome = I.m.get('chrome');
  const vinyl = I.paint(0x2a2a2e, 'cloth');
  I.b.at(x, 0, z, yaw, () => {
    I.g(chrome).post(0, 0, 0, 0.1, 0.45).box(0, 0.02, 0, 0.6, 0.04, 0.6);
    I.g(vinyl).box(0, 0.55, 0, 0.55, 0.14, 0.55).box(0, 0.95, -0.25, 0.55, 0.7, 0.1);
    for (const e of [-1, 1]) I.g(chrome).box(e * 0.3, 0.72, 0, 0.05, 0.05, 0.5);
  });
  I.collide(x, 0.6, z, 0.7, 1.2, 0.7, yaw);
}

/** Guitar hung on a wall facing +z turned `yaw`, body centre at height y. */
function guitar(I: Interior, x: number, y: number, z: number, yaw: number, color: number): void {
  I.b.at(x, y, z, yaw, () => {
    I.g(I.paint(color, 'timber')).box(0, 0, 0.06, 0.36, 0.46, 0.08).box(0, 0.16, 0.06, 0.3, 0.2, 0.08);
    I.g(I.paint(0x3a2a1e, 'timber')).box(0, 0.55, 0.06, 0.06, 0.62, 0.04).box(0, 0.92, 0.06, 0.09, 0.16, 0.04);
  });
}

/** Louvred vent on a wall facing +z turned `yaw`, bottom at `y`. */
function louvre(I: Interior, mat: Mat, back: Mat, x: number, y: number, z: number, yaw: number, w: number, h: number): void {
  const g = I.g(mat);
  I.b.at(x, y, z, yaw, () => {
    I.g(back).box(0, h / 2, 0.01, w, h, 0.02);
    g.box(0, h + 0.04, 0.05, w + 0.16, 0.08, 0.1).box(0, -0.04, 0.05, w + 0.16, 0.08, 0.1);
    for (const e of [-1, 1]) g.box(e * (w / 2 + 0.04), h / 2, 0.05, 0.08, h, 0.1);
    const n = Math.round(h / 0.12);
    for (let i = 0; i < n; i++) g.with(new THREE.Matrix4().makeRotationX(0.7).setPosition(0, (i + 0.5) * (h / n), 0.06), () => g.box(0, 0, 0, w, 0.015, 0.14));
  });
}

export const arcadeMall: LandmarkBuilder = function* (p, out) {
  const s = new Site(p, out);
  const world = out.world;
  // The floor is the footpath in front of the door, not the ground under the middle of the plot (which is
  // ten metres lower, on the bank down to the railway).
  const floorY = world.groundAt(s.wx(0, HD + 1), s.wz(0, HD + 1));
  const F = out.frameAt(p.x, floorY, p.z, p.heading);
  const I = new Interior(out, F, s.seed);
  const m = I.m;
  const gl = (x: number, z: number) => world.groundAt(s.wx(x, z), s.wz(x, z)) - floorY;
  const lowest = (x0: number, z0: number, x1: number, z1: number) => {
    let y = Infinity;
    for (let i = 0; i <= 12; i++) y = Math.min(y, gl(x0 + ((x1 - x0) * i) / 12, z0 + ((z1 - z0) * i) / 12));
    return y;
  };
  const inst = (kind: string, x: number, y: number, z: number, yaw: number, scale: number) => out.instance(kind, s.wx(x, z), floorY + y, s.wz(x, z), p.heading + yaw, scale);

  const glass = I.glass;
  const plaster = I.paint(0xece6d8, 'plaster');
  const alu = m.get('metal', { color: 0xb4b8bc });
  const chrome = m.get('chrome');
  const terrazzo = m.get('concrete', { color: 0xd9d1c3 });
  const facade = s.mat('plaster', 0xe2d6ba);
  const trim = s.mat('plaster', 0xc9b48e);
  const brick = s.mat('brick');
  const concrete = s.mat('concrete', 0xb8b2a4);
  const steel = s.mat('paintedMetal', 0x55606a);
  const iron = s.mat('paintedMetal', 0x2f4a3a);
  const timber = I.paint(0x8a6a4a, 'timber');
  const carton = I.paint(0xb08a5a);

  // How far the walls go down: to below the lowest ground along each of them.
  const yFront = Math.min(-0.3, lowest(-HW, HD + 0.2, HW, HD + 0.2)) - 0.4;
  const yLeft = Math.min(-0.3, lowest(-HW - 0.2, HD, -HW - 0.2, -HD)) - 0.5;
  const yRight = Math.min(-0.3, lowest(HW + 0.2, HD, HW + 0.2, -HD)) - 0.5;
  const yBack = Math.min(-0.3, lowest(-HW, -HD - 0.2, HW, -HD - 0.2)) - 0.5;
  // The rear stair and the loading dock only make sense on the low ground behind the bank.
  const yb = gl(9, -HD - 0.6);
  const deep = yb < -4;
  const gDock = gl(-8, -HD - 0.6);
  const dock = gDock < -6;

  // ── Walls ──
  const frame = (alongZ: boolean, line: number, q: Hole) => {
    const g = I.g(alu);
    const sill = q.sill ?? 0;
    const put = (u: number, y: number, du: number, dy: number) => (alongZ ? g.box(line, y, u, 0.12, dy, du) : g.box(u, y, line, du, dy, 0.12));
    put(q.at, sill + q.h - 0.03, q.w, 0.06);
    if (sill > 0) put(q.at, sill + 0.03, q.w, 0.06);
    for (const e of [-1, 1]) put(q.at + e * (q.w / 2 - 0.03), sill + q.h / 2, 0.06, q.h);
    if (q.w > 3.2) put(q.at, sill + q.h / 2, 0.05, q.h);
  };
  const run = (ax: number, az: number, bx: number, bz: number, holes: Hole[] = [], o: { y0?: number; top?: number; t?: number; inner?: Mat; outer?: Mat; frames?: boolean } = {}) => {
    const y0 = o.y0 ?? 0;
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const from = alongX ? ax : az;
    I.wall(ax, az, bx, bz, {
      y0,
      h: (o.top ?? CEIL) - y0,
      t: o.t ?? 0.25,
      inner: o.inner ?? plaster,
      outer: o.outer,
      holes: holes.map((q) => ({ along: Math.abs(q.at - from), width: q.w, sill: (q.sill ?? 0) - y0, height: q.h, glass: q.glass ? glass : undefined })),
    });
    if (o.frames !== false) for (const q of holes) frame(!alongX, alongX ? az : ax, q);
  };

  // Shell. Front on the footpath; sides and back carried down the bank to the low ground.
  const streetWindows = [win(-9.5, 11, 0.5, 2.6), win(9.5, 11, 0.5, 2.6)];
  run(-HW, 19.8, HW, 19.8, [...streetWindows, { at: 0, w: 5, h: 3.2 }], { y0: yFront, top: 3.75, t: 0.3, outer: facade, frames: false });
  for (const q of streetWindows) frame(false, 19.8, q);
  run(HW - 0.15, 19.95, HW - 0.15, -HD, [], { y0: yRight, top: PARAPET, t: 0.3, outer: concrete });
  run(-HW + 0.15, -HD, -HW + 0.15, 19.95, [], { y0: yLeft, top: PARAPET, t: 0.3, outer: concrete });
  const backHoles: Hole[] = [];
  if (dock) backHoles.push({ at: -8, w: 8, sill: gDock, h: 4.8 });
  if (deep) backHoles.push({ at: 9, w: 1.2, sill: yb, h: 2.2 });
  run(HW, -HD + 0.15, -HW, -HD + 0.15, backHoles, { y0: yBack, top: PARAPET, t: 0.3, outer: brick, frames: false });

  // Arcade: shopfronts both sides from the street door to the court.
  run(-2.5, -2.125, -2.5, 19.65, [door(13.4, 1.8), win(17, 4), win(7.7, 3.4), door(10.9, 1.4), win(0.5, 3.8), door(3.7, 1.2)]);
  run(2.5, 19.65, 2.5, -2.125, [door(13.6, 2), win(17.1, 4.2), win(7.6, 3.6), door(10.9, 1.4), win(0.6, 3.6), door(3.7, 1.2, true)]);
  // Court: shops on three sides, the music shop across the far end, the passage to the rear stair beside it.
  run(-8, -14.125, -8, -2.125, [win(-3.6, 2.6), door(-6.4, 1.6), win(-9.8, 2.6), door(-12.4, 1.4)]);
  run(8, -2.125, 8, -14.125, [win(-3.6, 2.6), door(-6.4, 1.6), win(-9.8, 2.6), door(-12.4, 1.4)]);
  run(-HW + 0.3, -2, -2.375, -2, [win(-5.25, 3.6, 0.8, 1.6)]);
  run(2.375, -2, HW - 0.3, -2, [win(5.25, 3.6, 0.8, 1.8)]);
  run(-8, -14, 5, -14, [win(-4.75, 5), { at: 0, w: 2.2, h: DOOR }, win(3, 2.8)]);
  run(-HW + 0.3, -14, -8, -14);
  run(8, -14, HW - 0.3, -14, [], { y0: deep ? yb - 0.4 : 0 });
  // Party walls between units and the stockrooms behind the arcade shops.
  run(-HW + 0.3, 12, -2.375, 12);
  run(2.375, 12, HW - 0.3, 12);
  run(-10.5, 5, -2.375, 5);
  run(2.375, 5, 10.5, 5);
  run(-10.5, -1.875, -10.5, 11.875);
  run(10.5, -1.875, 10.5, 11.875);
  run(-HW + 0.3, -8, -8, -8);
  run(8, -8, HW - 0.3, -8);
  run(-8, -14, -8, -HD + 0.3);
  run(5, -14, 5, -HD + 0.3);
  run(8, -14, 8, -HD + 0.3, deep ? [{ at: -16.9, w: 1.4, h: 2.2 }] : [], { y0: deep ? yb - 0.4 : 0 });

  // Floor (terrazzo, with the stairwell left open) and suspended ceiling with the court's skylight well.
  I.slab(0, 0, 0, 2 * HW - 0.3, 39.6, m.get('concrete', { color: 0x9a968c }), deep ? [[9.8, -19.7, 16.7, -14.125]] : [], 0.3, true, terrazzo);
  I.slab(0, CEIL, -0.1, 2 * HW - 0.3, 39.55, m.get('plaster', { color: 0xeeeae0 }), [[-6, -12.5, 6, -3.5]], 0.25);
  const tile = I.paint(0x6a4a3a);
  for (const sx of [-1, 1]) I.g(tile).box(sx * 2.1, 0.014, 8.7, 0.3, 0.008, 21.5, 0, false);
  const disc = (r: number, y: number, mat: Mat) => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 20; i++) pts.push([Math.cos((i / 20) * Math.PI * 2) * r, y, -8 - Math.sin((i / 20) * Math.PI * 2) * r]);
    I.g(mat).polyUp(pts);
  };
  disc(3, 0.012, tile);
  disc(2.4, 0.016, I.paint(0xe8dcc0));
  disc(0.8, 0.02, tile);
  yield;

  // ── Street frontage: the Edwardian building, its suspended verandah and the MALL sign ──
  const deco = I.g(trim);
  for (const x of [-16.4, -3.1, 3.1, 16.4]) deco.box(x, (yFront + 3.75) / 2, 20.03, 1.2, 3.75 - yFront, 0.16);
  for (const sx of [-1, 1]) I.g(I.paint(0x2f4a3a)).box(sx * 9.5, (yFront + 0.5) / 2, 20.0, 11, 0.5 - yFront, 0.1);
  deco.box(0, 3.87, 20.05, 2 * HW + 0.2, 0.25, 0.2);
  out.box(F, 0, 6.05, 19.8, 2 * HW, 4.6, 0.3, facade);
  for (const x of [-16.65, -10.2, -3.4, 3.4, 10.2, 16.65]) deco.box(x, 6, 20.03, 0.7, 4, 0.16);
  const office = s.m.windows('office');
  for (const c of [-13.3, -6.8, 0, 6.8, 13.3]) {
    for (const e of [-1.4, 1.4]) {
      const x = c + e;
      out.quad(F, x, 5.9, 19.97, 1.1, 2, office);
      deco.box(x, 4.83, 20.02, 1.4, 0.12, 0.16).box(x, 7.05, 20.03, 1.5, 0.22, 0.18);
      for (const sx of [-1, 1]) deco.box(x + sx * 0.62, 5.9, 20.0, 0.12, 2.1, 0.1);
    }
  }
  deco.box(0, 8.17, 20.1, 2 * HW + 0.3, 0.34, 0.4);
  out.box(F, 0, 8.8, 19.8, 2 * HW, 0.9, 0.3, facade);
  deco.box(0, 9.3, 19.8, 2 * HW + 0.2, 0.1, 0.42);
  for (const x of [-16.65, -10.2, -3.4, 3.4, 10.2, 16.65]) deco.box(x, 9.5, 19.85, 0.8, 0.4, 0.45);
  deco.box(0, 9.75, 19.8, 6.8, 0.9, 0.3).box(0, 10.28, 19.8, 7, 0.16, 0.4).box(0, 10.6, 19.8, 2.4, 0.5, 0.3);
  const plaque = { bg: '#e2d6ba', fg: '#5a4a32', style: 'paint', border: false } as const;
  s.sign(F, 'RINK BUILDINGS', 0, 8.8, 19.96, 6, 10, plaque);
  s.sign(F, 'A.D. 1907', 0, 9.75, 19.96, 2.8, 4, plaque);
  // Offices upstairs: a closed volume, lit windows on the back too (it rises above the mall roof).
  out.box(F, 0, 5.825, 15.9, 2 * HW - 0.3, 4.35, 7.5, facade);
  I.collide(0, 5.825, 15.9, 2 * HW - 0.3, 4.35, 7.5);
  for (const x of [-12, -6, 6, 12]) out.quad(F, x, 6, 12.13, 1.1, 1.6, office, Math.PI);
  out.gable(F, 0, 8, 15.9, 33.6, 7.4, 1.1, s.mat('corrugated', 0x8a5a48));

  // Mall entrance: glazed fanlight over a 5 m opening, its four glass doors folded back against the reveals.
  I.g(glass).box(0, 2.9, 19.8, 5, 0.6, 0.03);
  I.g(alu).box(0, 2.6, 19.8, 5, 0.08, 0.14).box(0, 3.17, 19.8, 5, 0.06, 0.14);
  for (const sx of [-1, 1]) {
    for (const k of [0, 1]) {
      const z = 19 - k * 1.25;
      I.g(glass).box(sx * 2.3, 1.3, z, 0.02, 2.5, 1.2);
      I.g(alu).box(sx * 2.3, 0.04, z, 0.05, 0.08, 1.2).box(sx * 2.3, 2.56, z, 0.05, 0.08, 1.2).box(sx * 2.3, 1.3, z + 0.6, 0.05, 2.5, 0.05);
    }
  }
  I.g(I.paint(0x3a3430, 'cloth')).box(0, 0.02, 18.2, 3, 0.02, 1.6, 0, false);

  // Suspended verandah on tie rods, 2.65 m over the footpath.
  I.g(s.mat('corrugated', 0x9aa0a0)).slabUp([-HW, 3.62, 22.6], [HW, 3.62, 22.6], [HW, 3.8, 19.95], [-HW, 3.8, 19.95], 0.06);
  I.g(I.paint(0xe8e2d0, 'timber')).box(0, 3.55, 21.28, 2 * HW, 0.03, 2.62);
  I.g(iron).box(0, 3.45, 22.6, 2 * HW, 0.6, 0.1);
  for (const x of [-15.5, -9.5, -4.2, 4.2, 9.5, 15.5]) I.g(iron).tube([x, 6.6, 20], [x, 3.75, 22.5], 0.025, 0.025, 5);
  I.collide(0, 3.68, 21.3, 2 * HW, 0.3, 2.6);
  s.sign(F, 'BARGAIN BIN', -9.5, 3.45, 22.66, 5.2, 10.4, { bg: '#b01e23', fg: '#f0c33a', style: 'block', border: false });
  s.sign(F, 'THE RINK MALL', 0, 3.45, 22.66, 4.6, 9.2, { bg: '#f2ead6', fg: '#7a1418', style: 'paint', border: false });
  s.sign(F, 'STARLIGHT MILK BAR', 9.5, 3.45, 22.66, 5.2, 10.4, { bg: '#f6f2e6', fg: '#1f6a8a', style: 'script', border: false });
  // The vertical MALL sign, a blade standing out from the upper facade, read up and down the street.
  I.g(s.mat('paintedMetal', 0x7a1418)).box(-3.4, 6.2, 20.6, 0.1, 4, 1.05);
  I.g(iron).box(-3.4, 8.3, 20.5, 0.08, 0.08, 1.1).box(-3.4, 4.1, 20.5, 0.08, 0.08, 1.1);
  s.signStack(F, ['M', 'A', 'L', 'L'], -3.4, 6.2, 20.6, 0.9, 0.95, { bg: '#7a1418', fg: '#fff2d0', style: 'neon' }, Math.PI / 2, true);

  // ── Roof: deck, plant, and the court's glazed lantern ──
  const deck = s.mat('concrete', 0x8a8780);
  const roof = (x0: number, z0: number, x1: number, z1: number) => out.box(F, (x0 + x1) / 2, 3.775, (z0 + z1) / 2, x1 - x0, 0.25, z1 - z0, deck);
  roof(-16.85, -19.85, 16.85, -12.5);
  roof(-16.85, -3.5, 16.85, 12.15);
  roof(-16.85, -12.5, -6, -3.5);
  roof(6, -12.5, 16.85, -3.5);
  out.box(F, 10, 4.4, 4, 2.2, 1, 1.4, s.mat('paintedMetal', 0xb8bcb4));
  out.box(F, -11, 4.3, -16, 1.6, 0.8, 1.2, s.mat('paintedMetal', 0xb8bcb4));
  I.g(concrete).box(0, 3.8, -12.65, 12.3, 0.8, 0.3).box(0, 3.8, -3.35, 12.3, 0.8, 0.3).box(-6.15, 3.8, -8, 0.3, 0.8, 9).box(6.15, 3.8, -8, 0.3, 0.8, 9);
  I.g(glass).box(0, 4.75, -12.65, 12, 1.1, 0.03).box(0, 4.75, -3.35, 12, 1.1, 0.03).box(-6.15, 4.75, -8, 0.03, 1.1, 9).box(6.15, 4.75, -8, 0.03, 1.1, 9);
  for (let i = 0; i <= 8; i++) for (const z of [-12.65, -3.35]) I.g(alu).box(-6 + i * 1.5, 4.75, z, 0.06, 1.1, 0.06);
  for (let i = 1; i < 6; i++) for (const x of [-6.15, 6.15]) I.g(alu).box(x, 4.75, -12.5 + i * 1.5, 0.06, 1.1, 0.06);
  I.g(alu).box(0, 5.32, -12.65, 12.4, 0.08, 0.1).box(0, 5.32, -3.35, 12.4, 0.08, 0.1).box(-6.15, 5.32, -8, 0.1, 0.08, 9.4).box(6.15, 5.32, -8, 0.1, 0.08, 9.4);
  out.gable(F, 0, 5.36, -8, 12.4, 9.4, 1.3, m.get('glass', { color: 0xd4e2e6, transparent: true, opacity: 0.3, doubleSided: true }));
  I.collide(0, 5.45, -8, 12.3, 0.2, 9.3);
  yield;

  // ── Rear elevation: concrete frame and brick on the railway side, louvres, service doors, dock, back door ──
  const col = I.g(concrete);
  for (const x of [-16.55, -12.35, -3.65, 3, 12.4, 16.55]) col.box(x, (yBack + PARAPET) / 2, -20.1, 0.6, PARAPET - yBack, 0.2);
  col.box(0, -0.15, -20.08, 2 * HW, 0.6, 0.16).box(0, PARAPET - 0.12, -20.08, 2 * HW, 0.24, 0.2);
  const brown = s.mat('paintedMetal', 0x6a5a48);
  const dark = I.paint(0x1c1c1e);
  for (const [x, w] of [[-15, 1.4], [0.9, 1.4], [6.2, 1.4], [11.4, 1]] as const) louvre(I, brown, dark, x, gl(x, -20.5) + 2.4, -20, Math.PI, w, 0.9);
  for (const x of [-1, 14.4]) {
    const y = gl(x, -20.5);
    I.g(steel).box(x, y + 1.1, -20.03, 1, 2.2, 0.06);
    col.box(x, y + 2.3, -20.12, 1.3, 0.18, 0.24);
  }
  s.sign(F, 'THE RINK MALL', -8, 1.8, -20.04, 7.4, 7.4, { bg: '#f2ead6', fg: '#7a1418', style: 'block' }, Math.PI);
  for (const x of [-14, 7.6]) I.g(steel).tube([x, PARAPET - 0.2, -20.12], [x, gl(x, -20.3) - 0.1, -20.12], 0.05, 0.05, 6);
  if (dock) {
    const y0 = gDock - 0.5;
    const top = gDock + 4.8;
    const bay = { y0, top, t: 0.3, inner: concrete, outer: concrete, frames: false };
    run(-12, -19.85, -12, -16.5, [], bay);
    run(-4, -16.5, -4, -19.85, [], bay);
    run(-4, -16.5, -12, -16.5, [], bay);
    I.g(concrete).box(-8, top + 0.15, -18.2, 8.3, 0.3, 3.6);
    I.solid(concrete, -8, (y0 + gDock + 1.2) / 2, -18.25, 7.7, gDock + 1.2 - y0, 3.2);
    I.g(s.mat('corrugated', 0x8f959a)).box(-8, gDock + 2.9, -16.68, 6.2, 3.4, 0.06);
    for (const x of [-10.5, -5.5]) I.g(dark).box(x, gDock + 0.8, -19.92, 0.25, 0.5, 0.15);
    s.sign(F, 'GOODS INWARDS · NO PARKING', -8, top + 0.6, -20.04, 4.4, 8, { bg: '#f0c33a', fg: '#1c1c1c', style: 'block' }, Math.PI);
  }

  // ── Rear stair: four flights in a scissor round a solid core, from the court passage down to the back door ──
  if (deep) {
    const step = -yb / 4;
    const lv = [0, -step, -2 * step, -3 * step, yb];
    const conc = m.get('concrete', { color: 0x8a8680 });
    for (let k = 0; k < 4; k++) {
      if (k % 2 === 0) I.stairs(15, -14.9, 1.5, step, 5.2, -Math.PI / 2, { y0: lv[k + 1] });
      else I.stairs(9.8, -18.95, 1.5, step, 5.2, Math.PI / 2, { y0: lv[k + 1] });
    }
    I.slab(15.85, lv[1], -16.91, 1.7, 5.575, conc, [], 0.2, true);
    I.slab(8.96, lv[2], -16.91, 1.675, 5.575, conc, [], 0.2, true);
    I.slab(15.85, lv[3], -16.91, 1.7, 5.575, conc, [], 0.2, true);
    I.slab(12.4, yb, -16.91, 8.6, 5.575, conc, [], 0.3, true);
    I.solid(I.paint(0xd8d4c8, 'plaster'), 12.4, (yb + 1) / 2, -16.925, 5.2, 1 - yb, 2.55);
    I.solid(I.paint(0xd8d4c8, 'plaster'), 9.86, 0.5, -18.95, 0.1, 1, 1.5);
    for (let k = 0; k < 4; k++) {
      // Even flights run down towards +x, odd ones back towards −x.
      const z = k % 2 === 0 ? -15.62 : -18.23;
      const [y0, y1] = k % 2 === 0 ? [lv[k], lv[k + 1]] : [lv[k + 1], lv[k]];
      I.g(alu).beam([9.8, y0 + 0.9, z], [15, y1 + 0.9, z], 0.05);
      const xl = k % 2 === 0 ? 16.62 : 8.2;
      I.g(I.tube).box(xl, lv[k + 1] + 2.2, -16.9, 0.06, 0.1, 1);
    }
    I.g(concrete).box(9, yb + 2.45, -20.4, 1.9, 0.12, 0.8);
    for (const x of [8.35, 9.65]) I.g(steel).box(x, yb + 1.1, -20.03, 0.1, 2.2, 0.1);
    s.sign(F, 'THE RINK MALL · REAR ENTRANCE', 9, yb + 2.9, -20.04, 3.2, 8, { bg: '#1d2a44', fg: '#f2ead6', style: 'block' }, Math.PI);
    s.sign(F, 'REAR EXIT · STAIRS TO CAR PARK', 7.86, 2.6, -16.9, 2.6, 8, { bg: '#2f6a4a', fg: '#ffffff', style: 'block' }, -Math.PI / 2);
  }

  // ── Arcade and court fittings ──
  yield;
  I.fluoros(-2.2, -1.8, 2.2, 19.4, CEIL, 3.2, 2.6);
  I.fluoros(-7.8, -3.5, 7.8, -2.2, CEIL);
  I.fluoros(-7.8, -13.9, 7.8, -12.5, CEIL);
  for (const sx of [-1, 1]) I.fluoros(sx > 0 ? 6.1 : -7.8, -12.5, sx > 0 ? 7.8 : -6.1, -3.5, CEIL);
  I.fluoros(5.2, -19.5, 7.8, -14.2, CEIL);
  I.hangingSign('THE RINK MALL', 0, 2.95, 18, 2.4, 0, CEIL, { bg: '#7a1418', fg: '#fff2d0', style: 'paint' });
  I.hangingSign('TOILETS · REAR EXIT', 6.5, 2.95, -13.6, 2.2, 0, CEIL, { bg: '#1d2a44', fg: '#f2ead6', style: 'block', aspect: 6 });
  // Directory board on the pier between the tote and the jeweller.
  I.g(I.paint(0x3a2a22, 'timber')).box(-2.35, 1.5, 5.15, 0.05, 1.75, 1.5);
  s.signStack(
    F,
    ['THE RINK MALL', 'SHOP DIRECTORY', '1  BARGAIN BIN', '2  STARLIGHT MILK BAR', '3  TOTE AGENCY', '4  SOLE MAN SHOE REPAIRS', '5  POUNAMU & PEARL JEWELLERS', '6  FOR LEASE', '7  THE DOG-EARED PAGE', '8  PETAL PUSHERS', '9  HAIR BY SHAZ', '10  THE DISPENSARY', '11  WIZARDS MUSIC & MAGIC', 'TOILETS · REAR EXIT · MALL OFFICE'],
    -2.32,
    1.5,
    5.15,
    1.36,
    0.112,
    { bg: '#3a2a22', fg: '#f2ead6', style: 'block' },
    Math.PI / 2,
  );
  I.g(s.mat('paintedMetal', 0xb01e23)).box(2.33, 1.4, 5.05, 0.1, 0.8, 0.8);
  // Court: planters with a cabbage tree and flax, seats, a coin-op horse, a bin.
  for (const sx of [-1, 1]) {
    I.solid(m.get('brick', { color: 0xa0583a }), sx * 4.6, 0.3, -8, 2.2, 0.6, 2.2);
    I.g(I.paint(0x3a2a1e)).box(sx * 4.6, 0.6, -8, 2, 0.02, 2, 0, false);
    for (const [z, yaw] of [[-6.45, 0], [-9.55, Math.PI]] as const) {
      bench(I.g(timber), sx * 4.6, 0, z, yaw, 1.8);
      I.collide(sx * 4.6, 0.45, z, 1.8, 0.9, 0.5);
    }
  }
  inst('tree-cabbage', -4.6, 0.6, -8, 0.3, 0.45);
  inst('flax', 4.6, 0.6, -8, 1.1, 0.7);
  inst('bush', 5.2, 0.6, -7.4, 2, 0.3);
  const ride = I.paint(0xd8302a);
  I.b.at(-6.8, 0, -11.2, Math.PI / 2, () => {
    I.g(I.paint(0x2f5fa8, 'paintedMetal')).box(0, 0.15, 0, 1.3, 0.3, 0.7);
    I.g(ride).box(0, 0.75, 0, 0.9, 0.4, 0.35).box(0.45, 1.1, 0, 0.18, 0.5, 0.2).box(0.62, 1.3, 0, 0.35, 0.18, 0.18);
    for (const ex of [-0.35, 0.35]) for (const ez of [-0.12, 0.12]) I.g(ride).box(ex, 0.45, ez, 0.08, 0.3, 0.08);
    I.g(I.paint(0xf0d070)).box(-0.05, 0.98, 0, 0.4, 0.06, 0.4);
  });
  I.collide(-6.8, 0.6, -11.2, 0.7, 1.2, 1.3);
  I.g(s.mat('paintedMetal', 0x3f5f3f)).tube([6.9, 0, -3.4], [6.9, 0.85, -3.4], 0.25, 0.25, 10);
  I.collide(6.9, 0.43, -3.4, 0.5, 0.85, 0.5);

  // ── Shops ──
  const fascia = (alongZ: boolean, line: number, face: 1 | -1, at: number, w: number, text: string, look: SignOptions) => {
    const opts = { aspect: w / 0.52, border: false, ...look };
    if (alongZ) I.sign(text, line + face * 0.136, 3, at, w, face > 0 ? Math.PI / 2 : -Math.PI / 2, opts);
    else I.sign(text, at, 3, line + face * 0.136, w, face > 0 ? 0 : Math.PI, opts);
  };
  const shop = (x0: number, z0: number, x1: number, z1: number, floor: number, surface: 'plain' | 'cloth' = 'plain', lit = true) => {
    I.g(I.paint(floor, surface)).box((x0 + x1) / 2, 0.016, (z0 + z1) / 2, x1 - x0, 0.012, z1 - z0, 0, false);
    if (lit) I.fluoros(x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2, CEIL);
  };
  const staffDoor = (x: number, z: number, yaw: number) => I.b.at(x, 0, z, yaw, () => I.g(I.paint(0x8a7a62, 'timber')).box(0, 1.05, 0.02, 0.9, 2.1, 0.04));

  // Wizards Music & Magic: records, tapes and CDs, sheet music and guitars, a corner of tricks and jokes, and
  // the counter where the town booked its Theatre Royal seats.
  shop(-7.875, -19.7, 4.875, -14.125, 0x2a2c5a, 'cloth');
  fascia(false, -14, 1, -1.6, 7.2, 'WIZARDS MUSIC & MAGIC', { bg: '#3a1f5c', fg: '#f0c33a', style: 'script' });
  I.gondola(-3.6, -19.45, 8, 0, { single: true, h: 2, shelves: 6, colors: CDS, fill: 0.95 });
  I.counter(WIZARDS_TILL.x, WIZARDS_TILL.z + 1, 2.6, 0, { till: true, front: I.paint(0x3a1f5c, 'timber') });
  I.sign('THEATRE ROYAL\nBOOKINGS HERE', WIZARDS_TILL.x, 2.1, -19.69, 2.1, 0, { aspect: 3, bg: '#f6edd0', fg: '#8a1f1f', style: 'paint' });
  I.sign('NOW BOOKING', 4.86, 1.9, -18.7, 1, -Math.PI / 2, { aspect: 2.5, bg: '#1d2a44', fg: '#f0c33a', style: 'block' });
  browser(I, -5.2, -16.8, 2.4, 0);
  browser(I, -2, -17.5, 1.9, 0);
  I.hangingSign('NEW RELEASES', -3.6, 2.7, -16.9, 1.8, 0, CEIL, { bg: '#e5b52b', fg: '#1c1c22', style: 'block' });
  pegboard(I, 4.86, 1, -15.6, 2.4, 1.2, -Math.PI / 2, JOKES, 4, 6);
  I.sign('MAGIC · JOKES · NOVELTIES', 4.86, 2.5, -15.6, 2.4, -Math.PI / 2, { aspect: 6, bg: '#3a1f5c', fg: '#f0c33a', style: 'block' });
  glassCase(I, 2.6, -14.95, 1.8, 0, JOKES);
  I.g(dark).tube([3.2, 1.15, -14.95], [3.2, 1.38, -14.95], 0.1, 0.1, 8).tube([3.2, 1.15, -14.95], [3.2, 1.17, -14.95], 0.17, 0.17, 8);
  I.g(dark).box(2.5, 1.16, -14.95, 0.3, 0.02, 0.02);
  I.b.at(-7.65, 0, -15.3, Math.PI / 2, () => {
    I.g(timber).box(0, 0.6, 0, 1.4, 1.2, 0.4);
    for (let k = 0; k < 3; k++) I.g(I.paint(k % 2 ? 0xe8e2d0 : 0xf4f2ee)).box(0, 0.85 + k * 0.12, 0.18 - k * 0.08, 1.3, 0.3, 0.02);
  });
  I.collide(-7.65, 0.6, -15.3, 0.4, 1.2, 1.4);
  I.sign('SHEET MUSIC', -7.86, 2.2, -15.3, 1.4, Math.PI / 2, { aspect: 4, bg: '#f2ead6', fg: '#1d2a44', style: 'paint' });
  for (const [z, c] of [[-16.6, 0x8a3a1a], [-17.3, 0xa8201e], [-18.0, 0x1c1c1c]] as const) guitar(I, -7.86, 1.3, z, Math.PI / 2, c);
  I.g(timber).box(-4.75, 0.2, -14.6, 4.6, 0.4, 0.5);
  for (let k = 0; k < 4; k++) I.g(I.paint(CDS[(k * 3) % CDS.length])).box(-6.4 + k * 1.1, 0.6, -14.62, 0.32, 0.32, 0.03);

  // Bargain Bin: the red-and-gold bargain shop, crammed.
  yield;
  shop(-16.7, 12.125, -2.625, 19.65, 0xc8c0a8);
  fascia(true, -2.5, 1, 15.9, 5.6, 'BARGAIN BIN', { bg: '#b01e23', fg: '#f0c33a', style: 'block' });
  for (const x of [-14.6, -11.6, -8.6]) I.gondola(x, 15.4, 4.2, Math.PI / 2, { h: 1.8, shelves: 5, fill: 1 });
  I.gondola(-16.48, 15.6, 6, Math.PI / 2, { single: true, h: 2, shelves: 5, fill: 1 });
  I.counter(BARGAIN_TILL.x, BARGAIN_TILL.z + 0.8, 2.4, 0, { till: true, front: I.paint(0xb01e23) });
  I.g(I.paint(0xb01e23)).box(-9.5, 0.18, 19.2, 10.6, 0.35, 0.6);
  I.collide(-9.5, 0.18, 19.2, 10.6, 0.35, 0.6);
  for (let k = 0; k < 9; k++) {
    const x = -14.4 + k * 1.2;
    const n = 2 + (k % 3);
    for (let j = 0; j < n; j++) I.g(I.paint(GOODS[(k * 5 + j) % GOODS.length])).box(x, 0.47 + j * 0.24, 19.2, 0.5 - j * 0.08, 0.22, 0.4);
  }
  I.sign('NOTHING OVER $5', -9.5, 2.3, 19.5, 2.6, 0, { aspect: 5, bg: '#f0c33a', fg: '#b01e23', style: 'block' });
  I.hangingSign('CRAZY PRICES', -11.6, 2.75, 15.4, 2, Math.PI / 2, CEIL, { bg: '#b01e23', fg: '#f0c33a', style: 'block' });
  for (const [x, z] of [[-6, 17.2], [-4, 16.4], [-5.2, 18.4]] as const) {
    I.g(chrome).box(x, 0.35, z, 0.8, 0.7, 0.8);
    for (let j = 0; j < 5; j++) I.g(I.paint(GOODS[I.rng.int(0, GOODS.length - 1)])).box(x + I.rng.range(-0.25, 0.25), 0.78, z + I.rng.range(-0.25, 0.25), 0.25, 0.16, 0.2, I.rng.range(0, 3));
    I.collide(x, 0.4, z, 0.8, 0.8, 0.8);
  }
  for (const [x, z, h] of [[-15.4, 12.6, 0.9], [-13, 12.55, 0.6], [-12.4, 12.6, 1.2]] as const) I.solid(carton, x, h / 2, z, 0.7, h, 0.6);

  // Starlight Milk Bar.
  shop(2.625, 12.125, 16.7, 19.65, 0xe8e2d0);
  fascia(true, 2.5, -1, 15.9, 5.6, 'STARLIGHT MILK BAR', { bg: '#f6f2e6', fg: '#1f6a8a', style: 'script' });
  I.counter(MILK_BAR_TILL.x, MILK_BAR_TILL.z + 0.8, 6, 0, { till: true, front: I.paint(0xd84a3a), top: I.paint(0xe8e2d0) });
  // Drinks fridge: a shell with a glass front, so the bottles show.
  const white = I.paint(0xf4f2ee, 'paintedMetal');
  I.g(white).box(10.5, 0.95, 12.3, 5, 1.9, 0.1).box(10.5, 1.85, 12.6, 5, 0.1, 0.6).box(10.5, 0.1, 12.6, 5, 0.2, 0.6);
  for (const e of [-1, 1]) I.g(white).box(10.5 + e * 2.45, 0.95, 12.6, 0.1, 1.9, 0.6);
  I.g(glass).box(10.5, 1, 12.88, 4.8, 1.6, 0.02);
  I.collide(10.5, 0.95, 12.575, 5, 1.9, 0.65);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) I.g(I.paint(GOODS[(r * 7 + k * 3) % GOODS.length])).box(8.4 + k * 0.84, 0.35 + r * 0.42, 12.65, 0.7, 0.26, 0.3);
  I.g(chrome).box(8.4, 1.15, 14.05, 0.5, 0.35, 0.3);
  for (const k of [0, 1, 2]) I.g(chrome).tube([8.25 + k * 0.15, 0.97, 14.2], [8.25 + k * 0.15, 1.12, 14.2], 0.04, 0.04, 6);
  I.g(glass).box(12.6, 1.2, 14.0, 0.9, 0.5, 0.5);
  for (const k of [0, 1, 2]) I.g(I.paint(0xb07a3a)).box(12.35 + k * 0.25, 1.0, 14.0, 0.18, 0.05, 0.18);
  s.signStack(F, ['PIES · PASTIES · SAUSAGE ROLLS', 'MILKSHAKES · THICKSHAKES · SPIDERS', 'TOASTIES · FILLED ROLLS · CHIPS'], 10.5, 2.6, 12.14, 4.8, 0.28, { bg: '#1c2a3a', fg: '#f6edd0', style: 'block' });
  for (const x of [4.6, 7.8, 11, 14.2]) cafeSet(I, x, 17.6);
  I.sign('THICKSHAKES', 9.5, 2.4, 19.5, 2.2, 0, { aspect: 4, bg: '#1c1c22', fg: '#ff5ab0', style: 'neon' });

  // Tote agency.
  shop(-10.375, 5.125, -2.625, 11.875, 0x5a2a2a, 'cloth');
  fascia(true, -2.5, 1, 8.6, 5.4, 'TOTE AGENCY', { bg: '#1f4a36', fg: '#f6edd0', style: 'block' });
  I.counter(TOTE_TILL.x + 1, TOTE_TILL.z, 4, Math.PI / 2, { till: true, front: I.paint(0x1f4a36, 'timber') });
  I.g(glass).box(TOTE_TILL.x + 1.05, 1.35, TOTE_TILL.z, 0.02, 0.7, 4);
  for (const z of [6.8, 8, 9.2]) {
    I.g(I.paint(0x2a2a2e, 'paintedMetal')).box(-10.1, 2.65, z, 0.45, 0.5, 0.6);
    I.g(m.emitter(0x6ad0a0, 'always')).box(-9.87, 2.65, z, 0.01, 0.38, 0.48, 0, false);
  }
  I.solid(timber, -6.5, 1.1, 5.3, 5.6, 0.05, 0.35);
  I.sign('RACING · TROTS · DOGS · SPORT', -6.5, 2.2, 5.135, 3.6, 0, { aspect: 9, bg: '#1f4a36', fg: '#f6edd0', style: 'block' });
  staffDoor(-10.36, 10.9, Math.PI / 2);

  // Pounamu & Pearl, jewellers.
  shop(-10.375, -1.875, -2.625, 4.875, 0x2a3a5a, 'cloth');
  fascia(true, -2.5, 1, 1.5, 5.4, 'POUNAMU & PEARL JEWELLERS', { bg: '#1d2a44', fg: '#e8d8a0', style: 'paint' });
  glassCase(I, -8.6, 1.5, 3.4, Math.PI / 2, GOLD);
  glassCase(I, -5.2, -1.2, 2.4, 0, GOLD);
  I.solid(I.paint(0x3a2a22, 'timber'), -10.15, 1.6, 1.5, 0.4, 1.4, 4);
  I.g(glass).box(-9.94, 1.6, 1.5, 0.02, 1.3, 3.9);
  for (const x of [-8.4, -6.6, -4.8]) {
    I.b.at(x, 2.1, 4.86, Math.PI, () => {
      I.g(I.paint(0xd8b040, 'metal')).disc(0, 0, 0, 0.2, 12);
      I.g(I.paint(0xf2ead6)).disc(0, 0, 0.01, 0.17, 12);
    });
  }
  for (let k = 0; k < 3; k++) I.g(I.paint(0x1d2a44, 'cloth')).box(-3.0, 0.5 + k * 0.05, -0.6 + k * 1.1, 0.4, 0.25 + k * 0.1, 0.4);

  // Sole Man: shoe repairs and keys cut.
  shop(2.625, 5.125, 10.375, 11.875, 0x8a7a62);
  fascia(true, 2.5, -1, 8.6, 5.4, 'SOLE MAN SHOE REPAIRS', { bg: '#f0c33a', fg: '#1c1c1c', style: 'block' });
  I.counter(6.4, 8.4, 3.6, -Math.PI / 2);
  I.g(I.paint(0x4a5a6a, 'metal')).box(6.4, 1.05, 7, 0.35, 0.2, 0.3);
  I.g(chrome).tube([6.3, 1.22, 7], [6.5, 1.22, 7], 0.08, 0.08, 8);
  pegboard(I, 10.37, 1, 8.4, 2.4, 1.2, -Math.PI / 2, [0xc8c8cc, 0xd8b040], 4, 8);
  I.sign('KEYS CUT · HEELS WHILE U WAIT', 10.36, 2.55, 8.4, 2.6, -Math.PI / 2, { aspect: 8, bg: '#f0c33a', fg: '#1c1c1c', style: 'block' });
  I.gondola(6.5, 5.45, 3.6, 0, { single: true, h: 1.8, shelves: 4, colors: SHOES, fill: 0.75 });
  I.solid(I.paint(0x6a5a4a, 'timber'), 9.4, 0.45, 8.4, 1.2, 0.9, 2);

  // The empty unit.
  shop(2.625, -1.875, 10.375, 4.875, 0x9a968c, 'plain', false);
  fascia(true, 2.5, -1, 1.5, 5.4, 'SHOP 6 · FOR LEASE', { bg: '#e8e4dc', fg: '#6a6a72', style: 'block' });
  const lease = { aspect: 3.2, bg: '#f6edd0', fg: '#8a1f1f', style: 'block' } as const;
  I.sign('FOR LEASE', 2.66, 1.55, 0.6, 2.2, -Math.PI / 2, lease);
  I.sign('QUARTER ACRE REALTY · PH 03 688 4120', 2.66, 1, 0.6, 2.2, -Math.PI / 2, { aspect: 9, bg: '#f6edd0', fg: '#1d2a44', style: 'block' });
  I.sign('FOR LEASE', 5.25, 1.7, -1.86, 1.8, Math.PI, lease);
  for (const [z, y, w] of [[-0.85, 1.3, 0.6], [2.1, 0.9, 0.5]] as const) I.g(I.paint(0xe8e0c8)).box(2.66, y, z, 0.005, 0.9, w, 0, false);
  for (const [x, z, h] of [[8.8, -0.8, 0.5], [9.4, 0.2, 0.4], [8.6, 3.8, 0.6]] as const) I.solid(carton, x, h / 2, z, 0.6, h, 0.5);
  for (const e of [-0.25, 0.25]) I.g(alu).beam([7 + e, 0, 3.7], [7 + e * 0.6, 1.7, 3.3], 0.04, 0.06).beam([7 + e, 0, 2.9], [7 + e * 0.6, 1.7, 3.3], 0.04, 0.06);
  for (let k = 1; k < 5; k++) I.g(alu).box(7, k * 0.34, 3.7 - k * 0.08, 0.5, 0.03, 0.06);

  // The Dog-Eared Page, second-hand books.
  yield;
  shop(-16.7, -7.875, -8.125, -2.125, 0x3a5a3a, 'cloth');
  fascia(true, -8, 1, -5, 4.8, 'THE DOG-EARED PAGE', { bg: '#f2ead6', fg: '#1d2a44', style: 'paint' });
  for (const z of [-4, -6.4]) I.gondola(-13.4, z, 4, 0, { colors: BOOKS, h: 1.6, shelves: 4 });
  I.gondola(-16.48, -5, 5.4, Math.PI / 2, { single: true, h: 2, shelves: 5, colors: BOOKS });
  I.counter(-10, -3, 1.2, -Math.PI / 2, { till: true });

  // Hair by Shaz.
  shop(-16.7, -13.875, -8.125, -8.125, 0xe0d8e0);
  fascia(true, -8, 1, -11, 4.8, 'HAIR BY SHAZ', { bg: '#e07aa8', fg: '#ffffff', style: 'script' });
  for (const z of [-9.6, -12.2]) salonChair(I, -15.7, z, -Math.PI / 2);
  out.quad(F, -16.68, 1.55, -10.9, 3.8, 1, chrome, Math.PI / 2);
  I.solid(I.paint(0xe8e2d8), -16.5, 0.85, -10.9, 0.4, 0.05, 3.8);
  I.solid(I.paint(0xd8d0c8), -12.6, 0.45, -13.55, 1.2, 0.9, 0.6);
  bench(I.g(timber), -8.75, 0, -9.8, -Math.PI / 2, 1.6);
  I.collide(-8.75, 0.45, -9.8, 0.5, 0.9, 1.6);
  I.sign('CUTS · PERMS · COLOURS', -12.4, 2.3, -13.86, 2.4, 0, { aspect: 6, bg: '#f4f2ee', fg: '#7a2a5a', style: 'script' });

  // Petal Pushers, florist.
  shop(8.125, -7.875, 16.7, -2.125, 0xb89a72);
  fascia(true, 8, -1, -5, 4.8, 'PETAL PUSHERS', { bg: '#3f8f4a', fg: '#f6edd0', style: 'script' });
  I.solid(timber, 16.05, 0.175, -5, 1.3, 0.35, 5);
  I.solid(timber, 16.37, 0.55, -5, 0.65, 0.4, 5);
  for (let k = 0; k < 9; k++) {
    const z = -7.2 + k * 0.55;
    for (const [x, y] of [[15.7, 0.35], [16.37, 0.75]] as const) {
      I.g(steel).tube([x, y, z], [x, y + 0.3, z], 0.14, 0.14, 8, false);
      I.g(I.paint(FLOWERS[I.rng.int(0, FLOWERS.length - 1)])).box(x, y + 0.42, z, 0.26, 0.25, 0.26);
    }
  }
  I.counter(12.6, -4.2, 1.8, -Math.PI / 2, { till: true });
  inst('bush', 10, 0, -7.2, 0, 0.35);
  inst('bush', 11.2, 0, -7.3, 1, 0.3);
  inst('bush', 8.8, 0, -3.6, 0.5, 0.3);

  // The Dispensary, chemist.
  shop(8.125, -13.875, 16.7, -8.125, 0xe8e8e0);
  fascia(true, 8, -1, -11, 4.8, 'THE DISPENSARY', { bg: '#f4f2ee', fg: '#2f6a4a', style: 'block' });
  I.gondola(12.6, -10, 3.6, 0, { colors: CHEMIST, h: 1.5, shelves: 4 });
  I.gondola(16.475, -10.6, 3.6, -Math.PI / 2, { single: true, h: 1.8, shelves: 5, colors: CHEMIST });
  I.gondola(12.4, -13.65, 3.6, 0, { single: true, h: 2, shelves: 5, colors: CHEMIST });
  I.counter(12.4, -12.3, 3, 0, { till: true, front: I.paint(0xf4f2ee) });
  I.hangingSign('DISPENSARY', 12.4, 2.9, -12.3, 1.8, 0, CEIL, { bg: '#2f6a4a', fg: '#ffffff', style: 'block' });

  // Passage to the rear stair: toilets and the mall office off it.
  staffDoor(6.5, -19.7, 0);
  I.sign('TOILETS', 6.5, 2.4, -19.68, 1, 0, { aspect: 4, bg: '#1d2a44', fg: '#f2ead6', style: 'block' });
  staffDoor(5.14, -18.2, Math.PI / 2);
  I.sign("MALL OFFICE · TENANTS' ASSOCIATION", 5.14, 2.4, -18.2, 1.6, Math.PI / 2, { aspect: 8, bg: '#1d2a44', fg: '#f2ead6', style: 'block' });

  // Night: one lamp under the verandah, one in the court.
  I.light(0, 3.2, 21.6, 0xfff0d8, 150, 16);
  I.light(0, 3.2, -8, 0xf4f6ff, 120, 18);
  I.flush();
};
