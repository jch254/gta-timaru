#!/usr/bin/env node
// @ts-check
/**
 * Photographic PBR textures for the game's surfaces (see ASSETS.md, "Photographic textures").
 *
 *   node scripts/assets/fetch-textures.mjs [--only=brick,grass] [--force]
 *
 * For every surface in SURFACES below this
 *   1. downloads the 1K (2K if there is no 1K) albedo, OpenGL normal and roughness maps of a CC0
 *      asset from Poly Haven or ambientCG. Raw downloads are cached under assets-staging/textures/
 *      (git-ignored), one folder per asset, and are not fetched again while they are there
 *      (--force re-downloads);
 *   2. writes game-ready maps to src/assets/textures/:
 *        <surface>_col.jpg  1024 x 1024 sRGB albedo, JPEG q82
 *        <surface>_nor.jpg  1024 x 1024 tangent-space normals, OpenGL (+Y up), JPEG q85 4:4:4
 *        <surface>_rgh.jpg   512 x  512 greyscale roughness, JPEG q80 (level corrected where SURFACES says so)
 *   3. writes src/assets/textures/manifest.json, which src/render/phototextures.ts loads.
 *
 * Nothing is cropped, so the maps tile exactly as the sources do.
 *
 * Tint ("neutral" | "natural", see phototextures.ts):
 *   natural  the albedo keeps its photographed colour (the game multiplies it by white).
 *   neutral  the game multiplies the albedo by a paint / vertex colour, so the albedo is shipped as
 *            a pale grey: 15 % of the original saturation, mean sRGB luminance 0.78, local contrast kept.
 *
 * A surface whose assets cannot be fetched is left out of the manifest; the game then keeps its
 * procedural texture for it. --only reprocesses the named surfaces and leaves the other manifest
 * entries as they are.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STAGING = path.join(ROOT, 'assets-staging', 'textures');
const OUT = path.join(ROOT, 'src', 'assets', 'textures');
const USER_AGENT = '03-quest-texture-pipeline/1.0 (browser game build script; downloads each CC0 texture once and caches it)';

const ALBEDO_SIZE = 1024;
const NORMAL_SIZE = 1024;
const ROUGHNESS_SIZE = 512;
const ALBEDO_QUALITY = 82;
const NORMAL_QUALITY = 85;
const ROUGHNESS_QUALITY = 80;

/** Neutral albedos: mean sRGB luminance and the share of the original saturation that is kept. */
const NEUTRAL_MEAN = 0.78;
const NEUTRAL_SATURATION = 0.15;

/**
 * @typedef {object} Candidate
 * @property {'polyhaven' | 'ambientcg'} library
 * @property {string} id                 Asset id in that library.
 * @property {[number, number]} tile     Metres covered by one repeat (u, v), so features are life-size.
 * @property {number} [flatten]          0..1: even out tile-sized light / dark blotches (hides the repeat on big areas).
 * @property {number} [saturation]       Natural albedos only: chroma multiplier.
 * @property {number} [gain]             Natural albedos only: brightness multiplier (sRGB-encoded values).
 * @property {number} [keepSaturation]   Neutral albedos only: overrides NEUTRAL_SATURATION.
 * @property {number} [roughness]        Mean (0..1) the roughness map is shifted to, keeping its variation. Set where
 *                                       the source's level would be wrong outdoors: the libraries author roughness
 *                                       for their own renderers, and several matt surfaces arrive near 0.5 (grass
 *                                       at 0.26), which in the game would shine like wet ground under the sun.
 *
 * @typedef {object} SurfaceSpec
 * @property {'neutral' | 'natural'} tint
 * @property {string} what               What the surface is in the game (for the log and ASSETS.md).
 * @property {Candidate[]} candidates    The first that can be fetched is used; later ones are fallbacks.
 */

/** @type {Record<string, SurfaceSpec>} */
const SURFACES = {
  // ── Ground ────────────────────────────────────────────────────────────────────────────────
  asphalt: {
    tint: 'natural',
    what: 'worn chip-seal road',
    candidates: [
      // Coarse grey chip standing proud of the binder: the closest match to New Zealand chip seal.
      { library: 'ambientcg', id: 'Asphalt015', tile: [2, 2], flatten: 0.6, roughness: 0.88 },
      { library: 'polyhaven', id: 'asphalt_04', tile: [4, 4], flatten: 0.6, roughness: 0.88 },
    ],
  },
  concrete: {
    tint: 'neutral',
    what: 'cast concrete (kerbs, walls, slabs); tinted by the game',
    candidates: [
      { library: 'polyhaven', id: 'concrete_floor_worn_001', tile: [3, 3], flatten: 0.5, roughness: 0.85 },
      { library: 'ambientcg', id: 'Concrete046', tile: [2.4, 2.4], flatten: 0.5, roughness: 0.85 },
    ],
  },
  footpath: {
    tint: 'natural',
    what: 'concrete paving slabs with joints',
    candidates: [
      // 4 x 4 square slabs per repeat: 600 mm pavers, the standard footpath slab.
      { library: 'ambientcg', id: 'PavingStones136', tile: [2.4, 2.4], saturation: 0.45, roughness: 0.86 },
      // 3 x 3 slabs per repeat, 0.9 m each.
      { library: 'polyhaven', id: 'large_floor_tiles_02', tile: [2.7, 2.7], roughness: 0.86 },
    ],
  },
  gravel: {
    tint: 'natural',
    what: 'unsealed road gravel',
    candidates: [{ library: 'polyhaven', id: 'gravel_floor_02', tile: [2, 2], flatten: 0.6, roughness: 0.94 }],
  },
  shingle: {
    tint: 'natural',
    what: 'river stones (braided-river shingle)',
    candidates: [{ library: 'polyhaven', id: 'ganges_river_pebbles', tile: [2.16, 2.16], flatten: 0.3 }],
  },
  grass: {
    tint: 'neutral',
    what: 'short lawn / pasture; the terrain vertex colours supply the green',
    candidates: [
      // Source is 1.4 m of fine lawn; 2 m gives the coarser blade of pasture ryegrass.
      { library: 'ambientcg', id: 'Grass004', tile: [2, 2], flatten: 0.8, roughness: 0.9 },
      { library: 'ambientcg', id: 'Grass001', tile: [2, 2], flatten: 0.8, roughness: 0.9 },
    ],
  },
  sand: {
    tint: 'neutral',
    what: 'beach sand; tinted by the game',
    candidates: [{ library: 'polyhaven', id: 'sand_03', tile: [2, 2], flatten: 0.7 }],
  },

  // ── Walls ─────────────────────────────────────────────────────────────────────────────────
  weatherboard: {
    tint: 'neutral',
    what: 'painted horizontal timber cladding; tinted by the game',
    // Painted rusticated (coved shiplap) boards, 9 per repeat: 150 mm cover (the source states 1 m, i.e.
    // 110 mm boards). ambientCG WoodSiding009 is the obvious alternative, but every board ends on the tile
    // edge, which reads as a seam every repeat.
    // The source is dead matt (0.93); weathered house paint keeps a little sheen.
    candidates: [{ library: 'polyhaven', id: 'brown_planks_05', tile: [1.35, 1.35], flatten: 0.8, roughness: 0.78 }],
  },
  brick: {
    tint: 'natural',
    what: 'red brick wall',
    // 6 stretchers x 20 courses per repeat, set to the New Zealand module (230 x 76 mm brick, 10 mm joints).
    candidates: [{ library: 'polyhaven', id: 'red_brick', tile: [1.44, 1.72], flatten: 0.5 }],
  },
  bluestone: {
    tint: 'natural',
    what: 'dark basalt block wall',
    // 9 courses per repeat. The source is 2 m of small setts; 2.4 m gives squared-rubble blocks about 270 mm
    // high. Its brown cast is halved and it is lifted from near-black to the charcoal of weathered basalt.
    candidates: [{ library: 'polyhaven', id: 'rock_wall_16', tile: [2.4, 2.4], saturation: 0.5, gain: 1.5 }],
  },
  limestone: {
    tint: 'natural',
    what: 'cream limestone ashlar (Oamaru stone)',
    // 5 courses per repeat. The source is 3 m of large tan sandstone ashlar; 2.2 m gives 440 mm courses, and
    // it is paled towards the cream of Oamaru stone.
    candidates: [{ library: 'polyhaven', id: 'sandstone_blocks_08', tile: [2.2, 2.2], saturation: 0.6, gain: 1.2, roughness: 0.8 }],
  },
  plaster: {
    tint: 'neutral',
    what: 'painted stucco / render; tinted by the game',
    candidates: [
      { library: 'polyhaven', id: 'white_stucco', tile: [2, 2], flatten: 0.5 },
      { library: 'ambientcg', id: 'PaintedPlaster017', tile: [2, 2], flatten: 0.5 },
    ],
  },

  // ── Roofs, timber, vegetation ─────────────────────────────────────────────────────────────
  corrugated: {
    tint: 'neutral',
    what: 'corrugated iron sheet; tinted by the game',
    candidates: [
      // 15 corrugations per repeat at the standard 76 mm pitch (the source states 1.12 m). Ridges run along v.
      { library: 'polyhaven', id: 'corrugated_iron', tile: [1.14, 1.14], flatten: 0.8 },
      { library: 'ambientcg', id: 'CorrugatedSteel005', tile: [1.2, 1.2], flatten: 0.8 },
    ],
  },
  rooftile: {
    tint: 'neutral',
    what: 'clay roof tiles (Marseille pattern); tinted by the game',
    candidates: [
      // 8 x 8 tiles per repeat.
      { library: 'polyhaven', id: 'clay_roof_tiles_03', tile: [2.6, 2.6], flatten: 0.4 },
      { library: 'ambientcg', id: 'RoofingTiles014A', tile: [2.9, 2.9], flatten: 0.4 },
    ],
  },
  slate: {
    tint: 'neutral',
    what: 'slate roof; tinted by the game',
    candidates: [
      // 11 courses per repeat. The source is 1.5 m of small slates; 1.8 m gives the 165 mm gauge and 265 mm
      // width of the larger Welsh slates on Canterbury's stone buildings.
      { library: 'polyhaven', id: 'grey_roof_tiles_02', tile: [1.8, 1.8], flatten: 0.7 },
      { library: 'ambientcg', id: 'RoofingTiles003', tile: [1.8, 1.8], flatten: 0.7 },
    ],
  },
  timber: {
    tint: 'neutral',
    what: 'weathered wood planks; tinted by the game',
    // 9 planks per repeat, running along v: 150 mm boards (the source states 1 m, i.e. 110 mm boards).
    candidates: [{ library: 'polyhaven', id: 'brown_planks_03', tile: [1.35, 1.35], flatten: 0.5, roughness: 0.8 }],
  },
  foliage: {
    tint: 'neutral',
    what: 'dense leaves (hedges, canopies); the prop colours supply the green',
    candidates: [
      // A dense carpet of 50 mm leaves. Yellow in the photograph, so a little less of its colour is kept.
      { library: 'ambientcg', id: 'ScatteredLeaves008', tile: [2.3, 2.3], flatten: 0.6, keepSaturation: 0.1, roughness: 0.85 },
      { library: 'polyhaven', id: 'forest_leaves_03', tile: [2.3, 2.3], flatten: 0.6, roughness: 0.85 },
    ],
  },
  bark: {
    tint: 'natural',
    what: 'tree bark',
    candidates: [{ library: 'polyhaven', id: 'bark_willow_02', tile: [2.15, 2.15], roughness: 0.9 }],
  },
};

const LIBRARIES = {
  polyhaven: { name: 'Poly Haven', page: (/** @type {string} */ id) => `https://polyhaven.com/a/${id}` },
  ambientcg: { name: 'ambientCG', page: (/** @type {string} */ id) => `https://ambientcg.com/a/${id}` },
};

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean) ?? null;

// ───────────────────────────────────── Downloading ─────────────────────────────────────

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cached = (/** @type {string} */ file) => !FORCE && existsSync(file) && statSync(file).size > 0;

/**
 * Downloads `url` to `dest` unless it is already cached. Writes via a .part file so an interrupted
 * run never leaves a truncated file that looks cached.
 * @param {string} url
 * @param {string} dest
 * @param {string} [md5]
 */
async function download(url, dest, md5) {
  if (cached(dest)) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  let lastError = new Error('not attempted');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0) throw new Error('empty response');
      if (md5 && createHash('md5').update(body).digest('hex') !== md5) throw new Error('checksum mismatch');
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
 * An API response, cached beside the asset so later runs work offline.
 * @param {string} url
 * @param {string} cacheFile
 */
async function getJson(url, cacheFile) {
  await download(url, cacheFile);
  return JSON.parse(readFileSync(cacheFile, 'utf8'));
}

/**
 * @typedef {object} RawSet
 * @property {string} albedo
 * @property {string} normal
 * @property {boolean} normalIsDirectX   True when only a DirectX (-Y) normal map exists: green is flipped.
 * @property {string} roughness          Greyscale roughness, or an AO/roughness/metal pack (roughness in green).
 * @property {string} name
 * @property {string} author
 * @property {string} resolution
 */

/**
 * Poly Haven: https://api.polyhaven.com/files/<id> lists a URL per map / resolution / format.
 * @param {string} id
 * @returns {Promise<RawSet>}
 */
async function fetchPolyHaven(id) {
  const dir = path.join(STAGING, 'polyhaven', id);
  const info = await getJson(`https://api.polyhaven.com/info/${id}`, path.join(dir, 'info.json'));
  const files = await getJson(`https://api.polyhaven.com/files/${id}`, path.join(dir, 'files.json'));
  /** @param {string[]} maps */
  const pick = (maps) => {
    for (const resolution of ['1k', '2k']) {
      for (const map of maps) {
        const formats = files[map]?.[resolution];
        const file = formats?.jpg ?? formats?.png;
        if (file?.url) return { url: /** @type {string} */ (file.url), md5: /** @type {string | undefined} */ (file.md5), resolution };
      }
    }
    return null;
  };
  const albedo = pick(['Diffuse', 'diffuse', 'Color', 'col']);
  const normalGl = pick(['nor_gl']);
  const normal = normalGl ?? pick(['nor_dx']);
  const roughness = pick(['Rough', 'rough']) ?? pick(['arm']);
  if (!albedo || !normal || !roughness) throw new Error(`Poly Haven asset "${id}" lacks an albedo, normal or roughness map`);
  /** @param {{ url: string, md5?: string }} file */
  const get = async (file) => {
    const dest = path.join(dir, path.basename(new URL(file.url).pathname));
    await download(file.url, dest, file.md5);
    return dest;
  };
  return {
    albedo: await get(albedo),
    normal: await get(normal),
    normalIsDirectX: !normalGl,
    roughness: await get(roughness),
    name: info.name ?? id,
    author: Object.keys(info.authors ?? {}).join(', '),
    resolution: albedo.resolution,
  };
}

/**
 * ambientCG: the API lists zip downloads per resolution; the zip holds one JPEG per map.
 * @param {string} id
 * @returns {Promise<RawSet>}
 */
async function fetchAmbientCg(id) {
  const dir = path.join(STAGING, 'ambientcg', id);
  const query = new URLSearchParams({ type: 'Material', id, include: 'downloadData,dimensionData,displayData' });
  const cacheFile = path.join(dir, 'asset.json');
  const json = await getJson(`https://ambientcg.com/api/v2/full_json?${query}`, cacheFile);
  const asset = (json.foundAssets ?? []).find((/** @type {{ assetId: string }} */ a) => a.assetId === id);
  if (!asset) {
    // An empty answer is not worth caching: the next run should ask again.
    rmSync(cacheFile, { force: true });
    throw new Error(`ambientCG has no material "${id}"`);
  }
  /** @type {{ attribute: string, downloadLink: string, fileName: string }[]} */
  const downloads = asset.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads ?? [];
  const zipInfo = downloads.find((d) => d.attribute === '1K-JPG') ?? downloads.find((d) => d.attribute === '2K-JPG');
  if (!zipInfo) throw new Error(`ambientCG material "${id}" has no 1K or 2K JPEG download`);
  const zip = path.join(dir, path.basename(zipInfo.fileName));
  await download(zipInfo.downloadLink, zip);

  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const entry = (/** @type {string} */ map) => entries.find((name) => !name.includes('/') && name.endsWith(`_${map}.jpg`));
  const albedo = entry('Color');
  const normalGl = entry('NormalGL');
  const normal = normalGl ?? entry('NormalDX');
  const roughness = entry('Roughness');
  if (!albedo || !normal || !roughness) throw new Error(`ambientCG material "${id}" lacks an albedo, normal or roughness map`);
  // The archive is untrusted: only the three named JPEGs are extracted, without paths, into their own folder.
  const unzipped = path.join(dir, 'unzipped');
  const wanted = [albedo, normal, roughness];
  if (wanted.some((name) => !cached(path.join(unzipped, name)))) {
    mkdirSync(unzipped, { recursive: true });
    execFileSync('unzip', ['-o', '-q', '-j', zip, ...wanted, '-d', unzipped]);
  }
  return {
    albedo: path.join(unzipped, albedo),
    normal: path.join(unzipped, normal),
    normalIsDirectX: !normalGl,
    roughness: path.join(unzipped, roughness),
    name: asset.displayName ?? id,
    // ambientCG publishes its materials under its own name; no author is listed per asset.
    author: 'ambientCG',
    resolution: zipInfo.attribute.split('-')[0].toLowerCase(),
  };
}

// ───────────────────────────────────── Image processing ─────────────────────────────────────

/** Rec. 709 luma of sRGB-encoded components (0..1). */
const luma = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Reads an image as size x size RGB floats (0..1, sRGB-encoded). `data` maps (normals, roughness)
 * skip colour management.
 * @param {string} file
 * @param {number} size
 * @param {boolean} data
 */
async function readRgb(file, size, data) {
  const { data: bytes, info } = await sharp(file, { ignoreIcc: data })
    .removeAlpha()
    .toColourspace('srgb')
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`${file}: expected 3 channels, got ${info.channels}`);
  const px = new Float32Array(size * size * 3);
  for (let i = 0; i < px.length; i++) px[i] = bytes[i] / 255;
  return px;
}

/**
 * @param {Float32Array} px  RGB or single-channel floats 0..1
 * @param {number} size
 * @param {1 | 3} channels
 * @param {string} file
 * @param {import('sharp').JpegOptions} jpeg
 */
async function writeJpeg(px, size, channels, file, jpeg) {
  const bytes = Buffer.alloc(px.length);
  for (let i = 0; i < px.length; i++) bytes[i] = Math.min(255, Math.max(0, Math.round(px[i] * 255)));
  const image = sharp(bytes, { raw: { width: size, height: size, channels } });
  // Without this sharp writes a one-channel image as three-channel sRGB.
  if (channels === 1) image.toColourspace('b-w');
  await image.jpeg({ mozjpeg: true, ...jpeg }).toFile(file);
}

/**
 * Divides out a wrap-around low-pass of the luminance, so patches a good fraction of the tile wide
 * all sit at the same brightness. Those patches are what gives the repeat away across a road or a
 * paddock; detail finer than about a sixth of the tile is untouched, and the result still tiles.
 * @param {Float32Array} px
 * @param {number} size
 * @param {number} strength 0..1
 */
function flattenLowFrequencies(px, size, strength) {
  const grid = 64;
  const cell = size / grid;
  let low = new Float64Array(grid * grid);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      low[Math.floor(y / cell) * grid + Math.floor(x / cell)] += luma(px[i], px[i + 1], px[i + 2]) / (cell * cell);
    }
  }
  // Three wrapped box blurs along each axis approximate a Gaussian with a sigma of about 4.5 cells (7 % of the tile).
  const radius = 4;
  for (let pass = 0; pass < 3; pass++) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const next = new Float64Array(grid * grid);
      for (let y = 0; y < grid; y++) {
        for (let x = 0; x < grid; x++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) sum += low[((y + k * dy + grid) % grid) * grid + ((x + k * dx + grid) % grid)];
          next[y * grid + x] = sum / (radius * 2 + 1);
        }
      }
      low = next;
    }
  }
  const mean = low.reduce((a, b) => a + b, 0) / low.length;
  for (let y = 0; y < size; y++) {
    const gy = (y + 0.5) / cell - 0.5;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) / cell - 0.5;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const at = (/** @type {number} */ cx, /** @type {number} */ cy) => low[((cy + grid) % grid) * grid + ((cx + grid) % grid)];
      const local = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const factor = Math.pow(mean / Math.max(local, 1e-4), strength);
      const i = (y * size + x) * 3;
      px[i] *= factor;
      px[i + 1] *= factor;
      px[i + 2] *= factor;
    }
  }
}

/**
 * Turns a photographed albedo into a pale, almost grey one that the game can tint: most of the
 * saturation is removed, then the luminance is moved to `NEUTRAL_MEAN` around its own mean, which
 * keeps the local contrast (joints, grain, blades) instead of bleaching it out.
 * @param {Float32Array} px
 * @param {{ keepSaturation?: number }} options
 */
function neutralise(px, options) {
  const keep = options.keepSaturation ?? NEUTRAL_SATURATION;
  const count = px.length / 3;
  const lum = new Float32Array(count);
  let mean = 0;
  for (let p = 0; p < count; p++) {
    const i = p * 3;
    const l = luma(px[i], px[i + 1], px[i + 2]);
    lum[p] = l;
    mean += l / count;
    for (let c = 0; c < 3; c++) px[i + c] = l + (px[i + c] - l) * keep;
  }
  const sorted = Float32Array.from(lum).sort();
  const p01 = sorted[Math.floor(count * 0.01)];
  const p99 = sorted[Math.floor(count * 0.99)];
  // Dark sources get some contrast back (lifting them by addition alone would flatten them), but never
  // so much that the brightest or darkest 1 % clips.
  let slope = Math.min(1.5, Math.max(1, NEUTRAL_MEAN / mean));
  if (p99 > mean) slope = Math.min(slope, (0.985 - NEUTRAL_MEAN) / (p99 - mean));
  if (p01 < mean) slope = Math.min(slope, (NEUTRAL_MEAN - 0.03) / (mean - p01));
  let offset = NEUTRAL_MEAN;
  // Clamping moves the mean a little; a few corrections bring it back to the target.
  for (let pass = 0; pass < 3; pass++) {
    let clamped = 0;
    for (let p = 0; p < count; p++) clamped += Math.min(1, Math.max(0, offset + (lum[p] - mean) * slope)) / count;
    offset += NEUTRAL_MEAN - clamped;
  }
  for (let i = 0; i < px.length; i++) px[i] = offset + (px[i] - mean) * slope;
}

/**
 * @param {Float32Array} px
 * @param {number} saturation
 * @param {number} gain
 */
function adjustNatural(px, saturation, gain) {
  for (let i = 0; i < px.length; i += 3) {
    const l = luma(px[i], px[i + 1], px[i + 2]);
    for (let c = 0; c < 3; c++) px[i + c] = (l + (px[i + c] - l) * saturation) * gain;
  }
}

/** Mean luminance and mean HSV saturation of an sRGB albedo (the numbers check-textures.mjs asserts on). */
function albedoStats(/** @type {Float32Array} */ px) {
  let luminance = 0;
  let saturation = 0;
  const count = px.length / 3;
  for (let i = 0; i < px.length; i += 3) {
    const r = Math.min(1, Math.max(0, px[i]));
    const g = Math.min(1, Math.max(0, px[i + 1]));
    const b = Math.min(1, Math.max(0, px[i + 2]));
    const max = Math.max(r, g, b);
    luminance += luma(r, g, b) / count;
    saturation += (max > 0 ? (max - Math.min(r, g, b)) / max : 0) / count;
  }
  return { luminance, saturation };
}

/**
 * @param {RawSet} raw
 * @param {string} kind
 * @param {SurfaceSpec} spec
 * @param {Candidate} candidate
 */
async function processSurface(raw, kind, spec, candidate) {
  mkdirSync(OUT, { recursive: true });
  const files = { map: `${kind}_col.jpg`, normalMap: `${kind}_nor.jpg`, roughnessMap: `${kind}_rgh.jpg` };

  // Albedo.
  const albedo = await readRgb(raw.albedo, ALBEDO_SIZE, false);
  if (candidate.flatten) flattenLowFrequencies(albedo, ALBEDO_SIZE, candidate.flatten);
  if (spec.tint === 'neutral') neutralise(albedo, candidate);
  else if (candidate.saturation !== undefined || candidate.gain !== undefined) adjustNatural(albedo, candidate.saturation ?? 1, candidate.gain ?? 1);
  await writeJpeg(albedo, ALBEDO_SIZE, 3, path.join(OUT, files.map), { quality: ALBEDO_QUALITY, chromaSubsampling: '4:2:0' });

  // Normals: OpenGL convention (+Y up), unit length again after resampling. Chroma is not subsampled:
  // red and green are independent axes, not colour.
  const normal = await readRgb(raw.normal, NORMAL_SIZE, true);
  for (let i = 0; i < normal.length; i += 3) {
    const x = normal[i] * 2 - 1;
    const y = (normal[i + 1] * 2 - 1) * (raw.normalIsDirectX ? -1 : 1);
    const z = Math.max(normal[i + 2] * 2 - 1, 0.05);
    const inv = 1 / Math.hypot(x, y, z);
    normal[i] = x * inv * 0.5 + 0.5;
    normal[i + 1] = y * inv * 0.5 + 0.5;
    normal[i + 2] = z * inv * 0.5 + 0.5;
  }
  await writeJpeg(normal, NORMAL_SIZE, 3, path.join(OUT, files.normalMap), { quality: NORMAL_QUALITY, chromaSubsampling: '4:4:4' });

  // Roughness: one channel. Green is used because three.js reads roughness from green, and it is also
  // where an AO / roughness / metal pack keeps it.
  const rough = await readRgb(raw.roughness, ROUGHNESS_SIZE, true);
  const grey = new Float32Array(ROUGHNESS_SIZE * ROUGHNESS_SIZE);
  let sourceRoughness = 0;
  for (let p = 0; p < grey.length; p++) {
    grey[p] = rough[p * 3 + 1];
    sourceRoughness += grey[p] / grey.length;
  }
  const shift = candidate.roughness === undefined ? 0 : candidate.roughness - sourceRoughness;
  let roughness = 0;
  for (let p = 0; p < grey.length; p++) {
    grey[p] = Math.min(1, Math.max(0.04, grey[p] + shift));
    roughness += grey[p] / grey.length;
  }
  await writeJpeg(grey, ROUGHNESS_SIZE, 1, path.join(OUT, files.roughnessMap), { quality: ROUGHNESS_QUALITY });

  const sizes = Object.values(files).map((file) => statSync(path.join(OUT, file)).size);
  return { files, sizes, stats: { ...albedoStats(albedo), roughness, sourceRoughness } };
}

// ───────────────────────────────────── Main ─────────────────────────────────────

const manifestPath = path.join(OUT, 'manifest.json');
/** @type {{ version: number, surfaces: Record<string, object> }} */
const manifest = { version: 1, surfaces: {} };
if (ONLY && existsSync(manifestPath)) Object.assign(manifest.surfaces, JSON.parse(readFileSync(manifestPath, 'utf8')).surfaces ?? {});

const unknown = (ONLY ?? []).filter((kind) => !SURFACES[kind]);
if (unknown.length) {
  console.error(`Unknown surface(s): ${unknown.join(', ')}. Known: ${Object.keys(SURFACES).join(', ')}`);
  process.exit(1);
}

/** @type {string[]} */
const missing = [];
let total = 0;
for (const [kind, spec] of Object.entries(SURFACES)) {
  if (ONLY && !ONLY.includes(kind)) continue;
  console.log(`${kind}: ${spec.what}`);
  let done = false;
  for (const candidate of spec.candidates) {
    const library = LIBRARIES[candidate.library];
    try {
      const raw = candidate.library === 'polyhaven' ? await fetchPolyHaven(candidate.id) : await fetchAmbientCg(candidate.id);
      const { files, sizes, stats } = await processSurface(raw, kind, spec, candidate);
      manifest.surfaces[kind] = {
        ...files,
        tile: candidate.tile,
        tint: spec.tint,
        asset: `${raw.name} (${candidate.id})`,
        library: library.name,
        source: library.page(candidate.id),
        author: raw.author,
        licence: 'CC0-1.0',
      };
      const size = sizes.reduce((a, b) => a + b, 0);
      total += size;
      console.log(
        `    ${library.name} ${candidate.id} (${raw.resolution}${raw.normalIsDirectX ? ', DirectX normals flipped' : ''}) -> ${spec.tint}, ` +
          `tile ${candidate.tile.join(' x ')} m, luminance ${stats.luminance.toFixed(3)}, saturation ${stats.saturation.toFixed(3)}, ` +
          `roughness ${stats.roughness.toFixed(2)}${candidate.roughness === undefined ? '' : ` (source ${stats.sourceRoughness.toFixed(2)})`}, ` +
          `${sizes.map((s) => `${(s / 1024).toFixed(0)}`).join(' + ')} = ${(size / 1024).toFixed(0)} kB`,
      );
      done = true;
      break;
    } catch (err) {
      console.warn(`    ${library.name} ${candidate.id} failed: ${/** @type {Error} */ (err).message}`);
    }
  }
  if (!done) {
    missing.push(kind);
    delete manifest.surfaces[kind];
  }
}

// Keep the manifest in the order of SURFACES whatever was (re)processed.
manifest.surfaces = Object.fromEntries(Object.keys(SURFACES).flatMap((kind) => (manifest.surfaces[kind] ? [[kind, manifest.surfaces[kind]]] : [])));
mkdirSync(OUT, { recursive: true });
// Pretty-printed, with each [u, v] tile kept on one line.
const json = JSON.stringify(manifest, null, 2).replace(/\[\s+([\d.]+),\s+([\d.]+)\s+\]/g, '[$1, $2]');
writeFileSync(manifestPath, `${json}\n`);

console.log(`\nWrote ${Object.keys(manifest.surfaces).length} surface(s) to ${path.relative(ROOT, manifestPath)}; processed ${(total / 1048576).toFixed(2)} MB this run.`);
if (missing.length) console.warn(`Not sourced (the game keeps its procedural texture): ${missing.join(', ')}`);
