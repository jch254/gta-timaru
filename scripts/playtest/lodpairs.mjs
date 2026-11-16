#!/usr/bin/env node
// Before/after crops of every level-of-detail switch seen during a frames.mjs run with lodwatch.js.
//   node scripts/playtest/lodpairs.mjs <frames dir> <log file> [--out prefix] [--max 24]
// For each kind of switch it writes a sheet of pairs (before | after, magnified) and prints how much the crop
// changed across the switch against how much the same crop changed in the frame pair just before it (motion
// alone). A ratio near 1 means the switch is lost in the motion; well above 1 is a visible pop.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const dir = argv[0];
const log = readFileSync(argv[1], 'utf8');
let out = dir + '-lod';
let max = 24;
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--out') out = argv[++i];
  else if (argv[i] === '--max') max = Number(argv[++i]);
}
const name = (n) => join(dir, `f${String(n).padStart(3, '0')}.jpg`);
const switches = [];
for (const line of log.split('\n')) {
  const m = /^f(\d+) (\[.*\])$/.exec(line);
  if (!m) continue;
  for (const s of JSON.parse(m[2])) switches.push({ ...s, f: Number(m[1]) });
}
const meta = await sharp(name(0)).metadata();
const TILE = 200;
const cut = async (f, s, size) => {
  const left = Math.max(0, Math.min(meta.width - size, Math.round(s.x - size / 2)));
  const top = Math.max(0, Math.min(meta.height - size, Math.round(s.y - size * 0.6)));
  return sharp(name(f)).extract({ left, top, width: size, height: size }).resize(TILE, TILE, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
};
const mad = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};
const groups = new Map();
for (const s of switches) {
  if (s.f < 2 || !existsSync(name(s.f))) continue;
  const key = `${s.k}-${s.a}-${s.b}`;
  const size = Math.max(70, Math.min(380, Math.round(5500 / Math.max(4, s.d))));
  const [p2, p1, p0] = await Promise.all([cut(s.f - 2, s, size), cut(s.f - 1, s, size), cut(s.f, s, size)]);
  const list = groups.get(key) ?? [];
  list.push({ s, before: p1, after: p0, change: mad(p1, p0), motion: mad(p2, p1) });
  groups.set(key, list);
}
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
for (const [key, list] of [...groups].sort()) {
  const ratios = list.map((e) => e.change / Math.max(0.5, e.motion));
  console.log(
    `${key.padEnd(18)} n=${String(list.length).padEnd(4)} change=${median(list.map((e) => e.change)).toFixed(1)} motion=${median(list.map((e) => e.motion)).toFixed(1)} ratio median=${median(ratios).toFixed(2)} worst=${Math.max(...ratios).toFixed(2)} dist=${median(list.map((e) => e.s.d))} m`,
  );
  // The sheet shows the strongest pops first.
  const pick = list.sort((a, b) => b.change / Math.max(0.5, b.motion) - a.change / Math.max(0.5, a.motion)).slice(0, max);
  const cols = 4;
  const rows = Math.ceil(pick.length / cols);
  const cell = TILE * 2 + 12;
  const tiles = [];
  for (let i = 0; i < pick.length; i++) {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * (TILE + 6);
    const raw = { raw: { width: TILE, height: TILE, channels: 3 } };
    tiles.push({ input: pick[i].before, ...raw, left: x, top: y }, { input: pick[i].after, ...raw, left: x + TILE + 2, top: y });
  }
  await sharp({ create: { width: cols * cell, height: rows * (TILE + 6), channels: 3, background: '#ff00ff' } })
    .composite(tiles)
    .jpeg({ quality: 90 })
    .toFile(`${out}-${key}.jpg`);
}
console.log(`${switches.length} switches; sheets written to ${out}-<kind>.jpg (before | after, strongest first)`);
