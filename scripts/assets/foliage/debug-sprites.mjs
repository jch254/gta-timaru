// @ts-check
// Development aid: writes one contact sheet per source to assets-staging/foliage/debug/ showing the
// sprites cut from it (stem at the bottom), so recipes in ../fetch-foliage.mjs can pick them by index.
//   node scripts/assets/foliage/debug-sprites.mjs [name ...]
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SOURCES, STAGING, extractSprites, fetchSheet } from './sources.mjs';

const only = process.argv.slice(2);
const outDir = path.join(STAGING, 'debug');
mkdirSync(outDir, { recursive: true });
for (const [name, source] of Object.entries(SOURCES)) {
  if (only.length && !only.includes(name)) continue;
  const raw = await fetchSheet(source);
  const sprites = await extractSprites(raw, source);
  const cell = 200;
  const cols = Math.min(8, sprites.length);
  const rows = Math.ceil(sprites.length / cols);
  const W = cols * cell;
  const H = rows * cell;
  const buf = Buffer.alloc(W * H * 3, 60);
  sprites.forEach((s, i) => {
    const ox = (i % cols) * cell;
    const oy = Math.floor(i / cols) * cell;
    const k = Math.min(1, (cell - 8) / Math.max(s.w, s.h));
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const sx = Math.floor((x - cell / 2) / k + s.w / 2);
        const sy = Math.floor((y - cell / 2) / k + s.h / 2);
        const o = ((oy + y) * W + ox + x) * 3;
        const edge = x === 0 || y === 0;
        let r = edge ? 0 : 70, g = edge ? 0 : 40, b = edge ? 0 : 90;
        if (sx >= 0 && sy >= 0 && sx < s.w && sy < s.h) {
          const p = (sy * s.w + sx) * 4;
          const a = s.px[p + 3];
          r = r * (1 - a) + s.px[p] * 255 * a;
          g = g * (1 - a) + s.px[p + 1] * 255 * a;
          b = b * (1 - a) + s.px[p + 2] * 255 * a;
        }
        buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
      }
    }
  });
  const file = path.join(outDir, `${name}.jpg`);
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 85 }).toFile(file);
  console.log(`${name}: ${sprites.length} sprites (${sprites.map((s) => `${s.w}x${s.h}`).join(' ')}) -> ${file}`);
}
