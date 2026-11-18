import * as THREE from 'three';
import { hashInts, Rng } from '../../core/rng';

import { type Mat, type Site, WARM_LIGHT, bigDoor, door, frame, glow, ground, ledge, pane, quad, shade, tone, trim, win, worldX, worldZ } from './kit';
import { SPRAY, TAGS, board } from './names';

/**
 * The elevations nobody designed: the back of a shop row on its service lane, the flank that shows over a
 * lower neighbour, the second front a corner site turns to the side street. A player cannot go inside but
 * can walk right round, so these get what real ones have: back doors on a step under a bulkhead light, a
 * roller door, small high windows, sashes upstairs (some bricked up long ago), downpipes, a vent stack, a
 * fire escape, a tarred plinth.
 *
 * Everything is laid out on the wall's own elevation (t along the wall, y up) from a generator seeded by
 * where the wall is, so it does not depend on how much decoration the street front used.
 */
export interface ServiceWall {
  /** Middle of the wall on plan (lot coordinates) and the way it faces: π the back, ±π/2 the flanks. */
  x: number;
  z: number;
  yaw: number;
  len: number;
  /** Top of the wall, height of the ground storey and of each of the `rows` storeys above it. */
  top: number;
  ground: number;
  upper: number;
  rows: number;
  wall: Mat;
  /** 'back': doors, pipes, a fire escape. 'side': a party wall, mostly blank. 'street': a corner site's second front. */
  kind: 'back' | 'side' | 'street';
  /** Back doors wanted (one per shop). */
  doors?: number;
  /**
   * How far things may stand out from the wall before they leave the plot (default 0.05: a flank on the
   * boundary, where everything is kept nearly flat). Steps want 0.8, a fire escape 1.3.
   */
  room?: number;
  /** Paint for doors and steelwork. */
  paint?: number;
  /** On a 'street' wall: a display window in the bay nearest the front, or ('all') in every bay. */
  shop?: boolean | 'all';
  /** No roller door (a bank, a picture theatre) / no rainwater pipes (they run inside an office block). */
  dock?: boolean;
  pipes?: boolean;
  /** A stretch of the wall (from, to along it) whose upper floors stay bare: a painted sign is there. */
  clear?: [number, number];
}

const UPRIGHT = (() => {
  // Front and both cheeks of a unit box: all that shows of a pipe fixed to a wall.
  const g = new THREE.BufferGeometry();
  const p = [-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5];
  const n = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(24).fill(0), 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
  return g;
})();

/** A square pipe `w` across on the wall of a wall-framed site, from `y0` up to `y1`. */
function upright(ws: Site, t: number, y0: number, y1: number, w: number, mt: Mat) {
  ws.out.addGeometry(UPRIGHT, mt, new THREE.Matrix4().makeScale(w, y1 - y0, w).setPosition(t, (y0 + y1) / 2, w / 2 + 0.003).premultiply(ws.f));
}

const PIPE = [0x6f6d68, 0x3c4044, 0x8a8d90, 0x5a4634];
const STEEL = [0x2a2c2e, 0x5a2e22, 0x3a4a3e, 0x2a2c2e];

export function serviceWall(s: Site, o: ServiceWall) {
  if (o.len < 3 || !s.near) return;
  const r = new Rng(hashInts(s.lot.seed, Math.round(o.x * 2), Math.round(o.z * 2), Math.round(o.yaw * 4) + 9));
  // A site whose frame is the wall: x runs along it, z out of it. Its own seed, so no two walls furnish alike.
  const ws: Site = { ...s, f: frame(s, o.x, 0, o.z, o.yaw), lot: { ...s.lot, seed: hashInts(s.lot.seed, Math.round(o.yaw * 4) + 21) } };
  const cos = Math.cos(o.yaw);
  const sin = Math.sin(o.yaw);
  /** Terrain under a point on the wall, relative to the floor. */
  const earth = (t: number) => ground(s, o.x + cos * t + sin * 0.4, o.z - sin * t + cos * 0.4);
  const street = o.kind === 'street';
  const back = o.kind === 'back';
  const usable = o.len - 1.6;
  const n = Math.max(1, Math.floor(usable / (street ? 3.3 : 3)));
  const bayW = usable / n;
  const at = (i: number) => -usable / 2 + (i + 0.5) * bayW;
  const paint = o.paint ?? r.pick([0x5a2e22, 0x234a3a, 0x2a3a5a, 0x3c4044, 0x6a1f1f, 0x4a4d50]);
  const sashH = Math.min(1.95, o.upper - 1.5);
  const infill = tone(s, o.wall, r.pick([0.8, 0.86, 0.9]));
  const sill = s.j.sill ?? trim(s, 0xb9b4a8);
  const room = o.room ?? 0.05;
  const masonry = s.j.wall !== 'timber' && s.j.wall !== 'plain';
  /** A window with a slim sill that stays inside a boundary wall's 5 cm. */
  const opening = (t: number, y: number, w: number, h: number, lit: number, dressed: boolean, style?: 'casement') => {
    win(ws, t, y, 0, w, h, 0, { lit, framed: false, style });
    if (dressed && masonry && s.spare()) ledge(ws, t, y - h / 2 - 0.05, 0.045, w + 0.22, 0.1, 0.09, 0, sill);
  };
  /** Which ground-floor bay is what: 'door', 'roller', or free. */
  const use: string[] = new Array(n).fill('');
  const doors = back ? Math.max(1, Math.min(o.doors ?? 1, n)) : street ? 1 : 0;
  /** The bay nearest the street front, where a corner shop's display window goes. */
  const shopBay = street && o.shop && n > 1 ? (sin > 0 ? 0 : n - 1) : -1;
  for (let k = 0; k < doors; k++) {
    const i = Math.min(n - 1, Math.floor(((k + r.range(0.25, 0.75)) * n) / doors));
    use[i === shopBay ? (i === 0 ? 1 : i - 1) : i] = 'door';
  }
  if (back && n >= 3 && r.chance(0.45) && o.dock !== false) {
    const free = use.map((u, i) => (u ? -1 : i)).filter((i) => i >= 0);
    if (free.length) use[r.pick(free)] = 'roller';
  }

  // Ground floor.
  let steps = 0;
  for (let i = 0; i < n; i++) {
    const t = at(i);
    const gy = earth(t);
    if (gy > 0.9 || gy < -2.2) continue;
    const floor = Math.max(gy, -0.2);
    if (use[i] === 'door') {
      // A concrete step where there is room for one: the first back door, two on a free-standing building.
      const stepped = room >= 0.8 && steps < (street ? 2 : 1) && s.spare();
      const step = stepped ? 0.12 : 0.02;
      if (stepped) steps++;
      door(ws, t, floor + step, 0, paint, 0, 0.9, 2.05, street ? 1 : 0);
      if (stepped) ws.out.box(ws.f, t, (gy - 0.4 + floor + step) / 2, 0.36, 1.3, floor + step - (gy - 0.4), 0.72, trim(s, 0x9a968c));
      if (s.spare()) glow(ws, t, floor + step + 2.4, 0.045, 0.32, 0.16, WARM_LIGHT, 2);
    } else if (use[i] === 'roller' && bayW > 2.9 && o.ground > 3.4 && room >= 0.2) {
      bigDoor(ws, t, floor + 0.02, 0, Math.min(3, bayW - 0.5), 2.9, shade(paint, 1.15), r.chance(0.15), 0);
    } else if (i === shopBay || (street && o.shop === 'all')) {
      // The shop's display window turns the corner.
      pane(ws, 'shop', t, floor + 1.56, 0.04, Math.min(bayW - 0.5, 2.9), 2.08, 0, { color: 0x9da1a4, lit: 3, variant: 1 });
    } else if (street) {
      // A street wall is never left bare: every bay that is not a door has its window.
      opening(t, floor + 2, Math.min(r.pick([1.2, 1.5, 1.5]), bayW - 1.3), 1.7, 0.5, true);
    } else if (r.chance(back ? 0.55 : 0.12)) {
      // A small high window: a toilet, a storeroom.
      opening(t + r.range(-0.4, 0.4), floor + 2.35, r.pick([0.7, 0.9, 1.2]), 0.7, 0.2, false, 'casement');
    } else if (r.chance(0.2) && s.spare(2)) {
      quad(ws, t, floor + 1.9, 0.02, 1.1, 1.6, infill, 0, true);
    } else if (back && r.chance(0.03) && s.spare()) {
      // Somebody's been down the service lane with a spray can.
      board(ws, r.pick(TAGS), t + r.range(-0.3, 0.3), floor + 1.3, 0.025, 1.7, 3.2, SPRAY);
    }
  }

  // A steel fire escape down the back of anything three storeys or more: a landing and a door at each
  // floor, flights between them, the last one down to the yard.
  const rows = o.rows;
  let escape = -1;
  if (back && rows >= 2 && n >= 3 && room >= 1.3 && r.chance(0.7) && s.spare(rows * 5 + 2)) {
    // Not an end bay: the bottom flight needs somewhere to land.
    const free = use.map((u, i) => (u === 'roller' || i === 0 || i === n - 1 ? -1 : i)).filter((i) => i >= 0);
    escape = free.length ? r.pick(free) : 1;
    const t = at(escape);
    const steel = trim(s, r.pick(STEEL));
    const ironwork = shade(r.pick(STEEL), 1.2);
    for (let row = 0; row < rows; row++) {
      const fy = o.ground + row * o.upper;
      const dir = row % 2 ? -1 : 1;
      ws.out.box(ws.f, t, fy - 0.04, 0.6, 2.7, 0.07, 1.1, steel);
      pane(ws, 'picket', t, fy + 0.5, 1.14, 2.7, 1, 0, { color: ironwork, variant: 3 });
      pane(ws, 'picket', t, fy + 0.5, 1.14, 2.7, 1, Math.PI, { color: ironwork, variant: 3 });
      door(ws, t - dir * 0.75, fy, 0, paint, 0, 0.85, 2, 0);
      // The flight down from this landing runs along the wall on the outer half of the landing below.
      const ax = t + dir * 1.1;
      const bx = row === 0 ? Math.max(0.5 - o.len / 2, Math.min(o.len / 2 - 0.5, t - dir * 2.9)) : t - dir * 1.1;
      const by = row === 0 ? Math.min(0.1, earth(bx) + 0.1) : fy - o.upper;
      ws.out.box(frame(ws, (ax + bx) / 2, (fy + by) / 2, 0.86, 0, 0, Math.atan2(fy - by, ax - bx)), 0, 0, 0, Math.hypot(ax - bx, fy - by), 0.06, 0.5, steel);
    }
  }

  // Upper floors: sashes over the bays, the odd one bricked up.
  for (let row = 0; row < rows; row++) {
    const y = o.ground + row * o.upper + 0.9 + sashH / 2;
    for (let i = 0; i < n; i++) {
      const roll = r.next();
      if (i === escape || (o.clear && at(i) > o.clear[0] - 0.7 && at(i) < o.clear[1] + 0.7)) continue;
      const share = street ? 1 : back ? 0.7 : 0.3;
      // Only a street wall gets sills: round the back the reveal drawn in the glass is depth enough.
      if (roll < share) opening(at(i), y, 1.05, sashH, 0.3, street);
      else if (roll < share + 0.12 && s.spare(3)) {
        quad(ws, at(i), y, 0.02, 1.05, sashH, infill, 0, true);
        if (masonry && street) ledge(ws, at(i), y - sashH / 2 - 0.05, 0.045, 1.27, 0.1, 0.09, 0, sill);
      }
    }
  }

  // Rainwater down the ends of the wall (kept slim: a flank stands on the boundary), a vent stack, and
  // on a back wall the things that get bolted on over the years.
  const pipe = trim(s, r.pick(PIPE));
  const piped = o.pipes !== false;
  // A party wall keeps only its vent: whatever else it had is behind the neighbour.
  for (const end of street || o.len <= 18 ? [r.chance(0.5) ? -1 : 1] : [-1, 1]) {
    if (!piped || o.kind === 'side' || !s.spare(2)) continue;
    const t = end * (usable / 2 + 0.4);
    const y0 = Math.min(0, earth(t)) - 0.3;
    upright(ws, t, y0, o.top - 0.15, 0.085, pipe);
    if (street) ledge(ws, t, o.top - 0.29, 0.05, 0.24, 0.26, 0.1, 0, pipe);
  }
  if (piped && !street && r.chance(0.55) && s.spare()) {
    // A vent stack, drawn flat: it is 6 cm wide.
    const t = at(r.int(0, n - 1)) + bayW * 0.5 - 0.2;
    const y0 = Math.min(0, earth(t)) - 0.3;
    const y1 = o.top + (back ? 0.9 : 0.2);
    quad(ws, t, (y0 + y1) / 2, 0.045, 0.07, y1 - y0, pipe);
  }
  if (back && room >= 0.5) {
    const side = r.chance(0.5) ? -1 : 1;
    // A vent grille by the door, a condenser on brackets, a kitchen flue up past the parapet.
    if (r.chance(0.5) && s.spare()) pane(ws, 'louvre', at(use.indexOf('door')) + 0.95, Math.max(earth(0), -0.2) + 1.6, 0.03, 0.45, 0.6, 0, { color: 0x8a8d90 });
    if (r.chance(0.25) && s.spare(2)) {
      const t = side * (usable / 2 - 0.5);
      const y = rows > 0 ? o.ground + 0.2 : 2.7;
      ws.out.box(ws.f, t, y + 0.3, 0.22, 0.9, 0.62, 0.38, trim(s, 0xc9c9c2));
      pane(ws, 'louvre', t, y + 0.3, 0.415, 0.62, 0.44, 0, { color: 0x9a9d9f });
    }
    if (piped && r.chance(0.12) && s.spare(2)) ws.out.cylinder(ws.f, -side * (usable / 2 - 1.1), (2.7 + o.top + 1.3) / 2, 0.24, 0.16, 0.16, Math.round((o.top + 1.3 - 2.7) * 10) / 10, trim(s, 0x9a9d9f), 5);
  }
  // The meter box by the back door with its conduit, a kitchen extractor, an enamel plate nobody took down.
  if (!street) {
    const di = use.indexOf('door');
    const t = di >= 0 ? at(di) - bayW / 2 + 0.3 : -usable / 2 + 0.2;
    const gy = Math.max(earth(t), -0.2);
    if (r.chance(back ? 0.75 : 0.3) && s.spare() && gy < 0.9) {
      pane(ws, 'fitting', t, gy + 1.5, 0.03, 0.42, 0.6, 0, { color: r.pick([0xb9b4a8, 0x8a8d90, 0xd8d2c4, 0x6f7a72]), variant: 0 });
      const run = o.top - 0.4 - gy - 1.8;
      if (run > 0.2) quad(ws, t + 0.12, gy + 1.8 + run / 2, 0.018, 0.035, run, pipe);
    }
    if (back && r.chance(0.4) && s.spare()) pane(ws, 'fitting', at(r.int(0, n - 1)) + bayW / 2 - 0.55, Math.min(o.top - 0.6, Math.max(earth(0), -0.2) + r.range(2.7, 3.3)), 0.03, 0.46, 0.46, 0, { color: 0x9a9d9f, variant: 2 });
    if (r.chance(0.25) && s.spare()) pane(ws, 'fitting', at(r.int(0, n - 1)) - bayW / 2 + 0.75, Math.max(earth(0), -0.2) + r.range(1.5, 2.2), 0.025, 0.5, 0.34, 0, { color: r.pick([0xe8e2d0, 0x23405a, 0x8a2f2a, 0xd8b23a]), variant: 3 });
  }
  if (!street && r.chance(0.6) && s.spare()) {
    const lo = Math.min(earth(-o.len / 2 + 0.5), earth(o.len / 2 - 0.5), 0) - 0.4;
    const hi = Math.max(earth(-o.len / 2 + 0.5), earth(o.len / 2 - 0.5), 0) + r.pick([0.6, 0.9, 1.1]);
    quad(ws, 0, (lo + hi) / 2, 0.016, o.len - 0.04, hi - lo, tone(s, o.wall, 0.7), 0, true);
  }
}

/**
 * What can be seen of a flank (side: -1 the -x one, 1 the +x one): 'street' when a road runs along it,
 * 'open' when nothing is built beside it (a car park, a vacant section, a square), 'hidden' when the
 * neighbour's wall stands against it.
 *
 * Asks the world for the plots beside it (`lotsNear`; where a test double has none, every non-street flank
 * counts as hidden).
 */
export function flankView(s: Site, side: number): 'street' | 'open' | 'hidden' {
  if (facesStreet(s, side)) return 'street';
  const world = s.out.world;
  if (!world.lotsNear) return 'hidden';
  let covered = 0;
  for (const lz of [s.hd * 0.4, -s.hd * 0.4]) {
    const px = worldX(s, side * (s.hw + 3.5), lz);
    const pz = worldZ(s, side * (s.hw + 3.5), lz);
    let hit = false;
    for (const other of world.lotsNear(px, pz, 1)) {
      if (other === s.lot || other.seed === s.lot.seed) continue;
      const dx = px - other.x;
      const dz = pz - other.z;
      const c = Math.cos(other.heading);
      const sn = Math.sin(other.heading);
      if (Math.abs(dx * c - dz * sn) <= other.width / 2 + 0.6 && Math.abs(dx * sn + dz * c) <= other.depth / 2 + 0.6) {
        hit = true;
        break;
      }
    }
    if (hit) covered++;
  }
  return covered === 2 ? 'hidden' : 'open';
}

/** The service-wall treatment for a flank seen that way: a second front, a bare-ish open wall, a party wall. */
export const flankKind = (view: 'street' | 'open' | 'hidden'): Pick<ServiceWall, 'kind' | 'doors' | 'dock'> => (view === 'street' ? { kind: 'street' } : view === 'open' ? { kind: 'back', doors: 1, dock: false } : { kind: 'side' });

/**
 * The three walls of a free-standing shed that are not its front: an exit door each, the odd high window,
 * a downpipe, replaced sheets, and (with `strip`) a run of factory glazing under the eaves of a tall one.
 */
export function shedWalls(b: Site, cx: number, cz: number, w: number, d: number, H: number, wall: Mat, strip = true) {
  const faces: [number, number, number, number][] = [
    [cx - w / 2, cz, -Math.PI / 2, d],
    [cx + w / 2, cz, Math.PI / 2, d],
    [cx, cz - d / 2, Math.PI, w],
  ];
  for (const [x, z, yaw, len] of faces) {
    serviceWall(b, { x, z, yaw, len, top: H, ground: H, upper: 3, rows: 0, wall, kind: 'back', doors: 1, dock: false, room: 1 });
    const run = Math.min(len * 0.6, 12);
    if (strip && H >= 5.6 && len > 9 && b.spare()) pane(b, 'steel', x + Math.sin(yaw) * 0.03, H - 1.15, z + Math.cos(yaw) * 0.03, run, 1.1, yaw, { nx: Math.max(2, Math.round(run / 2.4)), color: 0x6a6d70, lit: 1 });
  }
}

/** True when a road runs along this flank of the plot (side: -1 the -x flank, 1 the +x flank). */
export function facesStreet(s: Site, side: number): boolean {
  const graph = s.out.world.graph as { nearest?: (x: number, z: number, max: number) => { distance: number; edge: { width: number } } | null } | undefined;
  if (!graph?.nearest) return s.lot.corner;
  const lx = side * (s.hw + 7);
  const hit = graph.nearest(worldX(s, lx, 0), worldZ(s, lx, 0), 24);
  return !!hit && hit.distance < hit.edge.width / 2 + 8;
}
