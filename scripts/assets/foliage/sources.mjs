// @ts-check
/**
 * Downloading and sprite extraction for the foliage atlas (see ../fetch-foliage.mjs).
 *
 * Every source is a CC0 photo-scanned leaf / twig sheet with an opacity map, from ambientCG or from
 * the texture set of a Poly Haven plant model. Raw downloads are cached in assets-staging/foliage/
 * (git-ignored). Each sheet is cut into its separate leaves or sprigs ("sprites") by flood-filling
 * the opacity map; nothing else from the sources is used.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const STAGING = path.join(ROOT, 'assets-staging', 'foliage');
const USER_AGENT = '03-quest-texture-pipeline/1.0 (browser game build script; downloads each CC0 texture once and caches it)';

/**
 * @typedef {object} Source
 * @property {'ambientcg' | 'polyhaven'} library
 * @property {string} id
 * @property {[string, string]} [maps]   Poly Haven only: names of the colour and opacity maps in the files API.
 * @property {number} [minArea]          Smallest sprite kept, in pixels of the 1K sheet (default 600).
 * @property {number} [stem]             Direction from each sprite's tip to its stem end on the sheet, in
 *                                       degrees clockwise from "down" (0 = stem at the bottom, 90 = stem on the
 *                                       left, 180 = top, 270 = right). Omit to find it from the sprite's own shape
 *                                       (the stem end is the thin end).
 * @property {string} what
 */

/** @type {Record<string, Source>} */
export const SOURCES = {
  oak: { library: 'ambientcg', id: 'LeafSet016', stem: 0, what: 'English oak leaves' },
  lime: { library: 'ambientcg', id: 'LeafSet004', stem: 0, what: 'heart-shaped leaves (poplar)' },
  narrow: { library: 'ambientcg', id: 'LeafSet013', what: 'narrow lanceolate leaves (willow)' },
  box: { library: 'ambientcg', id: 'LeafSet002', what: 'small-leaved sprigs (hedging)' },
  cypress: { library: 'ambientcg', id: 'LeafSet019', what: 'conifer sprays (macrocarpa)' },
  blade: { library: 'ambientcg', id: 'Foliage001', what: 'long grass blades' },
  strap: { library: 'ambientcg', id: 'Foliage008', what: 'broad strap leaves (flax, cabbage tree, palm leaflets)' },
  plume: { library: 'ambientcg', id: 'Foliage002', what: 'grass seed heads (toetoe plumes)' },
  palmate: { library: 'ambientcg', id: 'LeafSet025', what: 'palmate leaves (lupin)' },
  pine: { library: 'polyhaven', id: 'pine_tree_01', maps: ['twig_diff', 'twig_alpha'], what: 'pine needle sprigs' },
  fir: { library: 'polyhaven', id: 'fir_tree_01', maps: ['twig_diff', 'twig_alpha'], what: 'fir sprigs (Norfolk pine branchlets)' },
  willow: { library: 'polyhaven', id: 'shrub_02', maps: ['Diffuse', 'Alpha'], what: 'long willow-like leaves' },
};

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cached = (/** @type {string} */ file, force = false) => !force && existsSync(file) && statSync(file).size > 0;

/**
 * @param {string} url
 * @param {string} dest
 * @param {{ md5?: string, force?: boolean }} [options]
 */
export async function download(url, dest, options = {}) {
  if (cached(dest, options.force)) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  let lastError = new Error('not attempted');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0) throw new Error('empty response');
      if (options.md5 && createHash('md5').update(body).digest('hex') !== options.md5) throw new Error('checksum mismatch');
      writeFileSync(`${dest}.part`, body);
      renameSync(`${dest}.part`, dest);
      console.log(`    downloaded ${path.relative(ROOT, dest)} (${(body.length / 1024).toFixed(0)} kB)`);
      return;
    } catch (err) {
      lastError = /** @type {Error} */ (err);
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  throw new Error(`could not download ${url}: ${lastError.message}`);
}

/**
 * @param {string} url
 * @param {string} cacheFile
 * @param {boolean} force
 */
async function getJson(url, cacheFile, force) {
  await download(url, cacheFile, { force });
  return JSON.parse(readFileSync(cacheFile, 'utf8'));
}

/**
 * @typedef {object} RawSheet
 * @property {string} color
 * @property {string} opacity
 * @property {string} name
 * @property {string} author
 * @property {string} page
 * @property {string} libraryName
 */

/**
 * @param {Source} source
 * @param {boolean} force
 * @returns {Promise<RawSheet>}
 */
async function fetchAmbientCg(source, force) {
  const { id } = source;
  const dir = path.join(STAGING, 'ambientcg', id);
  const cacheFile = path.join(dir, 'asset.json');
  const json = await getJson(`https://ambientcg.com/api/v2/full_json?${new URLSearchParams({ id, include: 'downloadData' })}`, cacheFile, force);
  const asset = (json.foundAssets ?? []).find((/** @type {{ assetId: string }} */ a) => a.assetId === id);
  if (!asset) {
    rmSync(cacheFile, { force: true });
    throw new Error(`ambientCG has no asset "${id}"`);
  }
  /** @type {{ attribute: string, downloadLink: string, fileName: string }[]} */
  const downloads = asset.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads ?? [];
  const zipInfo = downloads.find((d) => d.attribute === '1K-JPG');
  if (!zipInfo) throw new Error(`ambientCG asset "${id}" has no 1K JPEG download`);
  const zip = path.join(dir, path.basename(zipInfo.fileName));
  await download(zipInfo.downloadLink, zip, { force });
  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const entry = (/** @type {string} */ map) => entries.find((name) => !name.includes('/') && name.endsWith(`_${map}.jpg`));
  const color = entry('Color');
  const opacity = entry('Opacity');
  if (!color || !opacity) throw new Error(`ambientCG asset "${id}" lacks a colour or opacity map`);
  // The archive is untrusted: only the two named JPEGs are extracted, without paths, into their own folder.
  const unzipped = path.join(dir, 'unzipped');
  if ([color, opacity].some((name) => !cached(path.join(unzipped, name), force))) {
    mkdirSync(unzipped, { recursive: true });
    execFileSync('unzip', ['-o', '-q', '-j', zip, color, opacity, '-d', unzipped]);
  }
  return {
    color: path.join(unzipped, color),
    opacity: path.join(unzipped, opacity),
    name: asset.displayName ?? id,
    author: 'ambientCG',
    page: `https://ambientcg.com/a/${id}`,
    libraryName: 'ambientCG',
  };
}

/**
 * @param {Source} source
 * @param {boolean} force
 * @returns {Promise<RawSheet>}
 */
async function fetchPolyHaven(source, force) {
  const { id } = source;
  const dir = path.join(STAGING, 'polyhaven', id);
  const info = await getJson(`https://api.polyhaven.com/info/${id}`, path.join(dir, 'info.json'), force);
  const files = await getJson(`https://api.polyhaven.com/files/${id}`, path.join(dir, 'files.json'), force);
  const get = async (/** @type {string} */ map) => {
    const formats = files[map]?.['1k'];
    const file = formats?.jpg ?? formats?.png;
    if (!file?.url) throw new Error(`Poly Haven asset "${id}" has no 1K "${map}" map`);
    const dest = path.join(dir, path.basename(new URL(file.url).pathname));
    await download(file.url, dest, { md5: file.md5, force });
    return dest;
  };
  const [colorMap, opacityMap] = source.maps ?? ['Diffuse', 'Alpha'];
  return {
    color: await get(colorMap),
    opacity: await get(opacityMap),
    name: info.name ?? id,
    author: Object.keys(info.authors ?? {}).join(', '),
    page: `https://polyhaven.com/a/${id}`,
    libraryName: 'Poly Haven',
  };
}

/**
 * @param {Source} source
 * @param {boolean} [force]
 */
export const fetchSheet = (source, force = false) => (source.library === 'ambientcg' ? fetchAmbientCg(source, force) : fetchPolyHaven(source, force));

/**
 * One leaf or sprig cut from a sheet, turned so its stem is at the bottom centre and its tip points up.
 * Pixels are straight (not premultiplied) sRGB-encoded floats 0..1, RGBA.
 * @typedef {object} Sprite
 * @property {number} w
 * @property {number} h
 * @property {Float32Array} px
 * @property {number} length   Stem to tip, in pixels (= h).
 * @property {number} area     Opaque pixels.
 */

/**
 * Cuts a sheet into sprites.
 * @param {RawSheet} raw
 * @param {Source} source
 * @returns {Promise<Sprite[]>}
 */
export async function extractSprites(raw, source) {
  const size = 1024;
  const read = async (/** @type {string} */ file, /** @type {boolean} */ grey) => {
    let img = sharp(file).removeAlpha().resize(size, size, { fit: 'fill', kernel: 'lanczos3' });
    if (grey) img = img.greyscale();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    return { data, channels: info.channels };
  };
  const col = await read(raw.color, false);
  const op = await read(raw.opacity, true);
  const alpha = new Float32Array(size * size);
  for (let i = 0; i < alpha.length; i++) alpha[i] = op.data[i * op.channels] / 255;

  // Flood fill (8-connected) over alpha > 0.5.
  const label = new Int32Array(size * size).fill(-1);
  /** @type {{ pixels: number[], minX: number, minY: number, maxX: number, maxY: number }[]} */
  const parts = [];
  const stack = [];
  for (let start = 0; start < alpha.length; start++) {
    if (alpha[start] <= 0.5 || label[start] !== -1) continue;
    const part = { pixels: /** @type {number[]} */ ([]), minX: size, minY: size, maxX: 0, maxY: 0 };
    const id = parts.length;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = /** @type {number} */ (stack.pop());
      const x = i % size;
      const y = (i - x) / size;
      part.pixels.push(i);
      if (x < part.minX) part.minX = x;
      if (x > part.maxX) part.maxX = x;
      if (y < part.minY) part.minY = y;
      if (y > part.maxY) part.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const n = ny * size + nx;
          if (alpha[n] > 0.5 && label[n] === -1) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
    }
    parts.push(part);
  }

  const minArea = source.minArea ?? 600;
  /** @type {Sprite[]} */
  const sprites = [];
  parts.forEach((part, id) => {
    if (part.pixels.length < minArea) return;
    // Principal axis of the opaque pixels.
    let cx = 0;
    let cy = 0;
    for (const i of part.pixels) {
      cx += i % size;
      cy += Math.floor(i / size);
    }
    cx /= part.pixels.length;
    cy /= part.pixels.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const i of part.pixels) {
      const dx = (i % size) - cx;
      const dy = Math.floor(i / size) - cy;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy); // direction of the long axis (image coords, y down)
    let ax = Math.cos(angle);
    let ay = Math.sin(angle);
    // Extent along and across the axis.
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of part.pixels) {
      const t = ((i % size) - cx) * ax + (Math.floor(i / size) - cy) * ay;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    // Which end is the stem?
    let stemAtLo;
    if (source.stem !== undefined) {
      // Direction tip -> stem on the sheet: 0 = down (+y), 90 = left (-x), 180 = up, 270 = right.
      const a = (source.stem * Math.PI) / 180;
      const sx = -Math.sin(a);
      const sy = Math.cos(a);
      stemAtLo = ax * sx + ay * sy < 0;
    } else {
      // The stem end is the thin one: compare the mass in the outer 15 % at each end.
      const span = hi - lo;
      let massLo = 0;
      let massHi = 0;
      for (const i of part.pixels) {
        const t = ((i % size) - cx) * ax + (Math.floor(i / size) - cy) * ay;
        if (t < lo + span * 0.15) massLo++;
        else if (t > hi - span * 0.15) massHi++;
      }
      stemAtLo = massLo < massHi;
    }
    // From here on (ax, ay) points from the tip towards the stem, and (dx, dy) from the stem to the tip.
    if (stemAtLo) {
      ax = -ax;
      ay = -ay;
    }
    const dx = -ax;
    const dy = -ay;
    // Stem point: the centroid of the pixels nearest the stem end.
    let stemT = -Infinity;
    for (const i of part.pixels) {
      const t = ((i % size) - cx) * ax + (Math.floor(i / size) - cy) * ay;
      if (t > stemT) stemT = t;
    }
    let px = 0;
    let py = 0;
    let n = 0;
    for (const i of part.pixels) {
      const x = i % size;
      const y = Math.floor(i / size);
      const t = (x - cx) * ax + (y - cy) * ay;
      if (t > stemT - 3) {
        px += x;
        py += y;
        n++;
      }
    }
    px /= n;
    py /= n;
    // The cut-out is turned so the stem-to-tip direction points up its image; (rx, ry) is then its "right".
    const rx = -dy;
    const ry = dx;
    let minU = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (const i of part.pixels) {
      const x = (i % size) - px;
      const y = Math.floor(i / size) - py;
      const u = x * rx + y * ry;
      const v = x * dx + y * dy; // distance towards the tip
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v > maxV) maxV = v;
    }
    const pad = 2;
    const half = Math.ceil(Math.max(-minU, maxU)) + pad;
    const w = half * 2 + 1;
    const h = Math.ceil(maxV) + pad * 2 + 1;
    const out = new Float32Array(w * h * 4);
    let area = 0;
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        // Sprite pixel (u, v): stem at (half, h - 1 - pad); up the image is towards the tip.
        const su = u - half;
        const sv = h - 1 - pad - v;
        const x = px + su * rx + sv * dx;
        const y = py + su * ry + sv * dy;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        if (x0 < 0 || y0 < 0 || x0 >= size - 1 || y0 >= size - 1) continue;
        const fx = x - x0;
        const fy = y - y0;
        let a = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = 0; k < 4; k++) {
          const xi = x0 + (k & 1);
          const yi = y0 + (k >> 1);
          const i = yi * size + xi;
          const wgt = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy);
          // Only this sprite's own pixels count (neighbouring sprites can sit inside the rotated box).
          const own = label[i] === id || (alpha[i] <= 0.5 && nearLabel(label, size, xi, yi, id));
          const al = own ? alpha[i] : 0;
          a += wgt * al;
          r += (wgt * al * col.data[i * col.channels]) / 255;
          g += (wgt * al * col.data[i * col.channels + 1]) / 255;
          b += (wgt * al * col.data[i * col.channels + 2]) / 255;
        }
        const o = (v * w + u) * 4;
        if (a > 0.003) {
          out[o] = r / a;
          out[o + 1] = g / a;
          out[o + 2] = b / a;
          out[o + 3] = a;
          if (a > 0.5) area++;
        }
      }
    }
    sprites.push({ w, h, px: out, length: h, area });
  });
  // Biggest first, so recipes can ask for "the large ones".
  sprites.sort((a, b) => b.area - a.area);
  return sprites;
}

/** True when a pixel of sprite `id` touches (x, y): lets a sprite keep its own soft edge. */
function nearLabel(/** @type {Int32Array} */ label, /** @type {number} */ size, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ id) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (label[ny * size + nx] === id) return true;
    }
  }
  return false;
}
