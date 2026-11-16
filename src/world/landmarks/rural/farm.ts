import { LAMP_WARM } from '../../scatter/util';
// Registers the yard kinds (trailer, timber-stack, woodpile…) and the static cars.
import '../../props/extra';
import { TAU } from '../../../core/math';
import type { LandmarkBuilder } from '../../../core/types';
import { gableRoof, Geo, Site, walls } from './kit';
import { PROP } from './props';

const IRON = [0x8b3027, 0xa9adb0, 0x8a5a3c, 0x6f6a62, 0x35603f];
const FLEECE = [0xffffff, 0xf2ecdc, 0xe4dcc8, 0xd8cfb8];

/**
 * Woolshed: a corrugated-iron shearing shed on piles (18 × 9 m) with a lean-to of night pens, a wool-bale
 * landing, a sheep ramp, count-out pens, post-and-rail yards with a truck ramp, a tank on a stand and a
 * long-drop out the back. Iron colours, the tank's corner, the yard layout and the trees vary with the seed.
 */
export const woolshed: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const rng = s.rng;
  const roofColor = rng.pick(IRON);
  const wall = s.mat('corrugated', rng.pick([0xa9adb0, 0xb9b4a8, 0x9a958c, roofColor]), { metalness: 0.35 });
  const roof = s.mat('corrugated', roofColor, { metalness: 0.35 });
  const timber = s.mat('timber', 0x8a7a66);
  const dark = s.mat('timber', 0x4f4338);
  const b = s.batch();
  const FLOOR = 1.1;

  // Shed on piles, gable roof, lean-to along the back.
  out.box(f, 0, 0.05, -4, 17.4, 2.1, 8.4, s.mat('plain', 0x2a2622, { roughness: 1 }));
  out.box(f, 0, FLOOR + 1.7, -4, 18, 3.4, 9, wall);
  gableRoof(out, b.g(wall), f, 0, FLOOR + 3.4, -4, 18, 9, 2.4, roof, 0.3);
  out.collider(f, 0, 2.2, -4, 18, 4.5, 9);
  const piles = b.g(dark);
  for (let x = -8.6; x <= 8.6; x += 2.15) for (const z of [0.4, -8.4]) piles.post(x, -0.4, z, 0.22, FLOOR + 0.4);
  out.box(f, 0, 1.35, -10.4, 18, 3.7, 3.8, wall);
  b.g(roof).slab([-9.3, 3.0, -12.5], [-9.3, 4.5, -8.4], [9.3, 4.5, -8.4], [9.3, 3.0, -12.5], 0.08);
  out.collider(f, 0, 1.5, -10.4, 18, 3.2, 3.8);

  // Front wall: high windows over the board, ports and chutes to the count-out pens.
  const glass = b.g(s.mat('glass'));
  const chute = b.g(timber);
  for (let i = 0; i < 5; i++) {
    const x = -6.4 + i * 3.2;
    glass.box(x, FLOOR + 2.5, 0.52, 1.3, 0.7, 0.04);
    b.g(s.mat('plain', 0x1c1a18, { roughness: 1 })).box(x + 0.9, FLOOR + 0.42, 0.52, 0.6, 0.8, 0.04);
    chute.slab([x + 0.55, 0.05, 2.5], [x + 1.25, 0.05, 2.5], [x + 1.25, FLOOR, 0.5], [x + 0.55, FLOOR, 0.5], 0.06);
  }
  const rails = b.g(timber);
  s.fence(rails, [[-8, 0.6], [-8, 4.2], [8, 4.2], [8, 0.6]], { height: 1.1, spacing: 2, rails: 3, post: 0.12 });
  for (let i = 1; i < 5; i++) s.fence(rails, [[-8 + i * 3.2, 0.6], [-8 + i * 3.2, 4.2]], { height: 1.1, spacing: 2, rails: 3, post: 0.12 });

  // Wool end: sliding door, landing with steps, a few bales waiting for the truck.
  const end = rng.chance(0.5) ? -1 : 1;
  out.box(f, end * 9.04, FLOOR + 1.4, -4, 0.1, 2.6, 3, s.mat('timber', 0x6a5a48));
  out.box(f, end * 10.6, 0.35, -4, 3, FLOOR + 0.5, 4.4, timber);
  out.collider(f, end * 10.6, 0.55, -4, 3, FLOOR, 4.4);
  for (let k = 0; k < 3; k++) {
    const top = FLOOR - (k + 1) * 0.28;
    out.box(f, end * (12.3 + k * 0.32), top / 2 - 0.2, -4, 0.32, top + 0.4, 1.6, timber);
    out.collider(f, end * (12.3 + k * 0.32), top / 2, -4, 0.32, Math.max(0.1, top), 1.6);
  }
  const bales = b.g(s.mat('cloth', 0xb9a57a));
  for (const [dx, dz, dy] of [[0, -1.2, 0], [0.3, 0.9, 0], [0.1, -1.1, 0.78]] as const) bales.box(end * (10.4 + dx), FLOOR + 0.39 + dy, -4 + dz, 1.2, 0.76, 0.78);
  b.g(s.mat('paintedMetal', 0x2f4a6a)).lathe(end * 11.4, FLOOR, -5.6, [[0.29, 0], [0.29, 0.88], [0, 0.88]], 8);

  // Yard end: ramp up from the yards, pens with a drafting race, truck ramp.
  const yard = -end;
  const X = (v: number) => yard * v;
  out.box(f, X(9.04), FLOOR + 1, -5.5, 0.1, 1.9, 1.3, s.mat('plain', 0x1c1a18, { roughness: 1 }));
  const y0 = s.gy(X(12), -5.5);
  const xa = X(9.1);
  const xb = X(13.4);
  b.g(timber).slab([Math.min(xa, xb), xa < xb ? FLOOR : y0, -4.9], [Math.max(xa, xb), xa < xb ? y0 : FLOOR, -4.9], [Math.max(xa, xb), xa < xb ? y0 : FLOOR, -6.1], [Math.min(xa, xb), xa < xb ? FLOOR : y0, -6.1], 0.08);
  for (const z of [-4.85, -6.15]) for (const h of [0.5, 1.0]) rails.beam([xa, FLOOR + h, z], [xb, y0 + h, z], 0.05, 0.1);
  const pens = rng.int(2, 3);
  const x0 = 11;
  const x1 = x0 + 4.5 * pens;
  const lines: [number, number][][] = [
    [[X(x0), -13], [X(x1), -13], [X(x1), 7], [X(x0), 7], [X(x0), -6.4]],
    [[X(x0), -4.6], [X(x0), 0.5]],
    [[X(x0), -3], [X(x1), -3]],
    [[X(x0), 2], [X(x1), 2]],
    [[X(x0 + 1.4), -13], [X(x0 + 1.4), -6.4]],
  ];
  for (let i = 1; i < pens; i++) lines.push([[X(x0 + 4.5 * i), -3], [X(x0 + 4.5 * i), 7]]);
  for (const line of lines) s.fence(rails, line, { height: 1.2, spacing: 2.25, rails: 3, post: 0.13 });
  const yr = s.gy(X(x1 - 2), 8.4);
  b.g(timber).slab([X(x1 - 2) - 0.55, yr, 10.8], [X(x1 - 2) + 0.55, yr, 10.8], [X(x1 - 2) + 0.55, yr + 1.2, 7.1], [X(x1 - 2) - 0.55, yr + 1.2, 7.1], 0.1);
  for (const side of [-1, 1]) for (const h of [0.5, 1.0]) rails.beam([X(x1 - 2) + side * 0.55, yr + h, 10.8], [X(x1 - 2) + side * 0.55, yr + 1.2 + h, 7.1], 0.05, 0.1);
  out.collider(f, X(x1 - 2), yr + 0.5, 8.4, 1.2, 1.1, 2.4);
  const mob = rng.int(5, 14);
  for (let i = 0; i < mob; i++) s.prop(PROP.sheep, X(rng.range(x0 + 2, x1 - 0.8)), rng.range(-2.2, 6.2), rng.range(0, TAU), rng.range(0.9, 1.05), rng.pick(FLEECE));

  // Tank on a stand catching the roof water.
  const tx = end * rng.pick([6.5, -6.5]);
  const stand = b.g(dark);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) stand.post(tx + sx * 1.1, -0.3, -14.2 + sz * 1.1, 0.16, 1.5);
  stand.box(tx, 1.25, -14.2, 2.9, 0.12, 2.9);
  b.g(s.mat('corrugated', 0xa9adb0, { metalness: 0.4 })).lathe(tx, 1.31, -14.2, [[0, 0], [1.45, 0], [1.45, 2.1], [0, 2.35]], 12);
  stand.beam([tx, 3.05, -12.5], [tx, 3.3, -13.4], 0.08);
  out.collider(f, tx, 1.7, -14.2, 2.9, 3.6, 2.9);

  // Long-drop.
  const lx = end * rng.range(15, 19);
  const lz = rng.range(8, 13);
  const fl = s.at(lx, lz, rng.range(-0.4, 0.4));
  out.box(fl, 0, 0.85, 0, 1.2, 2.3, 1.3, wall);
  const bl = s.batch(fl);
  bl.g(roof).slab([-0.75, 2.0, 0.85], [0.75, 2.0, 0.85], [0.75, 2.35, -0.8], [-0.75, 2.35, -0.8], 0.05);
  bl.g(dark).box(0, 0.95, 0.66, 0.7, 1.8, 0.04);
  bl.flush();
  out.collider(fl, 0, 1, 0, 1.2, 2, 1.3);

  // Gravel where the trucks turn.
  const gravel = new Geo();
  s.drape(gravel, end * 6, 13, 22, 12, 0.05);
  gravel.flush(out, s.ground('gravel'), f);
  b.flush();

  const trees = rng.int(1, 3);
  for (let i = 0; i < trees; i++) s.prop('tree-pine', end * (14 + i * 4), -16 - (i % 2) * 3, rng.range(0, 6), rng.range(1, 1.3));
  s.light(end * 10.6, 3.6, -4, 0xffdca0, 1, 16);

  // What gathers round a working shed: the farm wagon, a trailer, diesel drums, a stack of posts, last year's bales.
  const clutter = (kind: string, lx: number, lz: number, yaw = 0, scale = 1, tint?: number) => {
    const x = s.wx(lx, lz);
    const z = s.wz(lx, lz);
    const road = out.world.graph.nearest(x, z, 20);
    if (out.world.places.some((q) => Math.hypot(q.x - x, q.z - z) < 7) || (road && road.distance < road.edge.width / 2 + 3)) return;
    s.prop(kind, lx, lz, yaw, scale, tint);
  };
  clutter('car-parked-wagon', end * 2.5, 15.2, end * 1.4 + rng.range(-0.2, 0.2), 1, rng.pick([0x8f959a, 0xc9b78a, 0x2d5a44, 0x6f3a2c, 0xe8e6df]));
  clutter('trailer', end * 12.5, 15.5, rng.range(0, 3), 1, rng.pick([0x8f959a, 0x6f3a2c, 0x2b4a6b]));
  for (let i = 0; i < 3; i++) clutter('drum', -end * (10.2 + i * 0.68), 5.4 + (i % 2) * 0.5, 0, 1, [0xb5261e, 0x2b4a6b, 0x8a8d90][i]);
  clutter('timber-stack', -end * 15.5, 9.5, rng.range(-0.1, 0.1), 0.62);
  clutter('woodpile', lx - end * 2.2, lz, Math.PI / 2);
  for (let i = 0; i < 3; i++) clutter(PROP.bale, end * (15.5 + (i % 2) * 1.5), 6.5 + i * 1.45, Math.PI / 2 + rng.range(-0.1, 0.1));
};

/**
 * Grain silos: a row of three to five galvanised steel bins on concrete pads, joined by a catwalk, with a
 * wheeled auger reaching up to one hatch, a hopper-bottom bin on legs and (sometimes) a dryer shed.
 */
export const grainSilo: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const rng = s.rng;
  const steel = s.mat('corrugated', 0xb4b8ba, { metalness: 0.55, roughness: 0.45 });
  const cap = s.mat('metal', 0xa4a8aa, { roughness: 0.5, metalness: 0.6 });
  const frame = s.mat('paintedMetal', 0x5a6068);
  const b = s.batch();
  const n = rng.int(3, 5);
  const tops: [number, number, number][] = [];
  let x = -(n - 1) * 3.9;
  for (let i = 0; i < n; i++) {
    const r = rng.range(2.9, 3.6);
    const h = rng.range(7.5, 11.5);
    const z = -5 + rng.range(-0.4, 0.4);
    const y = s.gy(x, z);
    out.cylinder(f, x, y - 0.2, z, r + 0.35, r + 0.35, 0.8, s.mat('concrete'), 14);
    b.g(steel).lathe(x, y + 0.2, z, [[r, 0], [r, h]], 16);
    b.g(cap).lathe(x, y + 0.2 + h, z, [[r + 0.08, 0], [0.45, r * 0.52], [0.45, r * 0.52 + 0.3], [0, r * 0.52 + 0.35]], 16);
    // Ladder up the front.
    const g = b.g(frame);
    for (const side of [-0.22, 0.22]) g.beam([x + side, y + 0.3, z + r + 0.06], [x + side, y + h + 0.3, z + r + 0.06], 0.04);
    for (let k = 1; k * 0.9 < h; k++) g.beam([x - 0.22, y + 0.3 + k * 0.9, z + r + 0.06], [x + 0.22, y + 0.3 + k * 0.9, z + r + 0.06], 0.03);
    out.collider(f, x, y + h / 2, z, r * 1.7, h, r * 1.7);
    tops.push([x, y + 0.2 + h + r * 0.52 + 0.35, z]);
    x += 7.8;
  }
  // Catwalk along the peaks.
  const g = b.g(frame);
  for (let i = 0; i < n - 1; i++) {
    const a = tops[i];
    const c = tops[i + 1];
    g.beam([a[0], a[1] + 0.05, a[2]], [c[0], c[1] + 0.05, c[2]], 0.7, 0.06);
    for (const side of [-0.35, 0.35]) g.beam([a[0], a[1] + 1, a[2] + side], [c[0], c[1] + 1, c[2] + side], 0.04);
  }

  // Auger on its wheeled frame, reaching one of the hatches.
  const target = tops[rng.int(0, n - 1)];
  const foot: [number, number, number] = [target[0] + rng.range(-2, 2), s.gy(target[0], 8) + 0.5, 8.5];
  const paint = b.g(s.mat('paintedMetal', rng.pick([0xc8322a, 0x2f6a4a, 0xd9a520])));
  paint.tube(foot, [target[0], target[1] + 0.1, target[2] + 0.4], 0.16, 0.16, 8);
  paint.box(foot[0], foot[1] - 0.1, foot[2] + 0.3, 1.2, 0.6, 1.2);
  const mid: [number, number, number] = [(foot[0] + target[0]) / 2, (foot[1] + target[1]) / 2, (foot[2] + target[2]) / 2];
  const axleY = s.gy(mid[0], mid[2] + 1.4) + 0.4;
  for (const side of [-1, 1]) {
    g.beam([mid[0] + side * 1.1, axleY, mid[2] + 1.4], [mid[0], mid[1] + 0.6, mid[2] - 0.6], 0.07);
    g.beam([mid[0] + side * 1.1, axleY, mid[2] + 1.4], [foot[0], foot[1] + 0.8, foot[2] - 1], 0.06);
    b.g(s.mat('rubber')).tube([mid[0] + side * 1.1, axleY, mid[2] + 1.4], [mid[0] + side * 1.32, axleY, mid[2] + 1.4], 0.4, 0.4, 10);
  }

  // Hopper-bottom bin on legs.
  const hx = (n - 1) * 3.9 + 6.5;
  if (Math.abs(hx) < 19) {
    const y = s.gy(hx, 0);
    b.g(steel).lathe(hx, y, 0, [[0.3, 1], [1.7, 2.8], [1.7, 6.6]], 12);
    b.g(cap).lathe(hx, y + 6.6, 0, [[1.76, 0], [0, 0.9]], 12);
    for (let i = 0; i < 4; i++) {
      const a = TAU * (i / 4) + 0.78;
      g.beam([hx + Math.cos(a) * 1.75, y - 0.3, Math.sin(a) * 1.75], [hx + Math.cos(a) * 1.65, y + 3, Math.sin(a) * 1.65], 0.12);
    }
    out.collider(f, hx, y + 3.3, 0, 3.4, 6.6, 3.4);
  }

  // Dryer shed.
  if (n <= 4 && rng.chance(0.6)) {
    const fd = s.at(-(n - 1) * 3.9 - 7.5, 3, Math.PI / 2);
    const skin = s.mat('corrugated', rng.pick(IRON), { metalness: 0.35 });
    walls(out, fd, 0, 0, 7, 3.4, 5, skin);
    const bd = s.batch(fd);
    gableRoof(out, bd.g(skin), fd, 0, 3.4, 0, 7, 5, 1.2, s.mat('corrugated', 0xa9adb0, { metalness: 0.35 }), 0.25);
    bd.flush();
    out.box(fd, 0, 1.4, 2.53, 3, 2.8, 0.08, s.mat('paintedMetal', 0x55606a));
    out.collider(fd, 0, 1.7, 0, 7, 3.4, 5);
  }

  const gravel = new Geo();
  s.drape(gravel, 0, 6, 34, 16, 0.05);
  gravel.flush(out, s.ground('gravel'), f);
  b.flush();
  s.light(0, 5, 6, LAMP_WARM, 1, 24);
};
