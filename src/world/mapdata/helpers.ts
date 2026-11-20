import * as THREE from 'three';
import { angleDiff } from '../../core/math';
import type { CityId, DistrictType, RoadClass } from '../../core/types';
import { inShape, segSegIntersect, type MapBuilder, type Pt, type RoadOptions } from '../mapsource';

/** Same curve fit `world/map.ts` applies to `smooth` roads, rivers and rails (kept in step by hand). */
export function smoothPts(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]] as Pt);
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'centripetal',
  );
  const n = Math.max(2, Math.round(curve.getLength() / 12));
  return curve.getSpacedPoints(n).map((p) => [p.x, p.z] as Pt);
}

export const r1 = (v: number) => Math.round(v * 10) / 10;
export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Heading (contract convention: forward = (sin h, cos h)) that looks from `from` towards `to`. */
export const facing = (from: Pt, to: Pt) => Math.atan2(to[0] - from[0], to[1] - from[1]);

function cumulative(pts: Pt[]): number[] {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + dist(pts[i], pts[i - 1]));
  return lens;
}

function pointAtLen(pts: Pt[], lens: number[], s: number): Pt {
  let seg = 0;
  while (seg < pts.length - 2 && lens[seg + 1] < s) seg++;
  const t = Math.min(1, Math.max(0, (s - lens[seg]) / (lens[seg + 1] - lens[seg] || 1)));
  return [pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t];
}

/** Sub-polyline between two distances along a polyline. */
function slice(pts: Pt[], lens: number[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [pointAtLen(pts, lens, s0)];
  for (let i = 0; i < pts.length; i++) if (lens[i] > s0 + 0.5 && lens[i] < s1 - 0.5) out.push(pts[i]);
  out.push(pointAtLen(pts, lens, s1));
  return out.map(([x, z]) => [r1(x), r1(z)] as Pt);
}

/** A river centreline as authored, kept so roads can find where they cross it. */
export interface RiverLine {
  name: string;
  width: number;
  /** Name given to bridges over it when the road does not supply one. */
  bridgeName?: string;
  pts: Pt[];
  lens: number[];
}

interface Crossing {
  river: RiverLine;
  /** Distance along the road. */
  s: number;
  /** Distance along the river. */
  rs: number;
  /** |sin| of the angle between road and river. */
  sin: number;
  /** +1 when the road travels from the river's right bank to its left bank. */
  toLeft: 1 | -1;
}

export interface BridgeEnd {
  river: RiverLine;
  rs: number;
  /** +1 = left bank (looking downstream), -1 = right bank. */
  bank: 1 | -1;
  pt: Pt;
}

export interface XOptions extends RoadOptions {
  /** Name for bridge spans (default "<road> Bridge" or the river's bridgeName). */
  bridgeName?: string;
  /** Extra half-length added to every bridge. */
  bridgeMargin?: number;
  /** Carriageway width on bridge spans (defaults to the road's). */
  bridgeWidth?: number;
  /** Class for the bridge spans (default: same as the road). */
  bridgeClass?: RoadClass;
}

/** Authoring context shared by the area files. */
export class Author {
  rivers: RiverLine[] = [];
  bridgeEnds: BridgeEnd[] = [];
  /** Landform height (set once the terrain features are authored). */
  natural: (x: number, z: number) => number = () => 8;

  constructor(readonly b: MapBuilder) {}

  river(name: string, pts: Pt[], width: number, options: { braided?: boolean; depth?: number; bridgeName?: string } = {}): RiverLine {
    this.b.river(name, pts, width, { braided: options.braided, depth: options.depth });
    const sm = smoothPts(pts);
    const line: RiverLine = { name, width, bridgeName: options.bridgeName, pts: sm, lens: cumulative(sm) };
    this.rivers.push(line);
    return line;
  }

  private crossings(pts: Pt[], lens: number[]): Crossing[] {
    const out: Crossing[] = [];
    for (const river of this.rivers) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, z1] = pts[i];
        const [x2, z2] = pts[i + 1];
        for (let j = 0; j < river.pts.length - 1; j++) {
          const [x3, z3] = river.pts[j];
          const [x4, z4] = river.pts[j + 1];
          const hit = segSegIntersect(x1, z1, x2, z2, x3, z3, x4, z4, 1e-9);
          if (!hit) continue;
          const { ua, ub, den } = hit;
          if (ua < 0 || ua >= 1 || ub < 0 || ub >= 1) continue;
          const la = lens[i + 1] - lens[i];
          const lb = river.lens[j + 1] - river.lens[j];
          const cross = den / (la * lb);
          out.push({ river, s: lens[i] + ua * la, rs: river.lens[j] + ub * lb, sin: Math.abs(cross), toLeft: cross > 0 ? 1 : -1 });
        }
      }
    }
    return out.sort((a, b) => a.s - b.s);
  }

  /**
   * Add a road, replacing every stretch over a river with a `bridge` span long enough to land on both banks.
   * Returns the bridge end points (so terraces can be threaded through them).
   */
  road(name: string, cls: RoadClass, pts: Pt[], options: XOptions = {}): BridgeEnd[] {
    const { bridgeName, bridgeMargin, bridgeWidth, bridgeClass, smooth, ...rest } = options;
    const line = smooth ? smoothPts(pts) : pts;
    const lens = cumulative(line);
    const total = lens[lens.length - 1];
    const xs = this.crossings(line, lens);
    if (xs.length === 0) {
      this.b.road(name, cls, pts, { ...rest, smooth });
      return [];
    }
    // Spans as [s0, s1]; overlapping ones (two channels close together) merge into one bridge.
    const spans: { s0: number; s1: number; x: Crossing[] }[] = [];
    for (const x of xs) {
      const half = (x.river.width / 2 + 17) / Math.max(0.35, x.sin) + (bridgeMargin ?? 0);
      const s0 = Math.max(0, x.s - half);
      const s1 = Math.min(total, x.s + half);
      const last = spans[spans.length - 1];
      if (last && s0 < last.s1 + 12) {
        last.s1 = Math.max(last.s1, s1);
        last.x.push(x);
      } else spans.push({ s0, s1, x: [x] });
    }
    const ends: BridgeEnd[] = [];
    let at = 0;
    for (const span of spans) {
      if (span.s0 - at > 1) this.b.road(name, cls, slice(line, lens, at, span.s0), rest);
      const first = span.x[0];
      const last = span.x[span.x.length - 1];
      const deck = slice(line, lens, span.s0, span.s1);
      this.b.road(bridgeName ?? first.river.bridgeName ?? `${name} Bridge`, bridgeClass ?? cls, deck, { ...rest, bridge: true, width: bridgeWidth ?? rest.width });
      ends.push({ river: first.river, rs: first.rs, bank: first.toLeft === 1 ? -1 : 1, pt: deck[0] });
      ends.push({ river: last.river, rs: last.rs, bank: last.toLeft === 1 ? 1 : -1, pt: deck[deck.length - 1] });
      at = span.s1;
    }
    if (total - at > 1) this.b.road(name, cls, slice(line, lens, at, total), rest);
    this.bridgeEnds.push(...ends);
    return ends;
  }

  /** A railway line; stretches over rivers become separate `bridge` spans (same landing rule as roads). */
  rail(name: string, corners: Pt[], kind: 'main' | 'tram' | 'siding' = 'main') {
    // The compiler fits a curve through railway points. Pin every straight with extra points either side of each
    // corner so the fitted line stays on the authored alignment and only bends at the corners.
    const pts: Pt[] = [corners[0]];
    for (let i = 1; i < corners.length; i++) {
      const a = corners[i - 1];
      const c = corners[i];
      const len = dist(a, c);
      const d = Math.min(30, len / 5);
      const at = (s: number): Pt => [r1(a[0] + ((c[0] - a[0]) * s) / len), r1(a[1] + ((c[1] - a[1]) * s) / len)];
      if (len > 20) pts.push(at(d), at(2 * d), at(len - 2 * d), at(len - d));
      pts.push(c);
    }
    const lens = cumulative(pts);
    const total = lens[lens.length - 1];
    const spans: { s0: number; s1: number; river: RiverLine }[] = [];
    for (const x of this.crossings(pts, lens)) {
      const half = (x.river.width / 2 + 17) / Math.max(0.35, x.sin);
      const s0 = Math.max(0, x.s - half);
      const s1 = Math.min(total, x.s + half);
      const last = spans[spans.length - 1];
      if (last && s0 < last.s1 + 12) last.s1 = Math.max(last.s1, s1);
      else spans.push({ s0, s1, river: x.river });
    }
    let at = 0;
    for (const span of spans) {
      if (span.s0 - at > 1) this.b.rail(name, slice(pts, lens, at, span.s0), kind, false);
      this.b.rail(`${name} (${span.river.name} rail bridge)`, slice(pts, lens, span.s0, span.s1), kind, true);
      at = span.s1;
    }
    if (total - at > 1) this.b.rail(name, slice(pts, lens, at, total), kind, false);
  }

  /** Distance along a river nearest to a point. */
  riverS(river: RiverLine, p: Pt): number {
    let best = Infinity;
    let bestS = 0;
    for (let j = 0; j < river.pts.length - 1; j++) {
      const a = river.pts[j];
      const c = river.pts[j + 1];
      const dx = c[0] - a[0];
      const dz = c[1] - a[1];
      const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
      if (d < best) {
        best = d;
        bestS = river.lens[j] + t * (river.lens[j + 1] - river.lens[j]);
      }
    }
    return bestS;
  }

  /** Point `offset` metres to the left (+) or right (−) of a river at distance s. */
  riverOffset(river: RiverLine, s: number, offset: number): Pt {
    const p = pointAtLen(river.pts, river.lens, s);
    const a = pointAtLen(river.pts, river.lens, Math.max(0, s - 6));
    const c = pointAtLen(river.pts, river.lens, Math.min(river.lens[river.lens.length - 1], s + 6));
    const len = dist(a, c) || 1;
    const tx = (c[0] - a[0]) / len;
    const tz = (c[1] - a[1]) / len;
    // Left of travel (tx, tz) is (tz, -tx).
    return [r1(p[0] + tz * offset), r1(p[1] - tx * offset)];
  }

  /**
   * A riverside street: follows one bank `offset` metres from the centreline between two points, passing exactly
   * through the ends of every bridge already added on that bank (so it joins them end-on).
   */
  terrace(name: string, river: RiverLine, bank: 1 | -1, from: Pt, to: Pt, offset: number, cls: RoadClass = 'street', options: RoadOptions = {}, flip = false): Pt[] {
    const s0 = this.riverS(river, from);
    const s1 = this.riverS(river, to);
    const lo = Math.min(s0, s1);
    const hi = Math.max(s0, s1);
    const anchors = this.bridgeEnds.filter((e) => e.river === river && e.bank === bank && e.rs > lo - 10 && e.rs < hi + 10).map((e) => ({ s: e.rs, pt: e.pt, anchor: true }));
    const nodes = [...anchors];
    for (let s = lo; s <= hi + 0.01; s += 14) {
      if (anchors.some((a) => Math.abs(a.s - s) < 26)) continue;
      nodes.push({ s, pt: this.riverOffset(river, s, offset * bank), anchor: false });
    }
    nodes.sort((a, c) => a.s - c.s);
    const pts = nodes.map((n) => n.pt);
    if (flip) pts.reverse();
    this.b.road(name, cls, pts, options);
    return pts;
  }

  /** Rectangular suburb grid with per-street names, classes and options; streets may be trimmed or skipped. */
  grid(spec: {
    xs: number[];
    zs: number[];
    ns: (string | null)[];
    ew: (string | null)[];
    nsClass?: (RoadClass | undefined)[];
    ewClass?: (RoadClass | undefined)[];
    /** Per-street span overrides: [from, to] along the street's axis. */
    nsSpan?: Record<number, [number, number]>;
    ewSpan?: Record<number, [number, number]>;
    rotate?: number;
    origin?: Pt;
    options?: XOptions;
  }) {
    const rot = spec.rotate ?? 0;
    const [ox, oz] = spec.origin ?? [0, 0];
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const tf = (x: number, z: number): Pt => [r1(ox + (x - ox) * cos + (z - oz) * sin), r1(oz - (x - ox) * sin + (z - oz) * cos)];
    const minX = Math.min(...spec.xs);
    const maxX = Math.max(...spec.xs);
    const minZ = Math.min(...spec.zs);
    const maxZ = Math.max(...spec.zs);
    spec.xs.forEach((x, i) => {
      const name = spec.ns[i];
      if (!name) return;
      const [z0, z1] = spec.nsSpan?.[i] ?? [minZ, maxZ];
      this.road(name, spec.nsClass?.[i] ?? 'street', [tf(x, z0), tf(x, z1)], spec.options);
    });
    spec.zs.forEach((z, i) => {
      const name = spec.ew[i];
      if (!name) return;
      const [x0, x1] = spec.ewSpan?.[i] ?? [minX, maxX];
      this.road(name, spec.ewClass?.[i] ?? 'street', [tf(x0, z), tf(x1, z)], spec.options);
    });
  }

  rect(id: string, name: string, city: CityId | null, type: DistrictType, minX: number, maxX: number, minZ: number, maxZ: number, priority = 1, teReo?: string) {
    this.b.district(id, name, city, type, { kind: 'rect', minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ) }, priority, teReo);
  }

  poly(id: string, name: string, city: CityId | null, type: DistrictType, pts: Pt[], priority = 1, teReo?: string) {
    this.b.district(id, name, city, type, { kind: 'poly', pts }, priority, teReo);
  }

  /**
   * Railway land: a strip along a stretch of track (`west` / `east` metres either side of a line drawn north → south)
   * where no building plots are laid out.
   *
   * Plots are generated from roads and districts only and know nothing of railways, so the track needs its own
   * no-build district wherever plots could reach it. `beach` is the one district type with neither plots nor
   * scattered trees; it also gives the corridor a pale, ballast-coloured verge.
   */
  railReserve(id: string, track: Pt[], west = 18, east = 18, name = 'Main South Line', city: CityId | null = null) {
    for (let i = 0; i < track.length - 1; i++) {
      const [x0, z0] = track[i];
      const [x1, z1] = track[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0) || 1;
      // Left of travel (tz, -tx): east for a line running north → south.
      const nx = (z1 - z0) / len;
      const nz = -(x1 - x0) / len;
      // Overlap neighbouring quads a little so bends leave no gap.
      const ex = ((x1 - x0) / len) * 8;
      const ez = ((z1 - z0) / len) * 8;
      this.poly(`${id}-${i}`, name, city, 'beach', [[r1(x0 - ex + nx * east), r1(z0 - ez + nz * east)], [r1(x1 + ex + nx * east), r1(z1 + ez + nz * east)], [r1(x1 + ex - nx * west), r1(z1 + ez - nz * west)], [r1(x0 - ex - nx * west), r1(z0 - ez - nz * west)]], 9);
    }
  }

  /**
   * A no-build apron at every level crossing: plots are laid along a street by frontage, so one that starts short
   * of the railway can still run on across it. Call once, after every road and railway has been authored.
   */
  levelCrossings(name = 'Main South Line') {
    const aprons: Pt[][] = [];
    for (const rail of this.b.source.rails) {
      if (rail.kind === 'tram') continue;
      const track = rail.pts.length > 2 ? smoothPts(rail.pts) : rail.pts;
      for (const road of this.b.source.roads) {
        if (road.bridge || road.tunnel) continue;
        const line = road.smooth ? smoothPts(road.pts) : road.pts;
        for (let i = 0; i < line.length - 1; i++) {
          const [x1, z1] = line[i];
          const [x2, z2] = line[i + 1];
          for (let j = 0; j < track.length - 1; j++) {
            const [x3, z3] = track[j];
            const [x4, z4] = track[j + 1];
            const hit = segSegIntersect(x1, z1, x2, z2, x3, z3, x4, z4, 1e-9);
            if (!hit) continue;
            const { ua, ub } = hit;
            if (ua < 0 || ua > 1 || ub < 0 || ub >= 1) continue;
            const len = Math.hypot(x2 - x1, z2 - z1) || 1;
            const tx = (x2 - x1) / len;
            const tz = (z2 - z1) / len;
            const cx = x1 + (x2 - x1) * ua;
            const cz = z1 + (z2 - z1) * ua;
            // Long enough for the longest frontage either side of the line, wide enough to catch the plots' probe line.
            let frontage = 0;
            for (let u = -60; u <= 60; u += 10) frontage = Math.max(frontage, FRONTAGE[this.typeAt(cx + tx * u, cz + tz * u)]);
            if (frontage === 0) continue;
            const L = frontage + 5;
            const W = 22;
            const corner = (u: number, v: number): Pt => [r1(cx + tx * u * L + tz * v * W), r1(cz + tz * u * L - tx * v * W)];
            aprons.push([corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)]);
          }
        }
      }
    }
    aprons.forEach((pts, i) => this.poly(`crossing-${i}`, name, null, 'beach', pts, 9));
    return aprons.length;
  }

  /** District type at a point, from the districts authored so far (rural where there is none). */
  typeAt(x: number, z: number): DistrictType {
    let best: DistrictType = 'rural';
    let bestPriority = -Infinity;
    for (const d of this.b.source.districts) {
      const priority = d.priority ?? 0;
      if (priority <= bestPriority) continue;
      if (inShape(d.shape, x, z)) {
        best = d.type;
        bestPriority = priority;
      }
    }
    return best;
  }

  /** A place standing at `at`, facing the road point `road`. */
  place(id: string, name: string, at: Pt, road: Pt, city: CityId | null, tags: string[], teReo?: string) {
    this.b.place(id, name, at[0], at[1], facing(at, road), city, tags, teReo);
  }

  /** A landmark at `at` whose front faces `towards`. */
  landmark(kind: string, name: string, at: Pt, towards: Pt, clearRadius: number, skyline = false, footprint?: { w: number; d: number; level?: boolean }) {
    this.b.landmark(kind, name, at[0], at[1], facing(at, towards), clearRadius, { ...(skyline ? { skyline: true } : {}), ...(footprint ? { footprint } : {}) });
  }
}

/**
 * A hill road that holds a steady gradient: marches downhill from `start`, turning across the slope just enough
 * to lose `grade` metres per metre, drifting towards +x (`drift` 1) or −x (−1). Stops at `stopHeight`, or on
 * reaching `stopX`.
 * `natural` is the terrain model's landform height.
 */
export function gradedDescent(natural: (x: number, z: number) => number, start: Pt, drift: 1 | -1, grade: number, stopHeight: number, stopX = drift * Infinity, maxLength = 2000): Pt[] {
  const out: Pt[] = [start];
  let [x, z] = start;
  // Set off along the hillside in the drift direction and ease round into the descent.
  let heading: number | null = (Math.PI / 2) * drift;
  const step = 10;
  const e = 16;
  for (let travelled = 0; travelled < maxLength; travelled += step) {
    if (natural(x, z) <= stopHeight || (x - stopX) * drift >= 0) break;
    const gx = (natural(x + e, z) - natural(x - e, z)) / (2 * e);
    const gz = (natural(x, z + e) - natural(x, z - e)) / (2 * e);
    const m = Math.hypot(gx, gz);
    if (m < 0.004) break;
    const ux = gx / m;
    const uz = gz / m;
    let dx = -ux;
    let dz = -uz;
    if (m > grade) {
      const c = grade / m;
      const sn = Math.sqrt(1 - c * c);
      // Two directions lose height at exactly `grade`; take the one that drifts the right way.
      const ax = -c * ux - sn * uz;
      const az = -c * uz + sn * ux;
      const bx = -c * ux + sn * uz;
      const bz = -c * uz - sn * ux;
      if (ax * drift >= bx * drift) {
        dx = ax;
        dz = az;
      } else {
        dx = bx;
        dz = bz;
      }
    }
    let h = Math.atan2(dx, dz);
    if (heading !== null) {
      const d = angleDiff(h, heading);
      h = heading + Math.max(-0.3, Math.min(0.3, d));
    }
    heading = h;
    x += Math.sin(h) * step;
    z += Math.cos(h) * step;
    out.push([r1(x), r1(z)]);
  }
  return out;
}

/** Longest plot frontage per district type (from the plot rules in world/lots.ts); 0 = no plots. */
const FRONTAGE: Record<DistrictType, number> = { cbd: 30, shops: 13, township: 15, villa: 19, statehouse: 20, industrial: 46, port: 50, rural: 44, park: 0, beach: 0 };

/** Clear radius per landmark kind, copied from docs/CONTRACT.md. */
export const CLEAR: Record<string, number> = {
  'chch-cathedral': 40,
  'cathedral-square': 75,
  'arts-centre': 70,
  'canterbury-museum': 40,
  'bridge-of-remembrance': 22,
  'town-hall': 55,
  'victoria-square': 60,
  'old-railway-station': 50,
  'addington-station': 40,
  'lancaster-park': 110,
  'antigua-boatsheds': 30,
  'tram-stop': 14,
  'chch-hospital': 70,
  'chch-police': 40,
  'new-brighton-mall': 60,
  'sign-of-the-takahe': 30,
  'sign-of-the-kiwi': 25,
  'sugarloaf-tower': 20,
  'gondola-base': 30,
  'gondola-summit': 30,
  'tunnel-portal': 25,
  'lyttelton-port': 120,
  'timeball-station': 22,
  'timaru-basilica': 45,
  'caroline-bay-soundshell': 40,
  'caroline-bay-carnival': 70,
  'caroline-bay-tearooms': 25,
  'timaru-port': 130,
  'timaru-lighthouse': 14,
  'landing-service-building': 30,
  'timaru-station': 40,
  'timaru-hospital': 60,
  'timaru-police': 35,
  'smithfield-works': 110,
  'washdyke-saleyards': 70,
  'phar-lap-raceway': 150,
  'ashburton-clock-tower': 14,
  'rakaia-salmon': 14,
  woolshed: 30,
  'grain-silo': 25,
  'service-station': 30,
  'country-pub': 25,
  'country-church': 25,
  'war-memorial': 12,
  school: 80,
  'rugby-field': 70,
  'rail-station-small': 30,
  marae: 50,
  'timaru-dept-store': 27,
  'timaru-discount-store': 20,
  'timaru-arcade-mall': 27,
  'timaru-nightclub': 21,
  'royal-arcade': 29,
  'northside-mall': 57,
  'highfield-mall': 56,
  'patiti-point': 55,
};

/**
 * Footprint (w along the frontage, d front to back) per landmark kind that stands in a street frontage: lots keep
 * off this rectangle rather than the clear circle, which for these is the circle round it.
 */
export const FOOTPRINT: Record<string, { w: number; d: number; level?: boolean }> = {
  'timaru-dept-store': { w: 34, d: 40, level: true },
  'timaru-discount-store': { w: 24, d: 32, level: true },
  'timaru-arcade-mall': { w: 34, d: 40 },
  'timaru-nightclub': { w: 34, d: 22 },
  'royal-arcade': { w: 14, d: 54 },
  'northside-mall': { w: 90, d: 68 },
  'highfield-mall': { w: 88, d: 68 },
};

export const SKYLINE = new Set(['chch-cathedral', 'sugarloaf-tower', 'gondola-summit', 'lyttelton-port', 'timaru-basilica', 'timaru-port', 'smithfield-works']);

/** Landmark with the contract's clear radius, footprint and skyline flag filled in. */
export function mark(a: Author, kind: string, name: string, at: Pt, towards: Pt) {
  a.landmark(kind, name, at, towards, CLEAR[kind], SKYLINE.has(kind), FOOTPRINT[kind]);
}
