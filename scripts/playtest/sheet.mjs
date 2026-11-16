#!/usr/bin/env node
// Contact sheet: many screenshots tiled into one image, for looking over a run of frames at a glance.
//   node scripts/playtest/sheet.mjs --out sheet.jpg --cols 5 --w 320 a.jpg b.jpg …
//   --crop x,y,w,h   cut this rectangle (fractions of the frame, 0..1) out of each image first
import sharp from 'sharp';

const argv = process.argv.slice(2);
let out = 'shots/sheet.jpg';
let cols = 5;
let w = 320;
let crop = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') out = argv[++i];
  else if (argv[i] === '--cols') cols = Number(argv[++i]);
  else if (argv[i] === '--w') w = Number(argv[++i]);
  else if (argv[i] === '--crop') crop = argv[++i].split(',').map(Number);
  else files.push(argv[i]);
}
if (!files.length) throw new Error('no images');
const tiles = [];
let h = 0;
for (const f of files) {
  let img = sharp(f);
  if (crop) {
    const meta = await img.metadata();
    img = img.extract({
      left: Math.round(crop[0] * meta.width),
      top: Math.round(crop[1] * meta.height),
      width: Math.round(crop[2] * meta.width),
      height: Math.round(crop[3] * meta.height),
    });
  }
  const { data, info } = await img.resize({ width: w }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  h = Math.max(h, info.height);
  tiles.push(data);
}
const rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#202020' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * w, top: Math.floor(i / cols) * h })))
  .jpeg({ quality: 86 })
  .toFile(out);
console.log('wrote', out, `${tiles.length} tiles, ${cols * w}x${rows * h}`);
