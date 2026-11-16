#!/usr/bin/env node
// Finds "pops" in a run of frames from scripts/playtest/frames.mjs: places where the picture changes between
// two consecutive frames far more than it does in the frames either side (a level-of-detail switch, something
// appearing), as opposed to steady motion.
//   node scripts/playtest/pops.mjs shots/round3/perf/drive/a --top 12 --out shots/round3/perf/pops-a
// Prints the strongest spikes (frame, block, score) and writes a before/after crop pair for each.
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const dir = argv[0];
let top = 12;
let out = dir + '-pops';
let from = 0;
let to = Infinity;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--top') top = Number(argv[++i]);
  else if (argv[i] === '--out') out = argv[++i];
  else if (argv[i] === '--from') from = Number(argv[++i]);
  else if (argv[i] === '--to') to = Number(argv[++i]);
}
const files = readdirSync(dir).filter((f) => /^f\d+\.jpg$/.test(f)).sort().slice(from, to);
const W = 400;
const H = 225;
const B = 10; // block size in the reduced picture
const bw = W / B;
const bh = Math.floor(H / B);
const load = (f) => sharp(join(dir, f)).resize(W, H, { fit: 'fill' }).raw().toBuffer();
let prev = await load(files[0]);
const diffs = []; // diffs[t][block]: mean absolute difference between frame t and t+1
for (let t = 1; t < files.length; t++) {
  const cur = await load(files[t]);
  const d = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      for (let y = by * B; y < (by + 1) * B; y++) {
        for (let x = bx * B; x < (bx + 1) * B; x++) {
          const k = (y * W + x) * 3;
          sum += Math.abs(cur[k] - prev[k]) + Math.abs(cur[k + 1] - prev[k + 1]) + Math.abs(cur[k + 2] - prev[k + 2]);
        }
      }
      d[by * bw + bx] = sum / (B * B * 3);
    }
  }
  diffs.push(d);
  prev = cur;
}
// A spike: this pair differs much more than the pairs around it in the same block and its neighbours.
const spikes = [];
for (let t = 2; t < diffs.length - 2; t++) {
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let around = 0;
      for (const dt of [-2, -1, 1, 2]) {
        for (let ny = Math.max(0, by - 1); ny <= Math.min(bh - 1, by + 1); ny++) {
          for (let nx = Math.max(0, bx - 1); nx <= Math.min(bw - 1, bx + 1); nx++) around = Math.max(around, diffs[t + dt][ny * bw + nx]);
        }
      }
      const score = diffs[t][by * bw + bx] - around;
      if (score > 6) spikes.push({ t, bx, by, score });
    }
  }
}
// One entry per frame pair: its strongest block and how many blocks spiked.
const byFrame = new Map();
for (const s of spikes) {
  const e = byFrame.get(s.t) ?? { t: s.t, blocks: 0, best: s, total: 0 };
  e.blocks++;
  e.total += s.score;
  if (s.score > e.best.score) e.best = s;
  byFrame.set(s.t, e);
}
const ranked = [...byFrame.values()].sort((a, b) => b.total - a.total).slice(0, top);
mkdirSync(out, { recursive: true });
const meta = await sharp(join(dir, files[0])).metadata();
const sx = meta.width / W;
const sy = meta.height / H;
for (const e of ranked) {
  const { bx, by } = e.best;
  const cw = Math.round(meta.width / 4);
  const ch = Math.round(meta.height / 4);
  const left = Math.max(0, Math.min(meta.width - cw, Math.round((bx + 0.5) * B * sx - cw / 2)));
  const topPx = Math.max(0, Math.min(meta.height - ch, Math.round((by + 0.5) * B * sy - ch / 2)));
  const a = await sharp(join(dir, files[e.t])).extract({ left, top: topPx, width: cw, height: ch }).resize(cw * 2).toBuffer();
  const b = await sharp(join(dir, files[e.t + 1])).extract({ left, top: topPx, width: cw, height: ch }).resize(cw * 2).toBuffer();
  const name = `${files[e.t].replace('.jpg', '')}-${files[e.t + 1].replace('.jpg', '')}.jpg`;
  await sharp({ create: { width: cw * 4 + 8, height: ch * 2, channels: 3, background: '#ff00ff' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: cw * 2 + 8, top: 0 }])
    .jpeg({ quality: 90 })
    .toFile(join(out, name));
  console.log(`${files[e.t]} -> ${files[e.t + 1]}  blocks=${e.blocks} total=${e.total.toFixed(0)} best=${e.best.score.toFixed(1)} at ${Math.round((bx + 0.5) * B * sx)},${Math.round((by + 0.5) * B * sy)}  ${name}`);
}
console.log(`${files.length} frames, ${byFrame.size} frame pairs with a spike; crops in ${out}`);
