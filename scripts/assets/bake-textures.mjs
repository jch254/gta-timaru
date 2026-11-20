// Offline derivatives of the checked-in CC0 sources. Run from any directory.
import sharp from 'sharp';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const assets = fileURLToPath(new URL('../../src/assets/', import.meta.url));
const json = async file => JSON.parse(await readFile(path.join(assets, file), 'utf8'));
const manifest = await json('textures/manifest.json');
const files = Object.values(manifest.surfaces).flatMap(s => [s.map, s.normalMap, s.roughnessMap]).filter(Boolean);
files.push(...(await readdir(path.join(assets, 'textures/ground'))).filter(f => f.endsWith('.jpg')).map(f => 'ground/' + f));
for (const file of new Set(files)) {
  const dest = path.join(assets, 'phone-textures', file);
  await mkdir(path.dirname(dest), { recursive: true });
  const size = file.endsWith('_rgh.jpg') ? 256 : 512;
  await sharp(path.join(assets, 'textures', file)).resize(size, size, { withoutEnlargement: true })
    .jpeg({ quality: 85, chromaSubsampling: '4:4:4' }).toFile(dest);
}

const main = await json('foliage/atlas.json');
const strip = await json('foliage/extra.json');
const cells = [...Object.values(main.cells), ...Object.values(strip.cells).map(c => ({ ...c, y: c.y + main.size }))];
const rgba = file => sharp(path.join(assets, 'foliage', file)).ensureAlpha().raw().toBuffer();
const base = Buffer.concat([await rgba(main.file), await rgba(strip.file)]);
const levels = buildMips(base, main.size, main.size + strip.height, cells);
const dest = path.join(assets, 'foliage/mips');
await mkdir(dest, { recursive: true });
for (const [i, { data, width, height }] of levels.entries()) {
  // WebP may throw away RGB at zero alpha. Keep the dilated colour below the cutout threshold.
  for (let a = 3; a < data.length; a += 4) if (!data[a]) data[a] = 1;
  await sharp(data, { raw: { width, height, channels: 4 } }).webp({ quality: 88, alphaQuality: 100 })
    .toFile(path.join(dest, `leaf-${i}.webp`));
}

/**
 * The full mip chain, made by hand for two reasons the GPU's own box filter gets wrong for cut-out leaves:
 *  - colour is averaged weighted by alpha and then spread into the transparent texels, so edges and small
 *    mips never pick up the (black) colour of empty space as a dark fringe;
 *  - each cell's alpha is scaled per level so the share of texels that pass the alpha test stays what it
 *    is at full size. Without this, distant trees thin out to bare twigs as their leaves average away.
 */
function buildMips(base, width, height, cells) {
  const levels = [{ data: base, width, height }];
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
  const cut = 128;
  const histogram = new Uint32Array(256);
  for (const cell of cells) {
    let passed = 0;
    for (let y = cell.y; y < cell.y + cell.h; y++) for (let x = cell.x; x < cell.x + cell.w; x++) if (base[(y * width + x) * 4 + 3] >= cut) passed++;
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
      const scale = cut / Math.max(1, threshold);
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
