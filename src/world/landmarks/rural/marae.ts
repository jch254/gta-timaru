import type { LandmarkBuilder } from '../../../core/types';
import { bench, flagpole, gableRoof, Geo, Site, type V3, walls, windowRow } from './kit';

// Kōkōwai (red ochre), white and black: the traditional paint colours.
const OCHRE = 0x8a2f20;
const WHITE = 0xf2ede0;
const BLACK = 0x1c1a18;

/**
 * A marae, built generically and plainly: the wharenui (meeting house) with its deep porch at the head of
 * the marae ātea (the open lawn, kept clear), the wharekai (dining hall) beside it, an ablution block, the
 * waharoa (gateway) in a low fence across the front, a flagpole, and a car park to one side.
 *
 * The gable front only suggests carving: plain red-ochre maihi (bargeboards), amo (side posts), a simple
 * koruru block and an upright tekoteko post at the apex, and a plain pare over the door. No pattern from any
 * real house is reproduced. The name board at the gateway carries the placement's name.
 */
export const marae: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const m = s.m;
  const rng = s.rng;
  const ochre = s.mat('timber', OCHRE);
  const white = s.mat('plain', WHITE, { roughness: 0.7 });
  const black = s.mat('plain', BLACK, { roughness: 0.7 });
  const board = s.mat('weatherboard', 0xefe6cf);

  // The marae ātea: mown lawn between the gateway and the house. Nothing stands on it.
  const lawn = new Geo();
  s.drape(lawn, 0, 19.5, 30, 29, 0.04, 0, 6);
  lawn.flush(out, s.ground('grass', 0x8a9150, -1), f);

  // ── Wharenui ──
  {
    const fw = s.at(0, -11);
    const b = s.batch(fw);
    const W = 5; // half width
    const BACK = -10;
    const WALL = 6.5; // front wall of the house; the porch runs on to z = 10
    const FRONT = 10;
    const EAVE = 2.9;
    const RIDGE = 6.3;
    const roof = b.g(s.mat('corrugated', 0x7a2b22, { metalness: 0.3 }));
    const wb = b.g(board);

    // Side walls run the full length, forming the porch sides; back and front walls rise into the gable.
    for (const side of [-1, 1]) out.box(fw, side * (W - 0.1), (EAVE - 1.5) / 2, 0, 0.2, EAVE + 1.5, FRONT - BACK, board);
    const gableWall = (z: number, facing: 1 | -1) => {
      const pts: V3[] = [[-W, -1.5, z], [W, -1.5, z], [W, EAVE, z], [0, RIDGE - 0.1, z], [-W, EAVE, z]];
      wb.poly(facing === 1 ? pts : pts.reverse());
    };
    gableWall(WALL, 1);
    gableWall(BACK, -1);
    // Roof: two slabs meeting at the ridge, so the porch is open underneath.
    const over = 0.35;
    roof.slab([-W - over, EAVE - 0.24, FRONT], [0, RIDGE, FRONT], [0, RIDGE, BACK - 0.2], [-W - over, EAVE - 0.24, BACK - 0.2], 0.12);
    roof.slab([0, RIDGE, FRONT], [W + over, EAVE - 0.24, FRONT], [W + over, EAVE - 0.24, BACK - 0.2], [0, RIDGE, BACK - 0.2], 0.12);
    // Porch floor and the paepae (threshold beam) across its front.
    b.g(s.mat('timber', 0x8a7a62)).box(0, 0.02, (WALL + FRONT) / 2, W * 2 - 0.4, 0.3, FRONT - WALL);
    b.g(ochre).box(0, 0.24, FRONT - 0.12, W * 2 - 0.4, 0.34, 0.22);
    out.collider(fw, 0, 1.5, (BACK + WALL) / 2, W * 2, 3, WALL - BACK);
    for (const side of [-1, 1]) out.collider(fw, side * (W - 0.1), 1.5, (WALL + FRONT) / 2, 0.3, 3, FRONT - WALL);

    // Maihi: the two bargeboards, each ending a little beyond its amo.
    const red = b.g(ochre);
    const slope = (RIDGE - EAVE) / W;
    for (const side of [-1, 1]) {
      const lowX = side * (W + 0.75);
      const lowY = RIDGE - (W + 0.75) * slope;
      red.beam([lowX, lowY - 0.05, FRONT + 0.08], [0, RIDGE + 0.02, FRONT + 0.08], 0.14, 0.62);
      // Amo: broad upright posts under the maihi.
      red.box(side * (W - 0.05), EAVE / 2 - 0.3, FRONT + 0.06, 0.62, EAVE + 0.6, 0.22);
      // A few plain white notches along each board stand in for carving.
      const wn = b.g(white);
      for (const u of [0.25, 0.45, 0.65, 0.85]) wn.box(side * (W + 0.75) * (1 - u), lowY + (RIDGE - lowY) * u, FRONT + 0.17, 0.24, 0.24, 0.04);
    }
    // Koruru at the apex and the tekoteko above it: a plain block and an upright post.
    red.box(0, RIDGE - 0.35, FRONT + 0.2, 0.7, 0.8, 0.2);
    red.taper(0, RIDGE + 0.1, FRONT + 0.1, 0.34, 0.3, 0.26, 0.24, 0.9);
    red.box(0, RIDGE + 1.18, FRONT + 0.1, 0.36, 0.36, 0.3);

    // Front wall under the porch: door to the left, window to the right, plain pare and frames, and the
    // centre post carrying the ridge.
    red.box(0, (RIDGE - 0.4) / 2, WALL + 0.1, 0.34, RIDGE - 0.4, 0.2);
    b.g(black).box(-2.4, 1.15, WALL + 0.05, 1.1, 2.1, 0.08);
    red.box(-2.4, 2.42, WALL + 0.1, 1.9, 0.42, 0.16);
    for (const side of [-1, 1]) red.box(-2.4 + side * 0.68, 1.15, WALL + 0.08, 0.2, 2.1, 0.12);
    b.g(s.mat('glass', 0x26323c)).box(2.4, 1.6, WALL + 0.05, 1.5, 1.1, 0.06);
    red.box(2.4, 2.34, WALL + 0.1, 2.1, 0.34, 0.16).box(2.4, 0.96, WALL + 0.1, 1.9, 0.16, 0.16);
    // Rafters in the porch, alternately black and white, under the roof.
    for (let i = 0; i < 4; i++) {
      const z = WALL + 0.5 + i * 0.85;
      const g = b.g(i % 2 === 0 ? black : white);
      for (const side of [-1, 1]) g.beam([side * (W - 0.25), EAVE - 0.32, z], [side * 0.25, RIDGE - 0.32, z], 0.1, 0.16);
    }
    // Small windows down the sides.
    for (const side of [-1, 1]) for (const z of [-6, -1.5, 3]) out.quad(fw, side * (W + 0.01), 1.7, z, 1.2, 0.9, m.windows('house'), (side * Math.PI) / 2);
    b.flush();
    s.light(0, 2.4, 0.5, 0xffe2b0, 1, 16);
  }

  // ── Wharekai (dining hall), set back to the right of the ātea ──
  {
    const side = rng.chance(0.5) ? 1 : -1;
    const fk = s.at(side * 26, -6, (-side * Math.PI) / 2);
    const b = s.batch(fk);
    const roof = s.mat('corrugated', rng.pick([0x35603f, 0x5c6268, 0x7a2b22]), { metalness: 0.3 });
    walls(out, fk, 0, 0, 24, 3.3, 11, board);
    gableRoof(out, b.g(board), fk, 0, 3.3, 0, 24, 11, 2.4, roof, 0.45);
    out.collider(fk, 0, 1.65, 0, 24, 3.3, 11);
    // Entry porch towards the ātea, double doors, a row of windows.
    b.g(roof).slab([-2.6, 2.5, 7.6], [2.6, 2.5, 7.6], [2.6, 2.95, 5.5], [-2.6, 2.95, 5.5], 0.08);
    for (const x of [-2.4, 2.4]) b.g(white).post(x, 0, 7.4, 0.12, 2.5);
    b.g(s.mat('concrete')).box(0, 0.06, 6.6, 5.2, 0.12, 2.2);
    out.box(fk, 0, 1.1, 5.54, 1.9, 2.2, 0.08, ochre);
    windowRow(out, fk, -11.4, -1.6, 3, 1.75, 5.53, 2, 1.3, m.windows('house'));
    windowRow(out, fk, 1.6, 11.4, 3, 1.75, 5.53, 2, 1.3, m.windows('house'));
    windowRow(out, fk, -11, 11, 6, 1.9, -5.53, 1.6, 1.1, m.get('glass'), Math.PI);
    // Kitchen lean-to at the far end with its flue, and a water tank.
    const k = -side; // the end away from the road
    out.box(fk, k * 14, 0.6, 0, 4, 4.2, 8, board);
    b.g(roof).slabUp([k * 16.2, 2.3, 4.2], [k * 11.9, 3.1, 4.2], [k * 11.9, 3.1, -4.2], [k * 16.2, 2.3, -4.2], 0.08);
    b.g(s.mat('metal', 0x8f959a, { roughness: 0.5 })).tube([k * 14.5, 2.6, -2], [k * 14.5, 4.4, -2], 0.16, 0.16, 8);
    out.collider(fk, k * 14, 1.35, 0, 4, 2.7, 8);
    b.g(s.mat('corrugated', 0xa9adb0, { metalness: 0.4 })).lathe(k * 13.5, 0, -6.6, [[1.3, -0.3], [1.3, 2.1], [0, 2.35]], 12);
    b.flush();
    s.light(side * 19, 2.4, -6, 0xffe2b0, 0.9, 16);

    // Ablution block out the back, on the other side.
    const fa = s.at(-side * 20, -22);
    walls(out, fa, 0, 0, 7, 2.7, 4.4, s.mat('concrete', 0xcfc8b8));
    out.box(fa, 0, 2.85, 0, 7.6, 0.2, 5, roof);
    out.collider(fa, 0, 1.35, 0, 7, 2.7, 4.4);
    for (const x of [-2, 2]) out.box(fa, x, 1, 2.24, 0.9, 2, 0.08, s.mat('plain', 0x3a5a4a, { roughness: 0.6 }));

    // Car park on the other side from the wharekai.
    const cx = -side * 29;
    const gravel = new Geo();
    s.drape(gravel, cx, 14, 16, 30, 0.05);
    s.ribbon(gravel, [[cx, 29], [cx, 38]], 6, 0.05);
    gravel.flush(out, s.ground('gravel'), f);

    // Seats for the paepae beside the ātea, near the house.
    const seats = s.batch();
    const g = seats.g(s.mat('timber', 0x6a4a30));
    for (const z of [7, 10.4]) bench(g, side * 16.4, s.gy(side * 16.4, z), z, (-side * Math.PI) / 2, 2.6);
    // Flagpole beside the house.
    flagpole(seats.g(s.mat('paintedMetal', WHITE)), -side * 9, s.gy(-side * 9, 3), 3, 9);
    // Front fence with the car entrance left open, and the waharoa in the middle.
    const rail = seats.g(white);
    const openA = cx - 3.5;
    const openB = cx + 3.5;
    const runs: [number, number][] = side === 1 ? [[openB, -3], [3, 30]] : [[-30, -3], [3, openA]];
    for (const [x0, x1] of runs) if (x1 - x0 > 2) s.fence(rail, [[x0, 36], [x1, 36]], { height: 0.95, spacing: 2.4, rails: 2, post: 0.1 });
    seats.flush();
  }

  // ── Waharoa: two posts and a gabled lintel, with a modest name board ──
  {
    const fg = s.at(0, 36);
    const b = s.batch(fg);
    const red = b.g(ochre);
    for (const side of [-1, 1]) {
      red.post(side * 2.2, -0.3, 0, 0.42, 3.5, 0.3);
      red.beam([side * 2.9, 3.0, 0], [0, 4.1, 0], 0.16, 0.5);
      out.collider(fg, side * 2.2, 1.6, 0, 0.42, 3.2, 0.3);
    }
    red.box(0, 3.0, 0, 4.9, 0.3, 0.2);
    red.box(0, 4.45, 0, 0.3, 0.8, 0.24);
    b.flush();
    const name = s.label((p.name || 'Marae').toUpperCase());
    s.signBoard(fg, name, 5.4, 1.25, 0, 3.2, 4, { bg: '#3a2a22', fg: '#f2ede0', style: 'paint' });
    for (const sx of [-1.45, 1.45]) out.box(fg, 5.4 + sx, 0.5, 0, 0.1, 1.9, 0.1, ochre);
  }

  // Tī kōuka and harakeke along the boundary.
  for (const [x, z] of [[-33, 34], [33, 34], [-12, -30]] as const) s.prop('tree-cabbage', x, z, x, 1);
  for (const [x, z] of [[-8, 37.5], [9, 37.6], [20, 37.4], [-20, 37.5], [12, -27], [-6, -29]] as const) s.prop('flax', x, z, x * 2, 1);
};
