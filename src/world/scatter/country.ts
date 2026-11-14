import { hashInts, Rng } from '../../core/rng';
import type { Scatterer } from '../../core/types';
import { Geo } from '../landmarks/rural/kit';
import { PROP } from '../landmarks/rural/props';
import { SCATTERERS } from './registry';
import { DRESSING_OFF, edgesIn, Keep } from './util';

/**
 * The country between the fences (see ./rural.ts for the fences, stock and shelter belts themselves):
 *
 * - hill country (the Port Hills, the downs, the foothills): snow-tussock clumps, volcanic outcrops and gorse;
 * - the braided riverbeds: lupins, scrub and rough grass on the shingle above the water;
 * - the odd paddock with a travelling irrigator at work or a pole hay barn in its corner;
 * - roading gravel stockpiled on the verge every kilometre or so;
 * - a cattle stop where a gravel road leaves the seal.
 *
 * Everything is placed from world coordinates (32 m cells, paddock blocks, road samples), so chunks agree at
 * their edges; the big pieces belong to the chunk that holds their anchor point.
 */

const CELL = 32;
/** Paddock blocks, as in ./rural.ts and the terrain's patchwork tint. */
const BLOCK_X = 190;
const BLOCK_Z = 150;
const ORIGIN_X = 5000;
const ORIGIN_Z = 9000;
/** Darker than the sun-bleached turf they stand in, or they vanish against it. */
const TUSSOCK = [0x7d6f3a, 0x8a7c45, 0x6f6a3a, 0x94834a, 0x857540];
const GORSE = [0xb8c070, 0xd0c860, 0x9aa860];
const HILL = 28;

export const countryScatter: Scatterer = (area, out) => {
  const world = out.world;
  const graph = world.graph;
  const { minX, minZ, size } = area;
  if (DRESSING_OFF) return;
  let any = false;
  for (let j = 0; j < 3 && !any; j++) for (let i = 0; i < 3 && !any; i++) any = world.districtAt(minX + ((i + 0.5) * size) / 3, minZ + ((j + 0.5) * size) / 3).type === 'rural';
  if (!any) return;
  const keep = new Keep(world, area, 50);
  const m = out.materials;
  const unit = (h: number, shift: number) => ((h >>> shift) % 1000) / 1000;

  // ── Hill country and riverbeds, cell by cell ──
  for (let gz = Math.floor(minZ / CELL); gz * CELL < minZ + size; gz++) {
    for (let gx = Math.floor(minX / CELL); gx * CELL < minX + size; gx++) {
      const cx = (gx + 0.5) * CELL;
      const cz = (gz + 0.5) * CELL;
      if (world.districtAt(cx, cz).type !== 'rural') continue;
      const surface = world.surfaceAt(cx, cz);
      const bed = surface === 'shingle';
      if (!bed && (surface !== 'grass' || world.heightAt(cx, cz) < HILL)) continue;
      const count = bed ? 9 : 11;
      for (let k = 0; k < count; k++) {
        const h = hashInts(gx, gz, k, 9173);
        const x = gx * CELL + unit(h, 0) * CELL;
        const z = gz * CELL + unit(h, 10) * CELL;
        if (keep.inLandmark(x, z, 2) || keep.nearPlace(x, z, 5)) continue;
        const pick = unit(h, 20);
        const turn = unit(h, 4) * 6.28;
        const hit = graph.nearest(x, z, 14);
        if (hit && hit.distance < hit.edge.width / 2 + (pick > 0.82 ? 5 : 2.2)) continue;
        if (bed) {
          if (world.surfaceAt(x, z) !== 'shingle' || world.waterDepthAt(x, z) > 0) continue;
          const y = world.heightAt(x, z) - 0.05;
          if (pick < 0.58) out.instance('lupin', x, y, z, turn, 1.2 + unit(h, 14) * 1.1);
          else if (pick < 0.84) out.instance('tussock', x, y, z, turn, 0.9 + unit(h, 14) * 0.6, 0xa9a878);
          else out.instance('bush', x, y, z, turn, 0.8 + unit(h, 14) * 0.9, 0xc8d0a0);
        } else {
          if (world.surfaceAt(x, z) !== 'grass') continue;
          const y = world.heightAt(x, z);
          if (y < HILL - 4) continue;
          if (pick < 0.82) out.instance('tussock', x, y - 0.06, z, turn, 1.4 + unit(h, 14) * 1.3, TUSSOCK[h % TUSSOCK.length]);
          else if (pick < 0.92) out.instance('bush', x, y - 0.1, z, turn, 1 + unit(h, 14) * 0.9, GORSE[h % GORSE.length]);
          else out.instance('rock', x, y - 0.25, z, turn, 0.6 + unit(h, 14) * unit(h, 7) * 2.2);
        }
      }
    }
  }

  // ── Paddocks with something going on: a travelling irrigator, or a hay barn ──
  const steel = new Geo();
  const timber = new Geo();
  const iron = new Geo();
  const straw = new Geo();
  for (let ix = Math.floor((minX + ORIGIN_X) / BLOCK_X); ix * BLOCK_X - ORIGIN_X < minX + size; ix++) {
    for (let iz = Math.floor((minZ + ORIGIN_Z) / BLOCK_Z); iz * BLOCK_Z - ORIGIN_Z < minZ + size; iz++) {
      const use = new Rng(hashInts(ix, iz, 7919)).next();
      if (use < 0.64 || use >= 0.76) continue;
      const rng = new Rng(hashInts(ix, iz, 4409));
      const barn = use >= 0.72;
      const x = ix * BLOCK_X - ORIGIN_X + (barn ? rng.range(26, 50) : BLOCK_X / 2 + rng.range(-12, 12));
      const z = iz * BLOCK_Z - ORIGIN_Z + (barn ? rng.range(24, 44) : BLOCK_Z / 2 + rng.range(-10, 10));
      const yaw = rng.chance(0.5) ? 0 : Math.PI / 2;
      if (!keep.inArea(x, z) || keep.inLandmark(x, z, 40) || graph.nearest(x, z, 44)) continue;
      const y = world.heightAt(x, z);
      const reach = barn ? 8 : 30;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // Level, dry farmland under the whole thing.
      let level = y < HILL;
      for (const t of [-1, 0, 1]) {
        const px = x + cos * t * reach;
        const pz = z - sin * t * reach;
        level = level && world.districtAt(px, pz).type === 'rural' && world.surfaceAt(px, pz) === 'grass' && Math.abs(world.heightAt(px, pz) - y) < 0.9;
      }
      if (!level) continue;
      const f = out.frameAt(x, y, z, yaw);
      if (barn) {
        // Pole barn: six poles, an iron roof, last season's hay stacked to the purlins and a few round bales outside.
        for (const px of [-6, 0, 6]) for (const pz of [-3.6, 3.6]) timber.with(f, () => timber.post(px, -0.4, pz, 0.24, 5.6));
        for (const pz of [-3.6, 3.6]) timber.with(f, () => timber.box(0, 5.1, pz, 13, 0.2, 0.12));
        out.gable(f, 0, 5.2, 0, 13.6, 8.6, 1.5, m.get('corrugated', { color: rng.pick([0x8b3027, 0x8f959a, 0x6f3a2c, 0xa9a79d]) }));
        iron.with(f, () => iron.box(0, 5.25, 0, 13.4, 0.06, 8.4));
        const bays = rng.int(1, 2);
        straw.with(f, () => straw.box(bays === 2 ? 0 : -3, 2, 0, bays * 5.9, 4, 6.6));
        out.collider(f, bays === 2 ? 0 : -3, 2, 0, bays * 5.9, 4, 6.6);
        for (let i = 0; i < 4; i++) {
          const bx = x + cos * (9 + i * 1.7) + sin * 2;
          const bz = z - sin * (9 + i * 1.7) + cos * 2;
          out.instance(PROP.bale, bx, world.heightAt(bx, bz), bz, yaw + rng.range(-0.2, 0.2), rng.range(0.95, 1.05));
        }
      } else {
        // Travelling irrigator: a wheeled cart with a tower and two trussed booms, hose trailing back up the run.
        steel.with(f, () => {
          steel.box(0, 0.9, 0, 2.2, 0.5, 1.5);
          for (const wx of [-1.25, 1.25]) for (const wz of [-0.5, 0.5]) steel.tube([wx - 0.12, 0.55, wz], [wx + 0.12, 0.55, wz], 0.55, 0.55, 10);
          steel.tube([0, 1.1, 0], [0, 4.4, 0], 0.09, 0.07, 6);
          for (const side of [-1, 1]) {
            const tip: [number, number, number] = [side * 29, 2.5, 0];
            steel.tube([0, 3.0, 0], tip, 0.055, 0.045, 5, false);
            steel.beam([0, 4.4, 0], [side * 14.5, 3.45, 0], 0.03);
            steel.beam([side * 14.5, 3.45, 0], tip, 0.03);
            for (let i = 1; i <= 5; i++) {
              const bx = side * i * 4.8;
              const top = 3.0 - (i * 4.8 * 0.5) / 29;
              steel.beam([bx, top, 0], [bx, top - 0.9, 0], 0.025);
              if (i === 3) steel.beam([bx, top, 0], [bx, top + 0.7, 0], 0.03);
            }
          }
          steel.tube([-1.1, 0.5, 0], [-1.1, 0.14, -26], 0.06, 0.06, 5, false);
        });
        out.collider(f, 0, 1, 0, 2.2, 2, 1.9);
      }
    }
  }

  // ── Along the roads: gravel stockpiles on the verge, cattle stops where the gravel begins ──
  const gravel = new Geo();
  const concrete = new Geo();
  const white = new Geo();
  for (const e of edgesIn(graph, area)) {
    if (e.bridge || e.tunnel || e.footpaths || (e.cls !== 'highway' && e.cls !== 'gravel')) continue;
    for (let i = 5; i < e.samples.length - 5; i++) {
      const h = hashInts(e.index, i, 61);
      if (h % 223 !== 0) continue;
      const s = e.samples[i];
      const side = (h >>> 9) & 1 ? 1 : -1;
      const off = side * (e.width / 2 + (e.cls === 'highway' ? 3.4 : 3));
      const x = s.x + s.tz * off;
      const z = s.z - s.tx * off;
      if (!keep.inArea(x, z) || keep.inLandmark(x, z, 4) || keep.nearPlace(x, z, 6) || world.districtAt(x, z).type !== 'rural' || world.surfaceAt(x, z) !== 'grass') continue;
      const y = world.heightAt(x, z);
      const r = e.cls === 'highway' ? 1.75 : 1.5;
      gravel.lathe(x, y - 0.2, z, [[r, 0], [r * 0.35, r * 0.62], [0, r * 0.7]], 9);
      gravel.lathe(x + s.tx * r * 1.3, y - 0.2, z + s.tz * r * 1.3, [[r * 0.75, 0], [r * 0.25, r * 0.5], [0, r * 0.56]], 8);
    }
    if (e.cls !== 'gravel' || e.length < 40) continue;
    for (const end of [e.a, e.b]) {
      const node = graph.nodes[end];
      if (!keep.inArea(node.x, node.z) || !node.edges.some((i) => graph.edges[i].cls !== 'gravel' && graph.edges[i].cls !== 'pedestrian')) continue;
      const p = graph.pointAt(e, end === e.a ? 16 : e.length - 16);
      if (world.districtAt(p.x, p.z).type !== 'rural' || keep.inLandmark(p.x, p.z, 4) || keep.nearPlace(p.x, p.z, 8)) continue;
      const f = out.frameAt(p.x, p.y, p.z, Math.atan2(p.tx, p.tz));
      const half = e.width / 2;
      // Rails across the road, flush with it (a picture of a cattle stop: nothing to hit), nibs and wing rails either side.
      steel.with(f, () => {
        for (let r = -4; r <= 4; r++) steel.box(0, 0.035, r * 0.3, e.width + 0.3, 0.05, 0.09);
      });
      for (const side of [-1, 1]) {
        concrete.with(f, () => concrete.box(side * (half + 0.4), 0.12, 0, 0.3, 0.5, 3));
        white.with(f, () => {
          for (const y of [0.55, 0.95]) white.beam([side * (half + 0.5), y, 0], [side * (half + 5.6), y, 0], 0.09);
          white.post(side * (half + 0.55), -0.3, 0, 0.14, 1.5);
          white.post(side * (half + 3.1), -0.3, 0, 0.12, 1.4);
        });
      }
    }
  }

  // The same surface settings as the fence wires in ./rural.ts, so all of it merges into one mesh per chunk.
  steel.flush(out, m.get('metal', { color: 0x9aa0a2, roughness: 0.6 }));
  timber.flush(out, m.get('timber', { color: 0x6f5a44 }));
  iron.flush(out, m.get('metal', { color: 0x70757a, roughness: 0.6 }));
  straw.flush(out, m.get('plain', { color: 0xc8b468 }));
  gravel.flush(out, m.get('gravel'));
  concrete.flush(out, m.get('concrete'));
  white.flush(out, m.get('plain', { color: 0xecebe4 }));
};

SCATTERERS.push(countryScatter);
