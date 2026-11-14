#!/usr/bin/env node
// @ts-check
/**
 * Verifies what fetch-textures.mjs shipped in src/assets/textures/:
 *
 *   node scripts/assets/check-textures.mjs
 *
 *  - every manifest entry names its three maps, they exist, are JPEGs of the stated size
 *    (albedo and normals 1024 x 1024 RGB, roughness 512 x 512 greyscale) and are CC0 with a source;
 *  - neutral albedos are pale and nearly grey (mean luminance 0.70-0.85, mean saturation < 0.12);
 *  - normal maps look like tangent-space normals (pointing out of the surface, no strong overall lean)
 *    and roughness maps are not mirror-glossy;
 *  - no map has a visible jump where it wraps;
 *  - nothing unreferenced sits in the folder (Vite would bundle it) and the folder is within budget.
 *
 * Prints a row per surface and exits non-zero on any failure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'src', 'assets', 'textures');
const BUDGET_BYTES = 22 * 1024 * 1024;

const EXPECT = {
  map: { size: 1024, channels: 3 },
  normalMap: { size: 1024, channels: 3 },
  roughnessMap: { size: 512, channels: 1 },
};
const NEUTRAL = { minLuminance: 0.7, maxLuminance: 0.85, maxSaturation: 0.12 };

/** @type {string[]} */
const failures = [];
const fail = (/** @type {string} */ message) => failures.push(message);

/**
 * Decoded pixels, in the file's own channel layout (sharp would otherwise expand greyscale to RGB).
 * @param {string} file
 * @param {number} channels  Channel count stored in the file.
 */
async function pixels(file, channels) {
  const { data, info } = await sharp(file, { ignoreIcc: true })
    .toColourspace(channels === 1 ? 'b-w' : 'srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Compares the step across the wrap (last column to first, last row to first) with the steps between
 * neighbouring columns / rows inside the image. Bricks, planks and slabs often put a joint on the tile
 * edge, which is a big step but not a seam, so the yardstick is the biggest step found anywhere inside
 * the image: `ratio` is wrap step / biggest inner step, and a seam is reported when that passes 1.5
 * (and the wrap step is not simply ordinary texture noise).
 * @param {Awaited<ReturnType<typeof pixels>>} image
 */
function wrapStep({ data, width, height, channels }) {
  const value = (/** @type {number} */ x, /** @type {number} */ y) => {
    const i = (y * width + x) * channels;
    return channels >= 3 ? 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] : data[i];
  };
  /** @param {boolean} alongX */
  const axis = (alongX) => {
    const n = alongX ? width : height;
    const m = alongX ? height : width;
    const steps = new Float64Array(n);
    for (let a = 0; a < n; a++) {
      const b = (a + 1) % n;
      let sum = 0;
      for (let t = 0; t < m; t++) sum += Math.abs(alongX ? value(a, t) - value(b, t) : value(t, a) - value(t, b));
      steps[a] = sum / m;
    }
    const wrap = steps[n - 1];
    const inner = Array.from(steps.subarray(0, n - 1)).sort((p, q) => p - q);
    // Steps are in 8-bit levels; half a level is the floor so a flat map does not divide by zero.
    const median = Math.max(inner[Math.floor(inner.length / 2)], 0.5);
    const largest = Math.max(inner[inner.length - 1], 0.5);
    return { ratio: wrap / largest, seam: wrap > 2 * median && wrap > 1.5 * largest };
  };
  const u = axis(true);
  const v = axis(false);
  return { ratio: Math.max(u.ratio, v.ratio), seam: u.seam || v.seam };
}

const manifestPath = path.join(DIR, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`No manifest at ${path.relative(ROOT, manifestPath)}: run scripts/assets/fetch-textures.mjs first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version !== 1) fail(`manifest.version is ${manifest.version}, expected 1`);
const surfaces = /** @type {Record<string, any>} */ (manifest.surfaces ?? {});
const referenced = new Set(['manifest.json']);

// lum / sat: albedo mean luminance and saturation. rough: mean of the roughness map. wrap: the worst
// wrap step / biggest inner step over the three maps (a seam is above 1.5).
console.log('surface       tint     tile (m)      lum    sat  rough   wrap  col kB  nor kB  rgh kB  asset');
for (const [kind, entry] of Object.entries(surfaces)) {
  const at = (/** @type {string} */ message) => fail(`${kind}: ${message}`);
  if (entry.tint !== 'neutral' && entry.tint !== 'natural') at(`tint "${entry.tint}" is neither "neutral" nor "natural"`);
  if (!Array.isArray(entry.tile) || entry.tile.length !== 2 || !entry.tile.every((/** @type {unknown} */ t) => typeof t === 'number' && t > 0)) at('tile must be [metresU, metresV]');
  if (entry.licence !== 'CC0-1.0') at(`licence is "${entry.licence}", only CC0-1.0 may ship`);
  if (!/^https:\/\/(polyhaven\.com|ambientcg\.com)\/a\/[\w-]+$/.test(entry.source ?? '')) at(`source "${entry.source}" is not an asset page URL`);

  /** @type {Record<string, number>} */
  const kB = {};
  let luminance = NaN;
  let saturation = NaN;
  let roughness = NaN;
  let worstStep = 0;
  for (const [key, expect] of Object.entries(EXPECT)) {
    const name = entry[key];
    if (typeof name !== 'string') {
      at(`no ${key}`);
      continue;
    }
    referenced.add(name);
    const file = path.join(DIR, name);
    if (!existsSync(file)) {
      at(`${name} does not exist`);
      continue;
    }
    kB[key] = statSync(file).size / 1024;
    const meta = await sharp(file).metadata();
    if (meta.format !== 'jpeg') at(`${name} is ${meta.format}, expected jpeg`);
    if (meta.width !== expect.size || meta.height !== expect.size) at(`${name} is ${meta.width} x ${meta.height}, expected ${expect.size} x ${expect.size}`);
    if (meta.channels !== expect.channels) at(`${name} has ${meta.channels} channel(s), expected ${expect.channels}`);
    const image = await pixels(file, meta.channels ?? 3);

    const step = wrapStep(image);
    worstStep = Math.max(worstStep, step.ratio);
    if (step.seam) at(`${name} has a visible step where it wraps (${step.ratio.toFixed(1)} x the biggest step inside it)`);

    const count = image.width * image.height;
    if (key === 'map' && image.channels === 3) {
      luminance = 0;
      saturation = 0;
      for (let i = 0; i < image.data.length; i += 3) {
        const r = image.data[i] / 255;
        const g = image.data[i + 1] / 255;
        const b = image.data[i + 2] / 255;
        const max = Math.max(r, g, b);
        luminance += (0.2126 * r + 0.7152 * g + 0.0722 * b) / count;
        saturation += (max > 0 ? (max - Math.min(r, g, b)) / max : 0) / count;
      }
      if (entry.tint === 'neutral') {
        if (luminance < NEUTRAL.minLuminance || luminance > NEUTRAL.maxLuminance) at(`neutral albedo luminance ${luminance.toFixed(3)} is outside ${NEUTRAL.minLuminance}-${NEUTRAL.maxLuminance}`);
        if (saturation >= NEUTRAL.maxSaturation) at(`neutral albedo saturation ${saturation.toFixed(3)} is not below ${NEUTRAL.maxSaturation}`);
      }
    }
    if (key === 'roughnessMap' && image.channels === 1) {
      roughness = 0;
      for (let i = 0; i < image.data.length; i++) roughness += image.data[i] / 255 / count;
      // The loader sets the surface's roughness to 1 and lets the map carry it, so a map that is nearly
      // black would turn the surface into a mirror.
      if (roughness < 0.3) at(`${name}: mean roughness ${roughness.toFixed(2)} is implausibly glossy for an outdoor surface`);
    }
    if (key === 'normalMap' && image.channels === 3) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let i = 0; i < image.data.length; i += 3) {
        x += (image.data[i] / 255) * 2 - 1;
        y += (image.data[i + 1] / 255) * 2 - 1;
        z += (image.data[i + 2] / 255) * 2 - 1;
      }
      // Lapped surfaces (slates, weatherboards) legitimately lean a little; this catches a wrong or broken map.
      if (z / count < 0.6) at(`${name}: mean z ${(z / count).toFixed(2)} is too low for a tangent-space normal map`);
      if (Math.abs(x / count) > 0.2 || Math.abs(y / count) > 0.2) at(`${name}: normals lean (${(x / count).toFixed(3)}, ${(y / count).toFixed(3)}) instead of averaging roughly straight out`);
    }
  }
  console.log(
    [
      kind.padEnd(13),
      String(entry.tint).padEnd(8),
      (Array.isArray(entry.tile) ? entry.tile.join(' x ') : '?').padEnd(13),
      luminance.toFixed(3).padStart(5),
      saturation.toFixed(3).padStart(6),
      roughness.toFixed(2).padStart(6),
      worstStep.toFixed(2).padStart(6),
      ...['map', 'normalMap', 'roughnessMap'].map((key) => (kB[key] ?? 0).toFixed(0).padStart(7)),
      ` ${entry.asset ?? ''}`,
    ].join(' '),
  );
}

let total = 0;
for (const name of readdirSync(DIR)) {
  if (name.startsWith('.')) continue; // .DS_Store and friends are neither bundled nor committed
  total += statSync(path.join(DIR, name)).size;
  if (!referenced.has(name)) fail(`${name} is in src/assets/textures but not in the manifest`);
}
console.log(`\n${Object.keys(surfaces).length} surfaces, ${referenced.size - 1} maps, ${(total / 1048576).toFixed(2)} MB of ${BUDGET_BYTES / 1048576} MB budget`);
if (total > BUDGET_BYTES) fail(`src/assets/textures is ${(total / 1048576).toFixed(2)} MB, over the ${BUDGET_BYTES / 1048576} MB budget`);

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}
console.log('All checks passed.');
