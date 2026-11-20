#!/usr/bin/env node
// @ts-check
/**
 * The home-screen icons and the favicon, drawn from the one mark (see ASSETS.md, "Interface").
 *
 *   node scripts/assets/icons.mjs
 *
 * Reads docs/art/03-quest-mark.svg and writes
 *   public/apple-touch-icon.png  180 x 180, the plate run square to the edges (iOS rounds the corners itself);
 *   public/icon-512.png          512 x 512 maskable: full-bleed green, the sign scaled into the middle 80 %
 *                                so a launcher's circle or squircle mask never clips the keyline;
 *   index.html                   the <link rel="icon"> data URI, the mark itself with its comments taken out.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MARK = path.join(ROOT, 'docs', 'art', '03-quest-mark.svg');
const INDEX = path.join(ROOT, 'index.html');

const mark = readFileSync(MARK, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim();
const body = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
// The first element is the rounded green plate; the icons draw their own square one in its place.
const plate = body.match(/^<rect[^>]*\/>/);
if (!plate || !plate[0].includes('rx=')) throw new Error(`${MARK}: expected the rounded plate <rect> first`);
const fill = plate[0].match(/fill="([^"]+)"/)?.[1] ?? '#0f6b47';
const sign = body.slice(plate[0].length);

/** @param {number} size @param {number} inset share of the canvas the 32-unit sign fills */
function square(size, inset) {
  const t = 16 * (1 - inset);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"><rect width="32" height="32" fill="${fill}"/><g transform="translate(${t} ${t}) scale(${inset})">${sign}</g></svg>`;
}

for (const [file, size, inset] of /** @type {const} */ ([
  ['apple-touch-icon.png', 180, 1],
  ['icon-512.png', 512, 0.8],
])) {
  await sharp(Buffer.from(square(size, inset))).png({ compressionLevel: 9 }).toFile(path.join(ROOT, 'public', file));
  console.log(`public/${file}  ${size} x ${size}`);
}

// Same escaping as before: single-quoted attributes, and only the characters a data URI cannot carry encoded.
const uri = 'data:image/svg+xml,' + mark.replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23');
const html = readFileSync(INDEX, 'utf8');
const link = /(<link rel="icon" href=")data:image\/svg\+xml,[^"]*(")/;
if (!link.test(html)) throw new Error(`${INDEX}: no <link rel="icon"> data URI to replace`);
writeFileSync(INDEX, html.replace(link, `$1${uri}$2`));
console.log('index.html  favicon data URI');
