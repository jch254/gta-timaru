#!/usr/bin/env node
// Development aid: a headless screenshot of dev/vegetation.html (the plant viewer). The dev server must be running.
//   node scripts/assets/foliage/view.mjs "kinds=tree-oak,tree-willow&gap=14&dist=30" shots/veg-view.png [1600x900]
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, DEV_URL, GPU_ARGS } from '../../lib.mjs';

const [query = '', out = 'shots/veg-view.png', size = '1600x900'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width, height, deviceScaleFactor: 1 },
  args: [...GPU_ARGS, '--enable-webgl', `--window-size=${width},${height}`],
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warn') && console.log(m.type(), m.text().slice(0, 400)));
  page.on('pageerror', (e) => console.log('error', String(e.message).slice(0, 600)));
  await page.goto(`${(process.env.DEV_URL || DEV_URL).replace(/\/$/, '')}/dev/vegetation.html?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.ready === true', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 400));
  console.log((await page.evaluate('window.vegetation')).join('\n'));
  await page.screenshot({ path: resolve(out) });
  console.log('wrote', resolve(out));
} finally {
  await browser.close();
}
