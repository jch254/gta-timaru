#!/usr/bin/env node
// Scans screenshots for a large near-black area (the "dark planes" glitch hunt).
//   node scripts/playtest/darkscan.mjs shots/round3/perf/hunt/*.jpg
//   node scripts/playtest/darkscan.mjs --dir shots/round3 --min 0.25      every image under a folder
// For each image: the fraction of near-black pixels, the largest connected near-black blob as a fraction of
// the frame, and the mean luminance. Images whose blob is at least --min (default 0.2) of the frame are
// flagged. Night views are dark all over, so compare a view with its own reruns rather than trusting one number.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const argv = process.argv.slice(2);
let min = 0.2;
let level = 14;
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jpe?g|png)$/i.test(f)) files.push(p);
  }
};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--min') min = Number(argv[++i]);
  else if (argv[i] === '--level') level = Number(argv[++i]);
  else if (argv[i] === '--dir') walk(argv[++i]);
  else files.push(argv[i]);
}

const W = 160;
const H = 90;
export async function scan(file) {
  const { data } = await sharp(file).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const dark = new Uint8Array(W * H);
  let n = 0;
  let sum = 0;
  for (let i = 0; i < W * H; i++) {
    sum += data[i];
    if (data[i] < level) {
      dark[i] = 1;
      n++;
    }
  }
  // Largest 4-connected blob of near-black.
  let best = 0;
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (dark[i] !== 1) continue;
    let size = 0;
    stack.push(i);
    dark[i] = 2;
    while (stack.length) {
      const k = stack.pop();
      size++;
      const x = k % W;
      if (x > 0 && dark[k - 1] === 1) (dark[k - 1] = 2), stack.push(k - 1);
      if (x < W - 1 && dark[k + 1] === 1) (dark[k + 1] = 2), stack.push(k + 1);
      if (k >= W && dark[k - W] === 1) (dark[k - W] = 2), stack.push(k - W);
      if (k < W * (H - 1) && dark[k + W] === 1) (dark[k + W] = 2), stack.push(k + W);
    }
    if (size > best) best = size;
  }
  return { file, dark: n / (W * H), blob: best / (W * H), mean: sum / (W * H) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let flagged = 0;
  for (const f of files) {
    try {
      const r = await scan(f);
      const flag = r.blob >= min;
      if (flag) flagged++;
      if (flag || process.env.ALL) console.log(`${flag ? 'DARK ' : '     '}blob=${r.blob.toFixed(3)} dark=${r.dark.toFixed(3)} mean=${r.mean.toFixed(1)}  ${f}`);
    } catch (e) {
      console.log('unreadable', f, e.message);
    }
  }
  console.log(`${files.length} images, ${flagged} flagged (blob >= ${min})`);
}
