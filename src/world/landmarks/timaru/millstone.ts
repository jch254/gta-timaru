import type { LandmarkBuilder, SignOptions } from '../../../core/types';
import { bench, gableRoof, Geo, Site, type V3 } from '../rural/kit';

/**
 * The Millstone, the nightclub in the old flour mill at the bottom of North Street (the Old Mill people
 * remember): an 1878 brick mill built against the bank, so it is one and two storeys on the uphill west side
 * and two, three and four on the railway side, with hipped and gabled iron roofs, roof ventilators, shallow
 * arched openings, a canopy over the old siding and faded lettering on the east wall. The club door is on
 * North Street under a little canopy and the pink neon.
 *
 * Local frame: +z is North Street (the north wall stands on the road boundary at z = +11), +x is uphill to the
 * west. The ground falls about nine metres across the site, so floors are worked out from the terrain.
 */

/** Just outside the club door on the footpath, facing the street (local). The Friday queue gathers here. */
export const MILLSTONE_DOOR: { x: number; z: number; heading: number } = { x: 3, z: 12.9, heading: 0 };

/** East (railway side) wall, west wall, North Street front, back. */
const EX = -13.5;
const WX = 17;
const FZ = 11;
const BZ = -11;
/** Mill storey height. */
const ST = 3.5;
/** Brick frieze between the top floor's ceiling and the eaves. */
const FRIEZE = 0.4;

const GHOST: SignOptions = { bg: '#8a4c3c', fg: '#c4ae8c', style: 'paint', border: false };
const NEON: SignOptions = { bg: '#140c16', fg: '#ff4fa8', style: 'neon', border: false };

interface Mass {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
}

type Face = 'n' | 's' | 'e' | 'w';

export const nightclub: LandmarkBuilder = (p, out) => {
  const s = new Site(p, out);
  const f = s.f;
  const b = s.batch();
  const G = (x: number, z: number) => s.gy(x, z);
  const sample = (x0: number, x1: number, z0: number, z1: number, pick: (a: number, b: number) => number, start: number) => {
    let v = start;
    for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) v = pick(v, G(x0 + ((x1 - x0) * i) / 3, z0 + ((z1 - z0) * j) / 3));
    return v;
  };
  const low = (x0: number, x1: number, z0: number, z1: number) => sample(x0, x1, z0, z1, Math.min, Infinity);
  const high = (x0: number, x1: number, z0: number, z1: number) => sample(x0, x1, z0, z1, Math.max, -Infinity);

  // The mill's lowest floor is the level of the old siding along the east side.
  const F0 = low(-17, EX, BZ, FZ);
  const yWn = high(WX - 0.3, WX + 0.3, 1, FZ);
  const yWs = high(WX - 0.3, WX + 0.3, BZ, 1);
  const door = high(MILLSTONE_DOOR.x - 1.8, MILLSTONE_DOOR.x + 1.8, FZ + 0.2, FZ + 1.4) + 0.12;
  // Two storeys on the bank at the north-west, one at the south-west, never above the four-storey mill. Each
  // block of the old mill gets more storeys if the bank under it would otherwise bury it.
  const storeys = (x0: number, x1: number, z0: number, z1: number, n: number) => Math.max(n, Math.ceil((high(x0, x1, z0, z1) - F0 + 2.4 - FRIEZE) / ST));
  const n1 = storeys(EX, -1.5, 3, FZ, 3);
  const n3 = storeys(EX, -1.5, BZ, -5, 2);
  const n2 = Math.max(storeys(EX, -1.5, -5, 3, 4), n1 + 1, n3 + 1);
  const top4 = Math.max(door + 5.8, Math.min(yWn + 2 * ST + FRIEZE, F0 + n2 * ST - 0.6));
  const top5 = Math.max(yWs + 3.2, Math.min(yWs + ST + FRIEZE, top4 - 0.6));
  const m1: Mass = { x0: EX, x1: -1.5, z0: 3, z1: FZ, top: F0 + n1 * ST + FRIEZE };
  const m2: Mass = { x0: EX, x1: -1.5, z0: -5, z1: 3, top: F0 + n2 * ST + FRIEZE };
  const m3: Mass = { x0: EX, x1: -1.5, z0: BZ, z1: -5, top: F0 + n3 * ST + FRIEZE };
  const m4: Mass = { x0: -1.5, x1: WX, z0: 1, z1: FZ, top: top4 };
  const m5: Mass = { x0: -1.5, x1: WX, z0: BZ, z1: 1, top: top5 };

  const brick = s.mat('brick');
  const roof = s.mat('corrugated', 0x7e3e2e);
  const roofGrey = s.mat('corrugated', 0x8f959a);
  const ends = b.g(brick);
  const band = b.g(s.mat('brick', 0x6e3426));
  const sill = b.g(s.mat('concrete', 0x9a9488));
  const pane = b.g(s.mat('glass', 0x2e3438));
  const blind = b.g(s.mat('paintedMetal', 0x1c1c20));
  const boards = b.g(s.mat('timber', 0x3c4a3a));
  const iron = b.g(s.mat('paintedMetal', 0x2a2d30));
  const timber = b.g(s.mat('timber', 0x6a5238));

  // Brick masses, carried a little below the lowest ground under each so the bank never shows a gap, with a
  // dark course at the eaves and, on the old mill, under each floor's sills.
  for (const m of [m1, m2, m3, m4, m5]) {
    const cx = (m.x0 + m.x1) / 2;
    const cz = (m.z0 + m.z1) / 2;
    const w = m.x1 - m.x0;
    const d = m.z1 - m.z0;
    const foot = low(m.x0, m.x1, m.z0, m.z1) - 1.2;
    ends.box(cx, (m.top + foot) / 2, cz, w, m.top - foot, d, 0, false);
    out.collider(f, cx, (m.top + foot) / 2, cz, w, m.top - foot, d);
    band.box(cx, m.top - 0.15, cz, w + 0.08, 0.3, d + 0.08);
    if (m.x0 === EX) for (let floor = m.top - FRIEZE - ST; floor > F0 + 0.2; floor -= ST) band.box(cx, floor + 0.85, cz, w + 0.08, 0.12, d + 0.08);
  }

  // Roofs: the front block hipped, the rest gabled, ridges running east-west so the tall mill shows its
  // gable to the railway.
  out.gable(f, (m1.x0 + m1.x1) / 2, m1.top, (m1.z0 + m1.z1) / 2, m1.x1 - m1.x0 + 0.5, m1.z1 - m1.z0 + 0.5, 2.4, roof, 2.4);
  gableRoof(out, ends, f, (m2.x0 + m2.x1) / 2, m2.top, (m2.z0 + m2.z1) / 2, m2.x1 - m2.x0, m2.z1 - m2.z0, 2.8, roofGrey, 0.35);
  gableRoof(out, ends, f, (m3.x0 + m3.x1) / 2, m3.top, (m3.z0 + m3.z1) / 2, m3.x1 - m3.x0, m3.z1 - m3.z0, 2.0, roof, 0.35);
  gableRoof(out, ends, f, (m4.x0 + m4.x1) / 2, m4.top, (m4.z0 + m4.z1) / 2, m4.x1 - m4.x0, m4.z1 - m4.z0, 2.4, roof, 0.3);
  gableRoof(out, ends, f, (m5.x0 + m5.x1) / 2, m5.top, (m5.z0 + m5.z1) / 2, m5.x1 - m5.x0, m5.z1 - m5.z0, 2.6, roof, 0.3);
  // Ventilators: round cowls on the ridges, a louvred lantern on the long back roof.
  const vent = b.g(s.mat('paintedMetal', 0x8a8f92));
  const cowl: [number, number][] = [[0.2, 0], [0.2, 0.45], [0.42, 0.55], [0.42, 0.92], [0.26, 1.05], [0, 1.12]];
  for (const [x, y, z] of [[-10, m2.top + 2.65, -1], [-5, m2.top + 2.65, -1], [-7.5, m1.top + 2.25, 7], [5, m4.top + 2.25, 6], [12, m4.top + 2.25, 6]] as const) vent.lathe(x, y, z, cowl, 8);
  vent.box(7.75, m5.top + 2.75, -5, 3, 0.45, 0.8);
  vent.box(7.75, m5.top + 3.02, -5, 3.3, 0.06, 1.1);
  // Hoist beam under the mill's east gable, where the sacks went up.
  timber.box(EX - 0.55, m2.top + 0.9, -1, 1.1, 0.24, 0.24);
  iron.tube([EX - 1.0, m2.top + 0.78, -1], [EX - 1.0, m2.top - 0.4, -1], 0.02, 0.02, 4, false);

  /** Opening with a shallow segmental arch, centred at (px, pz) on a wall facing `yaw`. */
  const opening = (px: number, pz: number, yaw: number, y0: number, w: number, h: number, fill: Geo, withSill = true) => {
    const sg = Math.min(0.22, w * 0.15);
    const r = (w * w) / 4 / (2 * sg) + sg / 2;
    const th = Math.asin(w / (2 * r));
    const yc = y0 + h - r * Math.cos(th);
    b.at(px, 0, pz, yaw, () => {
      fill.poly([[-w / 2, y0, 0.02], [w / 2, y0, 0.02], [w / 2, y0 + h, 0.02], [-w / 2, y0 + h, 0.02]]);
      const head: V3[] = [[-w / 2, y0 + h, 0.02], [w / 2, y0 + h, 0.02]];
      for (let i = 1; i < 4; i++) {
        const t = Math.PI / 2 - th + (2 * th * i) / 4;
        head.push([r * Math.cos(t), yc + r * Math.sin(t), 0.02]);
      }
      fill.poly(head);
      band.arch(0, yc, 0.03, r, r + 0.24, 0.06, Math.PI / 2 - th, Math.PI / 2 + th, 4);
      if (withSill) sill.box(0, y0 - 0.05, 0.06, w + 0.2, 0.1, 0.12);
    });
  };

  /**
   * A column of windows at each position along one face of a mass, one per floor counting down from the
   * eaves, wherever the sill clears the ground outside (and `above`, a roof in front). The lowest floor of
   * the mill gets `groundFill` (loading doors on the siding, blacked-out windows to the street).
   */
  const windows = (m: Mass, face: Face, us: number[], o: { above?: number; groundFill?: Geo; door?: boolean } = {}) => {
    const yaw = face === 'n' ? 0 : face === 's' ? Math.PI : face === 'e' ? -Math.PI / 2 : Math.PI / 2;
    const nx = Math.sin(yaw);
    const nz = Math.cos(yaw);
    for (const u of us) {
      const px = face === 'n' || face === 's' ? u : face === 'e' ? m.x0 : m.x1;
      const pz = face === 'e' || face === 'w' ? u : face === 'n' ? m.z1 : m.z0;
      const ground = G(px + nx * 0.6, pz + nz * 0.6);
      for (let k = 1; ; k++) {
        const floor = m.top - FRIEZE - k * ST;
        if (floor < F0 - 0.2 || floor + 1.0 < ground + 0.3) break;
        if (o.above !== undefined && floor + 1.0 < o.above) break;
        const lowest = floor < F0 + 0.2;
        // Loading doors only where the yard outside is at floor level; further up the bank it is a window.
        if (lowest && o.door && ground < floor + 0.6) opening(px, pz, yaw, floor, 2.4, 2.7, boards, false);
        else opening(px, pz, yaw, floor + 1.0, 1.1, 1.6, lowest && o.groundFill ? o.groundFill : pane);
      }
    }
  };
  windows(m1, 'n', [-11.4, -7.5, -3.6], { groundFill: blind });
  windows(m1, 'e', [5.2, 8.8], { door: true });
  windows(m2, 'e', [-3.4, 1.4], { door: true });
  windows(m2, 'n', [-11, -7.5, -4], { above: m1.top + 0.3 });
  windows(m2, 's', [-11, -7.5, -4], { above: m3.top + 0.3 });
  windows(m2, 'w', [-3.4, 1.4], { above: Math.max(m4.top, m5.top) + 0.3 });
  windows(m3, 'e', [-8], { door: true });
  windows(m3, 's', [-10.5, -6.5, -2.5]);
  windows(m4, 'n', [8.4, 11.8, 15.2], { groundFill: blind });
  windows(m4, 'w', [3.5, 8.5]);
  windows(m5, 'w', [-8, -3]);
  windows(m5, 's', [2.5, 7.5, 12.5]);

  // Faded lettering from the milling days on the railway side, between the floors.
  s.sign(f, 'ROLLER FLOUR MILLS', EX - 0.05, F0 + 2 * ST + 3.65, -1, 7.4, 8.2, GHOST, -Math.PI / 2);
  s.sign(f, 'WHEATMEAL & OATMEAL', EX - 0.05, F0 + ST + 3.65, 7, 6.6, 8.25, GHOST, -Math.PI / 2);

  // Canopy over the ground floor on the east side, on iron posts, sheltering the old siding where it runs at
  // the mill's floor level (from the street end back until the bank comes up).
  const cy0 = F0 + 4.3;
  const cy1 = F0 + 3.8;
  const stations = [10, 5, 0, -5, -10];
  let kept = 2;
  while (kept < stations.length && Math.max(G(-16.7, stations[kept]), G(EX - 0.4, stations[kept])) < F0 + 1.6) kept++;
  const c0 = kept === stations.length ? -10.5 : stations[kept - 1] - 0.5;
  const cl = 10.5 - c0;
  const cm = (10.5 + c0) / 2;
  b.g(roofGrey).slabUp([-17, cy1, c0], [EX, cy0, c0], [EX, cy0, 10.5], [-17, cy1, 10.5], 0.1);
  timber.box(-16.95, cy1 - 0.14, cm, 0.08, 0.3, cl);
  out.collider(f, (EX - 17) / 2, (cy0 + cy1) / 2 - 0.1, cm, EX + 17, 0.4, cl);
  for (const z of stations.slice(0, kept)) {
    const y = G(-16.7, z);
    iron.tube([-16.7, y - 0.2, z], [-16.7, cy1 - 0.05, z], 0.09, 0.09, 6, false);
    timber.beam([-16.7, cy1 - 0.12, z], [EX, cy0 - 0.18, z], 0.12, 0.18);
    out.collider(f, -16.7, (y - 0.2 + cy1) / 2, z, 0.2, cy1 - y + 0.2, 0.2);
  }
  // The siding itself: ballast, sleepers, rails, a buffer stop at the street end.
  const rx = -15.25;
  const ballast = new Geo();
  s.ribbon(ballast, [[rx, c0], [rx, FZ - 0.3]], 2.6, 0.04);
  ballast.flush(out, s.ground('gravel', 0x6e665c), f);
  const sleepers = b.g(s.mat('timber', 0x4a3e32));
  for (let z = c0 + 0.3; z < FZ - 0.4; z += 0.9) sleepers.box(rx, G(rx, z) + 0.07, z, 2.1, 0.14, 0.22);
  const steel = b.g(s.mat('metal', 0x5a5450, { roughness: 0.7 }));
  for (const side of [-0.535, 0.535]) {
    for (let z = c0 + 0.2; z < FZ - 0.5; z += 2.6) {
      const z1 = Math.min(FZ - 0.5, z + 2.6);
      steel.beam([rx + side, G(rx, z) + 0.2, z], [rx + side, G(rx, z1) + 0.2, z1], 0.07, 0.12);
    }
  }
  const stop = G(rx, FZ - 0.6);
  b.g(s.mat('paintedMetal', 0xa5332a)).box(rx, stop + 0.65, FZ - 0.6, 2.0, 0.3, 0.3);
  for (const side of [-0.6, 0.6]) timber.post(rx + side, stop - 0.2, FZ - 0.6, 0.2, 1.0);

  // ── The club door on North Street.
  const dx = MILLSTONE_DOOR.x;
  const stoopLow = low(dx - 1.8, dx + 1.8, FZ, FZ + 1.4) - 0.5;
  b.g(s.mat('concrete', 0xa8a294)).box(dx, (door + stoopLow) / 2, FZ + 0.7, 3.6, door - stoopLow, 1.4);
  out.collider(f, dx, (door + stoopLow) / 2, FZ + 0.7, 3.6, door - stoopLow, 1.4);
  // Through the glass, the lit foyer.
  opening(dx, FZ, 0, door, 2.2, 2.4, b.g(s.m.emitter(0xffa868, 'night')), false);
  for (const x of [-1.08, 0, 1.08]) iron.box(dx + x, door + 1.2, FZ + 0.06, x === 0 ? 0.08 : 0.06, 2.4, 0.06);
  iron.box(dx, door + 0.25, FZ + 0.06, 2.2, 0.5, 0.05).box(dx, door + 2.38, FZ + 0.06, 2.2, 0.06, 0.05);
  const chrome = b.g(s.mat('chrome'));
  for (const x of [-0.2, 0.2]) chrome.box(dx + x, door + 1.1, FZ + 0.1, 0.04, 0.5, 0.03);
  s.sign(f, 'TONIGHT', dx - 0.55, door + 1.55, FZ + 0.04, 0.75, 2.4, { bg: '#f4c400', fg: '#1c1c20', style: 'block' });

  // A little canopy on rods with the neon over it.
  const cy = door + 3.0;
  iron.box(dx, cy, FZ + 1.2, 4.6, 0.36, 2.4);
  b.g(s.m.emitter(0xffd0e0, 'night')).box(dx - 1.2, cy - 0.19, FZ + 1.6, 0.3, 0.02, 0.3).box(dx + 1.2, cy - 0.19, FZ + 1.6, 0.3, 0.02, 0.3);
  for (const x of [-2, 2]) iron.tube([dx + x, cy + 0.15, FZ + 2.2], [dx + x, cy + 1.6, FZ + 0.05], 0.02, 0.02, 4, false);
  s.sign(f, 'CABARET', dx, cy, FZ + 2.41, 3.2, 3.2 / 0.34, { ...NEON, fg: '#ffd84a' });
  iron.box(dx, cy + 1.35, FZ + 0.06, 6.2, 1.4, 0.12);
  s.sign(f, 'THE MILLSTONE', dx, cy + 1.35, FZ + 0.125, 6.0, 6.0 / 1.25, NEON);

  // Posters for the bands, west of the door where the queue stands.
  const posters: [string[], SignOptions][] = [
    [['LIVE BANDS', 'FRI & SAT', 'THE PLEASANT POINTERS'], { bg: '#f2e6c8', fg: '#b0271f', style: 'block' }],
    [['CABARET', 'SAT 9PM', 'SOUTHERN DRIFT'], { bg: '#1b2340', fg: '#f4c400', style: 'block' }],
    [['THURSDAY', 'STUDENT NIGHT', 'THE CRAIGIE DOGS'], { bg: '#e07aa8', fg: '#1c1c20', style: 'block' }],
  ];
  posters.forEach(([lines, look], i) => {
    const x = dx + 2.1 + i * 0.9;
    const y = G(x, FZ + 0.4) + 1.55;
    b.g(s.mat('plain', 0xf0e6c8)).box(x, y, FZ + 0.012, 0.8, 1.0, 0.02);
    s.signStack(f, lines, x, y, FZ + 0.025, 0.74, 0.28, look);
  });

  // The rope and stanchions for the queue, and the smokers' bench on the other side of the door.
  const rope = b.g(s.mat('cloth', 0x8a1a22));
  const posts = [dx + 1.9, dx + 3.5, dx + 5.1, dx + 6.7].map((x) => [x, G(x, FZ + 1.5)] as const);
  for (const [x, y] of posts) {
    chrome.lathe(x, y, FZ + 1.5, [[0, 0], [0.17, 0], [0.17, 0.04], [0.03, 0.07]], 8);
    chrome.post(x, y, FZ + 1.5, 0.05, 0.95);
    chrome.lathe(x, y + 0.95, FZ + 1.5, [[0, 0], [0.05, 0.03], [0.05, 0.07], [0, 0.1]], 6);
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const [ax, ay] = posts[i];
    const [bx, by] = posts[i + 1];
    const mid: V3 = [(ax + bx) / 2, (ay + by) / 2 + 0.7, FZ + 1.5];
    rope.tube([ax, ay + 0.88, FZ + 1.5], mid, 0.025, 0.025, 5, false);
    rope.tube(mid, [bx, by + 0.88, FZ + 1.5], 0.025, 0.025, 5, false);
  }
  const by = G(-3.2, FZ + 0.45);
  bench(timber, -3.2, by, FZ + 0.45, 0, 1.6);
  out.collider(f, -3.2, by + 0.45, FZ + 0.45, 1.6, 0.9, 0.45);
  b.g(s.mat('paintedMetal', 0x3a3d40)).lathe(-2.05, G(-2.05, FZ + 0.35), FZ + 0.35, [[0, 0], [0.17, 0], [0.15, 0.7], [0.19, 0.72], [0.19, 0.76], [0, 0.76]], 8);

  b.flush();
  s.light(dx, cy - 0.4, FZ + 1.6, 0xff6ab0, 130, 14);
  s.light(-15.2, F0 + 3.3, cm, 0xffd8a0, 90, 16);
};
