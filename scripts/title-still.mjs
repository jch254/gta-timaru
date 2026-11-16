#!/usr/bin/env node
// Turns a raw screenshot of the game into the title screen's photograph: cropped to 16:9, graded like a
// colour print that has spent thirty years in a drawer, and squeezed under the size budget.
//
//   node scripts/title-still.mjs <raw.png> [--crop x,y,w,h] [--out src/assets/ui/title.jpg]
//                                            [--width 1920] [--max-kb 240]
//
// The whole retake is one command: zsh scripts/title-still.sh
import { statSync } from 'node:fs';
import sharp from 'sharp';

const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) args._.push(a);
  else args[a.slice(2)] = process.argv[++i];
}
const input = args._[0];
if (!input) throw new Error('usage: still.mjs <raw.png> [--crop x,y,w,h] [--out file] [--width px] [--max-kb n]');
const out = args.out || 'src/assets/ui/title.jpg';
const W = Number(args.width || 1920);
const H = Math.round((W * 9) / 16);
const maxBytes = Number(args['max-kb'] || 240) * 1024;

let base = sharp(input);
if (args.crop) {
  const [left, top, width, height] = String(args.crop).split(',').map(Number);
  base = base.extract({ left, top, width, height });
}
// Pass 1: size, and the softness of a lens and a print (which also hides stair-stepped edges).
const sized = await base.resize(W, H, { fit: 'cover' }).blur(0.6).removeAlpha().toBuffer();

// Pass 2: the fade. Less colour, blacks lifted and whites pulled in, and the slow drift towards warm
// magenta-yellow that cheap colour paper takes on.
const faded = await sharp(sized)
  .modulate({ saturation: 0.88 })
  .linear(0.88, 17)
  .recomb([
    [1.04, 0.02, 0.0],
    [0.0, 0.985, 0.015],
    [0.0, 0.05, 0.88],
  ])
  .toBuffer();

// Pass 3: darker corners and a faint warm leak from the top-left, both baked in so the page needs no filters.
const overlay = (svg) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
const vignette = overlay(
  `<defs><radialGradient id="v" cx="52%" cy="46%" r="75%"><stop offset="55%" stop-color="#fff"/><stop offset="100%" stop-color="#9a8d7c"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/>`,
);
const leak = overlay(
  `<defs><radialGradient id="l" cx="0%" cy="0%" r="60%"><stop offset="0%" stop-color="#5a3414"/><stop offset="100%" stop-color="#000"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#l)"/>`,
);
const graded = await sharp(faded)
  .composite([
    { input: vignette, blend: 'multiply' },
    { input: leak, blend: 'screen' },
  ])
  .toBuffer();

let quality = 80;
for (;;) {
  await sharp(graded).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' }).toFile(out);
  const bytes = statSync(out).size;
  if (bytes <= maxBytes || quality <= 40) {
    console.log(`wrote ${out}: ${W}×${H}, quality ${quality}, ${(bytes / 1024).toFixed(0)} KB`);
    break;
  }
  quality -= 4;
}
