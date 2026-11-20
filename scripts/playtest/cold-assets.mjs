// After pnpm build: one cold localhost production boot. No CPU/network throttling.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { CHROME, GPU_ARGS, IPHONE_UA } from '../lib.mjs';

const server = await preview({ preview: { port: 0, host: '127.0.0.1' } });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: GPU_ARGS,
    defaultViewport: { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true } });
  const page = await browser.newPage();
  await page.setUserAgent(IPHONE_UA);
  await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(4000));
  page.on('pageerror', console.error);
  page.on('console', msg => { if (/failed to load|WebGL: INVALID/i.test(msg.text())) console.error(msg.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?dev`);
  await page.click('#btn-new');
  const start = await page.evaluate(() => performance.now());
  await page.click('#btn-start-timaru');
  await page.waitForFunction(() => !document.querySelector('#title') && !!window.dev, { timeout: 120000 });
  const { urls, ...metrics } = await page.evaluate(start => {
    const images = performance.getEntriesByType('resource').filter(r => /(?:_(?:col|nor|rgh)|\/(?:atlas|extra|leaf-\d+))-[\w-]+\.(jpg|webp)$/.test(r.name));
    return { urls: images.map(r => r.name), startToPlayMs: Math.round(performance.now() - start), imageRequests: images.length,
      encodedBodyBytes: images.reduce((n,r) => n+r.encodedBodySize,0), quality: window.dev.ctx.settings.data.quality };
  }, start);
  console.log(metrics);
  // Vite flattens both tiers to the same basename plus a hash. Check the actual served files.
  const expected = new Map();
  for (const dir of ['src/assets/phone-textures', 'src/assets/foliage/mips']) {
    for (const file of await readdir(dir, { recursive: true })) {
      if (/\.(jpg|webp)$/.test(file) && file !== 'leaf-0.webp') expected.set(basename(file), join(dir, file));
    }
  }
  const seen = new Set();
  for (const url of new Set(urls)) {
    const built = basename(new URL(url).pathname);
    const name = built.replace(/-[\w-]{8}\.(jpg|webp)$/, '.$1');
    assert.ok(expected.has(name), `unexpected image: ${built}`);
    assert.ok((await readFile(join('dist/assets', built))).equals(await readFile(expected.get(name))), `wrong tier: ${built}`);
    seen.add(name);
  }
  assert.deepEqual(seen, new Set(expected.keys()));
} finally {
  await browser?.close();
  await server.close();
}
