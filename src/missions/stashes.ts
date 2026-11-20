/**
 * Stashes: weapons somebody hid and has not come back for. They lie round the back of buildings, in the gap
 * between a wall and the next section's fence, where nobody walking the street would see them: behind the
 * shops in town, the sheds at the ports, the yards of Sydenham, a hay barn off the highway. No blip, no halo
 * (see `options.stash` on CombatApi.spawnPickup): they are for the player who goes looking.
 *
 * Where they are is worked out from the map, the same every game: each region below takes the building plots
 * round one of the contract places in a fixed shuffled order and puts a stash behind the first ones whose
 * back yard is open ground that can be walked to from a road.
 */
import { hashInts } from '../core/rng';
import type { DistrictType, Lot, WorldApi } from '../core/types';
import { findPlace } from './spots';

export interface StashRegion {
  id: string;
  /** Contract place the region is centred on, and how far out it reaches (m). */
  place: string;
  radius: number;
  /** What lies there, in the order the spots are found. */
  kinds: readonly string[];
  /** District types whose plots qualify (default: the commercial ones). */
  types?: readonly DistrictType[];
}

const COMMERCIAL: readonly DistrictType[] = ['cbd', 'shops', 'township', 'industrial', 'port'];
const FARM: readonly DistrictType[] = ['rural'];

/**
 * Thirty in all. Knives and pistols in town, the long guns at the ports and out in the country (farm guns),
 * and two katanas in the whole world: one in central Christchurch, one at the port in Timaru.
 */
export const STASH_REGIONS: readonly StashRegion[] = [
  { id: 'chch-cbd', place: 'cathedral-square', radius: 480, kinds: ['knife', 'pistol', 'bat', 'pistol', 'katana', 'knife'] },
  { id: 'sydenham', place: 'chch-garage', radius: 380, kinds: ['pistol', 'shotgun', 'knife'] },
  { id: 'lancaster', place: 'lancaster-park', radius: 380, kinds: ['bat', 'pistol'] },
  { id: 'new-brighton', place: 'new-brighton-beach', radius: 340, kinds: ['knife', 'pistol'] },
  { id: 'lyttelton', place: 'lyttelton-wharf', radius: 340, kinds: ['rifle', 'pistol'] },
  { id: 'timaru', place: 'timaru-gunshop', radius: 420, kinds: ['knife', 'bat', 'knife', 'pistol'] },
  { id: 'timaru-port', place: 'timaru-port-lockup', radius: 340, kinds: ['pistol', 'shotgun', 'katana'] },
  { id: 'washdyke', place: 'washdyke-saleyards', radius: 340, kinds: ['rifle'] },
  { id: 'temuka', place: 'temuka-pub', radius: 340, kinds: ['knife', 'shotgun'] },
  { id: 'ashburton', place: 'ashburton-stock-agent', radius: 380, kinds: ['pistol', 'bat'] },
  { id: 'rakaia', place: 'rakaia-salmon', radius: 300, kinds: ['rifle'] },
  { id: 'rangitata', place: 'rangitata-layby', radius: 900, kinds: ['shotgun'], types: FARM },
  { id: 'hinds', place: 'hinds-woolshed', radius: 2200, kinds: ['rifle'], types: FARM },
];

export const STASH = {
  /** How far behind a plot's back boundary the stash lies (m), and the margin kept from every plot. */
  behind: 1.3,
  lotPad: 0.5,
  /** Clear of the seal and the footpath beside it: kerb to stash (m). Off the street is the point. */
  roadClear: 3.5,
  railClear: 5,
  /** Apart from each other, and from every contract place (missions work there; shops and safehouses too). */
  spacing: 70,
  placeClear: 60,
  /** Margin outside a landmark's clear radius (landmarks are built by hand: no telling what stands where). */
  landmarkPad: 3,
  /** The story starts with a cricket bat: nothing better than a blade or a bat this near the start (m). */
  earlyPlace: 'timaru-spawn',
  earlyRadius: 250,
  /**
   * Can it be walked to? A flood fill over open ground from the stash, in steps of a metre, has to reach the
   * edge of a road within `reach` metres. `walkPad` is the room a person needs beside a plot boundary; `kerb`
   * is how near a road's edge counts as having got there.
   */
  reach: 40,
  walkPad: 0.3,
  kerb: 2,
  /** Found guns come back after this long (s), so there is still something to find after an arrest. Katanas do not. */
  respawn: 900,
};

/** Kinds allowed near the start of the story. */
const EARLY_OK = new Set(['knife', 'bat']);

export interface Stash {
  id: string;
  kind: string;
  x: number;
  z: number;
  region: string;
}

/** What `findStashes` reads off the world. */
export type StashWorld = Pick<WorldApi, 'graph' | 'places' | 'place' | 'landmarks' | 'waterDepthAt' | 'lotsNear'> & Partial<Pick<WorldApi, 'railways'>>;

export function inLot(lot: Lot, x: number, z: number, pad: number): boolean {
  const dx = x - lot.x;
  const dz = z - lot.z;
  const sin = Math.sin(lot.heading);
  const cos = Math.cos(lot.heading);
  return Math.abs(dx * cos - dz * sin) < lot.width / 2 + pad && Math.abs(dx * sin + dz * cos) < lot.depth / 2 + pad;
}

/** Open, dry, off the roads and rails, outside every plot, landmark and place, and apart from the others. */
function clear(world: StashWorld, x: number, z: number, taken: readonly Stash[]): boolean {
  if (world.waterDepthAt(x, z) > 0.05) return false;
  for (const lot of world.lotsNear!(x, z, 2)) if (inLot(lot, x, z, STASH.lotPad)) return false;
  const hit = world.graph.nearest(x, z, 60);
  if (hit && hit.distance < hit.edge.width / 2 + STASH.roadClear) return false;
  for (const l of world.landmarks) if (Math.hypot(l.x - x, l.z - z) < l.clearRadius + STASH.landmarkPad) return false;
  for (const p of world.places) if (Math.hypot(p.x - x, p.z - z) < STASH.placeClear) return false;
  for (const s of taken) if (Math.hypot(s.x - x, s.z - z) < STASH.spacing) return false;
  for (const rail of world.railways ?? []) {
    for (const p of rail.points) if (Math.abs(p.x - x) < STASH.railClear && Math.abs(p.z - z) < STASH.railClear) return false;
  }
  return true;
}

/** Flood fill from the stash over ground that is not a building plot or water: true once it meets a road's edge. */
export function reachable(world: StashWorld, x0: number, z0: number): boolean {
  const n = STASH.reach;
  const size = 2 * n + 1;
  const lots = world.lotsNear!(x0, z0, n + 2);
  const seen = new Uint8Array(size * size);
  const queue = new Int32Array(size * size);
  let head = 0;
  let tail = 0;
  seen[n * size + n] = 1;
  queue[tail++] = n * size + n;
  while (head < tail) {
    const cell = queue[head++];
    const i = (cell % size) - n;
    const j = Math.floor(cell / size) - n;
    const hit = world.graph.nearest(x0 + i, z0 + j, 14);
    if (hit && hit.distance <= hit.edge.width / 2 + STASH.kerb) return true;
    for (let k = 0; k < 4; k++) {
      const a = i + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const b = j + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (a < -n || a > n || b < -n || b > n) continue;
      const next = (b + n) * size + (a + n);
      if (seen[next]) continue;
      seen[next] = 1;
      const x = x0 + a;
      const z = z0 + b;
      if (world.waterDepthAt(x, z) > 0.05) continue;
      let blocked = false;
      for (let l = 0; l < lots.length && !blocked; l++) blocked = inLot(lots[l], x, z, STASH.walkPad);
      if (!blocked) queue[tail++] = next;
    }
  }
  return false;
}

/** Every stash on this map, in a fixed order. Empty when the world cannot say where its building plots are. */
export function findStashes(world: StashWorld): Stash[] {
  const out: Stash[] = [];
  if (!world.lotsNear) return out;
  const early = findPlace(world as WorldApi, STASH.earlyPlace);
  for (const region of STASH_REGIONS) {
    const centre = findPlace(world as WorldApi, region.place);
    if (!centre) continue;
    const types = region.types ?? COMMERCIAL;
    const order = (lot: Lot) => hashInts(Math.round(lot.x), Math.round(lot.z), 9173) >>> 0;
    const lots = world
      .lotsNear(centre.x, centre.z, region.radius)
      .filter((lot) => types.includes(lot.district.type) && Math.hypot(lot.x - centre.x, lot.z - centre.z) <= region.radius)
      .sort((a, b) => order(a) - order(b) || a.x - b.x || a.z - b.z);
    let found = 0;
    for (const lot of lots) {
      if (found >= region.kinds.length) break;
      const kind = region.kinds[found];
      // Round the back: a stride past the plot's rear boundary, on its centre line.
      const back = lot.depth / 2 + STASH.behind;
      const x = lot.x - Math.sin(lot.heading) * back;
      const z = lot.z - Math.cos(lot.heading) * back;
      if (early && !EARLY_OK.has(kind) && Math.hypot(early.x - x, early.z - z) < STASH.earlyRadius) continue;
      if (!clear(world, x, z, out) || !reachable(world, x, z)) continue;
      found++;
      out.push({ id: `stash-${region.id}-${found}`, kind, x, z, region: region.id });
    }
  }
  return out;
}
