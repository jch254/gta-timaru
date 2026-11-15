import { CREAM, type Mat, type Site, bigDoor, box, fence, ground, mat, prop, raised, roof, run, slope, solid, stretches, trim, walls, win } from './kit';

/**
 * The quarter-acre around a house: front fence and gate, letterbox, path, driveway, garage or carport,
 * washing line, boundary fences and planting. Shared by villas, state houses, township cottages and
 * farmhouses.
 */

export type FenceKind = 'picket' | 'block' | 'brick' | 'paling' | 'hedge' | 'rail' | 'wire' | 'none';

/** Where the house ended up, so the garden can be laid out around it. */
export interface Plot {
  x0: number;
  x1: number;
  /** Front-most and rear-most walls. */
  front: number;
  back: number;
  /** Foot of the front steps, and the height the house sits at above the lot's own level. */
  doorX: number;
  doorZ: number;
  floor: number;
}

export interface YardStyle {
  fence: FenceKind;
  fenceTint?: number;
  /** Side the driveway runs down; 0 for none. */
  drive: -1 | 0 | 1;
  driveKind: 'strips' | 'slab' | 'gravel';
  shelter: 'garage' | 'carport' | 'none';
  shed?: Mat;
  shedRoof?: Mat;
  washing: boolean;
  /** 0 bare lawn … 1 keen gardener. */
  planting: number;
  /** Paling fences down the side and across the back. */
  boundary: boolean;
}

const GARAGE_W = 3.1;
const GARAGE_D = 5.8;

export function yard(s: Site, p: Plot, o: YardStyle) {
  const zf = s.hd - 0.3;
  const xl = -s.hw + 0.2;
  const xr = s.hw - 0.2;
  const driveX = o.drive * (s.hw - 1.85);
  const roomForGarage = s.lot.depth >= 22 && s.lot.width >= 14;
  const shelter = o.drive === 0 || (o.shelter === 'garage' && !roomForGarage) ? 'none' : o.shelter;

  // Garage at the back corner (a second solid body), or a carport beside the house.
  const garageFront = -s.hd + 0.6 + GARAGE_D;
  if (shelter === 'garage') {
    const gz = garageFront - GARAGE_D / 2;
    const g = raised(s, ground(s, driveX, garageFront));
    const skin = o.shed ?? mat(s, 'corrugated', 0xb9b4a8);
    walls(g, driveX, gz, GARAGE_W, GARAGE_D, 2.3, skin);
    roof(g, driveX, 2.3, gz, GARAGE_W, GARAGE_D, 0.75, o.shedRoof ?? mat(s, 'corrugated'), { axis: 'z', eave: 0.12, gable: skin, fascia: null });
    bigDoor(g, driveX, 0, garageFront + 0.01, 2.4, 2, s.rng.pick([CREAM, 0x8a8d90, 0x6b3a2a, 0x2f5d3a, 0xd8d8d4]));
    solid(g, driveX, gz, GARAGE_W, GARAGE_D, 2.3);
    // A window in the side that faces the lawn.
    if (g.spare(2)) {
      const keep = g.j;
      g.j = { style: 'casement', variant: 0, frame: 0xf6f4ee, trim: 0xf6f4ee, wall: 'plain' };
      win(g, driveX - o.drive * (GARAGE_W / 2), 1.45, gz, 1, 0.8, (-o.drive * Math.PI) / 2, 0.1, false);
      g.j = keep;
    }
  } else if (shelter === 'carport') {
    const cz = p.front - 3.2;
    const g = raised(s, ground(s, driveX, cz));
    box(g, driveX, 2.25, cz, 2.9, 0.12, 5.6, o.shedRoof ?? mat(s, 'corrugated'));
    if (g.spare()) box(g, driveX, 2.14, cz + 2.78, 2.94, 0.2, 0.05, trim(g));
    for (const dz of [-2.6, 2.6]) box(g, driveX + o.drive * 1.3, -0.4, cz + dz, 0.1, 2.65, 0.1, trim(g));
  }

  // Driveway from the footpath.
  if (o.drive !== 0) {
    const end = shelter === 'garage' ? garageFront : shelter === 'carport' ? p.front - 6 : Math.min(p.front - 2, s.hd - 7);
    const ya = ground(s, driveX, s.hd);
    const yb = ground(s, driveX, end);
    const surface = o.driveKind === 'gravel' ? mat(s, 'gravel') : mat(s, 'concrete', 0xc4c0b4);
    const mid = ground(s, driveX, (s.hd + end) / 2);
    if (Math.abs(mid - (ya + yb) / 2) > 0.2) {
      // Undulating: follow the ground in two lengths.
      const zm = (s.hd + end) / 2;
      slope(s, driveX, ya, s.hd, driveX, mid, zm, 2.6, 0.12, surface);
      slope(s, driveX, mid, zm, driveX, yb, end, 2.6, 0.12, surface);
    } else if (o.driveKind === 'strips') {
      for (const dx of [-0.72, 0.72]) slope(s, driveX + dx, ya, s.hd, driveX + dx, yb, end, 0.55, 0.12, surface);
    } else {
      slope(s, driveX, ya, s.hd, driveX, yb, end, 2.6, 0.12, surface);
    }
  }

  // Front path to the steps.
  if (s.spare()) slope(s, p.doorX, ground(s, p.doorX, zf + 0.3), zf + 0.3, p.doorX, p.floor, p.doorZ, 1, 0.1, mat(s, 'concrete', 0xc4c0b4));

  // Front fence with gaps for the gate and the drive.
  const gaps: [number, number][] = [[p.doorX - 0.6, p.doorX + 0.6]];
  if (o.drive !== 0) gaps.push([driveX - 1.55, driveX + 1.55]);
  for (const [a, b] of stretches(xl, xr, gaps)) {
    if (o.fence === 'picket') {
      if (s.near) run(s, 'picket-fence', a, zf, b, zf, 2.4, o.fenceTint);
    } else if (o.fence === 'hedge') {
      if (s.near) run(s, 'hedge', a + 0.2, zf - 0.3, b - 0.2, zf - 0.3, 2, o.fenceTint);
    } else if (o.fence === 'wire') {
      if (s.near) run(s, 'farm-fence', a, zf, b, zf, 4);
    } else if (o.fence === 'rail') {
      if (s.spare(4)) fence(s, a, zf, b, zf, 0.1, 0.07, trim(s), 0.62);
      if (s.near) run(s, 'fence-post', a, zf, b, zf, 2.4, undefined, 0.72);
    } else if (o.fence !== 'none' && s.spare(4)) {
      if (o.fence === 'block') {
        fence(s, a, zf, b, zf, 0.62, 0.2, mat(s, 'concrete', 0xcfcabd));
        if (s.spare(2)) for (const x of [a, b]) box(s, x, ground(s, x, zf) - 0.3, zf, 0.32, 1.12, 0.32, mat(s, 'concrete', 0xc4bfb2));
      } else if (o.fence === 'brick') {
        fence(s, a, zf, b, zf, 0.7, 0.23, mat(s, 'brick'));
        if (s.spare(2)) for (const x of [a, b]) box(s, x, ground(s, x, zf) - 0.3, zf, 0.36, 1.2, 0.36, mat(s, 'brick'));
      }
      else fence(s, a, zf, b, zf, 1.05, 0.06, mat(s, 'timber', 0x9a8f80));
    }
  }

  // Letterbox by the gate.
  if (s.spare(2)) {
    const lx = p.doorX + (p.doorX > 0 ? -0.85 : 0.85);
    const gy = ground(s, lx, zf);
    box(s, lx, gy - 0.25, zf, 0.08, 1.2, 0.08, mat(s, 'timber'));
    box(s, lx, gy + 0.92, zf + 0.06, 0.26, 0.2, 0.42, trim(s, s.fx.pick([0xb5261e, CREAM, 0x2f5d3a, 0x8a8d90, 0x1f3f7a])));
  }

  // Paling fences down one side and across the back (the neighbour's fence closes the other side).
  if (o.boundary && s.spare(4)) {
    const paling = mat(s, 'timber', 0x8f867a);
    fence(s, -s.hw + 0.08, Math.min(p.front - 0.5, s.hd - 4), -s.hw + 0.08, -s.hd + 0.1, 1.5, 0.05, paling);
    if (s.spare(4)) fence(s, -s.hw + 0.1, -s.hd + 0.08, s.hw - 0.1, -s.hd + 0.08, 1.5, 0.05, paling);
  }

  // Garden shed in the back corner away from the drive (a solid body, so it is built at any detail level).
  const shedSide = o.drive === 0 ? s.rng.pick([-1, 1]) : -o.drive;
  const hasShed = s.rng.chance(0.4) && p.back - 3.2 > -s.hd + 0.8;
  if (hasShed) {
    const sx = shedSide * (s.hw - 1.5);
    const sz = -s.hd + 1.6;
    const g = raised(s, ground(s, sx, sz));
    const skin = mat(s, 'corrugated', s.rng.pick([0x9aa0a4, 0x8a7a66, 0x7d8a78, 0xa9a79d]));
    walls(g, sx, sz, 2.1, 1.9, 1.95, skin);
    slope(g, sx, 2.25, sz + 1.05, sx, 1.95, sz - 1.05, 2.3, 0.06, mat(s, 'corrugated', 0x8f959a));
    box(g, sx - shedSide * 0.3, 0, sz + 0.96, 0.75, 1.8, 0.04, trim(g, s.rng.pick([0x6b3a2a, 0x2f5d3a, 0x55606a])));
    g.out.collider(g.f, sx, 0.9, sz, 2.1, 2.2, 1.9);
  }

  if (!s.near) return;
  const fx = s.fx;
  const away = o.drive === 0 ? fx.pick([-1, 1]) : -o.drive;

  if (o.washing && p.back - 2.5 > -s.hd + 2) prop(s, 'washing-line', away * s.hw * fx.range(0.25, 0.5), (p.back + -s.hd) / 2 - fx.range(0, 1), fx.range(0, 1.5));

  // The lived-in back yard: a trampoline or a veggie patch on the lawn, a kennel or the incinerator drum
  // and the woodpile along the back fence. Only where the lot is deep enough that they sit behind the house.
  const backRoom = p.back - (-s.hd);
  if (backRoom > 7) {
    const bz = -s.hd + fx.range(2.5, Math.min(5.5, backRoom - 3.5));
    const bx = -away * s.hw * fx.range(0.2, 0.55);
    const toy = fx.int(0, 5);
    if (toy === 0) prop(s, 'trampoline', bx, bz, fx.range(0, 3));
    else if (toy <= 2) {
      // Veggie garden: a dug bed with rows of greens, fenced off from the dog.
      const vy = ground(s, bx, bz);
      box(s, bx, vy - 0.04, bz, 3.2, 0.16, 2.0, mat(s, 'plain', 0x3d3226));
      for (const dz of [-0.6, 0, 0.6]) run(s, 'grass-long', bx - 1.3, bz + dz, bx + 1.3, bz + dz, 2.1, 0x7fae56, 0.55);
    }
    if (fx.chance(0.22) && Math.abs(bx) < s.hw - 3) prop(s, 'kennel', away * (s.hw - 1.2), -s.hd + fx.range(1, 2.5), -away * (Math.PI / 2) + fx.range(-0.3, 0.3));
    if (fx.chance(0.25)) prop(s, 'drum', -away * (s.hw - 1), -s.hd + fx.range(0.8, 1.6), fx.range(0, 3), 1, 0x5a5146);
    if (fx.chance(0.28) && !hasShed) prop(s, 'woodpile', away * (s.hw - 1.6), -s.hd + fx.range(0.9, 1.8), fx.range(-0.2, 0.2), 0.8);
  }

  // Planting: shrubs along the front of the house, a specimen on the lawn, a fruit tree out the back.
  const shrubs = Math.round(o.planting * 3 + fx.range(-0.5, 0.5));
  for (let i = 0; i < shrubs; i++) {
    const x = fx.range(p.x0 + 0.5, p.x1 - 0.5);
    if (Math.abs(x - p.doorX) < 1.3) continue;
    prop(s, fx.pick(['bush', 'bush', 'flax', 'bush']), x, p.front + fx.range(0.5, 1.1), fx.range(0, 6), fx.range(0.7, 1.15));
  }
  const lawn = (p.front + zf) / 2;
  if (fx.chance(o.planting * 0.7) && zf - p.front > 2.5) {
    const tx = p.doorX + (p.doorX > (p.x0 + p.x1) / 2 ? -1 : 1) * fx.range(2.5, 4.5);
    if (Math.abs(tx - driveX) > 2.6 || o.drive === 0) prop(s, fx.pick(['tree-cabbage', 'tree-cabbage', 'bush', 'flax']), tx, lawn + fx.range(-0.5, 0.8), fx.range(0, 6), fx.range(0.75, 1.05));
  }
  if (fx.chance(o.planting * 0.55) && p.back - 4 > -s.hd + 2 && !(hasShed && away === shedSide)) prop(s, 'tree-oak', away * (s.hw - 3), -s.hd + 3, fx.range(0, 6), fx.range(0.55, 0.85));
  if (fx.chance(0.3)) prop(s, 'flax', p.doorX + (p.doorX > 0 ? -1.6 : 1.6), zf - 0.8, fx.range(0, 6), 0.8);
}
