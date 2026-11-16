#!/usr/bin/env node
// @ts-check
/**
 * More cells for the foliage atlas: flowers, bedding, broom, a plane bough, a run of long grass and a blank
 * cell (plain surfaces drawn in the leaf material sample it). Written as a strip that goes under the main
 * sheet when the game loads the two (src/world/props/foliage.ts), so ../fetch-foliage.mjs and its atlas are
 * left exactly as they are.
 *
 *   node scripts/assets/foliage/extra-cells.mjs [--preview]
 *
 * Uses the same CC0 leaf sheets as the main atlas (already cached in assets-staging/foliage/; nothing new is
 * downloaded if they are there). Leaves are photographs; arrangement, stems and every flower are drawn here.
 *
 *   src/assets/foliage/extra.webp   2048 x 512 RGBA, lossy WebP with alpha
 *   src/assets/foliage/extra.json   cell rectangles within the strip (pixels, origin top left)
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Canvas, prepare, rng } from './raster.mjs';
import { ROOT, SOURCES, STAGING, extractSprites, fetchSheet } from './sources.mjs';

/** @typedef {import('./raster.mjs').MipSprite} MipSprite */
/** @typedef {[number, number, number]} RGB */
/** @typedef {ReturnType<typeof rng>} Rng */

const OUT = path.join(ROOT, 'src', 'assets', 'foliage');
const WIDTH = 2048;
const HEIGHT = 512;
const GUTTER = 8;
const PREVIEW = process.argv.includes('--preview');
const DEG = Math.PI / 180;

/** @type {Record<string, MipSprite[]>} */
const S = {};
const USED = ['palmate', 'box', 'lime', 'willow', 'blade', 'plume'];
for (const key of USED) {
  const source = SOURCES[key];
  const raw = await fetchSheet(source, false);
  const sprites = await extractSprites(raw, source);
  S[key] = sprites.map((s) => prepare(s, { pivot: key === 'palmate' ? 'centre' : 'stem' }));
  console.log(`${key}: ${raw.libraryName} ${source.id}, ${sprites.length} cut-outs`);
}
const WILLOW = [S.willow[1], S.willow[2], S.willow[3]];
const PLUME_STALKS = S.plume.slice(0, 4);

const meanOf = (/** @type {MipSprite[]} */ set) => /** @type {RGB} */ ([0, 1, 2].map((c) => set.reduce((sum, s) => sum + s.mean[c], 0) / set.length));

/**
 * A leaf chooser: picks a sprite, sizes it to about `length` pixels and tints the set towards `target`.
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
  return (/** @type {Rng} */ r, shade = 1) => {
    const sprite = r.pick(set);
    const bright = shade * (1 + (r() - 0.5) * 2 * (o.vary ?? 0.14));
    const hue = (r() - 0.5) * 2 * (o.hue ?? 0.07);
    return { sprite, scale: (length / sprite.h) * r.range(s0, s1), squash: r.range(q0, q1), flip: r() < 0.5, mul: /** @type {RGB} */ ([gain[0] * bright * (1 + hue), gain[1] * bright, gain[2] * bright * (1 - hue)]) };
  };
}

// ───────────────────────────────────── Recipes ─────────────────────────────────────

/**
 * A leafy mass standing on a stem at the bottom middle: a handful of overlapping lobes inside an egg, each
 * filled with leaves pointing out from its middle, brightest in the middle and darker behind. The gaps left
 * between lobes are what make a card of it read as foliage rather than as a green disc. Returns the lobes,
 * so flowers can be put where the leaves are.
 * @param {Canvas} cv
 * @param {number} seed
 * @param {{ leaf: ReturnType<typeof leaves>, lobes: number, lobeSize?: number, gap?: number, node: number, keep: number, twig: RGB, twigWidth: number, upright?: number, lift?: number }} o
 */
function mass(cv, seed, o) {
  const r = rng(seed);
  const px = cv.w / 2;
  const py = cv.h - 6;
  const keep = o.keep;
  const foot = py - keep * 0.4;
  const ex = cv.w / 2;
  const ey = (keep + foot) / 2;
  const erx = cv.w / 2 - keep;
  const ery = (foot - keep) / 2;
  /** @type {{ x: number, y: number, rad: number }[]} */
  const lobes = [];
  for (let tries = 0; lobes.length < o.lobes && tries < o.lobes * 80; tries++) {
    const a = r.range(0, Math.PI * 2);
    const d = Math.sqrt(r()) * 0.92;
    const x = ex + Math.cos(a) * erx * d;
    const y = ey + Math.sin(a) * ery * d;
    const room = Math.min(x - keep, cv.w - keep - x, y - keep, foot - y);
    const rad = Math.min(room, r.range(0.22, 0.36) * Math.min(erx, ery) * (o.lobeSize ?? 1));
    if (rad < o.node * 1.2) continue;
    if (lobes.some((l) => Math.hypot(l.x - x, l.y - y) < (l.rad + rad) * (o.gap ?? 0.8))) continue;
    lobes.push({ x, y, rad });
  }
  // Stems: from the foot to each lobe, bowed a little.
  for (const l of lobes) {
    const bow = r.range(-0.18, 0.18) * Math.hypot(l.x - px, l.y - py);
    const mx = (px + l.x) / 2 + bow * 0.5;
    const my = (py + l.y) / 2 + Math.abs(bow) * 0.3;
    cv.stroke(px, py, mx, my, o.twigWidth, o.twigWidth * 0.7, o.twig);
    cv.stroke(mx, my, l.x, l.y, o.twigWidth * 0.7, o.twigWidth * 0.35, o.twig);
  }
  /** @type {{ x: number, y: number, angle: number, z: number, q: number }[]} */
  const spots = [];
  for (const l of lobes) {
    const count = Math.round((Math.PI * l.rad * l.rad) / (o.node * o.node));
    for (let i = 0; i < count; i++) {
      const a = r.range(0, Math.PI * 2);
      const q = Math.sqrt(r());
      const x = l.x + Math.cos(a) * l.rad * q;
      const y = l.y + Math.sin(a) * l.rad * q;
      // Out from the middle of the lobe, pulled towards straight up.
      const out = Math.atan2(x - l.x, -(y - l.y));
      const up = o.upright ?? 0.35;
      spots.push({ x, y, angle: Math.atan2(Math.sin(out) * (1 - up), Math.cos(out) * (1 - up) + up) + r.range(-0.4, 0.4), z: r(), q });
    }
  }
  spots.sort((a, b) => a.z - b.z);
  const lift = o.lift ?? 1.25;
  for (const s of spots) {
    const l = o.leaf(r, (0.6 + 0.44 * s.z) * (1 + (lift - 1) * (0.42 - 0.75 * s.q * s.q)));
    cv.stamp(l.sprite, s.x, s.y, s.angle, l.scale, l);
  }
  return lobes;
}

/** A point of a lobe where a flower would sit: the upper, outer part. @param {{ x: number, y: number, rad: number }} l @param {Rng} r */
const onLobe = (l, r, spread = 0.75) => {
  const a = r.range(-1.9, 1.9);
  const q = Math.sqrt(r()) * spread;
  return /** @type {[number, number]} */ ([l.x + Math.sin(a) * l.rad * q, l.y - Math.cos(a) * l.rad * q]);
};

const shadeOf = (/** @type {RGB} */ c, /** @type {number} */ k) => /** @type {RGB} */ ([Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]);

// ───────────────────────────────────── Flowers (all drawn) ─────────────────────────────────────

/** A garden rose seen from the front: a ring of outer petals, a tighter ring inside, a dark furled heart. */
function roseBloom(/** @type {Canvas} */ cv, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ rad, /** @type {RGB} */ color, /** @type {Rng} */ r) {
  const turn = r.range(0, 6.3);
  for (let i = 0; i < 6; i++) {
    const a = turn + (i / 6) * Math.PI * 2;
    cv.blob(x + Math.sin(a) * rad * 0.5, y - Math.cos(a) * rad * 0.5, rad * 0.5, rad * 0.58, a, shadeOf(color, r.range(0.74, 0.9)));
  }
  for (let i = 0; i < 5; i++) {
    const a = turn + 0.5 + (i / 5) * Math.PI * 2;
    cv.blob(x + Math.sin(a) * rad * 0.26, y - Math.cos(a) * rad * 0.26, rad * 0.36, rad * 0.42, a, shadeOf(color, r.range(0.98, 1.14)));
  }
  cv.blob(x, y, rad * 0.22, rad * 0.26, turn, shadeOf(color, 0.62));
  cv.blob(x + rad * 0.07, y - rad * 0.05, rad * 0.1, rad * 0.13, turn + 1, shadeOf(color, 1.2));
}

/** A hydrangea mop head: a ball of small four-petalled florets, bluest on top, shaded underneath. */
function mopHead(/** @type {Canvas} */ cv, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ rad, /** @type {RGB[]} */ hues, /** @type {Rng} */ r) {
  cv.blob(x, y, rad, rad * 0.9, 0, shadeOf(hues[0], 0.5));
  const florets = Math.round(rad * rad * 0.14);
  for (let i = 0; i < florets; i++) {
    const a = r.range(0, 6.3);
    const q = Math.sqrt(r()) * 0.92;
    const fx = x + Math.cos(a) * rad * q;
    const fy = y + Math.sin(a) * rad * 0.9 * q;
    const hue = shadeOf(r.pick(hues), (0.78 + 0.3 * r()) * (1 - 0.3 * Math.max(0, (fy - y) / rad)));
    const size = rad * r.range(0.13, 0.18);
    for (let k = 0; k < 4; k++) {
      const pa = a + (k * Math.PI) / 2;
      cv.blob(fx + Math.sin(pa) * size * 0.7, fy - Math.cos(pa) * size * 0.7, size * 0.62, size * 0.72, pa, hue);
    }
    cv.blob(fx, fy, size * 0.25, size * 0.25, 0, shadeOf(hue, 1.35));
  }
}

/** A rhododendron truss: a dome of open funnels, each five lobes with a freckled throat. */
function truss(/** @type {Canvas} */ cv, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ rad, /** @type {RGB} */ color, /** @type {Rng} */ r) {
  const flowers = 7;
  for (let i = 0; i < flowers; i++) {
    const a = (i / (flowers - 1)) * Math.PI * 2 + r.range(-0.3, 0.3);
    const q = i === flowers - 1 ? 0 : 0.56;
    const fx = x + Math.cos(a) * rad * q;
    const fy = y + Math.sin(a) * rad * q * 0.85;
    const tone = shadeOf(color, r.range(0.85, 1.08));
    for (let k = 0; k < 5; k++) {
      const pa = a + (k / 5) * Math.PI * 2;
      cv.blob(fx + Math.sin(pa) * rad * 0.19, fy - Math.cos(pa) * rad * 0.19, rad * 0.2, rad * 0.25, pa, tone);
    }
    cv.blob(fx, fy, rad * 0.11, rad * 0.11, 0, shadeOf(color, 1.3));
    for (let k = 0; k < 3; k++) cv.blob(fx + r.range(-0.1, 0.1) * rad, fy - rad * r.range(0.08, 0.2), 1.1, 1.1, 0, shadeOf(color, 0.5));
  }
}

/** A pea flower (broom, gorse): a standard petal and a keel. */
function peaFlower(/** @type {Canvas} */ cv, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ size, /** @type {Rng} */ r) {
  const a = r.range(-1, 1);
  cv.blob(x, y, size * 0.7, size, a, [0.95, 0.78, 0.1]);
  cv.blob(x + Math.sin(a) * size * 0.35, y - Math.cos(a) * size * 0.35, size * 0.4, size * 0.55, a, [1, 0.9, 0.24]);
}

/** One bedding plant's flower, by colour. */
function bedFlower(/** @type {Canvas} */ cv, /** @type {string} */ colour, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ k, /** @type {Rng} */ r) {
  if (colour === 'red') {
    // Salvia: a short scarlet spike.
    const a = r.range(-0.25, 0.25);
    for (let i = 0; i < 5; i++) cv.blob(x + Math.sin(a) * i * 4 * k + r.range(-1.5, 1.5), y - Math.cos(a) * i * 4 * k, 3.4 * k * (1 - i * 0.1), 4.2 * k, a + r.range(-0.6, 0.6), shadeOf([0.86, 0.1, 0.07], r.range(0.8, 1.15)));
  } else if (colour === 'gold') {
    // Marigold: a ruffled pompom, orange in the middle.
    const rad = 7.5 * k * r.range(0.8, 1.1);
    const hue = /** @type {RGB} */ (r() < 0.5 ? [0.98, 0.72, 0.06] : [0.96, 0.52, 0.05]);
    for (let i = 0; i < 9; i++) cv.blob(x + Math.sin(i * 0.7) * rad * 0.55, y - Math.cos(i * 0.7) * rad * 0.55, rad * 0.42, rad * 0.5, i * 0.7, shadeOf(hue, r.range(0.82, 1.05)));
    cv.blob(x, y, rad * 0.45, rad * 0.45, 0, shadeOf(hue, 0.78));
  } else if (colour === 'blue') {
    // Lobelia: small, five-lobed, violet-blue with a white eye.
    const hue = shadeOf(/** @type {RGB} */ (r() < 0.7 ? [0.2, 0.22, 0.78] : [0.4, 0.24, 0.74]), r.range(0.85, 1.15));
    for (let i = 0; i < 5; i++) cv.blob(x + Math.sin(i * 1.257) * 3 * k, y - Math.cos(i * 1.257) * 3 * k, 2.4 * k, 3 * k, i * 1.257, hue);
    cv.blob(x, y, 1.2 * k, 1.2 * k, 0, [0.92, 0.92, 0.98]);
  } else {
    // Alyssum: a cushion of pinhead flowers.
    for (let i = 0; i < 9; i++) cv.blob(x + r.range(-6, 6) * k, y + r.range(-5, 5) * k, 2.3 * k, 2.3 * k, 0, shadeOf([0.97, 0.97, 0.92], r.range(0.84, 1)));
  }
}

// ───────────────────────────────────── Cells ─────────────────────────────────────

const TWIG = /** @type {RGB} */ ([0.27, 0.22, 0.16]);

/** @type {{ name: string, w: number, h: number, anchor: 'bottom' | 'top' | 'left' | 'centre', slot: [number, number], draw: (cv: Canvas) => void }[]} */
const CELLS = [
  {
    // London plane: big maple-like leaves in a yellowish green, loosely set.
    name: 'plane',
    w: 384,
    h: 384,
    anchor: 'bottom',
    slot: [0, 0],
    draw: (cv) => void mass(cv, 311, { leaf: leaves(S.palmate, [0.37, 0.47, 0.19], 46, { squash: [0.7, 1], vary: 0.16 }), lobes: 11, node: 13, keep: 30, twig: [0.4, 0.37, 0.28], twigWidth: 4.5, upright: 0.2 }),
  },
  {
    // Broom: thin green whips standing up from the foot, lined with yellow pea flowers.
    name: 'broom',
    w: 256,
    h: 288,
    anchor: 'bottom',
    slot: [400, 0],
    draw: (cv) => {
      const r = rng(1723);
      const green = /** @type {RGB} */ ([0.24, 0.38, 0.15]);
      /** @type {[number, number][]} */
      const blooms = [];
      for (let i = 0; i < 46; i++) {
        let x = cv.w / 2 + r.range(-10, 10);
        let y = cv.h - 6;
        let a = r.range(-34, 34) * DEG;
        const length = cv.h * r.range(0.55, 0.92) * (1 - Math.abs(a) * 0.35);
        const shade = r.range(0.7, 1.15);
        for (let d = 0; d < length; d += 7) {
          const nx = x + Math.sin(a) * 7;
          const ny = y - Math.cos(a) * 7;
          if (nx < 14 || nx > cv.w - 14 || ny < 14) break;
          cv.stroke(x, y, nx, ny, 2.6 - (1.6 * d) / length, 2.4 - (1.6 * d) / length, shadeOf(green, shade));
          x = nx;
          y = ny;
          a += r.range(-0.07, 0.07) + Math.sign(a || 1) * 0.004;
          if (d > length * 0.25 && r() < 0.62) blooms.push([x + r.range(-3, 3), y + r.range(-2, 2)]);
        }
      }
      for (const [x, y] of blooms) peaFlower(cv, x, y, r.range(3, 4.4), r);
    },
  },
  {
    name: 'hydrangea',
    w: 256,
    h: 256,
    anchor: 'bottom',
    slot: [672, 0],
    draw: (cv) => {
      const lobes = mass(cv, 1063, { leaf: leaves(S.lime, [0.2, 0.37, 0.16], 44, { squash: [0.7, 1], vary: 0.16 }), lobes: 9, lobeSize: 1.1, gap: 0.7, node: 11, keep: 26, twig: [0.3, 0.3, 0.18], twigWidth: 3.5 });
      const r = rng(1069);
      /** @type {RGB[]} */
      const blues = [[0.36, 0.5, 0.86], [0.46, 0.52, 0.88], [0.58, 0.5, 0.84], [0.42, 0.6, 0.86]];
      for (const l of lobes.slice().sort((a, b) => b.y - a.y).slice(0, 7)) mopHead(cv, l.x + r.range(-6, 6), l.y - l.rad * 0.25, Math.min(30, l.rad * 0.78), blues, r);
    },
  },
  {
    name: 'rhododendron',
    w: 256,
    h: 256,
    anchor: 'bottom',
    slot: [944, 0],
    draw: (cv) => {
      const lobes = mass(cv, 1091, { leaf: leaves(WILLOW, [0.12, 0.25, 0.12], 40, { squash: [1.3, 1.9], vary: 0.18 }), lobes: 10, gap: 0.72, node: 10, keep: 26, twig: TWIG, twigWidth: 4, upright: 0.15 });
      const r = rng(1093);
      for (const l of lobes) {
        if (r() < 0.25) continue;
        const [x, y] = onLobe(l, r, 0.5);
        truss(cv, x, y, Math.min(24, l.rad * 0.62), /** @type {RGB} */ (r() < 0.75 ? [0.84, 0.3, 0.52] : [0.9, 0.5, 0.66]), r);
      }
    },
  },
  ...[
    { colour: 'red', hues: /** @type {RGB[]} */ ([[0.78, 0.07, 0.1], [0.66, 0.05, 0.1]]), seed: 1819, slot: /** @type {[number, number]} */ ([1216, 0]) },
    { colour: 'pink', hues: /** @type {RGB[]} */ ([[0.93, 0.5, 0.6], [0.95, 0.66, 0.7]]), seed: 1823, slot: /** @type {[number, number]} */ ([1456, 0]) },
    { colour: 'yellow', hues: /** @type {RGB[]} */ ([[0.96, 0.82, 0.3], [0.97, 0.93, 0.8]]), seed: 1849, slot: /** @type {[number, number]} */ ([1696, 0]) },
  ].map(({ colour, hues, seed, slot }) => ({
    // A bush rose: glossy dark leaflets on green canes, a dozen blooms at all stages.
    name: `rose-${colour}`,
    w: 224,
    h: 224,
    anchor: /** @type {'bottom'} */ ('bottom'),
    slot,
    draw: (/** @type {Canvas} */ cv) => {
      const lobes = mass(cv, seed, { leaf: leaves(S.box, [0.16, 0.3, 0.14], 30, { squash: [0.75, 1], vary: 0.18 }), lobes: 9, lobeSize: 0.9, gap: 0.95, node: 10, keep: 24, twig: [0.26, 0.36, 0.16], twigWidth: 3.2, upright: 0.3 });
      const r = rng(seed + 2);
      for (const l of lobes) {
        const n = r() < 0.5 ? 1 : 2;
        for (let i = 0; i < n; i++) {
          const [x, y] = onLobe(l, r, 0.6);
          roseBloom(cv, x, y, r.range(9, 13.5), r.pick(hues), r);
        }
      }
    },
  })),
  ...['red', 'gold', 'blue', 'white'].map((colour, n) => ({
    // Summer bedding: low leafy plants shoulder to shoulder, in full flower. The picture is used both upright
    // (the edge of a bed) and laid flat (its top), so flowers are spread over all of it, thickest at the top.
    name: `bed-${colour}`,
    w: 256,
    h: 160,
    anchor: /** @type {'bottom'} */ ('bottom'),
    slot: /** @type {[number, number]} */ ([928 + n * 272, 272]),
    draw: (/** @type {Canvas} */ cv) => {
      const r = rng(1903 + n * 17);
      const leaf = leaves(S.box, colour === 'white' ? [0.3, 0.42, 0.26] : colour === 'blue' ? [0.17, 0.33, 0.16] : [0.2, 0.36, 0.14], 30, { squash: [0.7, 1], vary: 0.2 });
      const top = (/** @type {number} */ x) => 30 + 7 * Math.sin(x * 0.07 + n) + 5 * Math.sin(x * 0.19 + 2 * n);
      /** @type {{ x: number, y: number, a: number, z: number }[]} */
      const spots = [];
      for (let i = 0; i < 620; i++) {
        const x = r.range(26, cv.w - 26);
        const edge = Math.min(x - 26, cv.w - 26 - x) / 30;
        spots.push({ x, y: r.range(top(x) + 16 + (edge < 1 ? (1 - edge) * r.range(0, 46) : 0), cv.h + 20), a: r.range(-75, 75) * DEG, z: r() });
      }
      spots.sort((a, b) => a.z - b.z);
      for (const s of spots) {
        const l = leaf(r, 0.55 + 0.5 * s.z);
        cv.stamp(l.sprite, s.x, s.y, s.a, l.scale, { ...l, clip: s.y > cv.h - 30 });
      }
      const count = colour === 'gold' ? 62 : colour === 'red' ? 80 : colour === 'blue' ? 240 : 120;
      for (let i = 0; i < count; i++) {
        const x = r.range(22, cv.w - 22);
        const y = top(x) + 6 + r() ** 1.6 * (cv.h - top(x) - 12);
        if (cv.px[(Math.floor(Math.min(cv.h - 1, y + 8)) * cv.w + Math.floor(x)) * 4 + 3] < 0.5) continue;
        bedFlower(cv, colour, x, y, 1, r);
      }
    },
  })),
  {
    // A run of rank grass: blades and seed heads from many feet along the bottom, mostly straw by midsummer.
    name: 'grass-long',
    w: 512,
    h: 192,
    anchor: 'bottom',
    slot: [400, 304],
    draw: (cv) => {
      const r = rng(1619);
      const blade = leaves(S.blade, [0.52, 0.55, 0.28], 150, { squash: [0.9, 1.6], size: [0.45, 1], vary: 0.24, hue: 0.12 });
      const straw = leaves(PLUME_STALKS, [0.72, 0.63, 0.38], 172, { squash: [1, 1.6], size: [0.7, 1], vary: 0.1 });
      /** @type {{ x: number, a: number, z: number, head: boolean }[]} */
      const items = [];
      for (let i = 0; i < 230; i++) items.push({ x: r.range(40, cv.w - 40), a: r.range(-34, 34), z: r(), head: false });
      for (let i = 0; i < 46; i++) items.push({ x: r.range(46, cv.w - 46), a: r.range(-16, 16), z: r(), head: true });
      items.sort((a, b) => a.z - b.z);
      for (const it of items) {
        // Shorter towards the two ends, so a run laps onto the next without a square edge.
        const end = Math.min(1, Math.min(it.x - 30, cv.w - 30 - it.x) / 70);
        const l = (it.head ? straw : blade)(r, 0.6 + 0.46 * it.z);
        for (const k of [1, 0.8, 0.62, 0.45]) if (cv.stamp(l.sprite, it.x, cv.h - 8, it.a * DEG, l.scale * k * (0.55 + 0.45 * end), l)) break;
      }
    },
  },
  {
    // Nothing: plain white, for surfaces coloured by their vertices (distant trunks, the heart of a hedge).
    name: 'solid',
    w: 64,
    h: 64,
    anchor: 'centre',
    slot: [1952, 0],
    draw: (cv) => {
      for (let i = 0; i < cv.w * cv.h; i++) cv.px.set([1, 1, 1, 1], i * 4);
    },
  },
];

// ───────────────────────────────────── Compose and pack ─────────────────────────────────────

/** @type {{ name: string, x: number, y: number, w: number, h: number }[]} */
const slots = [];
for (const cell of CELLS) {
  const s = { name: cell.name, x: cell.slot[0], y: cell.slot[1], w: cell.w + GUTTER * 2, h: cell.h + GUTTER * 2 };
  if (s.x + s.w > WIDTH || s.y + s.h > HEIGHT) throw new Error(`cell "${cell.name}" runs off the strip`);
  const clash = slots.find((o) => s.x < o.x + o.w && o.x < s.x + s.w && s.y < o.y + o.h && o.y < s.y + s.h);
  if (clash) throw new Error(`cells "${cell.name}" and "${clash.name}" overlap`);
  slots.push(s);
}

const strip = new Uint8Array(WIDTH * HEIGHT * 4);
/** @type {Record<string, { x: number, y: number, w: number, h: number, anchor: string, mean: number[] }>} */
const cellsOut = {};
for (const cell of CELLS) {
  const cv = new Canvas(cell.w, cell.h);
  cell.draw(cv);
  const x = cell.slot[0] + GUTTER;
  const y = cell.slot[1] + GUTTER;
  const mean = [0, 0, 0];
  let opaque = 0;
  for (let py = 0; py < cell.h; py++) {
    for (let px = 0; px < cell.w; px++) {
      const i = (py * cell.w + px) * 4;
      const a = Math.min(1, cv.px[i + 3]);
      if (a < 1 / 255) continue;
      const o = ((y + py) * WIDTH + x + px) * 4;
      for (let c = 0; c < 3; c++) strip[o + c] = Math.min(255, Math.max(0, Math.round((cv.px[i + c] / a) * 255)));
      strip[o + 3] = Math.round(a * 255);
      if (a > 0.5) {
        for (let c = 0; c < 3; c++) mean[c] += strip[o + c] / 255;
        opaque++;
      }
    }
  }
  cellsOut[cell.name] = { x, y, w: cell.w, h: cell.h, anchor: cell.anchor, mean: mean.map((v) => +(v / Math.max(1, opaque)).toFixed(3)) };
  console.log(`  ${cell.name.padEnd(14)} ${cell.w} x ${cell.h} at ${x},${y}  coverage ${(cv.coverage() * 100).toFixed(0)} %`);
}

mkdirSync(OUT, { recursive: true });
const webp = path.join(OUT, 'extra.webp');
await sharp(strip, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).webp({ quality: 80, alphaQuality: 88, effort: 6, smartSubsample: true }).toFile(webp);
const sources = USED.map((key) => ({ key, asset: SOURCES[key].id, library: SOURCES[key].library, licence: 'CC0-1.0', use: SOURCES[key].what }));
writeFileSync(path.join(OUT, 'extra.json'), `${JSON.stringify({ version: 1, file: 'extra.webp', height: HEIGHT, cells: cellsOut, sources }, null, 2)}\n`);
console.log(`\nWrote ${path.relative(ROOT, webp)} (${(statSync(webp).size / 1024).toFixed(0)} kB) and extra.json: ${CELLS.length} cells.`);

if (PREVIEW) {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const a = strip[i * 4 + 3] / 255;
    const bg = [150, 170, 200];
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = strip[i * 4 + c] * a + bg[c] * (1 - a);
  }
  const file = path.join(STAGING, 'debug', 'extra-preview.jpg');
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).jpeg({ quality: 90 }).toFile(file);
  console.log(`Preview: ${path.relative(ROOT, file)}`);
}
