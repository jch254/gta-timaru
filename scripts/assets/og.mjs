#!/usr/bin/env node
// @ts-check
/**
 * The link preview picture: what Slack, iMessage, WhatsApp and the rest show in the card when someone pastes
 * https://03.quest (index.html names it in og:image and twitter:image).
 *
 *   node scripts/assets/og.mjs
 *
 * Writes public/og.png, 1200 x 630. It is the title screen with the fingerposts taken off: the same photograph
 * (src/assets/ui/title.jpg), the same shade, grain and print edge, and the wordmark, all straight from
 * src/style.css, with the interface's one size turned up so the lettering still reads at the size of a card.
 * Under the wordmark, in place of the epigraph, one line that says what the game is.
 *
 * Run it again after the title photograph is retaken or the title's lettering changes. The title screen is set
 * in macOS's own faces (nothing is downloaded), so this has to run on a Mac; it stops if one is missing. It
 * uses the Chrome already installed, like scripts/shot.mjs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { CHROME } from '../lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public', 'og.png');
const W = 1200;
const H = 630;
/** --q03-size for the card: the title's h1 is 7.4em of it. */
const SIZE = 17;
const LINE = 'An open-world sandbox. Timaru to Christchurch, by whatever you can drive.';

const css = readFileSync(path.join(ROOT, 'src', 'style.css'), 'utf8');
const photo = readFileSync(path.join(ROOT, 'src', 'assets', 'ui', 'title.jpg')).toString('base64');

// The title screen's own markup (index.html), less the buttons, the controls and the footer. The photograph
// is held still: on the title it drifts.
const html = `<!doctype html>
<html lang="en-NZ">
  <head>
    <meta charset="UTF-8" />
    <style>${css}</style>
    <style>
      :root { --q03-size: ${SIZE}px; }
      #title.has-photo #title-photo { animation: none; }
    </style>
  </head>
  <body>
    <div id="title" class="has-photo">
      <img id="title-photo" src="data:image/jpeg;base64,${photo}" alt="" />
      <div class="title-shade"></div>
      <main class="title-main">
        <div class="title-head">
          <div class="sub">Canterbury &middot; 1995</div>
          <h1>03 Quest</h1>
          <p class="epigraph">${LINE}</p>
        </div>
      </main>
    </div>
  </body>
</html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.$eval('#title-photo', (img) => /** @type {HTMLImageElement} */ (img).decode());

  // Each stack's first face must be on this machine. With it missing, the text is as wide as the fallback
  // it is given, so the two widths differ.
  const missing = await page.evaluate(() => {
    const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
    const width = (/** @type {string} */ font) => ((ctx.font = `40px ${font}`), ctx.measureText('03 Quest, Canterbury').width);
    return ['--q03-display', '--q03-text', '--q03-reo']
      .map((name) => getComputedStyle(document.documentElement).getPropertyValue(name).split(',')[0].trim())
      .filter((face) => width(`${face}, serif`) !== width(`${face}, monospace`));
  });
  if (missing.length) throw new Error(`not installed here: ${missing.join(', ')}. The title screen's faces come with macOS.`);

  const shot = await page.screenshot({ type: 'png' });
  // A photograph, so a dithered palette rather than full colour: about 360 kB where full colour is 1.4 MB,
  // which WhatsApp will not always fetch. The print's grain hides the dither.
  const { size } = await sharp(shot).png({ palette: true, quality: 80, effort: 10 }).toFile(OUT);
  console.log(`public/og.png  ${W} x ${H}  ${Math.round(size / 1024)} kB`);
} finally {
  await browser.close();
}
