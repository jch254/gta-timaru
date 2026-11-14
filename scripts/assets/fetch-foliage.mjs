#!/usr/bin/env node
// @ts-check
/**
 * The foliage atlas: photographic leaves, arranged into branches (see ASSETS.md, "Vegetation").
 *
 *   node scripts/assets/fetch-foliage.mjs [--force] [--preview]
 *
 * 1. Downloads CC0 photo-scanned leaf and sprig sheets (colour + opacity, 1K) from ambientCG and from the
 *    texture sets of Poly Haven plant models. Raw downloads are cached in assets-staging/foliage/
 *    (git-ignored); --force fetches them again.
 * 2. Cuts every sheet into its separate leaves / sprigs (foliage/sources.mjs).
 * 3. Arranges those cut-outs into pictures of whole boughs, fronds, fans and tufts, one per plant the
 *    game draws: twigs are grown by a small branching rule and a leaf is stamped at every node, darker
 *    towards the back and the middle so the picture has depth. The leaves are photographs; the
 *    arrangement, the twigs and the flowers (flax, gorse, lupin) are drawn here.
 * 4. Packs the pictures into one 2048 x 2048 RGBA atlas:
 *        src/assets/foliage/atlas.webp   lossy WebP with alpha
 *        src/assets/foliage/atlas.json   cell rectangles (pixels, origin top left) and credits
 *    src/world/props/foliage.ts loads both; src/world/props/vegetation.ts maps cells onto cards.
 *
 * --preview also writes assets-staging/foliage/debug/atlas-preview.jpg (the atlas over a flat colour).
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Canvas, prepare, rng } from './foliage/raster.mjs';
import { ROOT, SOURCES, STAGING, extractSprites, fetchSheet } from './foliage/sources.mjs';

/** @typedef {import('./foliage/raster.mjs').MipSprite} MipSprite */
/** @typedef {[number, number, number]} RGB */

const OUT = path.join(ROOT, 'src', 'assets', 'foliage');
const ATLAS = 2048;
const GUTTER = 8;
const FORCE = process.argv.includes('--force');
const PREVIEW = process.argv.includes('--preview');
const DEG = Math.PI / 180;

// ───────────────────────────────────── Sources ─────────────────────────────────────

/** @type {Record<string, MipSprite[]>} */
const S = {};
/** @type {{ key: string, asset: string, library: string, source: string, author: string, licence: string, use: string }[]} */
const credits = [];
for (const [key, source] of Object.entries(SOURCES)) {
  const raw = await fetchSheet(source, FORCE);
  const sprites = await extractSprites(raw, source);
  S[key] = sprites.map((s) => prepare(s, { pivot: key === 'palmate' ? 'centre' : 'stem' }));
  credits.push({ key, asset: `${raw.name} (${source.id})`, library: raw.libraryName, source: raw.page, author: raw.author, licence: 'CC0-1.0', use: source.what });
  console.log(`${key}: ${raw.libraryName} ${source.id}, ${sprites.length} cut-outs`);
}
// Only the real sprigs and leaves of the model texture sheets (the rest of those sheets is bark and filler).
const PINE = [S.pine[1], S.pine[2]];
const FIR = [S.fir[1], S.fir[2], S.fir[3], S.fir[5], S.fir[6]];
const WILLOW = [S.willow[1], S.willow[2], S.willow[3]];
const PLUME_STALKS = S.plume.slice(0, 4);
const PLUME_HEADS = S.plume.slice(4, 6);

/** Mean colour of a set of sprites. */
const meanOf = (/** @type {MipSprite[]} */ set) => /** @type {RGB} */ ([0, 1, 2].map((c) => set.reduce((sum, s) => sum + s.mean[c], 0) / set.length));

/**
 * A leaf chooser: picks a sprite, sizes it to about `length` pixels and tints the set towards `target`
 * (keeping each photograph's own variation), with a little random brightness and hue.
 * @param {MipSprite[]} set
 * @param {RGB} target
 * @param {number} length
 * @param {{ vary?: number, hue?: number, size?: [number, number], squash?: [number, number] }} [o]
 */
function leaves(set, target, length, o = {}) {
  const mean = meanOf(set);
  const gain = /** @type {RGB} */ (target.map((t, c) => t / Math.max(0.02, mean[c])));
  const [s0, s1] = o.size ?? [0.8, 1.15];
  const [q0, q1] = o.squash ?? [0.75, 1];
  return (/** @type {ReturnType<typeof rng>} */ r, shade = 1) => {
    const sprite = r.pick(set);
    const bright = shade * (1 + (r() - 0.5) * 2 * (o.vary ?? 0.14));
    const hue = (r() - 0.5) * 2 * (o.hue ?? 0.07);
    return {
      sprite,
      scale: (length / sprite.h) * r.range(s0, s1),
      squash: r.range(q0, q1),
      flip: r() < 0.5,
      mul: /** @type {RGB} */ ([gain[0] * bright * (1 + hue), gain[1] * bright, gain[2] * bright * (1 - hue)]),
    };
  };
}

// ───────────────────────────────────── Recipes ─────────────────────────────────────

/**
 * @typedef {object} BoughOptions
 * @property {ReturnType<typeof leaves>} leaf
 * @property {number} [lobes]         Leaf masses the bough is made of (default 11).
 * @property {number} [lobeSize]      Scale on their size.
 * @property {number} [lobeGap]       How far apart they keep, in units of their radii (default 0.8; 1 = just touching).
 * @property {number} node           Pixels between leaf nodes.
 * @property {number} leafAngle      Degrees between twig and leaf.
 * @property {number} [leafJitter]   Degrees.
 * @property {boolean} [opposite]    Leaves in pairs rather than alternating.
 * @property {number} [whorl]        Leaves fanned at each twig end.
 * @property {number} [maxDepth]
 * @property {number} [branchEvery]  Nodes between side twigs.
 * @property {number} [branchAngle]  Degrees.
 * @property {number} [wander]       Radians of random turn per node.
 * @property {number} [droop]        Radians per node that side twigs bend back towards straight down.
 * @property {RGB} twig
 * @property {number} twigWidth
 * @property {number} [lift]         How much brighter the middle of a lobe is than its edge (default 1.5).
 * @property {[number, number]} [pivot]
 * @property {number} [keep]           Pixels kept clear inside the cell edge (default: two nodes); about a leaf length.
 */

/**
 * Grows twigs from the pivot (bottom centre unless given) and puts a leaf at every node.
 * @param {Canvas} cv
 * @param {number} seed
 * @param {BoughOptions} o
 */
function bough(cv, seed, o) {
  const r = rng(seed);
  const [px, py] = o.pivot ?? [cv.w / 2, cv.h - 6];
  /** @type {{ x0: number, y0: number, x1: number, y1: number, w0: number, w1: number }[]} */
  const twigs = [];
  /** @type {{ x: number, y: number, angle: number, z: number }[]} */
  const spots = [];
  const maxDepth = o.maxDepth ?? 2;
  const leafAngle = o.leafAngle * DEG;
  const jitter = (o.leafJitter ?? 22) * DEG;
  // The outline: a handful of overlapping leaf masses ("lobes") inside an egg that stands on the pivot and
  // keeps clear of the cell edge by the reach of a leaf, so no leaf is ever cut off square. The gaps between
  // lobes stay empty: seen in a crown they are the sky holes and shadows that make foliage read as clumps.
  const keep = o.keep ?? o.node * 2;
  const ex = cv.w / 2;
  const foot = py - keep * 0.4;
  const ey = (keep + foot) / 2;
  const erx = cv.w / 2 - keep;
  const ery = (foot - keep) / 2;
  const count = o.lobes ?? 11;
  /** @type {{ x: number, y: number, rad: number, phase: number }[]} */
  const lobes = [];
  for (let tries = 0; lobes.length < count && tries < count * 60; tries++) {
    // Anywhere in the egg, as big as will fit there, not swallowing a lobe already placed.
    const a = r.range(0, Math.PI * 2);
    const d = Math.sqrt(r()) * 0.92;
    const x = ex + Math.cos(a) * erx * d;
    const y = ey + Math.sin(a) * ery * d;
    const room = Math.min(x - keep, cv.w - keep - x, y - keep, foot - y);
    const rad = Math.min(room, r.range(0.2, 0.34) * Math.min(erx, ery) * (o.lobeSize ?? 1));
    if (rad < o.node * 1.2) continue;
    if (lobes.some((l) => Math.hypot(l.x - x, l.y - y) < (l.rad + rad) * (o.lobeGap ?? 0.8))) continue;
    lobes.push({ x, y, rad, phase: r() * 6.3 });
  }
  /** How deep (x, y) is inside its nearest lobe: 0 at the middle, 1 on the edge, more outside. */
  const depthIn = (/** @type {number} */ x, /** @type {number} */ y) => {
    let best = Infinity;
    for (const l of lobes) {
      const a = Math.atan2(y - l.y, x - l.x);
      const k = 1 + 0.09 * Math.sin(3 * a + l.phase) + 0.07 * Math.sin(5 * a + l.phase * 2.3);
      best = Math.min(best, Math.hypot(x - l.x, y - l.y) / (l.rad * k));
    }
    return best;
  };
  const inside = (/** @type {number} */ x, /** @type {number} */ y) => depthIn(x, y) <= 1;
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} angle
   * @param {number} length
   * @param {number} width
   * @param {number} depth
   * @param {{ x: number, y: number, rad: number } | null} goal   Main stems first make for a lobe.
   */
  const grow = (x, y, angle, length, width, depth, goal) => {
    const n = Math.max(2, Math.round(length / o.node));
    let side = r.sign();
    const every = o.branchEvery ?? 2;
    let entered = depth > 0;
    let arrived = !goal;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      if (goal && !arrived) {
        // Steer for the goal until inside it.
        const want = Math.atan2(goal.x - x, -(goal.y - y));
        angle += Math.max(-0.25, Math.min(0.25, Math.atan2(Math.sin(want - angle), Math.cos(want - angle))));
        arrived = Math.hypot(goal.x - x, goal.y - y) < goal.rad * 0.6;
      }
      const nx = x + Math.sin(angle) * o.node;
      const ny = y - Math.cos(angle) * o.node;
      const within = inside(nx, ny);
      if (arrived && entered && !within) break;
      entered = entered || (arrived && within);
      twigs.push({ x0: x, y0: y, x1: nx, y1: ny, w0: width * (1 - t * 0.75), w1: width * (1 - ((i + 1) / n) * 0.75) });
      x = nx;
      y = ny;
      angle += (r() - 0.5) * 2 * (o.wander ?? 0.12);
      if (depth > 0 && o.droop) angle += Math.sign(Math.sin(angle) || 1) * o.droop;
      if (within) {
        for (const sgn of o.opposite ? [1, -1] : [side]) spots.push({ x, y, angle: angle + sgn * (leafAngle + (r() - 0.5) * 2 * jitter), z: r() });
        if (depth < maxDepth && i % every === every - 1) {
          const remaining = length * (1 - t);
          const child = Math.max(remaining * r.range(0.5, 0.85), o.node * 4);
          grow(x, y, angle + side * ((o.branchAngle ?? 42) * DEG + (r() - 0.5) * 0.35), child, width * 0.62, depth + 1, null);
        }
        side = -side;
      }
    }
    if (!inside(x, y)) return;
    const whorl = o.whorl ?? 1;
    for (let k = 0; k < whorl; k++) {
      const spread = whorl === 1 ? 0 : (k / (whorl - 1) - 0.5) * 2 * 62 * DEG;
      spots.push({ x, y, angle: angle + spread + (r() - 0.5) * 0.3, z: r() });
    }
  };
  // Two stems to every lobe, setting out a little apart.
  for (const lobe of lobes) {
    for (const off of [-0.2, 0.22]) grow(px, py, Math.atan2(lobe.x - px, -(lobe.y - py)) + off, cv.h * 2, o.twigWidth * 0.7, 0, lobe);
  }

  for (const t of twigs) cv.stroke(t.x0, t.y0, t.x1, t.y1, t.w0, t.w1, o.twig);
  // Back to front: leaves behind are darker, and each lobe is brightest in the middle, like a rounded mass.
  spots.sort((a, b) => a.z - b.z);
  const lift = o.lift ?? 1.25;
  for (const s of spots) {
    const q = Math.min(1, depthIn(s.x, s.y));
    const shade = (0.62 + 0.42 * s.z) * (1 + (lift - 1) * (0.42 - 0.75 * q * q));
    const l = o.leaf(r, shade);
    cv.stamp(l.sprite, s.x, s.y, s.angle, l.scale, l);
  }
}

/**
 * Blades radiating from one point: a flax fan, a tussock, a cabbage-tree head.
 * @param {Canvas} cv
 * @param {number} seed
 * @param {{ leaf: ReturnType<typeof leaves>, count: number, spread: number, pivot?: [number, number], outerShort?: number, dead?: { beyond: number, leaf: ReturnType<typeof leaves> }, even?: boolean }} o
 *   `spread` is the half-angle in degrees (180 = all round); blades near the edge of the fan are shortened by `outerShort`.
 */
function fan(cv, seed, o) {
  const r = rng(seed);
  const [px, py] = o.pivot ?? [cv.w / 2, cv.h - 12];
  /** @type {{ angle: number, z: number }[]} */
  const blades = [];
  for (let i = 0; i < o.count; i++) {
    const u = o.even ? (i + r()) / o.count : r();
    blades.push({ angle: (u * 2 - 1) * o.spread, z: r() });
  }
  blades.sort((a, b) => a.z - b.z);
  for (const b of blades) {
    const edge = Math.abs(b.angle) / o.spread;
    const dead = o.dead && Math.abs(b.angle) > o.dead.beyond;
    const l = (dead && o.dead ? o.dead.leaf : o.leaf)(r, 0.62 + 0.45 * b.z);
    const scale = l.scale * (1 - (o.outerShort ?? 0) * edge * edge);
    // Try shorter if the blade would run off the picture.
    for (const k of [1, 0.85, 0.7, 0.55]) if (cv.stamp(l.sprite, px, py, b.angle * DEG, scale * k, l)) break;
  }
}

/**
 * A feather: a midrib with leaflets down both sides (palm frond, Norfolk pine branch). The pivot is the
 * left middle and the midrib runs to the right.
 * @param {Canvas} cv
 * @param {number} seed
 * @param {{ leaf: ReturnType<typeof leaves>, every: number, sweep: number, profile: (t: number) => number, rib: RGB, ribWidth: [number, number], rise?: number, start?: number }} o
 *   `profile(t)` is the leaflet length (0..1 of the available half height) at t along the midrib.
 */
function feather(cv, seed, o) {
  const r = rng(seed);
  const x0 = 8;
  const x1 = cv.w - 10;
  const mid = cv.h / 2;
  const half = cv.h / 2 - 8;
  const at = (/** @type {number} */ t) => /** @type {[number, number]} */ ([x0 + (x1 - x0) * t, mid - (o.rise ?? 0) * half * t * t]);
  const n = Math.floor((x1 - x0) / o.every);
  /** @type {{ t: number, side: number, z: number }[]} */
  const list = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    if (t < (o.start ?? 0.04)) continue;
    list.push({ t, side: 1, z: r() }, { t, side: -1, z: r() });
  }
  list.sort((a, b) => a.z - b.z);
  const dir = (/** @type {number} */ t) => {
    const [ax, ay] = at(Math.max(0, t - 0.01));
    const [bx, by] = at(Math.min(1, t + 0.01));
    return Math.atan2(bx - ax, -(by - ay)); // clockwise from up
  };
  for (const item of list) {
    const [x, y] = at(item.t);
    const l = o.leaf(r, 0.68 + 0.4 * item.z);
    const want = o.profile(item.t) * half;
    const scale = (want / (l.sprite.h * Math.cos((90 - o.sweep) * DEG))) * r.range(0.9, 1.08);
    const angle = dir(item.t) - item.side * (o.sweep + r.range(-5, 5)) * DEG;
    for (const k of [1, 0.85, 0.7]) if (cv.stamp(l.sprite, x, y, angle, scale * k, l)) break;
  }
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const [ax, ay] = at(i / steps);
    const [bx, by] = at((i + 1) / steps);
    const w = (/** @type {number} */ t) => o.ribWidth[0] + (o.ribWidth[1] - o.ribWidth[0]) * t;
    cv.stroke(ax, ay, bx, by, w(i / steps), w((i + 1) / steps), o.rib);
  }
}

// ───────────────────────────────────── Colours ─────────────────────────────────────
// Leaf albedos, sRGB 0..1. Summer foliage; the game tints further per species and per tree.

const OAK = /** @type {RGB} */ ([0.3, 0.43, 0.17]);
const POPLAR = /** @type {RGB} */ ([0.33, 0.47, 0.18]);
const SHRUB = /** @type {RGB} */ ([0.24, 0.38, 0.17]);
const WILLOW_GREEN = /** @type {RGB} */ ([0.46, 0.56, 0.24]);
const PINE_GREEN = /** @type {RGB} */ ([0.2, 0.3, 0.16]);
const MACROCARPA = /** @type {RGB} */ ([0.2, 0.31, 0.15]);
const NORFOLK = /** @type {RGB} */ ([0.19, 0.33, 0.17]);
const PALM = /** @type {RGB} */ ([0.3, 0.42, 0.2]);
const CABBAGE = /** @type {RGB} */ ([0.43, 0.5, 0.26]);
const FLAX = /** @type {RGB} */ ([0.34, 0.43, 0.24]);
const STRAW = /** @type {RGB} */ ([0.72, 0.63, 0.38]);
const DRY_LEAF = /** @type {RGB} */ ([0.52, 0.43, 0.27]);
const TUSSOCK = /** @type {RGB} */ ([0.5, 0.55, 0.28]);
const GORSE = /** @type {RGB} */ ([0.22, 0.31, 0.14]);
const LUPIN_LEAF = /** @type {RGB} */ ([0.3, 0.45, 0.2]);
const TWIG = /** @type {RGB} */ ([0.27, 0.22, 0.16]);

// ───────────────────────────────────── Cells ─────────────────────────────────────

/**
 * @typedef {object} Cell
 * @property {string} name
 * @property {number} w
 * @property {number} h
 * @property {'bottom' | 'top' | 'left' | 'centre'} anchor   Where the picture attaches to its branch.
 * @property {(cv: Canvas) => void} draw
 */

/** @type {Cell[]} */
const CELLS = [
  {
    name: 'oak-a',
    w: 512,
    h: 512,
    anchor: 'bottom',
    draw: (cv) =>
      bough(cv, 11, {
        leaf: leaves(S.oak, OAK, 30),
        keep: 30,
        node: 14,
        leafAngle: 48,
        whorl: 5,
        branchEvery: 3,
        twig: TWIG,
        twigWidth: 5,
      }),
  },
  {
    name: 'oak-b',
    w: 512,
    h: 512,
    anchor: 'bottom',
    draw: (cv) =>
      bough(cv, 29, {
        leaf: leaves(S.oak, OAK, 29),
        keep: 30,
        node: 14,
        leafAngle: 50,
        whorl: 5,
        branchEvery: 3,
        twig: TWIG,
        twigWidth: 5,
      }),
  },
  {
    name: 'poplar',
    w: 384,
    h: 512,
    anchor: 'bottom',
    draw: (cv) =>
      bough(cv, 41, {
        leaf: leaves(S.lime, POPLAR, 30, { squash: [0.55, 1] }),
        keep: 30,
        node: 16,
        leafAngle: 40,
        whorl: 3,
        branchEvery: 3,
        branchAngle: 24,
        twig: [0.34, 0.31, 0.24],
        twigWidth: 4,
      }),
  },
  {
    name: 'shrub',
    w: 320,
    h: 320,
    anchor: 'bottom',
    draw: (cv) =>
      bough(cv, 53, {
        leaf: leaves(S.box, SHRUB, 40, { squash: [0.7, 1] }),
        keep: 34,
        lobes: 12,
        lobeSize: 0.75,
        lobeGap: 1.05,
        node: 12,
        leafAngle: 38,
        whorl: 3,
        branchEvery: 2,
        twig: TWIG,
        twigWidth: 4,
      }),
  },
  {
    name: 'hedge',
    w: 512,
    h: 320,
    anchor: 'bottom',
    draw: (cv) => {
      // A clipped face: sprigs all over, pointing roughly up and out, with a ragged top and ends.
      const r = rng(67);
      const leaf = leaves(S.box, SHRUB, 44, { squash: [0.7, 1], vary: 0.2 });
      /** @type {{ x: number, y: number, a: number, z: number }[]} */
      const spots = [];
      const top = (/** @type {number} */ x) => 66 + 8 * Math.sin(x * 0.045 + 1) + 6 * Math.sin(x * 0.11 + 4);
      for (let i = 0; i < 1300; i++) {
        const x = r.range(46, cv.w - 46);
        const edge = Math.min(x - 46, cv.w - 46 - x) / 40;
        spots.push({ x, y: r.range(top(x) + (edge < 1 ? (1 - edge) * r.range(0, 60) : 0), cv.h + 30), a: r.range(-70, 70) * DEG, z: r() });
      }
      spots.sort((a, b) => a.z - b.z);
      for (const s of spots) {
        const l = leaf(r, 0.55 + 0.55 * s.z);
        cv.stamp(l.sprite, s.x, s.y, s.a, l.scale, { ...l, clip: s.y > cv.h - 40 });
      }
    },
  },
  {
    name: 'willow-bough',
    w: 384,
    h: 448,
    anchor: 'bottom',
    draw: (cv) =>
      bough(cv, 71, {
        leaf: leaves([...WILLOW, ...S.narrow], WILLOW_GREEN, 44, { squash: [0.8, 1.2] }),
        keep: 40,
        node: 13,
        leafAngle: 30,
        leafJitter: 14,
        whorl: 3,
        branchEvery: 3,
        branchAngle: 36,
        droop: 0.05,
        twig: [0.5, 0.46, 0.22],
        twigWidth: 3.5,
      }),
  },
  {
    name: 'willow-curtain',
    w: 288,
    h: 832,
    anchor: 'top',
    draw: (cv) => {
      // Weeping shoots hanging from the top edge.
      const r = rng(83);
      const leaf = leaves([...WILLOW, ...S.narrow], WILLOW_GREEN, 40, { squash: [0.8, 1.25] });
      const strands = 9;
      /** @type {{ x: number, y: number, a: number, z: number }[]} */
      const spots = [];
      for (let i = 0; i < strands; i++) {
        let x = 40 + ((cv.w - 80) * (i + r.range(0.2, 0.8))) / strands;
        let y = 4;
        let a = Math.PI + r.range(-0.1, 0.1);
        const length = cv.h * r.range(0.62, 0.97);
        const step = 12;
        let side = r.sign();
        for (let d = 0; d < length - 46; d += step) {
          const nx = x + Math.sin(a) * step;
          const ny = y - Math.cos(a) * step;
          cv.stroke(x, y, nx, ny, 2.6 - (1.6 * d) / length, 2.6 - (1.6 * (d + step)) / length, [0.52, 0.47, 0.2]);
          x = nx;
          y = ny;
          a += r.range(-0.05, 0.05) + (Math.PI - a) * 0.12;
          if (d > 10) spots.push({ x, y, a: a + side * r.range(14, 34) * DEG, z: r() });
          side = -side;
        }
        spots.push({ x, y, a, z: r() });
      }
      spots.sort((p, q) => p.z - q.z);
      for (const s of spots) {
        const l = leaf(r, 0.66 + 0.46 * s.z);
        cv.stamp(l.sprite, s.x, s.y, s.a, l.scale, l);
      }
    },
  },
  {
    name: 'pine-a',
    w: 512,
    h: 512,
    anchor: 'bottom',
    draw: (cv) =>
      bough(cv, 97, {
        leaf: leaves(PINE, PINE_GREEN, 66, { squash: [0.8, 1.1], vary: 0.2 }),
        keep: 60,
        lobes: 12,
        lobeSize: 0.8,
        lobeGap: 1.3,
        node: 17,
        leafAngle: 32,
        whorl: 3,
        branchEvery: 2,
        branchAngle: 38,
        twig: [0.24, 0.18, 0.13],
        twigWidth: 6,
      }),
  },
  {
    name: 'macrocarpa',
    w: 448,
    h: 512,
    anchor: 'bottom',
    draw: (cv) =>
      bough(cv, 131, {
        leaf: leaves(S.cypress, MACROCARPA, 76, { squash: [0.7, 1.05], vary: 0.2 }),
        keep: 66,
        lobes: 12,
        lobeSize: 0.8,
        lobeGap: 1.25,
        node: 16,
        leafAngle: 30,
        whorl: 3,
        branchEvery: 2,
        branchAngle: 36,
        twig: [0.25, 0.19, 0.14],
        twigWidth: 6,
      }),
  },
  {
    name: 'norfolk',
    w: 768,
    h: 352,
    anchor: 'left',
    draw: (cv) =>
      feather(cv, 149, {
        leaf: leaves(S.cypress.slice(0, 2), NORFOLK, 100, { squash: [0.45, 0.6], vary: 0.16 }),
        every: 15,
        sweep: 62,
        profile: (t) => (t < 0.25 ? 0.55 + 1.8 * t : 1 - 0.78 * ((t - 0.25) / 0.75) ** 1.4),
        rib: [0.26, 0.21, 0.15],
        ribWidth: [7, 2],
        rise: 0.12,
      }),
  },
  {
    name: 'palm',
    w: 896,
    h: 304,
    anchor: 'left',
    draw: (cv) =>
      feather(cv, 163, {
        leaf: leaves([...S.strap, ...S.blade.slice(0, 6)], PALM, 100, { squash: [0.5, 0.8], vary: 0.14 }),
        every: 7,
        sweep: 52,
        profile: (t) => (t < 0.12 ? 0.25 : t < 0.3 ? 0.25 + ((t - 0.12) / 0.18) * 0.75 : 1 - 0.55 * ((t - 0.3) / 0.7) ** 1.6),
        rib: [0.45, 0.46, 0.22],
        ribWidth: [8, 2],
        start: 0.03,
      }),
  },
  {
    name: 'cabbage',
    w: 320,
    h: 320,
    anchor: 'centre',
    draw: (cv) => {
      {
        fan(cv, 179, {
          leaf: leaves(S.strap, CABBAGE, 150, { squash: [1.1, 1.7], size: [0.8, 1], vary: 0.2 }),
          dead: { beyond: 122, leaf: leaves(S.strap, DRY_LEAF, 128, { squash: [1, 1.5], size: [0.7, 1], vary: 0.2 }) },
          count: 120,
          spread: 180,
          pivot: [160, 166],
          even: true,
        });
        // The pale leaf bases all meet in the middle: cover them with the heart of the tuft.
        cv.blob(160, 166, 9, 9, 0, [0.36, 0.42, 0.2]);
      }
    },
  },
  {
    name: 'flax',
    w: 384,
    h: 512,
    anchor: 'bottom',
    draw: (cv) =>
      fan(cv, 193, {
        leaf: leaves(S.strap, FLAX, 560, { squash: [1, 1.5], size: [0.72, 1], vary: 0.2, hue: 0.1 }),
        count: 30,
        spread: 40,
        outerShort: 0.3,
        even: true,
      }),
  },
  {
    name: 'flax-flower',
    w: 256,
    h: 704,
    anchor: 'bottom',
    draw: (cv) => {
      const r = rng(211);
      // Kōrari: tall dark flower stalks with upswept side branches carrying pods, above a smaller fan.
      const stalk = /** @type {RGB} */ ([0.2, 0.13, 0.11]);
      for (const lean of [-7, 5, 13]) {
        let x = cv.w / 2 + lean * 1.5;
        let y = cv.h - 6;
        const a = lean * DEG;
        const length = cv.h * r.range(0.82, 0.96);
        const step = 20;
        let side = r.sign();
        for (let d = 0; d < length; d += step) {
          const nx = x + Math.sin(a) * step;
          const ny = y - Math.cos(a) * step;
          cv.stroke(x, y, nx, ny, 6 - (3.5 * d) / length, 6 - (3.5 * (d + step)) / length, stalk);
          x = nx;
          y = ny;
          if (d > length * 0.52) {
            const ba = a + side * r.range(38, 58) * DEG;
            const bl = r.range(34, 58) * (1 - 0.5 * ((d / length - 0.52) / 0.48));
            const ex = x + Math.sin(ba) * bl;
            const ey = y - Math.cos(ba) * bl;
            cv.stroke(x, y, ex, ey, 2.6, 1.6, stalk);
            for (let k = 0; k < 5; k++) {
              const t = 0.35 + (0.65 * k) / 4;
              const red = r() < 0.4;
              cv.blob(x + (ex - x) * t + r.range(-2, 2), y + (ey - y) * t - 7, 2.7, r.range(8, 12), r.range(-0.25, 0.25), red ? [0.5, 0.13, 0.08] : [0.16, 0.1, 0.09]);
            }
            side = -side;
          }
        }
      }
      fan(cv, 223, { leaf: leaves(S.strap, FLAX, 440, { squash: [1, 1.5], size: [0.72, 1], vary: 0.2, hue: 0.1 }), count: 20, spread: 36, outerShort: 0.3, even: true });
    },
  },
  {
    name: 'toetoe',
    w: 384,
    h: 512,
    anchor: 'bottom',
    draw: (cv) => {
      const r = rng(239);
      // Plumes first (behind the leaves): thin stalks, each carrying a drooping cream flag of seed heads.
      const head = leaves(PLUME_HEADS, [0.9, 0.84, 0.64], 62, { squash: [0.8, 1.3], vary: 0.1, hue: 0.03 });
      for (const lean of [-24, -11, 2, 14, 26]) {
        let x = cv.w / 2 + lean * 0.6;
        let y = cv.h - 6;
        let a = (lean + r.range(-3, 3)) * DEG;
        const length = cv.h * r.range(0.74, 0.9);
        const step = 16;
        const droop = Math.sign(lean || 1) * 0.045;
        for (let d = 0; d < length; d += step) {
          const nx = x + Math.sin(a) * step;
          const ny = y - Math.cos(a) * step;
          cv.stroke(x, y, nx, ny, 3, 2, [0.66, 0.6, 0.36]);
          x = nx;
          y = ny;
          if (d > length * 0.62) {
            a += droop;
            for (let k = 0; k < 4; k++) {
              const l = head(r, r.range(0.85, 1.1));
              cv.stamp(l.sprite, x + r.range(-5, 5), y + r.range(-4, 4), a + Math.sign(lean || 1) * r.range(0.5, 1.5) + Math.PI * 0, l.scale, l);
            }
          }
        }
      }
      fan(cv, 241, { leaf: leaves(S.blade, TUSSOCK, 360, { squash: [0.9, 1.6], size: [0.6, 1], vary: 0.2, hue: 0.1 }), count: 64, spread: 66, outerShort: 0.35, even: true });
    },
  },
  {
    name: 'grass',
    w: 384,
    h: 288,
    anchor: 'bottom',
    draw: (cv) => {
      // Rank roadside grass gone to seed: mostly straw by midsummer.
      fan(cv, 251, { leaf: leaves(PLUME_STALKS, STRAW, 270, { squash: [1, 1.6], size: [0.75, 1], vary: 0.1 }), count: 12, spread: 34, even: true });
      fan(cv, 257, { leaf: leaves(S.blade, [0.56, 0.56, 0.3], 230, { squash: [0.9, 1.5], size: [0.5, 1], vary: 0.24, hue: 0.12 }), count: 54, spread: 62, outerShort: 0.3, even: true });
    },
  },
  {
    name: 'gorse',
    w: 304,
    h: 304,
    anchor: 'bottom',
    draw: (cv) => {
      bough(cv, 263, {
        leaf: leaves(FIR, GORSE, 58, { squash: [0.7, 1], vary: 0.2 }),
        keep: 44,
        node: 13,
        leafAngle: 34,
        whorl: 3,
        branchEvery: 2,
        twig: [0.26, 0.24, 0.14],
        twigWidth: 4,
      });
      // Pea flowers wherever there is foliage, thickest towards the tips.
      const r = rng(269);
      for (let i = 0; i < 900; i++) {
        const x = r.range(12, cv.w - 12);
        const y = r.range(12, cv.h - 30);
        if (cv.px[(Math.floor(y) * cv.w + Math.floor(x)) * 4 + 3] < 0.6) continue;
        const out = Math.hypot(x - cv.w / 2, y - cv.h) / cv.h;
        if (r() > 0.16 + out * 0.4) continue;
        const a = r.range(-1, 1);
        cv.blob(x, y, 3.2, 4.6, a, [0.93, 0.74, 0.08]);
        cv.blob(x + Math.sin(a) * 1.5, y - Math.cos(a) * 1.5, 1.8, 2.6, a, [0.99, 0.87, 0.2]);
      }
    },
  },
  {
    name: 'lupin',
    w: 320,
    h: 384,
    anchor: 'bottom',
    draw: (cv) => {
      const r = rng(277);
      const stem = /** @type {RGB} */ ([0.32, 0.42, 0.2]);
      /** @type {RGB[]} */
      const hues = [[0.44, 0.27, 0.66], [0.3, 0.31, 0.72], [0.8, 0.43, 0.62], [0.52, 0.3, 0.7], [0.9, 0.86, 0.8], [0.36, 0.26, 0.66]];
      // Flower spikes.
      [-30, -17, -6, 5, 17, 29].forEach((lean, n) => {
        const a = (lean + r.range(-3, 3)) * DEG;
        const length = cv.h * r.range(0.66, 0.9);
        const bx = cv.w / 2 + lean * 1.2;
        const by = cv.h - 8;
        const at = (/** @type {number} */ d) => [bx + Math.sin(a) * d, by - Math.cos(a) * d];
        const [tx, ty] = at(length);
        cv.stroke(bx, by, tx, ty, 4, 2, stem);
        const from = length * 0.42;
        const hue = hues[n % hues.length];
        for (let d = from; d < length; d += 5.5) {
          const t = (d - from) / (length - from);
          const [x, y] = at(d);
          const wide = 13 * (1 - t * 0.7);
          const bud = t > 0.82;
          for (const k of [-1, 0, 1]) {
            const shade = r.range(0.8, 1.15) * (k === 0 ? 1.08 : 0.9);
            const c = /** @type {RGB} */ (bud ? [0.5 * shade, 0.58 * shade, 0.36 * shade] : [hue[0] * shade, hue[1] * shade, hue[2] * shade]);
            cv.blob(x + Math.cos(a) * k * wide * 0.62 + r.range(-1, 1), y + Math.sin(a) * k * wide * 0.62 + Math.abs(k) * 2.5, 4.2 * (1 - t * 0.45), 5 * (1 - t * 0.4), a + k * 0.9, c);
          }
        }
      });
      // The mound of leaves in front.
      const leaf = leaves(S.palmate, LUPIN_LEAF, 78, { squash: [0.6, 1], size: [0.7, 1.1], vary: 0.2 });
      /** @type {{ x: number, y: number, z: number }[]} */
      const spots = [];
      for (let i = 0; i < 46; i++) {
        const u = r.range(-1, 1);
        spots.push({ x: cv.w / 2 + u * 150, y: cv.h - 44 - r.range(0, 150) * (1 - u * u * 0.7), z: r() });
      }
      spots.sort((p, q) => p.z - q.z);
      for (const s of spots) {
        cv.stroke(cv.w / 2 + (s.x - cv.w / 2) * 0.15, cv.h - 6, s.x, s.y, 2.4, 1.6, stem);
        const l = leaf(r, 0.6 + 0.5 * s.z);
        cv.stamp(l.sprite, s.x, s.y, r.range(-Math.PI, Math.PI), l.scale, l);
      }
    },
  },
];

// ───────────────────────────────────── Compose and pack ─────────────────────────────────────

/**
 * Where each cell sits: the top-left corner of its slot, which is the cell plus a GUTTER of empty pixels all
 * round (so neighbouring pictures do not bleed into each other in the smaller mip levels).
 * Laid out by hand; `pack` only checks it.
 * @type {Record<string, [number, number]>}
 */
const SLOTS = {
  'oak-a': [0, 0],
  'oak-b': [528, 0],
  'pine-a': [1056, 0],
  macrocarpa: [1584, 0],
  poplar: [0, 528],
  flax: [400, 528],
  toetoe: [800, 528],
  'willow-bough': [1200, 528],
  lupin: [1600, 528],
  'willow-curtain': [0, 1056],
  'flax-flower': [304, 1056],
  palm: [576, 1056],
  hedge: [1488, 1056],
  norfolk: [576, 1376],
  shrub: [1360, 1392],
  cabbage: [1696, 1392],
  gorse: [1696, 1728],
  grass: [576, 1744],
};

function pack(/** @type {Cell[]} */ cells) {
  /** @type {Record<string, { x: number, y: number }>} */
  const at = {};
  /** @type {{ name: string, x: number, y: number, w: number, h: number }[]} */
  const slots = [];
  for (const cell of cells) {
    const slot = SLOTS[cell.name];
    if (!slot) throw new Error(`no slot for cell "${cell.name}"`);
    const s = { name: cell.name, x: slot[0], y: slot[1], w: cell.w + GUTTER * 2, h: cell.h + GUTTER * 2 };
    if (s.x + s.w > ATLAS || s.y + s.h > ATLAS) throw new Error(`cell "${cell.name}" runs off the atlas`);
    const clash = slots.find((o) => s.x < o.x + o.w && o.x < s.x + s.w && s.y < o.y + o.h && o.y < s.y + s.h);
    if (clash) throw new Error(`cells "${cell.name}" and "${clash.name}" overlap`);
    slots.push(s);
    at[cell.name] = { x: s.x + GUTTER, y: s.y + GUTTER };
  }
  return at;
}

const placed = pack(CELLS);
const atlas = new Uint8Array(ATLAS * ATLAS * 4);
/** @type {Record<string, { x: number, y: number, w: number, h: number, anchor: string, mean: number[] }>} */
const cellsOut = {};
for (const cell of CELLS) {
  const cv = new Canvas(cell.w, cell.h);
  cell.draw(cv);
  const { x, y } = placed[cell.name];
  const mean = [0, 0, 0];
  let opaque = 0;
  for (let py = 0; py < cell.h; py++) {
    for (let px = 0; px < cell.w; px++) {
      const i = (py * cell.w + px) * 4;
      const a = Math.min(1, cv.px[i + 3]);
      if (a < 1 / 255) continue;
      const o = ((y + py) * ATLAS + x + px) * 4;
      for (let c = 0; c < 3; c++) atlas[o + c] = Math.min(255, Math.max(0, Math.round((cv.px[i + c] / a) * 255)));
      atlas[o + 3] = Math.round(a * 255);
      if (a > 0.5) {
        for (let c = 0; c < 3; c++) mean[c] += atlas[o + c] / 255;
        opaque++;
      }
    }
  }
  // The mean leaf colour (sRGB 0..1) lets the game cancel a picture's own colour where a plant is tinted instead.
  cellsOut[cell.name] = { x, y, w: cell.w, h: cell.h, anchor: cell.anchor, mean: mean.map((v) => +(v / Math.max(1, opaque)).toFixed(3)) };
  console.log(`  ${cell.name.padEnd(15)} ${cell.w} x ${cell.h} at ${x},${y}  coverage ${(cv.coverage() * 100).toFixed(0)} %`);
}

mkdirSync(OUT, { recursive: true });
const webp = path.join(OUT, 'atlas.webp');
await sharp(atlas, { raw: { width: ATLAS, height: ATLAS, channels: 4 } }).webp({ quality: 80, alphaQuality: 88, effort: 6, smartSubsample: true }).toFile(webp);
const json = { version: 1, size: ATLAS, file: 'atlas.webp', cells: cellsOut, sources: credits };
writeFileSync(path.join(OUT, 'atlas.json'), `${JSON.stringify(json, null, 2)}\n`);
console.log(`\nWrote ${path.relative(ROOT, webp)} (${(statSync(webp).size / 1024).toFixed(0)} kB) and atlas.json: ${CELLS.length} cells from ${credits.length} sources.`);

if (PREVIEW) {
  const rgb = Buffer.alloc(ATLAS * ATLAS * 3);
  for (let i = 0; i < ATLAS * ATLAS; i++) {
    const a = atlas[i * 4 + 3] / 255;
    const bg = [150, 170, 200];
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = atlas[i * 4 + c] * a + bg[c] * (1 - a);
  }
  const file = path.join(STAGING, 'debug', 'atlas-preview.jpg');
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(rgb, { raw: { width: ATLAS, height: ATLAS, channels: 3 } }).jpeg({ quality: 88 }).toFile(file);
  console.log(`Preview: ${path.relative(ROOT, file)}`);
}
