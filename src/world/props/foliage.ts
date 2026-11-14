import * as THREE from 'three';

/**
 * The foliage atlas: one 2048 px RGBA texture of photographic boughs, fronds and fans (CC0 sources, see
 * ASSETS.md "Vegetation"; built by scripts/assets/fetch-foliage.mjs). Every plant's leaf cards map onto
 * one of its cells, so all foliage in the game shares a single alpha-tested material.
 *
 * The texture object exists from the start (one transparent texel, so cards are simply invisible until
 * the picture arrives) and is filled in by `loadFoliage`, which the texture preload awaits before the
 * world is built.
 */

/** Where a cell's picture attaches to its branch: the bottom middle, top middle, left middle or centre. */
export type CellAnchor = 'bottom' | 'top' | 'left' | 'centre';

export interface FoliageCell {
  /** UV rectangle. v0 is the TOP of the picture (the texture is not flipped). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Width / height of the picture. */
  aspect: number;
  anchor: CellAnchor;
  /** Mean colour of the picture's leaves, linear RGB. */
  mean: [number, number, number];
}

interface AtlasInfo {
  size: number;
  file: string;
  cells: Record<string, { x: number; y: number; w: number; h: number; anchor: CellAnchor; mean?: [number, number, number] }>;
}

const infos = import.meta.glob('../../assets/foliage/atlas.json', { eager: true, import: 'default' }) as Record<string, AtlasInfo>;
const urls = import.meta.glob('../../assets/foliage/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const info: AtlasInfo | undefined = Object.values(infos)[0];

/** The alpha threshold foliage materials test against; mip levels are built to keep their coverage at it. */
export const FOLIAGE_ALPHA_TEST = 0.5;

export const foliageTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
foliageTexture.colorSpace = THREE.SRGBColorSpace;
foliageTexture.magFilter = THREE.LinearFilter;
foliageTexture.minFilter = THREE.LinearMipmapLinearFilter;
foliageTexture.generateMipmaps = false;
foliageTexture.needsUpdate = true;

const fallback: FoliageCell = { u0: 0, v0: 0, u1: 1, v1: 1, aspect: 1, anchor: 'bottom', mean: [0.1, 0.16, 0.04] };
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** UV rectangle of a named cell (the whole texture if the atlas or the cell is missing). */
export function foliageCell(name: string): FoliageCell {
  const c = info?.cells[name];
  if (!info || !c) return fallback;
  const s = info.size;
  const mean = c.mean ? (c.mean.map(toLinear) as [number, number, number]) : fallback.mean;
  return { u0: c.x / s, v0: c.y / s, u1: (c.x + c.w) / s, v1: (c.y + c.h) / s, aspect: c.w / c.h, anchor: c.anchor, mean };
}

let loading: Promise<void> | null = null;

/** Loads the atlas into `foliageTexture` (once). Resolves when it is ready to draw; never rejects. */
export function loadFoliage(anisotropy = 8): Promise<void> {
  if (loading) return loading;
  const url = info ? urls[`../../assets/foliage/${info.file}`] : undefined;
  if (!info || !url || typeof createImageBitmap === 'undefined') return (loading = Promise.resolve());
  loading = (async () => {
    try {
      const blob = await (await fetch(url)).blob();
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const g = canvas.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bitmap, 0, 0);
      bitmap.close();
      const base = g.getImageData(0, 0, canvas.width, canvas.height);
      const mips = buildMips(new Uint8Array(base.data.buffer), base.width, base.height, info);
      // A texture cannot change size once it is on the GPU, so let go of the placeholder first.
      foliageTexture.dispose();
      foliageTexture.image = mips[0] as unknown as typeof foliageTexture.image;
      foliageTexture.mipmaps = mips as unknown as typeof foliageTexture.mipmaps;
      foliageTexture.anisotropy = anisotropy;
      foliageTexture.needsUpdate = true;
    } catch (err) {
      console.warn('The foliage atlas failed to load; plants will show bare branches.', err);
    }
  })();
  return loading;
}

interface Level {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * The full mip chain, made by hand for two reasons the GPU's own box filter gets wrong for cut-out leaves:
 *  - colour is averaged weighted by alpha and then spread into the transparent texels, so edges and small
 *    mips never pick up the (black) colour of empty space as a dark fringe;
 *  - each cell's alpha is scaled per level so the share of texels that pass the alpha test stays what it
 *    is at full size. Without this, distant trees thin out to bare twigs as their leaves average away.
 */
function buildMips(base: Uint8Array, width: number, height: number, atlas: AtlasInfo): Level[] {
  const levels: Level[] = [{ data: base, width, height }];
  // Premultiplied sums are kept at full precision alongside each level so the averages stay alpha-weighted.
  let prev = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = base[i * 4 + 3];
    prev[i * 4] = base[i * 4] * a;
    prev[i * 4 + 1] = base[i * 4 + 1] * a;
    prev[i * 4 + 2] = base[i * 4 + 2] * a;
    prev[i * 4 + 3] = a;
  }
  let w = width;
  let h = height;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const next = new Float32Array(nw * nh * 4);
    const data = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(h - 1, y * 2);
      const y1 = Math.min(h - 1, y * 2 + 1);
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(w - 1, x * 2);
        const x1 = Math.min(w - 1, x * 2 + 1);
        const o = (y * nw + x) * 4;
        for (let c = 0; c < 4; c++) next[o + c] = (prev[(y0 * w + x0) * 4 + c] + prev[(y0 * w + x1) * 4 + c] + prev[(y1 * w + x0) * 4 + c] + prev[(y1 * w + x1) * 4 + c]) / 4;
        const a = next[o + 3];
        if (a > 0.01) {
          data[o] = next[o] / a;
          data[o + 1] = next[o + 1] / a;
          data[o + 2] = next[o + 2] / a;
        }
        data[o + 3] = a;
      }
    }
    levels.push({ data, width: nw, height: nh });
    prev = next;
    w = nw;
    h = nh;
  }

  // Spread colour into transparent texels, coarse to fine: an empty texel takes its parent's colour.
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    for (let y = 0; y < fine.height; y++) {
      const py = Math.min(coarse.height - 1, y >> 1);
      for (let x = 0; x < fine.width; x++) {
        const o = (y * fine.width + x) * 4;
        if (fine.data[o + 3] > 2) continue;
        const p = (py * coarse.width + Math.min(coarse.width - 1, x >> 1)) * 4;
        fine.data[o] = coarse.data[p];
        fine.data[o + 1] = coarse.data[p + 1];
        fine.data[o + 2] = coarse.data[p + 2];
      }
    }
  }

  // Keep each cell's alpha-test coverage through the chain.
  const cut = Math.round(FOLIAGE_ALPHA_TEST * 255);
  const histogram = new Uint32Array(256);
  for (const cell of Object.values(atlas.cells)) {
    let passed = 0;
    for (let y = cell.y; y < cell.y + cell.h; y++) for (let x = cell.x; x < cell.x + cell.w; x++) if (base[(y * width + x) * 4 + 3] > cut) passed++;
    const coverage = passed / (cell.w * cell.h);
    if (coverage <= 0) continue;
    for (let l = 1; l < levels.length; l++) {
      const level = levels[l];
      const x0 = cell.x >> l;
      const y0 = cell.y >> l;
      const x1 = Math.min(level.width, Math.max(x0 + 1, (cell.x + cell.w) >> l));
      const y1 = Math.min(level.height, Math.max(y0 + 1, (cell.y + cell.h) >> l));
      const count = (x1 - x0) * (y1 - y0);
      if (count < 4) break;
      histogram.fill(0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) histogram[level.data[(y * level.width + x) * 4 + 3]]++;
      // The alpha value that `coverage` of this cell's texels lie above.
      let above = 0;
      let threshold = 255;
      while (threshold > 1 && above + histogram[threshold] <= coverage * count) above += histogram[threshold--];
      const scale = Math.min(6, Math.max(1, (cut + 1) / Math.max(1, threshold)));
      if (scale === 1) continue;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * level.width + x) * 4 + 3;
          level.data[o] = Math.min(255, level.data[o] * scale);
        }
      }
    }
  }
  return levels;
}
