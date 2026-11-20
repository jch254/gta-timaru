import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { ChunkBuilder, MaterialLibrary, SignOptions } from '../../core/types';
import { Batch, sub, type Geo } from './rural/kit';

/**
 * Kit for buildings you can walk into (the Stafford Street shops, the malls). Everything is in one local frame
 * whose origin is on the shop floor: +y up, +z the street front, +x to the right seen from the street.
 *
 * Rules every interior keeps:
 * - Walls are two skins (outside material, inside material) with one collider through both, broken only
 *   where a doorway is; shop windows are real glass (see-through and solid) with real goods behind them.
 * - The floor, the ceiling and any upper floor have colliders, so the camera stays inside and you can stand
 *   on an upper floor. Openings in a floor (stairwells, escalator wells) are left out of its collider.
 * - Colour goes on through `paint()` (library materials that differ only by colour merge into one draw call),
 *   so shelves of goods in a dozen colours cost one batch. Interiors use the clean library, not the aged one:
 *   indoors nobody's paint has weathered.
 * - Fittings are boxes in a few shared materials, merged by `flush()`; aim for no more than ~25k triangles.
 */

export type Mat = THREE.Material;
export type Side = 'front' | 'right' | 'back' | 'left';

/** A hole in a wall: `at` is the centre along the wall, from the middle of that side (local x for front/back, local z for left/right). */
export interface Opening {
  side: Side;
  at: number;
  width: number;
  height: number;
  /** Height of the bottom of the opening above the floor (0 = doorway). */
  sill?: number;
  /** Glass to glaze it with (solid); omit for an open doorway. */
  glass?: Mat;
}

export interface RoomOptions {
  /** Centre and size on plan, floor at `y`. */
  cx?: number;
  cz?: number;
  w: number;
  d: number;
  /** Floor to ceiling. */
  h: number;
  y?: number;
  floor: Mat;
  /** Inside face of the walls. */
  wall: Mat;
  /** Outside face of the walls (defaults to `wall`). */
  outer?: Mat;
  ceiling?: Mat;
  /** Wall thickness. */
  t?: number;
  openings?: Opening[];
  /** Sides to leave out (a party wall built by the neighbour, a side open to the next room). */
  omit?: Side[];
  /** Carry the floor slab this far down (a building on falling ground stands on it). */
  plinth?: number;
  /** Plinth material (defaults to concrete). */
  plinthMat?: Mat;
  /** Rectangles [x0, z0, x1, z1] cut out of the ceiling (and its collider): stairwells, escalator wells. */
  holes?: [number, number, number, number][];
  /** No ceiling at all (the room above provides it, or it is open to the roof). */
  noCeiling?: boolean;
  /** No floor slab (an upper storey standing on a `slab` laid separately, with holes in it). */
  noFloor?: boolean;
}

/** Goods on the shelves: packets, tins, boxes, towels. Bright, as a 1995 discount store was. */
export const GOODS = [0xc8302a, 0xe5b52b, 0x2f5fa8, 0x3f8f4a, 0xe8e2d0, 0xd8642a, 0x7a3f8f, 0x2a2a2a, 0xe07aa8, 0x5ab0c8, 0xf0d070, 0x8a5a3a];
/** Clothes on the racks. */
export const CLOTHES = [0x2c3a5c, 0x8a1f2a, 0xd8c8a8, 0x3c5a3a, 0x6a6a72, 0xe8e2d8, 0x1c1c22, 0xa86a3a, 0x5a7ab0, 0xc87a8a, 0x7a2a5a, 0x4a8a8a];

const _v = new THREE.Vector3();

/** Interior builder: walls with doorways, floors, ceilings, stairs and the fittings of a shop. */
export class Interior {
  readonly m: MaterialLibrary;
  readonly b: Batch;
  readonly rng: Rng;

  constructor(
    readonly out: ChunkBuilder,
    /** Local → world, origin on the floor. */
    readonly f: THREE.Matrix4,
    seed: number,
  ) {
    this.m = out.materials;
    this.b = new Batch(out, f);
    this.rng = new Rng(seed);
  }

  /** Library material in a colour (merges with every other colour of the same surface). */
  paint(color: number, surface: 'plain' | 'paintedMetal' | 'timber' | 'cloth' | 'concrete' | 'metal' | 'plaster' = 'plain'): THREE.MeshStandardMaterial {
    return this.m.get(surface, { color });
  }

  /** See-through, solid shop glass. */
  get glass(): Mat {
    return this.m.get('glass', { color: 0xc8d8dc, transparent: true, opacity: 0.22, doubleSided: true });
  }

  /** Fluorescent tube, lit day and night. */
  get tube(): Mat {
    return this.m.emitter(0xf4f6ff, 'always');
  }

  g(material: Mat): Geo {
    return this.b.g(material);
  }

  /** Box with a collider. */
  solid(material: Mat, cx: number, cy: number, cz: number, w: number, h: number, d: number, yaw = 0): this {
    this.g(material).box(cx, cy, cz, w, h, d, yaw);
    this.collide(cx, cy, cz, w, h, d, yaw);
    return this;
  }

  collide(cx: number, cy: number, cz: number, w: number, h: number, d: number, yaw = 0): this {
    if (yaw === 0) this.out.collider(this.f, cx, cy, cz, w, h, d);
    else this.out.collider(sub(this.f, cx, 0, cz, yaw), 0, cy, 0, w, h, d);
    return this;
  }

  /**
   * A straight wall from a to b (local plan points), `outer` on the side to the left of a → b seen from above
   * (trace a room front left→right, right front→back, back right→left, left back→front and that is outside).
   * Openings are [along, width, sill, height, glass?] measured from a.
   */
  wall(ax: number, az: number, bx: number, bz: number, o: { y0?: number; h: number; t?: number; inner: Mat; outer?: Mat; holes?: { along: number; width: number; sill: number; height: number; glass?: Mat }[] }): this {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return this;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    const yaw = Math.atan2(-dz, dx);
    const y0 = o.y0 ?? 0;
    const t = o.t ?? 0.25;
    const outer = o.outer ?? o.inner;
    const frame = sub(this.f, ax, y0, az, yaw);
    const piece = (u0: number, u1: number, v0: number, v1: number) => {
      if (u1 - u0 < 0.01 || v1 - v0 < 0.01) return;
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      const w = u1 - u0;
      const h = v1 - v0;
      this.b.at(ax, y0, az, yaw, () => {
        this.g(outer).box(cu, cv, t / 4, w, h, t / 2);
        this.g(o.inner).box(cu, cv, -t / 4, w, h, t / 2);
      });
      this.out.collider(frame, cu, cv, 0, w, h, t);
    };
    const holes = [...(o.holes ?? [])].sort((p, q) => p.along - q.along);
    let cursor = 0;
    for (const hole of holes) {
      const u0 = Math.max(cursor, hole.along - hole.width / 2);
      const u1 = Math.min(len, hole.along + hole.width / 2);
      piece(cursor, u0, 0, o.h);
      piece(u0, u1, 0, hole.sill);
      piece(u0, u1, hole.sill + hole.height, o.h);
      if (hole.glass) {
        this.b.at(ax, y0, az, yaw, () => this.g(hole.glass!).box((u0 + u1) / 2, hole.sill + hole.height / 2, 0, u1 - u0, hole.height, 0.03));
        this.out.collider(frame, (u0 + u1) / 2, hole.sill + hole.height / 2, 0, u1 - u0, hole.height, 0.1);
      }
      cursor = u1;
    }
    piece(cursor, len, 0, o.h);
    return this;
  }

  /** A rectangular room: floor slab, four walls with their openings, and a ceiling. */
  room(o: RoomOptions): this {
    const cx = o.cx ?? 0;
    const cz = o.cz ?? 0;
    const y = o.y ?? 0;
    const t = o.t ?? 0.25;
    const hw = o.w / 2;
    const hd = o.d / 2;
    const openings = o.openings ?? [];
    const omit = new Set(o.omit ?? []);
    // Floor: a slab whose top is the floor, carried down as a plinth when asked.
    const depth = 0.3 + (o.plinth ?? 0);
    if (!o.noFloor) {
      this.g(o.floor).box(cx, y - 0.15, cz, o.w, 0.3, o.d, 0, false);
      if (o.plinth) this.g(o.plinthMat ?? this.m.get('concrete', { color: 0xb8b2a4 })).box(cx, y - 0.3 - o.plinth / 2, cz, o.w + t, o.plinth, o.d + t, 0, false);
      this.out.collider(this.f, cx, y - depth / 2, cz, o.w, depth, o.d);
      this.out.floor?.(this.f, cx, y, cz, o.w, o.d);
    }

    const holesOn = (side: Side, along: (at: number) => number) =>
      openings.filter((p) => p.side === side).map((p) => ({ along: along(p.at), width: p.width, sill: p.sill ?? 0, height: p.height, glass: p.glass }));
    const spec = { y0: y, h: o.h, t, inner: o.wall, outer: o.outer };
    // Corners: front and back run the full width plus the thickness; the sides fit between them.
    if (!omit.has('front')) this.wall(cx - hw - t / 2, cz + hd, cx + hw + t / 2, cz + hd, { ...spec, holes: holesOn('front', (at) => at + hw + t / 2) });
    if (!omit.has('right')) this.wall(cx + hw, cz + hd - t / 2, cx + hw, cz - hd + t / 2, { ...spec, holes: holesOn('right', (at) => hd - t / 2 - at) });
    if (!omit.has('back')) this.wall(cx + hw + t / 2, cz - hd, cx - hw - t / 2, cz - hd, { ...spec, holes: holesOn('back', (at) => hw + t / 2 - at) });
    if (!omit.has('left')) this.wall(cx - hw, cz - hd + t / 2, cx - hw, cz + hd - t / 2, { ...spec, holes: holesOn('left', (at) => at + hd - t / 2) });

    if (!o.noCeiling) this.slab(cx, y + o.h, cz, o.w, o.d, o.ceiling ?? this.m.get('plaster', { color: 0xeeeae0 }), o.holes ?? [], 0.25);
    return this;
  }

  /**
   * Horizontal slab with its underside at `y` (a ceiling) or, with `top`, its top at `y` (an upper floor), with
   * rectangular holes [x0, z0, x1, z1]. Split into strips around the holes; each strip gets a collider.
   */
  slab(cx: number, y: number, cz: number, w: number, d: number, material: Mat, holes: [number, number, number, number][] = [], t = 0.25, top = false, upper?: Mat): this {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const yc = top ? y - t / 2 : y + t / 2;
    // Cut lines across x from every hole edge; in each band of x, the z-intervals not covered by a hole.
    const xs = [x0, x1, ...holes.flatMap((h) => [Math.max(x0, Math.min(h[0], h[2])), Math.min(x1, Math.max(h[0], h[2]))])].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i];
      const b = xs[i + 1];
      if (b - a < 0.01) continue;
      const mid = (a + b) / 2;
      const cuts = holes
        .filter((h) => mid > Math.min(h[0], h[2]) && mid < Math.max(h[0], h[2]))
        .map((h) => [Math.min(h[1], h[3]), Math.max(h[1], h[3])] as [number, number])
        .sort((p, q) => p[0] - q[0]);
      let zc = z0;
      const strip = (s0: number, s1: number) => {
        if (s1 - s0 < 0.01) return;
        const zm = (s0 + s1) / 2;
        // Underside in the slab's material; the top of an upper floor in its own finish.
        this.g(material).box(mid, yc, zm, b - a, t, s1 - s0);
        if (upper) this.g(upper).box(mid, yc + t / 2 + 0.005, zm, b - a, 0.01, s1 - s0, 0, false);
        this.out.collider(this.f, mid, yc, zm, b - a, t, s1 - s0);
        // The top of an upper floor is somewhere people stand.
        if (top) this.out.floor?.(this.f, mid, y, zm, b - a, s1 - s0);
      };
      for (const [c0, c1] of cuts) {
        strip(zc, Math.max(zc, c0));
        zc = Math.max(zc, c1);
      }
      strip(zc, z1);
    }
    return this;
  }

  /** Grid of fluorescent fittings under a ceiling at height `y`, over the rectangle [x0, z0, x1, z1]. */
  fluoros(x0: number, z0: number, x1: number, z1: number, y: number, along = 3.2, across = 2.6): this {
    const housing = this.paint(0xe8e6e0, 'paintedMetal');
    const nx = Math.max(1, Math.floor((x1 - x0) / along));
    const nz = Math.max(1, Math.floor((z1 - z0) / across));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = x0 + ((i + 0.5) * (x1 - x0)) / nx;
        const z = z0 + ((j + 0.5) * (z1 - z0)) / nz;
        this.g(housing).box(x, y - 0.04, z, 1.25, 0.08, 0.32);
        this.g(this.tube).box(x, y - 0.085, z, 1.15, 0.012, 0.2, 0, false);
      }
    }
    return this;
  }

  /**
   * Gondola shelving run `len` long along its local x, double-sided (or single, against a wall, facing +z),
   * stocked with goods in the given colours. Centre (x, z), turned `yaw`.
   */
  gondola(x: number, z: number, len: number, yaw = 0, o: { h?: number; shelves?: number; single?: boolean; colors?: readonly number[]; frame?: number; fill?: number } = {}): this {
    const h = o.h ?? 1.6;
    const shelves = o.shelves ?? 4;
    const depth = o.single ? 0.45 : 0.9;
    const colors = o.colors ?? GOODS;
    const metal = this.paint(o.frame ?? 0xd8d6d0, 'paintedMetal');
    const fill = o.fill ?? 0.85;
    this.b.at(x, 0, z, yaw, () => {
      const g = this.g(metal);
      // Base, back panel, end uprights.
      g.box(0, 0.06, 0, len, 0.12, depth);
      g.box(0, h / 2, o.single ? -depth / 2 + 0.02 : 0, len, h, 0.04);
      for (const sx of [-1, 1]) g.box((sx * len) / 2, h / 2, 0, 0.05, h, depth);
      const faces = o.single ? [1] : [1, -1];
      for (const face of faces) {
        for (let s = 0; s < shelves; s++) {
          const sy = 0.16 + (s * (h - 0.3)) / shelves;
          const zc = o.single ? 0 : (face * depth) / 4;
          g.box(0, sy, zc + face * 0.01, len - 0.04, 0.025, depth / (o.single ? 1 : 2) - 0.04);
          // Goods: blocks of one product at a time, shelf by shelf.
          let u = -len / 2 + 0.04;
          while (u < len / 2 - 0.1) {
            const w = this.rng.range(0.18, 0.55);
            const room = len / 2 - 0.04 - u;
            const bw = Math.min(w, room);
            if (this.rng.chance(fill)) {
              const gh = this.rng.range(0.12, Math.min(0.34, (h - 0.3) / shelves - 0.04));
              const gd = (depth / (o.single ? 1 : 2)) * this.rng.range(0.55, 0.85);
              const color = colors[this.rng.int(0, colors.length - 1)];
              this.g(this.paint(color)).box(u + bw / 2, sy + 0.0125 + gh / 2, zc + face * (o.single ? 0.02 : depth / 4 - gd / 2 - 0.02) * (o.single ? 0 : 1), bw - 0.02, gh, gd);
            }
            u += bw;
          }
        }
      }
    });
    this.collide(x, h / 2, z, len, h, depth, yaw);
    return this;
  }

  /** Clothes rail: a chrome rail on two stands with garments hanging from it, `len` along local x. */
  rack(x: number, z: number, len = 1.6, yaw = 0, colors: readonly number[] = CLOTHES, round = false): this {
    const chrome = this.m.get('chrome');
    this.b.at(x, 0, z, yaw, () => {
      const c = this.g(chrome);
      if (round) {
        c.post(0, 0, 0, 0.05, 1.3);
        c.lathe(0, 1.28, 0, [[0.62, 0], [0.62, 0.03]], 12, 0, Math.PI * 2, false);
        c.box(0, 0.02, 0, 0.5, 0.04, 0.5);
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          this.g(this.paint(colors[this.rng.int(0, colors.length - 1)], 'cloth')).box(Math.cos(a) * 0.6, 0.86, Math.sin(a) * 0.6, 0.06, 0.8, 0.42, -a);
        }
      } else {
        for (const sx of [-1, 1]) {
          c.post((sx * len) / 2, 0, 0, 0.04, 1.45);
          c.box((sx * len) / 2, 0.02, 0, 0.06, 0.04, 0.55);
        }
        c.box(0, 1.45, 0, len, 0.03, 0.03);
        const n = Math.floor(len / 0.09);
        for (let k = 0; k < n; k++) {
          if (!this.rng.chance(0.8)) continue;
          const u = -len / 2 + 0.08 + (k * (len - 0.16)) / Math.max(1, n - 1);
          const long = this.rng.chance(0.3);
          this.g(this.paint(colors[this.rng.int(0, colors.length - 1)], 'cloth')).box(u, long ? 0.86 : 1.06, 0, 0.05, long ? 1.1 : 0.7, 0.46);
        }
      }
    });
    this.collide(x, 0.75, z, round ? 1.3 : len, 1.5, round ? 1.3 : 0.6, yaw);
    return this;
  }

  /** Shop counter (`w` along local x), its customer side facing +z; `till` puts a cash register on it. */
  counter(x: number, z: number, w: number, yaw = 0, o: { d?: number; h?: number; front?: Mat; top?: Mat; till?: boolean } = {}): this {
    const d = o.d ?? 0.7;
    const h = o.h ?? 0.95;
    const front = o.front ?? this.paint(0x8a6a4a, 'timber');
    const top = o.top ?? this.paint(0xd8d0bc);
    this.b.at(x, 0, z, yaw, () => {
      this.g(front).box(0, h / 2 - 0.02, 0, w, h - 0.04, d);
      this.g(top).box(0, h - 0.015, 0.02, w + 0.06, 0.03, d + 0.06);
      if (o.till) {
        const dark = this.paint(0x2a2c2e);
        this.g(dark).box(w * 0.25, h + 0.12, -0.05, 0.42, 0.2, 0.4);
        this.g(dark).box(w * 0.25, h + 0.3, -0.12, 0.3, 0.16, 0.06);
        this.g(this.m.emitter(0x6aff8a, 'always')).box(w * 0.25, h + 0.32, -0.088, 0.18, 0.04, 0.005, 0, false);
      }
    });
    this.collide(x, h / 2, z, w, h, d, yaw);
    return this;
  }

  /** Low display table with folded goods on it. */
  table(x: number, z: number, w = 1.6, d = 0.9, yaw = 0, colors: readonly number[] = CLOTHES): this {
    const wood = this.paint(0xb89a72, 'timber');
    this.b.at(x, 0, z, yaw, () => {
      this.g(wood).box(0, 0.74, 0, w, 0.04, d);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.g(wood).post((sx * (w - 0.1)) / 2, 0, (sz * (d - 0.1)) / 2, 0.05, 0.72);
      for (let i = 0; i < 6; i++) {
        const px = -w / 2 + 0.2 + ((i % 3) * (w - 0.4)) / 2;
        const pz = i < 3 ? -d / 4 : d / 4;
        const stack = this.rng.int(2, 5);
        this.g(this.paint(colors[this.rng.int(0, colors.length - 1)], 'cloth')).box(px, 0.76 + stack * 0.025, pz, 0.34, stack * 0.05, 0.28);
      }
    });
    this.collide(x, 0.4, z, w, 0.8, d, yaw);
    return this;
  }

  /**
   * A straight flight of stairs climbing `rise` over `run` along local +z from (x, y0, z), `width` wide, turned
   * `yaw`. Visual treads; one tilted ramp collider underfoot (smoother than steps), plus the stringers.
   */
  stairs(x: number, z: number, width: number, rise: number, run: number, yaw = 0, o: { y0?: number; tread?: Mat; side?: Mat } = {}): this {
    const y0 = o.y0 ?? 0;
    const n = Math.max(2, Math.round(rise / 0.18));
    const riser = rise / n;
    const going = run / n;
    const tread = o.tread ?? this.paint(0x6a6058, 'concrete');
    const side = o.side ?? this.paint(0xd8d4c8, 'plaster');
    this.b.at(x, y0, z, yaw, () => {
      for (let i = 0; i < n; i++) this.g(tread).box(0, (i + 1) * riser - riser / 2, (i + 0.5) * going, width, riser, going, 0, false);
      for (const sx of [-1, 1]) {
        const g = this.g(side);
        g.slab([(sx * (width + 0.12)) / 2 - 0.06, 0, 0], [(sx * (width + 0.12)) / 2 - 0.06, rise, run], [(sx * (width + 0.12)) / 2 + 0.06, rise, run], [(sx * (width + 0.12)) / 2 + 0.06, 0, 0], 0.3);
      }
    });
    this.ramp(x, z, width, rise, run, yaw, y0);
    return this;
  }

  /** Tilted collider climbing `rise` over `run` along local +z from (x, y0, z): what people walk on up a stair or escalator. */
  ramp(x: number, z: number, width: number, rise: number, run: number, yaw = 0, y0 = 0): this {
    const pitch = Math.atan2(rise, run);
    const len = Math.hypot(rise, run);
    const base = sub(this.f, x, y0, z, yaw);
    // Tilt about local x at the foot of the flight; the box's top face is the walking line.
    const tilt = new THREE.Matrix4().makeRotationX(-pitch);
    const frame = base.clone().multiply(tilt);
    this.out.collider(frame, 0, -0.1, len / 2, width, 0.2, len);
    return this;
  }

  /** Double-sided hanging sign on two drop rods from a ceiling at `ceiling`. */
  hangingSign(text: string, x: number, y: number, z: number, w: number, yaw = 0, ceiling = 0, options: SignOptions = {}): this {
    const h = w / (options.aspect ?? 4);
    const mat = this.m.sign(text, { aspect: w / h, ...options });
    const off = 0.02;
    this.b.at(x, y, z, yaw, () => {
      this.g(this.paint(0x2a2a2a, 'paintedMetal')).box(0, 0, 0, w + 0.04, h + 0.04, 0.03);
      if (ceiling > y) for (const sx of [-1, 1]) this.g(this.m.get('chrome')).post((sx * w) / 2.6, h / 2, 0, 0.012, ceiling - y - h / 2);
    });
    const frame = sub(this.f, x, y, z, yaw);
    this.out.quad(frame, 0, 0, off, w, h, mat, 0);
    this.out.quad(frame, 0, 0, -off, w, h, mat, Math.PI);
    return this;
  }

  /** Flat sign on a wall facing +z turned `yaw`. */
  sign(text: string, x: number, y: number, z: number, w: number, yaw = 0, options: SignOptions = {}): this {
    const aspect = options.aspect ?? 4;
    this.out.quad(sub(this.f, x, y, z, yaw), 0, 0, 0, w, w / aspect, this.m.sign(text, { aspect, ...options }), 0);
    return this;
  }

  /** A shop dummy: a plain pale figure on a stand, dressed in one colour. */
  mannequin(x: number, z: number, yaw = 0, dress: number = CLOTHES[0]): this {
    const skin = this.paint(0xe8e2d8);
    const cloth = this.paint(dress, 'cloth');
    this.b.at(x, 0, z, yaw, () => {
      this.g(this.m.get('chrome')).post(0, 0, 0, 0.03, 0.9);
      this.g(this.m.get('chrome')).box(0, 0.01, 0, 0.36, 0.02, 0.36);
      this.g(cloth).box(0, 1.25, 0, 0.42, 0.62, 0.22);
      this.g(cloth).box(0, 0.86, 0, 0.36, 0.2, 0.2);
      this.g(skin).box(0, 1.66, 0, 0.12, 0.12, 0.12);
      this.g(skin).box(0, 1.82, 0, 0.18, 0.24, 0.2);
      for (const sx of [-1, 1]) this.g(skin).box(sx * 0.26, 1.24, 0.02, 0.08, 0.58, 0.08);
    });
    this.collide(x, 0.95, z, 0.45, 1.9, 0.45, yaw);
    return this;
  }

  /** Automatic sliding doors, drawn standing open in a doorway `width` wide on the front wall line at z. */
  slidingDoors(x: number, z: number, width: number, height = 2.3, yaw = 0): this {
    const frame = this.paint(0x9a9ea2, 'metal');
    const leaf = width / 2;
    this.b.at(x, 0, z, yaw, () => {
      // Each leaf slid back behind the fixed side light beside the opening.
      for (const sx of [-1, 1]) {
        this.g(this.glass).box(sx * (width / 2 + leaf / 2 - 0.05), height / 2, -0.12, leaf, height, 0.02);
        this.g(frame).box(sx * (width / 2 + leaf / 2 - 0.05), height + 0.02, -0.12, leaf, 0.05, 0.05);
      }
      this.g(frame).box(0, height + 0.12, 0, width + leaf * 2, 0.24, 0.2);
    });
    return this;
  }

  /** World position of a local point (for staff, spawn points, lights). */
  world(x: number, y: number, z: number): THREE.Vector3 {
    return _v.set(x, y, z).applyMatrix4(this.f).clone();
  }

  /** Night light at a local point. */
  light(x: number, y: number, z: number, color = 0xfff4e0, intensity = 140, range = 16): this {
    const p = this.world(x, y, z);
    this.out.light(p.x, p.y, p.z, color, intensity, range);
    return this;
  }

  flush(): void {
    this.b.flush();
  }
}
