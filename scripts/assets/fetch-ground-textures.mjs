#!/usr/bin/env node
// @ts-check
/**
 * Extra photographic layers for the terrain (see ASSETS.md, "Ground and water").
 *
 *   node scripts/assets/fetch-ground-textures.mjs [--force]
 *
 * The terrain shader (src/world/ground.ts) blends seven ground layers. Four reuse maps that
 * fetch-textures.mjs already ships (grass, river shingle, sand, concrete); this script adds the three
 * that were missing:
 *
 *   dry    withered long grass   (road verges, tussock, browned-off paddocks, stubble, marram)
 *   soil   cloddy farm soil      (ploughed paddocks, bare yards, stream beds)
 *   rock   weathered rock        (outcrops on the Port Hills, steep faces, harbour shores)
 *
 * For each it downloads the 1K albedo and OpenGL normal map of a CC0 Poly Haven asset (cached under
 * the git-ignored assets-staging/textures/polyhaven/<id>/) and writes
 *
 *   src/assets/textures/ground/<layer>_col.jpg   1024 x 1024 sRGB albedo, JPEG q80
 *   src/assets/textures/ground/<layer>_nor.jpg    512 x  512 tangent-space normals (OpenGL, +Y up), JPEG q82
 *
 * Nothing is cropped, so the maps tile as the sources do. The albedo keeps its photographed colour: the
 * shader divides every layer by its own average and multiplies the ground colour back in, so only the
 * variation inside the photograph is used. Tile-sized light and dark blotches are evened out (FLATTEN)
 * so the repeat does not show across a paddock.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGING = path.join(ROOT, 'assets-staging', 'textures', 'polyhaven');
const OUT = path.join(ROOT, 'src', 'assets', 'textures', 'ground');
const USER_AGENT = '03-quest-texture-pipeline/1.0 (browser game build script; downloads each CC0 texture once and caches it)';
const FORCE = process.argv.includes('--force');

const ALBEDO_SIZE = 1024;
const NORMAL_SIZE = 512;

/** layer → Poly Haven asset id, and how strongly tile-sized blotches are evened out (0..1). */
const LAYERS = {
  dry: { id: 'withered_grass', flatten: 0.75 },
  soil: { id: 'farm_soil', flatten: 0.6 },
  rock: { id: 'rock_boulder_dry', flatten: 0.35 },
};

const cached = (/** @type {string} */ file) => !FORCE && existsSync(file) && statSync(file).size > 0;

/**
 * @param {string} url
 * @param {string} dest
 * @param {string} [md5]
 */
async function download(url, dest, md5) {
  if (cached(dest)) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`could not download ${url}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (md5 && createHash('md5').update(body).digest('hex') !== md5) throw new Error(`checksum mismatch for ${url}`);
  writeFileSync(`${dest}.part`, body);
  renameSync(`${dest}.part`, dest);
  console.log(`    downloaded ${path.relative(ROOT, dest)} (${(body.length / 1024).toFixed(0)} kB)`);
}

/**
 * @param {string} url
 * @param {string} cacheFile
 */
async function getJson(url, cacheFile) {
  await download(url, cacheFile);
  return JSON.parse(readFileSync(cacheFile, 'utf8'));
}

/**
 * Evens out blotches wider than about a sixth of the tile: divides by a wrap-around low-pass of the
 * luminance, mixed in by `amount`.
 * @param {Buffer} rgb  size x size x 3 bytes
 * @param {number} size
 * @param {number} amount
 */
function flatten(rgb, size, amount) {
  const G = 32;
  const cell = size / G;
  const low = new Float64Array(G * G);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      low[Math.floor(y / cell) * G + Math.floor(x / cell)] += 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
    }
  }
  for (let i = 0; i < low.length; i++) low[i] /= cell * cell;
  // Wrap-around blur of the coarse grid (three passes of a 5-tap box in each direction).
  const blur = (/** @type {Float64Array} */ src) => {
    const out = new Float64Array(G * G);
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += src[((y + dy + G) % G) * G + ((x + dx + G) % G)];
        out[y * G + x] = sum / 25;
      }
    }
    return out;
  };
  const smooth = blur(blur(blur(low)));
  let mean = 0;
  for (const v of smooth) mean += v;
  mean /= smooth.length;
  const out = Buffer.alloc(rgb.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Bilinear, wrap-around lookup of the coarse grid.
      const gx = (x + 0.5) / cell - 0.5;
      const gy = (y + 0.5) / cell - 0.5;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const at = (/** @type {number} */ a, /** @type {number} */ b) => smooth[((b + G) % G) * G + ((a + G) % G)];
      const l = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      const gain = 1 + (mean / Math.max(1, l) - 1) * amount;
      const i = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(rgb[i + c] * gain)));
    }
  }
  return out;
}

mkdirSync(OUT, { recursive: true });
const report = [];
for (const [layer, spec] of Object.entries(LAYERS)) {
  console.log(`${layer}: Poly Haven ${spec.id}`);
  const dir = path.join(STAGING, spec.id);
  const info = await getJson(`https://api.polyhaven.com/info/${spec.id}`, path.join(dir, 'info.json'));
  const files = await getJson(`https://api.polyhaven.com/files/${spec.id}`, path.join(dir, 'files.json'));
  const pick = (/** @type {string[]} */ maps) => {
    for (const map of maps) {
      const file = files[map]?.['1k']?.jpg;
      if (file?.url) return file;
    }
    throw new Error(`${spec.id}: no 1K JPEG for ${maps.join(' / ')}`);
  };
  const get = async (/** @type {{ url: string, md5?: string }} */ file) => {
    const dest = path.join(dir, path.basename(new URL(file.url).pathname));
    await download(file.url, dest, file.md5);
    return dest;
  };
  const albedo = await get(pick(['Diffuse', 'diffuse', 'Color', 'col']));
  const normal = await get(pick(['nor_gl']));

  const raw = await sharp(albedo).removeAlpha().toColourspace('srgb').resize(ALBEDO_SIZE, ALBEDO_SIZE, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  const col = path.join(OUT, `${layer}_col.jpg`);
  await sharp(flatten(raw, ALBEDO_SIZE, spec.flatten), { raw: { width: ALBEDO_SIZE, height: ALBEDO_SIZE, channels: 3 } }).jpeg({ mozjpeg: true, quality: 80 }).toFile(col);
  const nor = path.join(OUT, `${layer}_nor.jpg`);
  await sharp(normal, { ignoreIcc: true }).removeAlpha().resize(NORMAL_SIZE, NORMAL_SIZE, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ mozjpeg: true, quality: 82, chromaSubsampling: '4:4:4' }).toFile(nor);
  const kb = (/** @type {string} */ f) => Math.round(statSync(f).size / 1024);
  report.push(`${layer}: ${info.name} (${spec.id}) by ${Object.keys(info.authors ?? {}).join(', ')}: ${path.basename(col)} ${kb(col)} kB, ${path.basename(nor)} ${kb(nor)} kB`);
}
console.log('\n' + report.join('\n'));
